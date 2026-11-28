import { blank } from './ioXml';
import { decodeDrawing } from './dsnCodec';
import { checkProjectOpen, hierarchySymbolEvent, projectFolderOpened } from './projectStorage';
import type {
  ProjectOpenLocation,
  ProjectStorageRequest,
  ProjectStorageResult,
} from './projectStorage';
import { actionSetDocument } from '../state/dispatcher/AppDispatcher';
import type { docDrawing } from '../state/undo/undo';
import { openSchematicTabs, schematicTabDirty } from '../state/schematicTabs';
import i18n from '../i18n';
import { updateSymbol } from '../manipulators/updateSymbol';
import { updateView } from '../manipulators/updateView';
import { DocItemTypes, type Coordinate, type DocItem, type dsnSymbol } from '../model/dsnItem';
import type { Dispatch } from 'redux';
import type { MenuEditor } from '../state/actions/menuActions';

export function projectRequest<T extends ProjectStorageRequest>(request: T) {
  return window.electronAPI.projectFiles(request) as Promise<
    ProjectStorageResult[T['operation']]
  >;
}

export function isProjectSchematicPath(project: string, filename: string) {
  const separator = project.includes('\\') ? '\\' : '/';
  const prefix = project.replace(/[\\/]$/, '') + separator;
  return separator === '\\'
    ? filename.toLowerCase().startsWith(prefix.toLowerCase())
    : filename.startsWith(prefix);
}

export async function readCurrentHierarchy(state: docDrawing, includeOpenDrawings = false) {
  const { drawing } = state.docStore.present;
  const project = state.schematicTabs?.projectRoot;
  if (!project) return drawing;
  const owner = state.altStore.file.id;
  const openDrawings = includeOpenDrawings ? openHierarchyEdits(state) : undefined;
  const { resolveProjectHierarchy } = await import('./projectHierarchy');
  return resolveProjectHierarchy(drawing, project, typeof owner === 'string' ? owner : undefined, openDrawings);
}

export function openHierarchyEdits(state: docDrawing) {
  return new Map(openSchematicTabs(state).flatMap(({ tab }) =>
    typeof tab.file.id === 'string' && schematicTabDirty(tab)
      ? [[tab.file.id, tab.history.present.drawing] as const] : [],
  ));
}

function linkedSchematicAt(state: docDrawing, point: Coordinate) {
  const { schematicTabs, docStore: { present } } = state;
  const { view, drawing, editLibrary, heterogeneous } = present;
  const sheet = drawing.sheets[view.selected_sheet];
  if (!schematicTabs?.projectRoot || editLibrary || view.add || !sheet ||
      sheet.hierarchicalSymbol || sheet.kind === 'simulation') return;

  const isLinked = (item: DocItem): item is dsnSymbol =>
    item?.NodeName === DocItemTypes.Symbol && item.hierarchicalFile !== undefined;
  const hit = new updateView().is_inside(view, sheet, point, 0, false, false, heterogeneous);
  if (hit) return isLinked(hit.item) ? hit.item : undefined;

  // A block can have an unfilled outline. Only use its bounds when no item was hit.
  return sheet.items.findLast((item) => {
    if (!isLinked(item) || view.hiddenItemIds?.includes(item._id)) return false;
    const { x1, y1, x2, y2 } = new updateSymbol(item).getBoundingRect();
    return point[0] >= x1 && point[0] <= x2 && point[1] >= y1 && point[1] <= y2;
  });
}

export function handleSchematicDoubleClick(action: MenuEditor) {
  return (dispatch: Dispatch, getState: () => docDrawing) => {
    const item = linkedSchematicAt(getState(), action.p);
    if (!item) {
      dispatch(action);
      return;
    }
    window.dispatchEvent(new CustomEvent(hierarchySymbolEvent, {
      detail: { command: 'open', symbolId: item._id },
    }));
  };
}

export function assertProjectCanOpen(state: docDrawing) {
  if (
    state.altStore.saveInProgress ||
    state.docStore.present.drawingVersion !== state.altStore.savedVersion ||
    openSchematicTabs(state).some(({ tab }) => schematicTabDirty(tab)) ||
    !window.dispatchEvent(new Event(checkProjectOpen, { cancelable: true }))
  ) throw new Error(i18n.t('examples.saveBeforeOpeningProject'));
}

export function activateProjectFolder(root: ProjectOpenLocation) {
  window.dispatchEvent(new CustomEvent(projectFolderOpened, { detail: root }));
}

export async function openProjectFolder(getState: () => docDrawing, recentId?: string) {
  assertProjectCanOpen(getState());
  const root = await projectRequest(
    recentId
      ? { operation: 'open-recent-project-folder', id: recentId }
      : { operation: 'choose-project-folder' },
  );
  if (root) {
    assertProjectCanOpen(getState());
    activateProjectFolder(root);
  }
}

export async function openLaunchedProject(getState: () => docDrawing) {
  assertProjectCanOpen(getState());
  const launch = await projectRequest({ operation: 'open-launch' });
  if (!launch) return;
  assertProjectCanOpen(getState());
  const root = await projectRequest({
    operation: 'activate-launch',
    ticket: launch.ticket,
  });
  assertProjectCanOpen(getState());
  activateProjectFolder(root);
}

export async function readProjectDrawing(file: {
  id: string;
  name: string;
  folder: string;
}, project?: string, snapshot?: { data: Uint8Array; version?: string }) {
  const { data, version } = snapshot ?? await projectRequest({
    operation: 'read',
    id: file.id,
  });
  let drawing = data.length ? await decodeDrawing(data) : blank();
  if (project) {
    const { resolveProjectHierarchy } = await import('./projectHierarchy');
    drawing = await resolveProjectHierarchy(drawing, project, file.id);
  }
  return actionSetDocument(drawing, file.name, file.id, file.folder, version);
}
