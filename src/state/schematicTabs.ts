import type { CurrentFile } from './stores/altStoreReducer';
import type { docDrawing } from './undo/undo';
import type { OpenProjectDrawing } from '../io/projectStorage';
import { DocActionTypes } from './actions/docActions';
import { DocItemTypes } from '../model/dsnItem';
import { ActionCreators } from 'redux-undo';
import type { AppActionTypes } from './dispatcher/AppDispatcher';

export type SchematicSnapshot = {
  history: docDrawing['docStore'];
  file: CurrentFile;
  savedVersion: number;
  simulationPanelVisible: boolean;
  simulationPanelActivated: boolean;
};

export type SchematicTabs = {
  enabled: boolean;
  order: string[];
  inactive: Record<string, SchematicSnapshot>;
};

type TabsAction =
  | { type: 'schematic-tabs/enable'; enabled: boolean }
  | {
      type: 'schematic-tabs/activate';
      key: string;
      location?: OpenProjectDrawing;
    }
  | { type: 'schematic-tabs/remove'; key: string }
  | {
      type: 'schematic-tabs/reload';
      key: string;
      original: SchematicSnapshot;
      document: Extract<AppActionTypes, { type: DocActionTypes.SetDocument }>;
    }
  | {
      type: 'schematic-tabs/saved';
      key: string;
      original: SchematicSnapshot;
      file: CurrentFile;
      savedVersion: number;
    };

export const schematicTabKey = (location?: { id: string; entryId: string }) =>
  location ? JSON.stringify([location.id, location.entryId]) : undefined;

export const schematicTabDirty = (tab: SchematicSnapshot) =>
  tab.history.present.drawingVersion !== tab.savedVersion;

export function activeSchematicSnapshot(state: docDrawing): SchematicSnapshot {
  const {
    file,
    savedVersion,
    simulationPanelVisible,
    simulationPanelActivated,
  } = state.altStore;
  return {
    history: state.docStore,
    file,
    savedVersion,
    simulationPanelVisible,
    simulationPanelActivated,
  };
}

export function openSchematicTabs(state: docDrawing) {
  const tabs = state.schematicTabs;
  if (!tabs?.enabled) return [];
  const selected = schematicTabKey(state.altStore.file.project);
  return tabs.order.flatMap((key) => {
    const tab =
      selected === key ? activeSchematicSnapshot(state) : tabs.inactive[key];
    return tab ? [{ key, tab }] : [];
  });
}

export function linkedSchematicSnapshot(state: docDrawing, projectId: string, entryId: string) {
  const key = schematicTabKey({ id: projectId, entryId });
  return key === schematicTabKey(state.altStore.file.project)
    ? activeSchematicSnapshot(state)
    : state.schematicTabs?.inactive[key];
}

export function reloadSchematicTab(
  key: string,
  original: SchematicSnapshot,
  document: Extract<AppActionTypes, { type: DocActionTypes.SetDocument }>,
): TabsAction {
  return { type: 'schematic-tabs/reload', key, original, document };
}

export function enableSchematicTabs(enabled: boolean): TabsAction {
  return { type: 'schematic-tabs/enable', enabled };
}

export function activateSchematicTab(
  key: string,
  location?: OpenProjectDrawing,
): TabsAction {
  return { type: 'schematic-tabs/activate', key, location };
}

export function removeSchematicTab(key: string): TabsAction {
  return { type: 'schematic-tabs/remove', key };
}

export function savedSchematicTab(
  key: string,
  original: SchematicSnapshot,
  file: CurrentFile,
  savedVersion: number,
): TabsAction {
  return { type: 'schematic-tabs/saved', key, original, file, savedVersion };
}

const disabled: SchematicTabs = { enabled: false, order: [], inactive: {} };

export function withSchematicTabs(
  reduce: (state: docDrawing | undefined, action: AppActionTypes) => docDrawing,
) {
  return (
    state: docDrawing | undefined,
    raw: AppActionTypes | TabsAction,
  ): docDrawing => {
    const tabs = state?.schematicTabs ?? disabled;
    const active = schematicTabKey(state?.altStore.file.project);
    if (raw.type === 'schematic-tabs/enable' && state)
      return {
        ...state,
        schematicTabs: raw.enabled
          ? { enabled: true, order: active ? [active] : [], inactive: {} }
          : disabled,
      };
    if (!state) return reduce(state, raw as AppActionTypes);
    if (!tabs.enabled) {
      const { schematicTabs: _, ...editor } = state;
      return reduce(editor, raw as AppActionTypes);
    }

    if (raw.type === 'schematic-tabs/activate') {
      const selected =
        active === raw.key
          ? activeSchematicSnapshot(state)
          : tabs.inactive[raw.key];
      if (!selected || state.altStore.saveInProgress) return state;
      const inactive = { ...tabs.inactive };
      if (active && active !== raw.key)
        inactive[active] = activeSchematicSnapshot(state);
      delete inactive[raw.key];
      let history = selected.history;
      const location = raw.location;
      if (location?.openSheetId) {
        const present = history.present;
        const index = present.drawing.sheets.findIndex(
          ({ id }) => id === location.openSheetId,
        );
        if (index >= 0) {
          const unit = present.drawing.sheets[index].items.find(
            (item) =>
              item.NodeName === DocItemTypes.Symbol &&
              item.unitId === location.openUnitId,
          );
          history = {
            ...history,
            present: {
              ...present,
              view: {
                ...present.view,
                selected_sheet: index,
                _selected_array: unit ? [unit._id] : [],
                _selected_handle: 0,
                hover_obj: null,
                hover_pins:
                  unit && location.openPinId
                    ? [`${unit._id}:@${location.openPinId}`]
                    : [],
              },
            },
          };
        }
      }
      return {
        docStore: history,
        altStore: {
          ...state.altStore,
          file: location
            ? { ...selected.file, project: location }
            : selected.file,
          savedVersion: selected.savedVersion,
          simulationPanelVisible: selected.simulationPanelVisible,
          simulationPanelActivated: selected.simulationPanelActivated,
        },
        schematicTabs: { ...tabs, inactive },
      };
    }
    if (raw.type === 'schematic-tabs/remove') {
      const inactive = { ...tabs.inactive };
      delete inactive[raw.key];
      return {
        ...state,
        schematicTabs: {
          ...tabs,
          order: tabs.order.filter((key) => key !== raw.key),
          inactive,
        },
      };
    }
    if (raw.type === 'schematic-tabs/reload') {
      const original = tabs.inactive[raw.key];
      if (original !== raw.original || schematicTabDirty(original)) return state;
      const reloaded = reduce({
        docStore: original.history,
        altStore: {
          ...state.altStore,
          file: original.file,
          savedVersion: original.savedVersion,
        },
      }, raw.document);
      const fresh = reduce(reloaded, ActionCreators.clearHistory() as AppActionTypes);
      return {
        ...state,
        schematicTabs: {
          ...tabs,
          inactive: { ...tabs.inactive, [raw.key]: activeSchematicSnapshot(fresh) },
        },
      };
    }
    if (raw.type === 'schematic-tabs/saved') {
      if (tabs.inactive[raw.key] !== raw.original) return state;
      return {
        ...state,
        schematicTabs: {
          ...tabs,
          inactive: {
            ...tabs.inactive,
            [raw.key]: {
              ...raw.original,
              file: raw.file,
              savedVersion: raw.savedVersion,
            },
          },
        },
      };
    }

    // Keep the tab registry out of the existing document reducers.
    const { schematicTabs: _, ...editor } = state;
    const next = reduce(editor, raw as AppActionTypes);
    const incoming = schematicTabKey(next.altStore.file.project);
    if (incoming === active)
      return next === editor ? state : { ...next, schematicTabs: tabs };
    const inactive = { ...tabs.inactive };
    const order = [...tabs.order];
    if (active && raw.type === DocActionTypes.SetDocument && incoming) {
      inactive[active] = activeSchematicSnapshot(state);
      if (!order.includes(active)) order.push(active);
    } else if (active) {
      const index = order.indexOf(active);
      if (index >= 0) order.splice(index, 1);
    }
    if (incoming) {
      delete inactive[incoming];
      if (!order.includes(incoming)) order.push(incoming);
    }
    return { ...next, schematicTabs: { enabled: true, order, inactive } };
  };
}
