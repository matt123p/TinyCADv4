import { decodeDrawing } from './dsnCodec';
import { projectFolderOpened } from './projectStorage';
import type {
  ProjectStorageRequest,
  ProjectStorageResult,
} from './projectStorage';
import { actionSetDocument } from '../state/dispatcher/AppDispatcher';

export function projectRequest<T extends ProjectStorageRequest>(request: T) {
  return window.electronAPI.projectFiles(request) as Promise<
    ProjectStorageResult[T['operation']]
  >;
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
}) {
  const { data, version } = await projectRequest({
    operation: 'read',
    id: file.id,
  });
  const drawing = await decodeDrawing(data);
  return actionSetDocument(drawing, file.name, file.id, file.folder, version);
}
