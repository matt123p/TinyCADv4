import { ActionCreators } from 'redux-undo';
import type { Dispatch } from 'redux';
import { isCompressedDrawing } from '../../shared/drawingFiles';
import { isProjectFile, projectFileTitle } from '../../shared/projectFiles';
import { decodeDrawing, encodeDrawing } from './dsnCodec';
import { blank } from './ioXml';
import { userManager } from './files';
import { digest } from './dsnContainer';
import {
  decodeProjectSettings,
  encodeProjectSettings,
} from '../pcb/projectSettings';
import type { ProjectLink, ProjectSettings } from '../pcb/projectSettings';
import type { RevisionInventory } from '../pcb/projectRevisions';
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
  ProjectItem,
  ProjectStorageRequest,
  ProjectStorageResult,
} from './projectStorage';

export const projectRootChanged = 'tinycad:project-root-changed';
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

export async function readProject(id: string, rootId: string) {
  const { data } = await projectRequest({ operation: 'read', id });
  const settings = decodeProjectSettings(data);
  const markers = (
    await projectRequest({ operation: 'list', folder: rootId, tree: true })
  ).filter((item) => !item.folder && isProjectFile(item.name));
  if (markers.length !== 1 || markers[0].id !== id || markers[0].unsupported)
    throw new Error('A project folder needs exactly one root settings file.');
  const files = await resolveProjectLinks(rootId, settings);
  return { settings, files, marker: markers[0] };
}

async function resolveProjectLinks(rootId: string, settings: ProjectSettings) {
  const lists = new Map<string, Promise<ProjectItem[]>>();
  const files = new Map<string, ProjectItem>();
  const list = (folder: string) => {
    if (!lists.has(folder))
      lists.set(
        folder,
        projectRequest({ operation: 'list', folder, tree: true }),
      );
    return lists.get(folder);
  };
  for (const link of settings.entries) {
    let folder = rootId;
    const parts = link.path.split('/');
    for (const [index, part] of parts.entries()) {
      const matches = (await list(folder)).filter(
        ({ name }) => name.toLowerCase() === part.toLowerCase(),
      );
      const [item] = matches;
      const isFolder = index < parts.length - 1;
      if (matches.length !== 1 || item.unsupported || item.folder !== isFolder)
        throw new Error(`Missing or ambiguous project link: ${link.path}`);
      folder = item.id;
      if (!item.folder) files.set(link.path, item);
    }
  }
  return files;
}

type LoadedProject = Awaited<ReturnType<typeof readProject>>;

type DrawingEntry = ProjectLink & { data: Uint8Array };

function writeFile(folder: string, name: string, data: Uint8Array) {
  return projectRequest({ operation: 'write', folder, name, data });
}

async function makeFolder(folder: string, name: string) {
  const existing = await projectRequest({
    operation: 'list',
    folder,
    tree: true,
  });
  if (existing.some((item) => item.name.toLowerCase() === name.toLowerCase()))
    throw new Error(`A file or folder already has the name ${name}.`);
  return projectRequest({ operation: 'mkdir', folder, name });
}

type TreeEntry = ProjectItem & { path: string; children?: TreeEntry[] };

async function readTree(
  root: string,
  prefix = '',
  ancestors = new Set<string>(),
): Promise<TreeEntry[]> {
  if (ancestors.has(root)) throw new Error('Circular project folder.');
  const trail = new Set(ancestors).add(root);
  const items = await projectRequest({
    operation: 'list',
    folder: root,
    tree: true,
  });
  const names = new Set<string>();
  const tree: TreeEntry[] = [];
  for (const item of items) {
    const path = prefix + item.name;
    const name = item.name.toLowerCase();
    if (item.unsupported || names.has(name))
      throw new Error(`Unsupported or ambiguous project file: ${path}`);
    names.add(name);
    tree.push({
      ...item,
      path,
      ...(item.folder
        ? { children: await readTree(item.id, path + '/', trail) }
        : {}),
    });
  }
  return tree;
}

function* treeEntries(tree: readonly TreeEntry[]): Generator<TreeEntry> {
  for (const item of tree) {
    yield item;
    if (item.children) yield* treeEntries(item.children);
  }
}

async function copyTree(
  tree: readonly TreeEntry[],
  folder: string,
  settingsId: string,
  replacement?: DrawingEntry,
) {
  for (const item of tree) {
    if (item.id === settingsId) continue;
    if (item.folder) {
      const target = await projectRequest({
        operation: 'mkdir',
        folder,
        name: item.name,
      });
      await copyTree(item.children, target.id, settingsId, replacement);
    } else if (item.path === replacement?.path) {
      await writeFile(folder, item.name, replacement.data);
    } else {
      await projectRequest({
        operation: 'copy',
        id: item.id,
        folder,
        name: item.name,
      });
    }
  }
}

function projectRevision(
  previous: ProjectSettings | undefined,
  title: string,
  entries: readonly ProjectLink[],
): ProjectSettings {
  return {
    ...previous,
    projectId: previous?.projectId || crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    parentRevisionId: previous?.revisionId,
    title,
    requiredFeatures: previous?.requiredFeatures || [],
    entries,
    primarySchematic:
      previous?.primarySchematic ??
      entries.find(({ kind }) => kind === 'schematic')?.id,
  };
}

async function publishProject(
  folder: string,
  name: string,
  settings: ProjectSettings,
  populate: (root: string) => Promise<unknown>,
) {
  const data = encodeProjectSettings(settings);
  if (!folder)
    throw new Error(
      'Open the project from its parent folder to save a sibling revision.',
    );
  const root = await makeFolder(folder, projectFileTitle(name));
  try {
    await populate(root.id);
    await resolveProjectLinks(root.id, settings);
    const file = await writeFile(root.id, name, data);
    return { ...file, rootId: root.id };
  } catch (error) {
    await projectRequest({
      operation: 'trash',
      id: root.id,
      directory: true,
    }).catch(() => {});
    throw error;
  }
}

async function drawingEntry(
  drawing: dsnDrawing,
  path?: string,
): Promise<DrawingEntry> {
  const representation = path
    ? /\.dzn$/i.test(path)
      ? 'zip-v1'
      : 'xml'
    : undefined;
  const data = await encodeDrawing(drawing, representation);
  const id = drawing.documentId.toLowerCase();
  return {
    kind: 'schematic',
    id,
    path: path || (isCompressedDrawing(data) ? 'Circuit.dzn' : 'Circuit.dsn'),
    data,
  };
}

export async function createProjectFile(folder: string, title: string) {
  const name = projectFileName(title);
  const entry = await drawingEntry(blank());
  const settings = projectRevision(undefined, projectFileTitle(name), [entry]);
  return publishProject(folder, name, settings, (root) =>
    writeFile(root, entry.path, entry.data),
  );
}

async function copyProject(
  folder: string,
  name: string,
  source: { id: string; rootId: string },
  project: LoadedProject,
  replacement?: DrawingEntry,
) {
  const tree = await readTree(source.rootId);
  if (
    folder === source.rootId ||
    [...treeEntries(tree)].some(({ id }) => id === folder)
  )
    throw new Error('Choose a destination outside the project folder.');
  const settings = projectRevision(
    project.settings,
    projectFileTitle(name),
    project.settings.entries,
  );
  return publishProject(folder, name, settings, (root) =>
    copyTree(tree, root, source.id, replacement),
  );
}

export async function duplicateProject(
  folder: string,
  title: string,
  source: { id: string; rootId: string },
) {
  const project = await readProject(source.id, source.rootId);
  return copyProject(folder, projectFileName(title), source, project);
}

export async function savedProjectRevision(
  id: string,
  rootId: string,
): Promise<RevisionInventory> {
  const project = await readProject(id, rootId);
  const { projectId, revisionId, parentRevisionId, title } = project.settings;
  const entries = new Map<string, { path: string; digest: string }>();
  for (const item of treeEntries(await readTree(rootId))) {
    if (item.folder || item.id === id) continue;
    entries.set(item.path, {
      path: item.path,
      digest: await projectRequest({ operation: 'fingerprint', id: item.id }),
    });
  }
  // Lineage and title are presented separately from shared settings changes.
  const settings = encodeProjectSettings({
    ...project.settings,
    revisionId: projectId,
    parentRevisionId: undefined,
    title: 'Project',
  });
  return {
    projectId,
    revisionId,
    parentRevisionId,
    title,
    entries,
    settings: { path: project.marker.name, digest: await digest(settings) },
  };
}

export type OpenProjectAction = {
  type: 'file-open-project';
  location: Omit<OpenProjectDrawing, 'version' | 'documentPath'>;
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
    const project = await readProject(location.id, location.rootId);
    const entry = project.settings.entries.find(
      ({ kind, id }) => kind === 'schematic' && id === location.entryId,
    );
    if (!entry)
      throw new Error(
        'Project schematic has been removed. Refresh the project browser.',
      );
    const saved = await projectRequest({
      operation: 'read',
      id: project.files.get(entry.path).id,
    });
    if (isCompressedDrawing(saved.data) !== /\.dzn$/i.test(entry.path))
      throw new Error(
        `Project schematic encoding does not match its filename: ${entry.path}`,
      );
    const version = await digest(saved.data);
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
    const data = recovered ? draft.data : saved.data;
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
      : entry.path.split('/').pop();
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
              documentPath: entry.path,
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
    const original = source
      ? await readProject(source.id, source.rootId)
      : undefined;
    const link = original?.settings.entries.find(
      ({ kind, id }) => kind === 'schematic' && id === source.entryId,
    );
    if (source && (!link || source.documentPath !== link.path))
      throw new Error(
        'The open schematic link changed. Reopen the project before saving.',
      );
    const documentFile = link && original.files.get(link.path);
    const saved =
      documentFile &&
      (await projectRequest({ operation: 'read', id: documentFile.id }));
    const savedVersion = saved && (await digest(saved.data));
    if (source && savedVersion !== source.version)
      throw new Error(
        'The saved schematic changed in storage. Reopen it before saving.',
      );
    const drawing = copy?.omitResults
      ? withoutResults(present.drawing)
      : present.drawing;
    const entry = await drawingEntry(drawing, link?.path);
    const entryId = entry.id;
    if (source && source.entryId !== entryId)
      throw new Error('The open schematic identity changed.');
    const documentName = entry.path.split('/').pop();
    let location: OpenProjectDrawing;
    if (copy) {
      let destination = copy.folderId;
      if (!destination && source) {
        const parent = await projectRequest({
          operation: 'choose',
          containProject: source.rootId,
        });
        if (!parent) return;
        destination = parent.id;
        window.dispatchEvent(new Event(projectRootChanged));
      }
      const name = projectFileName(copy.name);
      const file = original
        ? await copyProject(
            destination,
            name,
            {
              id: source.id,
              rootId: source.rootId,
            },
            original,
            entry,
          )
        : await publishProject(
            destination,
            name,
            projectRevision(undefined, projectFileTitle(name), [entry]),
            (root) => writeFile(root, entry.path, entry.data),
          );
      location = {
        ...file,
        folderId: destination,
        version: await digest(entry.data),
        entryId,
        documentPath: entry.path,
      };
    } else {
      const file = documentFile;
      await projectRequest({
        operation: 'write',
        folder: source.rootId,
        name: file.name,
        data: entry.data,
        id: file.id,
        version: saved.version,
      });
      location = { ...source, version: await digest(entry.data) };
    }
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
        actionSetFileData(
          documentName,
          null,
          location.folderId,
          present.drawingVersion,
          location,
        ),
      );
    }
    window.dispatchEvent(new Event(projectFilesChanged));
  } catch (error) {
    dispatch(actionSelectDialog('io_failure', { message: String(error) }));
  } finally {
    dispatch(actionSetSaveInProgress(false, null));
  }
}
