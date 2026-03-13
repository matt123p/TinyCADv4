import { Store } from 'redux';
import { dsnDrawing, dsnSheet } from '../../model/dsnDrawing';
import { DocItem, DocItemTypes } from '../../model/dsnItem';
import { NetlistData } from './netlistGenerator';
import { docDrawing } from '../../state/undo/undo';
import { wkrInitNetlist, wkrUpdateNetlistSheets } from '../../web-worker/worker';

const netlistDebug = process.env.NODE_ENV === 'development';
const netlistIdleDelayMs = 1000;

function netlistLog(message: string, data?: any) {
  if (!netlistDebug) {
    return;
  }
  if (typeof data === 'undefined') {
    console.log(`[netlist-sync] ${message}`);
  } else {
    console.log(`[netlist-sync] ${message}`, data);
  }
}

const netlistActiveTypes = new Set<DocItemTypes>([
  DocItemTypes.Symbol,
  DocItemTypes.Wire,
  DocItemTypes.Power,
  DocItemTypes.Label,
  DocItemTypes.Junction,
  DocItemTypes.NoConnect,
]);

function isNetlistActiveItem(item: DocItem): boolean {
  return netlistActiveTypes.has(item.NodeName);
}

function toActiveItemMap(sheet: dsnSheet): Map<number, DocItem> {
  const result = new Map<number, DocItem>();
  for (let i = 0; i < sheet.items.length; ++i) {
    const item = sheet.items[i];
    if (isNetlistActiveItem(item)) {
      result.set(item._id, item);
    }
  }
  return result;
}

function isNetlistActiveSheetChanged(prevSheet: dsnSheet, nextSheet: dsnSheet) {
  const prevActiveItems = toActiveItemMap(prevSheet);
  const nextActiveItems = toActiveItemMap(nextSheet);

  if (prevActiveItems.size !== nextActiveItems.size) {
    return true;
  }

  for (const [id, nextItem] of nextActiveItems) {
    const prevItem = prevActiveItems.get(id);
    if (!prevItem || prevItem !== nextItem) {
      return true;
    }
  }

  return false;
}

function toSheetMap(drawing: dsnDrawing): Map<string, dsnSheet> {
  const result = new Map<string, dsnSheet>();
  for (let i = 0; i < drawing.sheets.length; ++i) {
    const sheet = drawing.sheets[i];
    result.set(sheet.name, sheet);
  }
  return result;
}

function findNetlistDirtySheets(prev: dsnDrawing, next: dsnDrawing) {
  const prevSheets = toSheetMap(prev);
  const nextSheets = toSheetMap(next);

  const removedSheets = Array.from(prevSheets.keys()).filter(
    (name) => !nextSheets.has(name),
  );

  const changedSheets: dsnSheet[] = [];
  for (const [name, nextSheet] of nextSheets) {
    const prevSheet = prevSheets.get(name);
    if (!prevSheet) {
      changedSheets.push(nextSheet);
      continue;
    }

    if (prevSheet === nextSheet) {
      continue;
    }

    if (isNetlistActiveSheetChanged(prevSheet, nextSheet)) {
      changedSheets.push(nextSheet);
    }
  }

  return {
    removedSheets,
    changedSheets,
  };
}

type NetlistListener = (netlist: NetlistData | null) => void;

let currentNetlist: NetlistData | null = null;
const listeners = new Set<NetlistListener>();

function publishNetlist(netlist: NetlistData | null) {
  currentNetlist = netlist;
  for (const listener of listeners) {
    listener(currentNetlist);
  }
}

export function subscribeNetlist(listener: NetlistListener) {
  listeners.add(listener);
  listener(currentNetlist);
  return () => {
    listeners.delete(listener);
  };
}

export function initializeNetlistSync(store: Store) {
  let previousDrawing: dsnDrawing | null = null;
  let previousVersion = -1;
  let running = false;
  let resyncRequested = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const sync = async () => {
    const state = store.getState() as docDrawing;
    const present = state.docStore.present;

    if (present.editSymbol) {
      previousDrawing = null;
      previousVersion = -1;
      return;
    }

    const drawing = present.drawing;
    const drawingVersion = present.drawingVersion;

    if (!drawing) {
      return;
    }

    if (previousDrawing === null || drawingVersion === 0) {
      netlistLog('full init', {
        drawingVersion,
        sheets: drawing.sheets.map((s) => s.name),
      });
      const netlist = await wkrInitNetlist(drawing);
      publishNetlist(netlist);
      previousDrawing = drawing;
      previousVersion = drawingVersion;
      return;
    }

    if (drawing === previousDrawing || drawingVersion === previousVersion) {
      return;
    }

    const delta = findNetlistDirtySheets(previousDrawing, drawing);
    if (delta.changedSheets.length > 0 || delta.removedSheets.length > 0) {
      netlistLog('incremental update', {
        drawingVersion,
        changedSheets: delta.changedSheets.map((s) => s.name),
        removedSheets: delta.removedSheets,
      });
      const netlist = await wkrUpdateNetlistSheets(
        delta.changedSheets,
        delta.removedSheets,
      );
      publishNetlist(netlist);
    } else {
      netlistLog('no netlist-active changes');
    }

    previousDrawing = drawing;
    previousVersion = drawingVersion;
  };

  const scheduleSync = async () => {
    if (running) {
      resyncRequested = true;
      return;
    }

    running = true;
    try {
      do {
        resyncRequested = false;
        await sync();
      } while (resyncRequested);
    } catch {
      // Ignore sync errors to preserve current behavior.
    } finally {
      running = false;
    }
  };

  const requestSyncWhenIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    idleTimer = setTimeout(() => {
      idleTimer = null;
      void scheduleSync();
    }, netlistIdleDelayMs);
  };

  store.subscribe(() => {
    requestSyncWhenIdle();
  });

  requestSyncWhenIdle();
}
