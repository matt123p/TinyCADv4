import type { DrcError } from '../model/dsnDrawing';
import type { docDrawing } from './undo/undo';
import { activeSchematicTabKey } from './schematicTabs';

export const projectDrcResultSelected = 'tinycad:project-drc-result-selected';

export function projectDrcDrawing(state: docDrawing) {
  const id = state.altStore.projectDrcTabKey;
  const tabs = state.schematicTabs;
  if (!id || !tabs?.projectRoot) return undefined;
  const drawing = state.docStore.present.drawing;
  if (activeSchematicTabKey(state) === id) return { drawing, name: state.altStore.file.name };
  const tab = tabs.inactive[id];
  if (tab) return { drawing: tab.history.present.drawing, name: tab.file.name };
}

export function drcResultInActiveDrawing(state: docDrawing, result: DrcError) {
  if (result.source?.fileId) return result.source.fileId === state.altStore.file.id;
  return !state.schematicTabs?.projectRoot || !state.altStore.projectDrcTabKey ||
    state.altStore.projectDrcTabKey === activeSchematicTabKey(state);
}
