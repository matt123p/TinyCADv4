import { NetlistData } from '../io/netlists/netlistGenerator';
import { dsnDrawing, dsnSheet } from '../model/dsnDrawing';
import { NetlistWorkerState } from './netlistState';

type WorkerCommand =
  | 'netlist-init'
  | 'netlist-update'
  | 'netlist-get'
  | 'netlist';

interface WorkerRequest {
  id: number;
  command: WorkerCommand;
  payload?: any;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  data?: any;
  error?: string;
}

class WorkerTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerTransportError';
  }
}

let myWorker: Worker | null = null;
let requestId = 1;
let netlistInitialized = false;
let preferLocalRunner = false;
let localRunnerWarningShown = false;
let lastDrawingSnapshot: dsnDrawing | null = null;
let localState: NetlistWorkerState | null = null;
let localNetlistInitialized = false;
let retainNetlistState = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();

function releaseNetlistWhenIdle() {
  if (retainNetlistState || pending.size || releaseTimer !== undefined) return;
  // Let the request consumer finish publishing its netlist before clearing the cache.
  releaseTimer = setTimeout(() => {
    releaseTimer = undefined;
    if (retainNetlistState || pending.size) return;
    myWorker?.terminate();
    myWorker = null;
    netlistInitialized = false;
    lastDrawingSnapshot = null;
    localState = null;
    localNetlistInitialized = false;
  }, 0);
}

export function retainSchematicNetlist(retain: boolean) {
  retainNetlistState = retain;
  if (!retain) releaseNetlistWhenIdle();
}

function cloneDrawingSnapshot(drawing: dsnDrawing): dsnDrawing {
  return {
    ...drawing,
    sheets: drawing.sheets.slice(),
  };
}

function applySheetDeltaToSnapshot(
  sheets: dsnSheet[],
  removedSheets: string[],
) {
  if (!lastDrawingSnapshot) {
    return;
  }

  const nextSheets = lastDrawingSnapshot.sheets.filter(
    (sheet) => !removedSheets.includes(sheet.name),
  );

  for (let index = 0; index < sheets.length; ++index) {
    const sheet = sheets[index];
    const existingIndex = nextSheets.findIndex((entry) => entry.name === sheet.name);
    if (existingIndex >= 0) {
      nextSheets[existingIndex] = sheet;
    } else {
      nextSheets.push(sheet);
    }
  }

  lastDrawingSnapshot = {
    ...lastDrawingSnapshot,
    sheets: nextSheets,
  };
}

function getLocalState(): NetlistWorkerState {
  if (!localState) {
    localState = new NetlistWorkerState();
  }

  return localState;
}

function ensureLocalStateInitialized() {
  if (localNetlistInitialized || !lastDrawingSnapshot) {
    return;
  }

  getLocalState().init(lastDrawingSnapshot);
  localNetlistInitialized = true;
}

function runLocal(command: WorkerCommand, payload?: any) {
  const state = getLocalState();

  switch (command) {
    case 'netlist-init':
      localNetlistInitialized = true;
      return Promise.resolve(state.init(payload.drawing));
    case 'netlist-update':
      if (!localNetlistInitialized) {
        ensureLocalStateInitialized();
        return Promise.resolve(state.get());
      }
      return Promise.resolve(
        state.update(payload.sheets || [], payload.removedSheets || []),
      );
    case 'netlist-get':
      ensureLocalStateInitialized();
      return Promise.resolve(state.get());
    case 'netlist':
      localNetlistInitialized = true;
      return Promise.resolve(state.init(payload));
  }
}

function activateLocalRunner(error: Error) {
  preferLocalRunner = true;
  myWorker = null;

  if (!localRunnerWarningShown) {
    console.warn(
      '[netlist-worker] Falling back to in-process netlist runner.',
      error,
    );
    localRunnerWarningShown = true;
  }
}

function getWorker(): Worker {
  if (!myWorker) {
    try {
      myWorker = new Worker(new URL('./main.ts', import.meta.url), {
        type: 'module',
        name: 'tinycad-schematic-netlist',
      });
    } catch (error) {
      throw new WorkerTransportError(
        error instanceof Error ? error.message : 'Failed to create netlist worker',
      );
    }

    myWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (!response || !Number.isInteger(response.id) || typeof response.ok !== 'boolean') {
        return;
      }
      const waiter = pending.get(response.id);
      if (!waiter) {
        return;
      }
      pending.delete(response.id);
      if (response.ok) {
        waiter.resolve(response.data);
      } else {
        waiter.reject(new Error(response.error || 'Worker request failed'));
      }
    };

    myWorker.onerror = (event: ErrorEvent) => {
      for (const [id, waiter] of pending) {
        waiter.reject(
          new WorkerTransportError(event.message || 'Netlist worker crashed'),
        );
        pending.delete(id);
      }
      myWorker = null;
      netlistInitialized = false;
    };
  }
  return myWorker;
}

function runWorker(command: WorkerCommand, payload?: any) {
  if (preferLocalRunner) {
    return Promise.resolve().then(() => runLocal(command, payload)).finally(releaseNetlistWhenIdle);
  }

  return new Promise<any>((resolve, reject) => {
    const id = requestId++;
    try {
      const worker = getWorker();
      pending.set(id, { resolve, reject });
      const request: WorkerRequest = { id, command, payload };
      worker.postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(
        error instanceof WorkerTransportError
          ? error
          : new WorkerTransportError(
              error instanceof Error
                ? error.message
                : 'Failed to dispatch netlist worker request',
            ),
      );
    }
  }).catch((error: Error) => {
    if (!(error instanceof WorkerTransportError)) {
      throw error;
    }

    activateLocalRunner(error);
    return runLocal(command, payload);
  }).finally(releaseNetlistWhenIdle);
}

export async function wkrInitNetlist(drawing: dsnDrawing): Promise<NetlistData> {
  lastDrawingSnapshot = cloneDrawingSnapshot(drawing);
  const data = await runWorker('netlist-init', { drawing });
  netlistInitialized = true;
  return data as NetlistData;
}

export async function wkrUpdateNetlistSheets(
  sheets: dsnSheet[],
  removedSheets: string[],
): Promise<NetlistData> {
  applySheetDeltaToSnapshot(sheets, removedSheets);
  if (!netlistInitialized) {
    return runWorker('netlist-get');
  }
  return runWorker('netlist-update', {
    sheets,
    removedSheets,
  });
}

export async function wkrGetNetlist(): Promise<NetlistData> {
  return runWorker('netlist-get');
}

export function wkrGenerateNetlist(drawing: dsnDrawing): Promise<NetlistData> {
  const cachedSheets = lastDrawingSnapshot?.sheets;
  if (!retainNetlistState || !netlistInitialized ||
      cachedSheets?.length !== drawing.sheets.length ||
      drawing.sheets.some((sheet, index) => sheet !== cachedSheets[index])) {
    return wkrInitNetlist(drawing);
  }
  return wkrGetNetlist();
}
