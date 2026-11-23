import { ActionCreators } from 'redux-undo';
import type { Dispatch } from 'redux';
import { isCompressedDrawing } from '../../shared/drawingFiles';
import {
  isProjectFile,
  projectFileTitle,
  validProjectName,
} from '../../shared/projectFiles';
import { decodeDrawing, encodeDrawing } from './dsnCodec';
import { blank } from './ioXml';
import { hasChildPlacements } from './hierarchyDrawing';
import { saveStandaloneSchematic, userManager } from './files';
import { digest } from './dsnContainer';
import {
  decodeProjectSettings,
  encodeProjectSettings,
} from '../pcb/projectSettings';
import type { ProjectLink, ProjectSettings } from '../pcb/projectSettings';
import type { RevisionInventory } from '../pcb/projectRevisions';
import type { dsnDrawing } from '../model/dsnDrawing';
import { withoutResults } from '../simulation/document';
import { restoreResults } from '../simulation/resultStore';
import type { ResultData } from '../simulation/contracts';
import {
  actionSelectDialog,
  actionSetDocument,
  actionSetFileData,
  actionSetSaveInProgress,
} from '../state/dispatcher/AppDispatcher';
import {
  activateSchematicTab,
  openSchematicTabs,
  reloadSchematicTab,
  removeSchematicTab,
  savedSchematicTab,
  schematicFileTabKey,
  schematicTabDirty,
  schematicTabKey,
} from '../state/schematicTabs';
import type { SchematicSnapshot } from '../state/schematicTabs';
import type { docDrawing } from '../state/undo/undo';
import {
  projectFileName,
  projectFilesChanged,
  projectFolderOpened,
  projectRootChanged,
} from './projectStorage';
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

export { projectRootChanged, projectFilesChanged } from './projectStorage';

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

export async function chooseDesktopProjectFolder() {
  const root = await projectRequest({ operation: 'choose-project-folder' });
  if (root)
    window.dispatchEvent(
      new CustomEvent(projectFolderOpened, { detail: root }),
    );
}

export async function openRecentDesktopProjectFolder(id: string) {
  const root = await projectRequest({ operation: 'open-recent-project-folder', id });
  window.dispatchEvent(new CustomEvent(projectFolderOpened, { detail: root }));
}

export async function openLaunchedProject() {
  const launch = await projectRequest({ operation: 'open-launch' });
  if (!launch) return;
  decodeProjectSettings(launch.data);
  const root = await projectRequest({
    operation: 'activate-launch',
    ticket: launch.ticket,
  });
  await readProject(launch.marker.id, root.id);
  window.dispatchEvent(new CustomEvent(projectFolderOpened, { detail: root }));
}

export async function readProject(id: string, rootId: string) {
  const { inProjectTransaction, recoverProjectReferenceUpdate } =
    await import('./projectReferenceTransaction');
  return inProjectTransaction(id, async () => {
    await recoverProjectReferenceUpdate(id);
    const { readProjectFileJournal } = await import('./projectRecovery');
    const journal = await readProjectFileJournal(id).catch((): undefined => undefined);
    if (journal?.kind === 'trash') {
      const { recoverProjectTrash } = await import('./projectTrash');
      await recoverProjectTrash(journal);
    } else if (journal) {
      const { recoverProjectRelocation } = await import('./projectRelocation');
      await recoverProjectRelocation(journal);
    }
    const { data, version } = await projectRequest({ operation: 'read', id });
    const settings = decodeProjectSettings(data);
    const markers = (
      await projectRequest({ operation: 'list', folder: rootId, tree: true })
    ).filter((item) => !item.folder && isProjectFile(item.name));
    if (markers.length !== 1 || markers[0].id !== id || markers[0].unsupported)
      throw new Error('A project folder needs exactly one root settings file.');
    const files = await resolveProjectLinks(rootId, settings, true);
    const missingSchematics = settings.entries.filter(
      ({ kind, path }) => kind === 'schematic' && !files.has(path),
    );
    return { settings, files, marker: markers[0], version, missingSchematics };
  });
}

export type ProjectMetadata = {
  title: string;
  author: string;
  primarySchematic: string;
  primaryBoard: string;
};

export function projectMetadata(settings: ProjectSettings): ProjectMetadata {
  return {
    title: settings.title,
    author: settings.author ?? '',
    primarySchematic: settings.primarySchematic ?? '',
    primaryBoard: settings.primaryBoard ?? '',
  };
}

export async function saveProjectMetadata(
  id: string,
  folder: string,
  name: string,
  version: string,
  settings: ProjectSettings,
  fields: ProjectMetadata,
) {
  const title = fields.title.trim();
  const author = fields.author.trim();
  if (!title || /[\x00-\x1f\uFFFE\uFFFF]/.test(title))
    throw new Error('Enter a valid project name.');
  const next: ProjectSettings = {
    ...settings,
    title,
    author: author || undefined,
    primarySchematic: fields.primarySchematic || undefined,
    primaryBoard: fields.primaryBoard || undefined,
  };
  const saved = await projectRequest({
    operation: 'write',
    id,
    folder,
    name,
    version,
    data: encodeProjectSettings(next),
  });
  return {
    version: saved.version,
    settings: next,
    value: projectMetadata(next),
  };
}

type ProjectList = (folder: string) => Promise<ProjectItem[]>;

const listProjectFolder: ProjectList = (folder) =>
  projectRequest({ operation: 'list', folder, tree: true });

export async function findProjectPath(
  rootId: string,
  path: string,
  directory = false,
  list = listProjectFolder,
): Promise<ProjectItem | undefined> {
  let folder = rootId;
  const parts = path.split('/');
  let item: ProjectItem;
  for (const [index, part] of parts.entries()) {
    if (!validProjectName(part))
      throw new Error(`Invalid project path: ${path}`);
    const matches = (await list(folder)).filter(
      ({ name }) => name.toLowerCase() === part.toLowerCase(),
    );
    [item] = matches;
    const isFolder = directory || index < parts.length - 1;
    if (matches.length !== 1 || item.unsupported || item.folder !== isFolder)
      return undefined;
    folder = item.id;
  }
  return item;
}

async function resolveProjectLinks(
  rootId: string,
  settings: ProjectSettings,
  allowMissingSchematics = false,
) {
  const lists = new Map<string, Promise<ProjectItem[]>>();
  const files = new Map<string, ProjectItem>();
  const list = (folder: string) => {
    if (!lists.has(folder)) lists.set(folder, listProjectFolder(folder));
    return lists.get(folder);
  };
  for (const link of settings.entries) {
    const item = await findProjectPath(rootId, link.path, false, list);
    if (item) files.set(link.path, item);
    else if (!allowMissingSchematics || link.kind !== 'schematic')
      throw new Error(`Missing or ambiguous project link: ${link.path}`);
  }
  return files;
}

type LoadedProject = Awaited<ReturnType<typeof readProject>>;

export async function addProjectSchematic(
  projectRoot: Pick<OpenProjectDrawing, 'id' | 'rootId'>,
  path: string,
  input?: Uint8Array,
  useExisting = false,
) {
  const { id, rootId } = projectRoot;
  const project = await readProject(id, rootId);
  const match = project.settings.entries.find(
    ({ path: name }) => name.toLowerCase() === path.toLowerCase(),
  );
  if (
    match &&
    useExisting &&
    match.kind === 'schematic' &&
    project.files.has(match.path)
  )
    return match;
  if (match) throw new Error(`A document already uses ${path}.`);
  const parts = path.split('/');
  const name = parts.pop();
  const folder = parts.length
    ? (await findProjectPath(rootId, parts.join('/'), true))?.id
    : rootId;
  if (!folder || !validProjectName(name) || !/\.d[sz]n$/i.test(name))
    throw new Error('Choose a schematic filename inside the project.');
  const matches = (await listProjectFolder(folder)).filter(
    ({ name: candidate }) => candidate.toLowerCase() === name.toLowerCase(),
  );
  if (
    useExisting
      ? matches.length !== 1 || matches[0].unsupported || matches[0].folder
      : matches.length > 0
  )
    throw new Error(`The schematic path is unavailable or ambiguous: ${path}`);
  const file = useExisting ? matches[0] : undefined;
  const saved = file
    ? await projectRequest({ operation: 'read', id: file.id })
    : undefined;
  const results = new Map<string, ResultData>();
  const drawing =
    input || saved ? await decodeDrawing(input || saved.data, results) : blank();
  const entry: ProjectLink = {
    kind: 'schematic',
    id: drawing.documentId.toLowerCase(),
    path,
  };
  const settings = encodeProjectSettings({
    ...project.settings,
    entries: [...project.settings.entries, entry],
    primarySchematic: project.settings.primarySchematic ?? entry.id,
  });
  const data = await encodeDrawing(
    drawing,
    /\.dzn$/i.test(name) ? 'zip-v1' : 'xml',
    results,
  );
  const written = await projectRequest({
    operation: 'write',
    folder,
    name,
    data,
    ...(file ? { id: file.id, version: saved.version } : {}),
  });
  try {
    await projectRequest({
      operation: 'write',
      id,
      folder: rootId,
      name: project.marker.name,
      data: settings,
      version: project.version,
    });
  } catch (error) {
    if (file) {
      await projectRequest({
        operation: 'write',
        id: written.id,
        folder,
        name,
        data: saved.data,
        version: written.version,
      }).catch(() => {});
    } else {
      await projectRequest({
        operation: 'trash',
        id: written.id,
        directory: false,
      }).catch(() => {});
    }
    throw error;
  }
  window.dispatchEvent(new Event(projectFilesChanged));
  return entry;
}

export async function readProjectBoard(
  project: LoadedProject,
  entryId: string,
) {
  const link = project.settings.entries.find(
    ({ kind, id }) => kind === 'board' && id === entryId,
  );
  if (!link) throw new Error('Missing linked PCB document.');
  const file = project.files.get(link.path);
  const { data, version } = await projectRequest({
    operation: 'read',
    id: file.id,
  });
  const { decodeBoard } = await import('../pcb/boardCodec');
  const board = await decodeBoard(data);
  if (board.boardId.toLowerCase() !== link.id)
    throw new Error('PCB document identity does not match its project link.');

  const source = board.sourceCircuit;
  let circuit = board.appliedCircuit;
  if (source) {
    const { circuitConnectivityDigest } = await import(
      '../pcb/circuitSnapshot'
    );
    const schematic = source.documentId.toLowerCase();
    const association = project.settings.associations?.find(
      ({ board }) => board === entryId,
    );
    if (association && association.schematic !== schematic)
      throw new Error(
        'PCB source circuit does not match its project schematic association.',
      );
    if (circuit) return { board, data, circuit, version };
    const text = new TextDecoder('utf-8', { fatal: true });
    for (const entry of project.settings.entries.filter(
      ({ kind }) => kind === 'circuit',
    )) {
      const snapshotFile = project.files.get(entry.path);
      const snapshot = JSON.parse(
        text.decode(
          (await projectRequest({ operation: 'read', id: snapshotFile.id }))
            .data,
        ),
      );
      if (
        typeof snapshot?.documentId !== 'string' ||
        snapshot.documentId.toLowerCase() !== schematic ||
        snapshot.revision !== source.revision
      )
        continue;
      if (
        typeof snapshot.snapshotId !== 'string' ||
        snapshot.snapshotId.toLowerCase() !== entry.id
      )
        throw new Error(
          'Circuit snapshot identity does not match its project link.',
        );
      if (
        circuit ||
        (await circuitConnectivityDigest(snapshot)) !==
          source.connectivityDigest
      )
        throw new Error(
          'Missing or inconsistent project circuit snapshot for this PCB.',
        );
      circuit = snapshot;
    }
    if (!circuit)
      throw new Error(
        'Missing or inconsistent project circuit snapshot for this PCB.',
      );
  }
  return { board, data, circuit, version };
}

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
  resultScope?: string,
): Promise<DrawingEntry> {
  const representation = path
    ? /\.dzn$/i.test(path)
      ? 'zip-v1'
      : 'xml'
    : undefined;
  const data = await encodeDrawing(drawing, representation, resultScope);
  const id = drawing.documentId.toLowerCase();
  return {
    kind: 'schematic',
    id,
    path: path || (isCompressedDrawing(data) ? 'Circuit.dzn' : 'Circuit.dsn'),
    data,
  };
}

export async function createProjectFile(
  folder: string,
  title: string,
  inPlace = false,
) {
  const name = projectFileName(title);
  if (inPlace) {
    const entries = await listProjectFolder(folder);
    if (entries.some((item) => !item.folder && isProjectFile(item.name)))
      throw new Error('This folder already has project settings.');
    const settings = projectRevision(undefined, projectFileTitle(name), []);
    const file = await writeFile(folder, name, encodeProjectSettings(settings));
    return { ...file, rootId: folder };
  }
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
  refresh?: boolean;
  restoringTab?: boolean;
};

export interface ProjectRecoveryPrompt {
  location: OpenProjectAction['location'];
  token: string;
  time: number;
  conflict: boolean;
  onComplete?(): void;
}

async function projectInstanceReferences(
  project: LoadedProject,
  location: OpenProjectAction['location'],
  drawing: dsnDrawing,
) {
  if (!location.hierarchyTrail?.length) return undefined;
  const { readProjectSchematic, referencesForInstance } = await import(
    './projectHierarchy'
  );
  const rootEntry = project.settings.entries.find(
    ({ kind, id }) =>
      kind === 'schematic' && id === location.hierarchyTrail[0].entryId,
  );
  if (!rootEntry) return undefined;
  return referencesForInstance(
    await readProjectSchematic(project, rootEntry),
    drawing,
    location.hierarchyTrail.map(({ placementId }) => placementId),
  );
}

export async function refreshInactiveSchematics(
  dispatch: Dispatch,
  getState: () => docDrawing,
  matches: (location: OpenProjectDrawing) => boolean,
): Promise<string[]> {
  const unavailable: string[] = [];
  for (const [key, tab] of Object.entries(getState().schematicTabs?.inactive ?? {})) {
    const location = tab.file.project;
    if (!location || !matches(location) || schematicTabDirty(tab)) continue;
    try {
      const project = await readProject(location.id, location.rootId);
      const entry = project.settings.entries.find(
        ({ kind, id }) => kind === 'schematic' && id === location.entryId,
      );
      const file = entry && project.files.get(entry.path);
      if (!file) throw new Error('Project schematic has been removed.');
      const { data } = await projectRequest({ operation: 'read', id: file.id });
      if (isCompressedDrawing(data) !== /\.dzn$/i.test(entry.path))
        throw new Error('Project schematic encoding does not match its filename.');
      const version = await digest(data);
      if (version === location.version && entry.path === location.documentPath &&
          !location.hierarchyTrail?.length) continue;
      const results = new Map<string, ResultData>();
      let drawing = await decodeDrawing(data, results);
      if (drawing.documentId.toLowerCase() !== location.entryId)
        throw new Error('The saved schematic identity does not match the project.');
      if (hasChildPlacements(drawing)) {
        const { loadLegacyInterfaces } = await import('./projectHierarchy');
        drawing = await loadLegacyInterfaces(project, { rootId: location.rootId, documentPath: entry.path }, drawing);
      }
      const instanceReferencesByUnit = await projectInstanceReferences(project, location, drawing);
      if (getState().schematicTabs?.inactive[key] !== tab) continue;
      restoreResults(results, drawing.documentId, key);
      dispatch(reloadSchematicTab(key, tab, actionSetDocument(
        drawing, entry.path.split('/').pop(), null, location.folderId,
        { ...location, version, documentPath: entry.path, instanceReferencesByUnit },
      )) as any);
    } catch {
      unavailable.push(location.documentPath);
    }
  }
  return unavailable;
}

let openSequence = 0;

export async function openProjectDrawing(
  action: OpenProjectAction,
  dispatch: Dispatch,
  getState: () => docDrawing,
) {
  const { location } = action;
  const initial = getState();
  const tabKey = schematicTabKey(location);
  if (action.refresh && schematicTabKey(initial.altStore.file.project) === tabKey &&
      initial.altStore.savedVersion !== initial.docStore.present.drawingVersion) return;
  const request = ++openSequence;
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
    const held =
      !action.refresh && !action.recovery
        ? openSchematicTabs(initial).find((item) => item.key === tabKey)?.tab
        : undefined;
    async function restoreHeld(tab: SchematicSnapshot, project?: LoadedProject) {
      const instanceReferencesByUnit = location.hierarchyTrail?.length
        ? await projectInstanceReferences(
            project ?? await readProject(location.id, location.rootId),
            location,
            tab.history.present.drawing,
          )
        : undefined;
      if (stillOpening())
        dispatch(
          activateSchematicTab(tabKey, {
            ...tab.file.project,
            ...location,
            instanceReferencesByUnit,
          }) as any,
        );
    }
    if (held?.file.project && schematicTabDirty(held)) {
      await restoreHeld(held);
      return;
    }
    const project = await readProject(location.id, location.rootId);
    const entry = project.settings.entries.find(
      ({ kind, id }) => kind === 'schematic' && id === location.entryId,
    );
    if (!entry)
      throw new Error(
        'Project schematic has been removed. Refresh the project browser.',
      );
    const file = project.files.get(entry.path);
    if (!file)
      throw new Error(`Missing or ambiguous project schematic: ${entry.path}`);
    const saved = await projectRequest({ operation: 'read', id: file.id });
    if (isCompressedDrawing(saved.data) !== /\.dzn$/i.test(entry.path))
      throw new Error(
        `Project schematic encoding does not match its filename: ${entry.path}`,
      );
    const version = await digest(saved.data);
    if (!stillOpening()) return;
    if (held?.file.project?.version === version &&
        held.file.project.documentPath === entry.path) {
      await restoreHeld(held, project);
      return;
    }
    if (
      action.refresh &&
      initial.altStore.file.project?.version === version &&
      initial.altStore.file.project?.documentPath === entry.path &&
      !location.hierarchyTrail?.length
    )
      return;
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
      if (action.restoringTab) {
        await new Promise<void>((resolve) => {
          dispatch(actionSelectDialog('project_recovery', { ...prompt, onComplete: resolve }));
        });
      } else dispatch(actionSelectDialog('project_recovery', prompt));
      return;
    }
    if (action.recovery?.choice === 'restore' && !draft)
      throw new Error('The recovery copy is no longer available.');
    const recovered = !!draft && action.recovery?.choice === 'restore';
    const data = recovered ? draft.data : saved.data;
    const detached = recovered && conflict;
    const results = new Map<string, ResultData>();
    let drawing = await decodeDrawing(data, results);
    if (drawing.documentId.toLowerCase() !== location.entryId)
      throw new Error(
        'The recovered schematic identity does not match the project.',
      );
    if (!recovered && hasChildPlacements(drawing)) {
      const { loadLegacyInterfaces } = await import('./projectHierarchy');
      drawing = await loadLegacyInterfaces(
        project,
        { rootId: location.rootId, documentPath: entry.path },
        drawing,
      );
    }
    const instanceReferencesByUnit = await projectInstanceReferences(
      project,
      location,
      drawing,
    );
    if (!stillOpening()) return;
    if (draft && action.recovery?.choice === 'discard')
      await deleteRecoveryDraft(key, draft.token);
    if (!stillOpening()) return;
    const name = detached
      ? `${projectFileTitle(location.name)}-recovered.${
          isCompressedDrawing(data) ? 'dzn' : 'dsn'
        }`
      : entry.path.split('/').pop();
    restoreResults(results, drawing.documentId, detached ? undefined : tabKey);
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
              instanceReferencesByUnit,
            },
        recovered,
      ),
    );
    dispatch(ActionCreators.clearHistory());
  } catch (error) {
    if (stillOpening() && !action.restoringTab)
      dispatch(actionSelectDialog('io_failure', { message: String(error) }));
  }
}

async function discardSchematicRecovery(
  account: string,
  location: OpenProjectDrawing,
) {
  const key = projectRecoveryKey(account, location);
  const draft = await readRecoveryDraft(key);
  if (draft) await deleteRecoveryDraft(key, draft.token);
}

export async function closeProjectSchematicTab(
  dispatch: Dispatch,
  getState: () => docDrawing,
  key: string,
  discard: boolean,
) {
  const state = getState();
  const tabs = openSchematicTabs(state);
  const selected = tabs.find((item) => item.key === key)?.tab;
  if (!selected) return;
  const active = schematicFileTabKey(state.altStore.file) === key;
  if (discard && selected.file.project && schematicTabDirty(selected))
    await discardSchematicRecovery(
      state.altStore.user?.id || '',
      selected.file.project,
    );
  if (active) {
    const next = tabs.find((item) => item.key !== key);
    if (next) dispatch(activateSchematicTab(next.key) as any);
    else {
      dispatch(actionSetDocument(blank(), 'tCad1.dsn', null, null));
      dispatch(ActionCreators.clearHistory());
    }
  }
  dispatch(removeSchematicTab(key) as any);
}

export async function closeLinkedSchematic(
  dispatch: Dispatch,
  getState: () => docDrawing,
  discard: boolean,
) {
  const state = getState();
  const location = state.altStore.file.project;
  if (!location) return;
  if (discard)
    await discardSchematicRecovery(state.altStore.user?.id || '', location);
  dispatch(actionSetDocument(blank(), 'tCad1.dsn', null, null));
  dispatch(ActionCreators.clearHistory());
}

async function savedLinkedSchematic(
  project: LoadedProject,
  source: OpenProjectDrawing,
) {
  const link = project.settings.entries.find(
    ({ kind, id }) => kind === 'schematic' && id === source.entryId,
  );
  if (!link || source.documentPath !== link.path)
    throw new Error(
      'The open schematic link changed. Reopen the project before saving.',
    );
  const file = project.files.get(link.path);
  const saved =
    file && (await projectRequest({ operation: 'read', id: file.id }));
  if (!saved || (await digest(saved.data)) !== source.version)
    throw new Error(
      'The saved schematic changed in storage. Reopen it before saving.',
    );
  return { link, file, version: saved.version };
}

async function writeLinkedSchematic(
  source: OpenProjectDrawing,
  document: Awaited<ReturnType<typeof savedLinkedSchematic>>,
  entry: DrawingEntry,
) {
  await projectRequest({
    operation: 'write',
    folder: source.rootId,
    name: document.file.name,
    data: entry.data,
    id: document.file.id,
    version: document.version,
  });
  return { ...source, version: await digest(entry.data) };
}

async function clearSavedSchematicRecovery(
  key: string,
  version: string,
  started: number,
) {
  const draft = await readRecoveryDraft(key).catch((): undefined => undefined);
  if (draft?.sourceVersion === version && draft.time <= started)
    await deleteRecoveryDraft(key, draft.token).catch(() => {});
}

export async function saveInactiveSchematic(
  key: string,
  tab: SchematicSnapshot,
  dispatch: Dispatch,
  getState: () => docDrawing,
) {
  const state = getState();
  if (state.schematicTabs?.inactive[key] !== tab)
    throw new Error('The schematic tab changed. Save it again.');
  const source = tab.file.project;
  if (!schematicTabDirty(tab)) return;
  if (state.altStore.saveInProgress)
    throw new Error('A schematic save is already in progress.');
  dispatch(actionSetSaveInProgress(true, null));
  try {
    if (!source) {
      const file = await saveStandaloneSchematic(tab.history.present.drawing, tab.file);
      dispatch(savedSchematicTab(key, tab, { ...tab.file, name: file.name, id: file.id }, tab.history.present.drawingVersion) as any);
      return;
    }
    const started = Date.now();
    const project = await readProject(source.id, source.rootId);
    const document = await savedLinkedSchematic(project, source);
    const entry = await drawingEntry(
      tab.history.present.drawing,
      document.link.path,
      key,
    );
    if (entry.id !== source.entryId)
      throw new Error('The open schematic identity changed.');
    const location = await writeLinkedSchematic(source, document, entry);
    await clearSavedSchematicRecovery(
      projectRecoveryKey(state.altStore.user?.id || '', source),
      source.version,
      started,
    );
    dispatch(
      savedSchematicTab(
        key,
        tab,
        { ...tab.file, project: location },
        tab.history.present.drawingVersion,
      ) as any,
    );
    window.dispatchEvent(new Event(projectFilesChanged));
  } finally {
    dispatch(actionSetSaveInProgress(false, null));
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
  reportFailure = true,
) {
  const {
    altStore,
    docStore: { present },
  } = getState();
  const source = altStore.file.project;
  if (altStore.saveInProgress || present.editLibrary || (!source && !copy))
    return;
  const saveStarted = Date.now();
  dispatch(actionSetSaveInProgress(true, null));
  try {
    const recoveryKey =
      source && projectRecoveryKey(altStore.user?.id || '', source);
    const original = source
      ? await readProject(source.id, source.rootId)
      : undefined;
    const document = source && (await savedLinkedSchematic(original, source));
    const drawing = copy?.omitResults
      ? withoutResults(present.drawing)
      : present.drawing;
    const entry = await drawingEntry(drawing, document?.link.path);
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
        hierarchyTrail: source?.hierarchyTrail,
      };
    } else {
      location = await writeLinkedSchematic(source, document, entry);
    }
    if (recoveryKey && !copy?.omitResults)
      await clearSavedSchematicRecovery(
        recoveryKey,
        source.version,
        saveStarted,
      );
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
    if (!reportFailure) throw error;
    dispatch(actionSelectDialog('io_failure', { message: String(error) }));
  } finally {
    dispatch(actionSetSaveInProgress(false, null));
  }
}
