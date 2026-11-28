import { retainSchematicNetlist } from '../../web-worker/worker';
import { Store } from 'redux';
import { dsnDrawing, dsnSheet } from '../../model/dsnDrawing';
import { DocItem, DocItemTypes, dsnWire } from '../../model/dsnItem';
import { NetlistData } from './netlistGenerator';
import { docDrawing } from '../../state/undo/undo';
import { wkrInitNetlist, wkrUpdateNetlistSheets } from '../../web-worker/worker';
import { actionStampWireNetTypes } from '../../state/dispatcher/AppDispatcher';

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

function areNetlistActiveItemsEqual(prevItem: DocItem, nextItem: DocItem): boolean {
  if (prevItem === nextItem) return true;
  // For wires, only d_points affect netlist topology — ignore net_type changes
  if (
    prevItem.NodeName === DocItemTypes.Wire &&
    nextItem.NodeName === DocItemTypes.Wire
  ) {
    const pw = prevItem as dsnWire;
    const nw = nextItem as dsnWire;
    return (
      pw.d_points[0][0] === nw.d_points[0][0] &&
      pw.d_points[0][1] === nw.d_points[0][1] &&
      pw.d_points[1][0] === nw.d_points[1][0] &&
      pw.d_points[1][1] === nw.d_points[1][1]
    );
  }
  return false;
}

function isNetlistActiveSheetChanged(prevSheet: dsnSheet, nextSheet: dsnSheet) {
  const prevActiveItems = toActiveItemMap(prevSheet);
  const nextActiveItems = toActiveItemMap(nextSheet);

  if (prevActiveItems.size !== nextActiveItems.size) {
    return true;
  }

  for (const [id, nextItem] of nextActiveItems) {
    const prevItem = prevActiveItems.get(id);
    if (!prevItem || !areNetlistActiveItemsEqual(prevItem, nextItem)) {
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
let netlistDrawing: dsnDrawing | null = null;
const listeners = new Set<NetlistListener>();
let updateDemand: (() => void) | undefined;

function publishNetlist(netlist: NetlistData, drawing: dsnDrawing) {
  currentNetlist = netlist;
  netlistDrawing = drawing;
  for (const listener of listeners) {
    listener(currentNetlist);
  }
}

export function getCurrentNetlist(drawing: dsnDrawing): NetlistData | null {
  if (!netlistDrawing) {
    return null;
  }
  if (drawing.sheets !== netlistDrawing.sheets) {
    const { changedSheets, removedSheets } = findNetlistDirtySheets(netlistDrawing, drawing);
    if (changedSheets.length || removedSheets.length) {
      return null;
    }
  }
  return currentNetlist;
}

export function subscribeNetlist(listener: NetlistListener) {
  listeners.add(listener);
  listener(currentNetlist);
  if (listeners.size === 1) updateDemand?.();
  return () => {
    if (listeners.delete(listener) && listeners.size === 0) updateDemand?.();
  };
}

export function initializeNetlistSync(store: Store) {
  let previousDrawing: dsnDrawing | null = null;
  let previousVersion = -1;
  let previousHierarchyRevision = 0;
  let running = false;
  let resyncRequested = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const sync = async () => {
    if (!listeners.size) return;
    const observed = generation;
    const state = store.getState() as docDrawing;
    const present = state.docStore.present;

    if (present.editSymbol) {
      previousDrawing = null;
      previousVersion = -1;
      previousHierarchyRevision = 0;
      return;
    }

    const drawing = present.drawing;
    const drawingVersion = present.drawingVersion;
    const hierarchyRevision = present.hierarchyRevision ?? 0;

    if (!drawing) {
      return;
    }

    // Publishing a netlist dispatches an internal action. At version zero that
    // notification must not initialize the same drawing again indefinitely.
    if (drawing === previousDrawing) {
      return;
    }

    if (previousDrawing === null || drawingVersion === 0) {
      netlistLog('full init', {
        drawingVersion,
        sheets: drawing.sheets.map((s) => s.name),
      });
      const netlist = await wkrInitNetlist(drawing);
      if (observed !== generation) return;
      publishNetlist(netlist, drawing);
      store.dispatch(actionStampWireNetTypes(netlist));
      previousDrawing = drawing;
      previousVersion = drawingVersion;
      previousHierarchyRevision = hierarchyRevision;
      return;
    }

    if (drawingVersion === previousVersion && hierarchyRevision === previousHierarchyRevision) {
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
      if (observed !== generation) return;
      publishNetlist(netlist, drawing);
      store.dispatch(actionStampWireNetTypes(netlist));
    } else {
      netlistLog('no netlist-active changes');
    }

    previousDrawing = drawing;
    previousVersion = drawingVersion;
    previousHierarchyRevision = hierarchyRevision;
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
    if (!listeners.size) return;
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

  updateDemand = () => {
    retainSchematicNetlist(listeners.size > 0);
    generation++;
    if (listeners.size) {
      requestSyncWhenIdle();
    } else {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      currentNetlist = null;
      netlistDrawing = null;
      previousDrawing = null;
      previousVersion = -1;
      previousHierarchyRevision = 0;
    }
  };
  updateDemand();
}
