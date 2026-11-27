import { blank } from './ioXml';
import { decodeDrawing } from './dsnCodec';
import { projectFolderOpened } from './projectStorage';
import type {
  ProjectStorageRequest,
  ProjectStorageResult,
} from './projectStorage';
import { actionSetDocument } from '../state/dispatcher/AppDispatcher';
import type { docDrawing } from '../state/undo/undo';
import { openSchematicTabs } from '../state/schematicTabs';

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
  const openDrawings = includeOpenDrawings ? new Map(openSchematicTabs(state).flatMap(({ tab }) =>
    typeof tab.file.id === 'string' ? [[tab.file.id, tab.history.present.drawing] as const] : [],
  )) : undefined;
  const { resolveProjectHierarchy } = await import('./projectHierarchy');
  return resolveProjectHierarchy(drawing, project, typeof owner === 'string' ? owner : undefined, false, openDrawings);
}

export async function openProjectFolder(recentId?: string) {
  const root = await projectRequest(
    recentId
      ? { operation: 'open-recent-project-folder', id: recentId }
      : { operation: 'choose-project-folder' },
  );
  if (root)
    window.dispatchEvent(
      new CustomEvent(projectFolderOpened, { detail: root }),
    );
}

export async function openLaunchedProject() {
  const launch = await projectRequest({ operation: 'open-launch' });
  if (!launch) return;
  const root = await projectRequest({
    operation: 'activate-launch',
    ticket: launch.ticket,
  });
  window.dispatchEvent(new CustomEvent(projectFolderOpened, { detail: root }));
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
