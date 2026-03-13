import { NetlistData } from '../io/netlists/netlistGenerator';
import { dsnDrawing, dsnSheet } from '../model/dsnDrawing';

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

let myWorker: Worker | null = null;
let requestId = 1;
let netlistInitialized = false;
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
  if (!myWorker) {
    myWorker = new Worker(new URL('./main.ts', import.meta.url), {
      type: 'module',
    });

    myWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
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

    myWorker.onerror = () => {
      for (const [id, waiter] of pending) {
        waiter.reject(new Error('Netlist worker crashed'));
        pending.delete(id);
      }
      myWorker = null;
      netlistInitialized = false;
    };
  }
  return myWorker;
}

function runWorker(command: WorkerCommand, payload?: any) {
  return new Promise<any>((resolve, reject) => {
    const id = requestId++;
    const worker = getWorker();
    pending.set(id, { resolve, reject });
    const request: WorkerRequest = { id, command, payload };
    worker.postMessage(request);
  });
}

export async function wkrInitNetlist(drawing: dsnDrawing): Promise<NetlistData> {
  const data = await runWorker('netlist-init', { drawing });
  netlistInitialized = true;
  return data as NetlistData;
}

export async function wkrUpdateNetlistSheets(
  sheets: dsnSheet[],
  removedSheets: string[],
): Promise<NetlistData> {
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
  if (!netlistInitialized) {
    return wkrInitNetlist(drawing);
  }
  return wkrGetNetlist();
}
