import type { CurrentFile } from './stores/altStoreReducer';
import { isDrawingFile } from '../../shared/drawingFiles';
import type { docDrawing } from './undo/undo';
import { DocActionTypes } from './actions/docActions';
import { ActionCreators } from 'redux-undo';
import type { SetMousePosition } from './actions/viewActions';
import type { AppActionTypes } from './dispatcher/AppDispatcher';

export type SchematicSnapshot = {
  history: docDrawing['docStore'];
  exampleExplanation: docDrawing['altStore']['exampleExplanation'];
  exampleExplanationVisible: boolean;
  file: CurrentFile;
  savedVersion: number;
  simulationPanelVisible: boolean;
  simulationPanelActivated: boolean;
};

export type SchematicTabs = {
  enabled: boolean;
  projectRoot?: string;
  order: string[];
  inactive: Record<string, SchematicSnapshot>;
};

type EditorAction = AppActionTypes | SetMousePosition;

type TabsAction =
  | { type: 'schematic-tabs/enable'; enabled: boolean; projectRoot?: string }
  | {
      type: 'schematic-tabs/activate';
      key: string;
    }
  | { type: 'schematic-tabs/remove'; key: string }
  | { type: 'schematic-tabs/relocate'; files: Record<string, CurrentFile> }
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

export const schematicFileTabKey = (file?: CurrentFile) =>
  typeof file?.id === 'string' && file.id && isDrawingFile(file.name)
    ? JSON.stringify([file.id])
    : undefined;

export function activeSchematicTabKey(state?: docDrawing) {
  if (!state || state.docStore.present.editLibrary) return;
  const id = state.docStore.present.drawing.documentId;
  return (
    schematicFileTabKey(state.altStore.file) ??
    (id ? JSON.stringify(['untitled', id]) : undefined)
  );
}

export const schematicTabDirty = (tab: SchematicSnapshot) =>
  tab.history.present.drawingVersion !== tab.savedVersion;

export function activeSchematicSnapshot(state: docDrawing): SchematicSnapshot {
  const {
    file,
    exampleExplanation,
    exampleExplanationVisible,
    savedVersion,
    simulationPanelVisible,
    simulationPanelActivated,
  } = state.altStore;
  return {
    history: state.docStore,
    file,
    exampleExplanation,
    exampleExplanationVisible,
    savedVersion,
    simulationPanelVisible,
    simulationPanelActivated,
  };
}

export function openSchematicTabs(state: docDrawing) {
  const tabs = state.schematicTabs;
  if (!tabs?.enabled) return [];
  const selected = activeSchematicTabKey(state);
  return tabs.order.flatMap((key) => {
    const tab =
      selected === key ? activeSchematicSnapshot(state) : tabs.inactive[key];
    return tab ? [{ key, tab }] : [];
  });
}

export function reloadSchematicTab(
  key: string,
  original: SchematicSnapshot,
  document: Extract<AppActionTypes, { type: DocActionTypes.SetDocument }>,
): TabsAction {
  return { type: 'schematic-tabs/reload', key, original, document };
}

export function enableSchematicTabs(
  enabled: boolean,
  projectRoot?: string,
): TabsAction {
  return { type: 'schematic-tabs/enable', enabled, projectRoot };
}

export function activateSchematicTab(key: string): TabsAction {
  return { type: 'schematic-tabs/activate', key };
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

export function relocateSchematicTabs(
  files: Record<string, CurrentFile>,
): TabsAction {
  return { type: 'schematic-tabs/relocate', files };
}

const disabled: SchematicTabs = { enabled: false, order: [], inactive: {} };

export function withSchematicTabs(
  reduce: (state: docDrawing | undefined, action: EditorAction) => docDrawing,
) {
  return (
    state: docDrawing | undefined,
    raw: EditorAction | TabsAction,
  ): docDrawing => {
    const tabs = state?.schematicTabs ?? disabled;
    const active = activeSchematicTabKey(state);
    if (raw.type === 'schematic-tabs/enable' && state)
      return {
        ...state,
        altStore: { ...state.altStore, projectDrcTabKey: undefined },
        schematicTabs: raw.enabled
          ? {
              enabled: true,
              projectRoot: raw.projectRoot,
              order: active ? [active] : [],
              inactive: {},
            }
          : disabled,
      };
    if (!state) return reduce(state, raw as EditorAction);
    if (!tabs.enabled) {
      const { schematicTabs: _, ...editor } = state;
      return reduce(editor, raw as EditorAction);
    }

    if (raw.type === 'schematic-tabs/relocate') {
      const inactive = Object.fromEntries(
        Object.entries(tabs.inactive).map(([key, tab]) => {
          const file = raw.files[key];
          return file
            ? [schematicFileTabKey(file), { ...tab, file }]
            : [key, tab];
        }),
      );
      const file = raw.files[active] ?? state.altStore.file;
      return {
        ...state,
        altStore: { ...state.altStore, file },
        schematicTabs: {
          ...tabs,
          order: tabs.order.map((key) =>
            raw.files[key] ? schematicFileTabKey(raw.files[key]) : key,
          ),
          inactive,
        },
      };
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
      return {
        docStore: selected.history,
        altStore: {
          ...state.altStore,
          file: selected.file,
          exampleExplanation: selected.exampleExplanation,
          exampleExplanationVisible: selected.exampleExplanationVisible,
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
      if (original !== raw.original || schematicTabDirty(original))
        return state;
      const reloaded = reduce(
        {
          docStore: original.history,
          altStore: {
            ...state.altStore,
            file: original.file,
            savedVersion: original.savedVersion,
          },
        },
        raw.document,
      );
      const fresh = reduce(
        reloaded,
        ActionCreators.clearHistory() as AppActionTypes,
      );
      return {
        ...state,
        schematicTabs: {
          ...tabs,
          inactive: {
            ...tabs.inactive,
            [raw.key]: activeSchematicSnapshot(fresh),
          },
        },
      };
    }
    if (raw.type === 'schematic-tabs/saved') {
      if (tabs.inactive[raw.key] !== raw.original) return state;
      const key = schematicFileTabKey(raw.file) ?? raw.key;
      const inactive = { ...tabs.inactive };
      delete inactive[raw.key];
      inactive[key] = {
        ...raw.original,
        file: raw.file,
        savedVersion: raw.savedVersion,
      };
      return {
        ...state,
        schematicTabs: {
          ...tabs,
          order: tabs.order.map((id) => (id === raw.key ? key : id)),
          inactive,
        },
      };
    }

    // Keep the tab registry out of the existing document reducers.
    const { schematicTabs: _, ...editor } = state;
    const next = reduce(editor, raw as EditorAction);
    const incoming = activeSchematicTabKey(next);
    if (incoming === active)
      return next === editor ? state : { ...next, schematicTabs: tabs };
    const inactive = { ...tabs.inactive };
    const order = [...tabs.order];
    if (active && raw.type === DocActionTypes.SetDocument) {
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
    return { ...next, schematicTabs: { ...tabs, order, inactive } };
  };
}
