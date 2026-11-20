import { ActionCreators } from 'redux-undo';
import type { Dispatch } from 'redux';
import { isCompressedDrawing } from '../../shared/drawingFiles';
import { projectFileTitle } from '../../shared/projectFiles';
import { decodeDrawing, encodeDrawing } from './dsnCodec';
import { blank } from './ioXml';
import { userManager } from './files';
import {
  decodeProjectArchive,
  encodeProjectArchive,
  projectEntryPath,
} from '../pcb/projectArchive';
import type { PcbProject, ProjectEntry } from '../pcb/projectArchive';
import type { dsnDrawing } from '../model/dsnDrawing';
import { withoutResults } from '../simulation/document';
import {
  actionSelectDialog,
  actionSetDocument,
  actionSetFileData,
  actionSetSaveInProgress,
} from '../state/dispatcher/AppDispatcher';
import type { docDrawing } from '../state/undo/undo';
import { projectFileName } from './projectStorage';
import {
  deleteRecoveryDraft,
  projectRecoveryKey,
  readRecoveryDraft,
} from './projectRecovery';
import type {
  OpenProjectDrawing,
  ProjectFile,
  ProjectStorageRequest,
  ProjectStorageResult,
} from './projectStorage';

export const projectFilesChanged = 'tinycad:project-files-changed';

export function projectRequest<T extends ProjectStorageRequest>(
  request: T,
): Promise<ProjectStorageResult[T['operation']]> {
  if (process.env.TARGET_SYSTEM === 'electron')
    return window.electronAPI.projectFiles(request);
  if (process.env.TARGET_SYSTEM === 'google' && userManager?.projectFiles)
    return userManager.projectFiles(request) as Promise<
      ProjectStorageResult[T['operation']]
    >;
  return Promise.reject(
    new Error(
      'Project storage is available in Electron and Google Drive mode.',
    ),
  );
}

export async function readProject(id: string) {
  const { data, version } = await projectRequest({ operation: 'read', id });
  return { data, version, project: await decodeProjectArchive(data) };
}

async function drawingEntry(drawing: dsnDrawing): Promise<ProjectEntry> {
  const data = await encodeDrawing(drawing);
  const id = drawing.documentId.toLowerCase();
  return {
    kind: 'schematic',
    id,
    path: projectEntryPath('schematic', id, isCompressedDrawing(data)),
    data,
  };
}

export async function createProjectFile(
  folder: string,
  title: string,
  sourceId?: string,
): Promise<ProjectFile> {
  const name = projectFileName(title);
  const source = sourceId ? (await readProject(sourceId)).project : undefined;
  const bytes = await encodeProjectArchive({
    projectId: source?.projectId || crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    parentRevisionId: source?.revisionId,
    requiredFeatures: source?.requiredFeatures || [],
    title: projectFileTitle(name),
    entries: source?.entries || [await drawingEntry(blank())],
  });
  return projectRequest({ operation: 'write', folder, name, data: bytes });
}

export type OpenProjectAction = {
  type: 'file-open-project';
  location: Omit<OpenProjectDrawing, 'version'>;
  recovery?: { choice: 'restore' | 'discard'; token: string };
};

export interface ProjectRecoveryPrompt {
  location: OpenProjectAction['location'];
  token: string;
  time: number;
  conflict: boolean;
}

let openSequence = 0;

export async function openProjectDrawing(
  action: OpenProjectAction,
  dispatch: Dispatch,
  getState: () => docDrawing,
) {
  const { location } = action;
  const request = ++openSequence;
  const initial = getState();
  const stillOpening = () => {
    const current = getState();
    return (
      request === openSequence &&
      !current.altStore.saveInProgress &&
      current.altStore.file === initial.altStore.file &&
      current.docStore.present.drawingVersion ===
        initial.docStore.present.drawingVersion
    );
  };
  try {
    const { project, version } = await readProject(location.id);
    const entry = project.entries.find(
      ({ kind, id }) => kind === 'schematic' && id === location.entryId,
    );
    if (!entry)
      throw new Error(
        'Project schematic has been removed. Refresh the project browser.',
      );
    if (!stillOpening()) return;
    const key = projectRecoveryKey(initial.altStore.user?.id || '', location);
    const draft = await readRecoveryDraft(key).catch((error): undefined => {
      if (action.recovery) throw error;
      return undefined;
    });
    if (!stillOpening()) return;
    const conflict = !!draft && draft.sourceVersion !== version;
    if (draft && draft.token !== action.recovery?.token) {
      const prompt: ProjectRecoveryPrompt = {
        location,
        token: draft.token,
        time: draft.time,
        conflict,
      };
      dispatch(actionSelectDialog('project_recovery', prompt));
      return;
    }
    if (action.recovery?.choice === 'restore' && !draft)
      throw new Error('The recovery copy is no longer available.');
    const recovered = !!draft && action.recovery?.choice === 'restore';
    const data = recovered ? draft.data : entry.data;
    const drawing = await decodeDrawing(data);
    if (drawing.documentId.toLowerCase() !== location.entryId)
      throw new Error(
        'The recovered schematic identity does not match the project.',
      );
    if (!stillOpening()) return;
    if (draft && action.recovery?.choice === 'discard')
      await deleteRecoveryDraft(key, draft.token);
    if (!stillOpening()) return;
    const detached = recovered && conflict;
    const name = detached
      ? `${projectFileTitle(location.name)}-recovered.${
          isCompressedDrawing(data) ? 'dzn' : 'dsn'
        }`
      : location.name;
    dispatch(
      actionSetDocument(
        drawing,
        name,
        null,
        location.folderId,
        detached
          ? undefined
          : {
              ...location,
              version,
            },
        recovered,
      ),
    );
    dispatch(ActionCreators.clearHistory());
  } catch (error) {
    if (stillOpening())
      dispatch(actionSelectDialog('io_failure', { message: String(error) }));
  }
}

export interface ProjectCopyOptions {
  folderId: string;
  name: string;
  omitResults?: boolean;
}

export async function saveProjectDrawing(
  dispatch: Dispatch,
  getState: () => docDrawing,
  copy?: ProjectCopyOptions,
) {
  const {
    altStore,
    docStore: { present },
  } = getState();
  const source = altStore.file.project;
  if (altStore.saveInProgress || present.editLibrary || (!source && !copy))
    return;
  dispatch(actionSetSaveInProgress(true, null));
  try {
    const recoveryKey =
      source && projectRecoveryKey(altStore.user?.id || '', source);
    const recovery =
      recoveryKey && !copy?.omitResults
        ? await readRecoveryDraft(recoveryKey).catch((): undefined => undefined)
        : undefined;
    const original = source ? await readProject(source.id) : undefined;
    if (original && original.version !== source.version)
      throw new Error(
        'The project changed in storage. Reopen it before saving.',
      );
    const name = copy ? projectFileName(copy.name) : source.name;
    const folderId = copy ? copy.folderId : source.folderId;
    const title = projectFileTitle(name);
    const drawing = copy?.omitResults
      ? withoutResults(present.drawing)
      : present.drawing;
    const entry = await drawingEntry(drawing);
    const entryId = entry.id;
    if (source && source.entryId !== entryId)
      throw new Error('The open schematic identity changed.');
    const project: PcbProject = {
      projectId: original?.project.projectId || crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      parentRevisionId: original?.project.revisionId,
      title: copy ? title : original.project.title,
      requiredFeatures: original?.project.requiredFeatures || [],
      entries: [
        ...(original?.project.entries.filter(
          (item) => item.kind !== 'schematic' || item.id !== entryId,
        ) || []),
        entry,
      ],
    };
    const bytes = await encodeProjectArchive(project);
    const file = await projectRequest({
      operation: 'write',
      folder: folderId,
      name,
      data: bytes,
      ...(copy ? {} : { id: source.id, version: source.version }),
    });
    if (recovery && recovery.sourceVersion === source.version) {
      await deleteRecoveryDraft(recoveryKey, recovery.token).catch(() => {});
    }
    const current = getState().altStore.file;
    if (
      !copy?.omitResults &&
      current === altStore.file &&
      getState().docStore.present.drawing.documentId === drawing.documentId
    ) {
      dispatch(
        actionSetFileData(file.name, null, folderId, present.drawingVersion, {
          ...file,
          folderId,
          entryId,
        }),
      );
    }
    window.dispatchEvent(new Event(projectFilesChanged));
  } catch (error) {
    dispatch(actionSelectDialog('io_failure', { message: String(error) }));
  } finally {
    dispatch(actionSetSaveInProgress(false, null));
  }
}
