import { isBoardFile } from '../../../shared/drawingFiles';
import { boardOpened } from '../../io/boardWorkspaceEvents';
import type { useOpenBoards } from '../../io/useOpenBoards';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useSelector, useStore } from 'react-redux';
import { ActionCreators } from 'redux-undo';
import { useTranslation } from 'react-i18next';
import { Button, ToolbarButton } from '@fluentui/react-components';
import {
  ArrowRedoRegular,
  ArrowUndoRegular,
  BranchForkRegular,
  DismissRegular,
  FolderOpenRegular,
  FolderRegular,
  LibraryRegular,
  OrganizationRegular,
  SaveRegular,
} from '@fluentui/react-icons';
import { isDrawingFile } from '../../../shared/drawingFiles';
import { isProjectFile } from '../../../shared/projectFiles';
import { fileSave, saveSchematicFile } from '../../io/files';
import { bindDrawingExports } from '../../io/designExports';
import type { GitSnapshot } from '../../io/projectGit';
import { projectDocumentKind } from '../../io/projectDocumentKind';
import {
  addProjectLibraries,
  endProjectLibraries,
  rememberProjectLibrariesOnEdit,
  startProjectLibraries,
} from '../../io/projectLibraries';
import { blank } from '../../io/ioXml';
import {
  closeProjectMode,
  confirmProjectClose,
  editProjectHistory,
  newProjectDesign,
  saveActiveProjectFile,
  saveProjectTabs,
  saveStartupMode,
  startupMode,
} from '../../io/projectMode';
import {
  activateProjectFolder,
  assertProjectCanOpen,
  openLaunchedProject,
  openProjectFolder,
  openHierarchyEdits,
  projectRequest,
  readCurrentHierarchy,
  readProjectDrawing,
} from '../../io/projects';
import {
  checkProjectOpen,
  projectFilesChanged,
  projectFolderOpened,
  hierarchyDropEvent,
} from '../../io/projectStorage';
import type { ProjectItem, ProjectLocation, ProjectOpenLocation } from '../../io/projectStorage';
import type { HierarchyDesign } from '../../io/projectHierarchyBrowser';
import {
  readProjectTabSession,
  writeProjectTabSession,
} from '../../io/projectTabSession';
import type { ProjectTabLocation } from '../../io/projectTabSession';
import {
  dirtyProjectDocument,
  useProjectDocuments,
} from '../../io/useProjectDocuments';
import { actionCommand, actionFindSelection, actionSetDocument, actionSheetSelect } from '../../state/dispatcher/AppDispatcher';
import SidePanelContainer from '../../state/containers/sidePanelContainer';
import {
  activeSchematicTabKey,
  activateSchematicTab,
  enableSchematicTabs,
  openSchematicTabs,
  reloadSchematicTab,
  relocateSchematicTabs,
  removeSchematicTab,
  savedSchematicTab,
  schematicFileTabKey,
  schematicTabDirty,
} from '../../state/schematicTabs';
import type { docDrawing } from '../../state/undo/undo';
import { SidePanelToggle } from '../panel/SidePanelToggle';
import { EditorToolbarDivider } from '../toolbar/toolbar';
import ProjectDocumentEditor from './ProjectDocumentEditor';
import type { ProjectTextEditor } from './ProjectDocumentEditor';
import ProjectFileBrowser from './ProjectFileBrowser';
import ProjectHierarchyBrowser from './ProjectHierarchyBrowser';
import type { BrowserFile } from './ProjectFileBrowser';
import ProjectSourceControl from './ProjectSourceControl';
import ProjectFileTabs from './ProjectFileTabs';
import type { ChatProject } from '../../chat/project-context';
import { DocItemTypes, type Coordinate, type dsnSymbol } from '../../model/dsnItem';
import type { DrcError } from '../../model/dsnDrawing';
import { drcResultInActiveDrawing, projectDrcResultSelected } from '../../state/projectDrc';

const account = '';
const pathSeparator = (path: string) => (path.includes('\\') ? '\\' : '/');
const isInside = (parent: string, child: string) =>
  child === parent ||
  child.startsWith(parent.replace(/[\\/]$/, '') + pathSeparator(parent));

function drawingLocation(
  file: docDrawing['altStore']['file'],
  root: string,
): ProjectTabLocation | undefined {
  if (typeof file.id !== 'string' || !isInside(root, file.id)) return;
  const folder = file.projectVersion
    ? file.folderId
    : file.id.slice(
        0,
        Math.max(root.length, file.id.lastIndexOf(pathSeparator(root))),
      );
  return { kind: 'drawing', id: file.id, name: file.name, folder };
}

export type ProjectWorkspaceLayout = {
  projectSidebar?: {
    activityBar: React.ReactNode;
    content: React.ReactNode;
    visible: boolean;
    showFootprints?(): void;
  };
  status?: React.ReactNode;
  tabs?: React.ReactNode;
  document?: React.ReactNode;
  documentToolbar?: React.ReactNode;
  chatProject?: ChatProject;
  saveBlocked?: boolean;
  boardFootprintsRef?: HTMLDivElement;
  closeBoard?(): void;
  splitBoard?: boolean;
  boardActive?: boolean;
  focusBoard?(): void;
  focusCircuit?(): void;
};

type ProjectPanel = 'files' | 'git' | 'libraries' | 'hierarchy';

type Tab = {
  key: string;
  name: string;
  dirty: boolean;
  select(): void;
  location?: ProjectTabLocation;
};

export default function ProjectWorkspace({
  children,
  boards,
}: {
  boards: ReturnType<typeof useOpenBoards>;
  children(layout: ProjectWorkspaceLayout): React.ReactNode;
}) {
  const { t } = useTranslation();
  const sidebarId = useId();
  const store = useStore<docDrawing>();
  const { dispatch } = store;
  const state = useSelector(
    ({ schematicTabs, docStore, altStore }: docDrawing) => ({
      schematicTabs,
      docStore,
      altStore,
    }),
    (previous, current) =>
      previous.schematicTabs === current.schematicTabs &&
      previous.altStore.file === current.altStore.file &&
      previous.altStore.savedVersion === current.altStore.savedVersion &&
      previous.altStore.saveInProgress === current.altStore.saveInProgress &&
      previous.altStore.standardLibraryNavigation ===
        current.altStore.standardLibraryNavigation &&
      previous.docStore.present.drawingVersion ===
        current.docStore.present.drawingVersion &&
      previous.docStore.present.hierarchyRevision ===
        current.docStore.present.hierarchyRevision &&
      previous.docStore.present.view.selected_sheet ===
        current.docStore.present.view.selected_sheet &&
      activeSchematicTabKey(previous) === activeSchematicTabKey(current),
  );
  const activeKey = activeSchematicTabKey(state);
  const activeFile = state.altStore.file;
  const [root, setRoot] = useState<ProjectLocation>();
  const projectRoot = useRef<ProjectLocation>();
  const [restoring, setRestoring] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [panel, setPanel] = useState<ProjectPanel>('files');
  const [error, setError] = useState('');
  const [gitCount, setGitCount] = useState(0);
  const [gitSnapshot, setGitSnapshot] = useState<GitSnapshot>();
  const [saving, setSaving] = useState(false);
  const [textEditor, setTextEditor] = useState<ProjectTextEditor>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const saveLock = useRef(false);
  const transition = useRef(false);
  const opening = useRef(0);
  const drcSelection = useRef(0);
  const [order, setOrder] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [preview, setPreview] = useState<string>();
  const previewKey = useRef<string>();
  const documents = useProjectDocuments();
  const refreshDocuments = documents.refresh;
  const [boardFootprintsRef, setBoardFootprintsRef] = useState<HTMLDivElement>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const [boardFocus, setBoardFocus] = useState(true);
  const activeBoard = boards.tabs.find(({ id }) => id === boards.activeId);
  const projectBoards = boards.tabs.filter(({ document }) => document.projectRootId === root?.id);
  const splitBoard = !!(root && activeBoard && activeKey && !documents.active && sideBySide &&
    state.docStore.present.view.selected_sheet >= 0 &&
    state.docStore.present.drawing.sheets[state.docStore.present.view.selected_sheet]?.kind !== 'simulation');

  function selectBoard(id: string) {
    opening.current++;
    documents.select();
    boards.select(id);
    setBoardFocus(true);
  }

  const projectBoardsBusy = () => projectBoards.some(({ document }) => document.session.busy);
  const projectBoardsDirty = () => projectBoards.some(({ document }) => document.session.dirty);

  function selectDocument(id: string) {
    boards.deactivate();
    setSideBySide(false);
    documents.select(id);
  }

  useEffect(() => {
    if (!root) return;
    const prefix = root.id.replace(/[\\/]$/, '') + pathSeparator(root.id);
    const refreshSettings = () => {
      void refreshDocuments((id) => {
        if (!id.startsWith(prefix)) return false;
        const name = id.slice(prefix.length);
        return !/[\\/]/.test(name) && isProjectFile(name);
      });
    };
    window.addEventListener(projectFilesChanged, refreshSettings);
    return () =>
      window.removeEventListener(projectFilesChanged, refreshSettings);
  }, [root, refreshDocuments]);

  useEffect(() => {
    if (state.altStore.standardLibraryNavigation) {
      setPanel('libraries');
      setShowSidebar(true);
    }
  }, [state.altStore.standardLibraryNavigation]);

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : String(error));
  }

  function rememberLibraries() {
    void rememberProjectLibrariesOnEdit(store.getState).catch(report);
  }

  function clearDrawing(empty = false) {
    const drawing = blank();
    dispatch(actionSetDocument(
      empty ? { ...drawing, documentId: '' } : drawing,
      'tCad1.dsn',
      null,
      null,
    ));
    dispatch(ActionCreators.clearHistory());
  }

  function markPreview(key?: string) {
    previewKey.current = key;
    setPreview(key);
  }

  function keepOpen(key: string) {
    if (previewKey.current === key) markPreview();
  }

  function replaceTabKey(previous: string, next: string) {
    const replace = (keys: string[]) =>
      keys.includes(previous)
        ? [...new Set(keys.map((key) => key === previous ? next : key))]
        : keys;
    setOrder(replace);
    setPinned(replace);
    if (previewKey.current === previous) markPreview(next);
  }

  function forgetClosed(keys: ReadonlySet<string>) {
    if (previewKey.current && keys.has(previewKey.current)) markPreview();
    setPinned((pinned) => pinned.filter((key) => !keys.has(key)));
  }

  async function createDesign(location: ProjectLocation) {
    const blocked = () =>
      projectRoot.current !== location ||
      transition.current ||
      saveLock.current ||
      store.getState().altStore.saveInProgress;
    if (blocked()) return;
    const entries = await projectRequest({
      operation: 'list',
      folder: location.id,
      tree: true,
    });
    if (blocked()) return;
    const occupied = new Set([
      ...entries.map(({ name }) => name.toLowerCase()),
      ...openSchematicTabs(store.getState()).map(({ tab }) =>
        tab.file.name.toLowerCase(),
      ),
    ]);
    let number = 1;
    while (
      occupied.has(`tcad${number}.dsn`) ||
      occupied.has(`tcad${number}.dzn`)
    )
      number++;
    dispatch(
      actionSetDocument(blank(), `tCad${number}.dsn`, null, location.id),
    );
    dispatch(ActionCreators.clearHistory());
  }

  function hasDirtyDrawings() {
    return openSchematicTabs(store.getState()).some(({ tab }) =>
      schematicTabDirty(tab),
    );
  }

  function canReplace(message: string) {
    if (
      transition.current ||
      saveLock.current ||
      store.getState().altStore.saveInProgress ||
      documents.writing.size || projectBoardsBusy()
    )
      return false;
    return (
      !(hasDirtyDrawings() || documents.hasDirty() || projectBoardsDirty()) || window.confirm(message)
    );
  }

  function activate(key: string) {
    opening.current++;
    boards.deactivate();
    setSideBySide(false);
    documents.select();
    dispatch(activateSchematicTab(key));
  }

  async function open(
    file: BrowserFile,
    mode: 'restore' | 'preview' | 'keep' = 'restore',
    snapshot?: { data: Uint8Array; version?: string },
  ) {
    const blocked = () =>
      saveLock.current ||
      store.getState().altStore.saveInProgress ||
      (mode !== 'restore' && (transition.current || documents.isSaving()));
    if (blocked()) return;
    const epoch = ++opening.current;
    setError('');
    if (/\.tclib$/i.test(file.name)) {
      await projectRequest({ operation: 'edit-library', id: file.id });
      return;
    }
    const canOpen = () => epoch === opening.current && !blocked();
    if (isBoardFile(file.name)) {
      const existing = boards.get().tabs.find(({ document }) => (document.session.file?.id ?? document.fileId) === file.id);
      if (existing) selectBoard(existing.id);
      else {
        const { openProjectBoardFile } = await import('../../io/projectBoardWorkspace');
        const project = projectRoot.current;
        const relativePath = file.id.slice(project.id.length).replace(/^[\\/]/, '');
        const session = await openProjectBoardFile({ ...file, path: relativePath }, project.id);
        if (!canOpen()) return;
        documents.select();
        setBoardFocus(true);
        const id = boards.add({ session, fileId: file.id, folderId: file.folder, projectRootId: project.id }, false);
        keepOpen('board:' + id);
      }
      return;
    }
    const schematic = isDrawingFile(file.name);
    const key = schematic ? schematicFileTabKey(file) : 'file:' + file.id;
    const existing = schematic
      ? openSchematicTabs(store.getState()).some((entry) => entry.key === key)
      : documents.has(file.id);
    if (schematic) {
      if (existing) activate(key);
      else {
        const drawing = await readProjectDrawing(file, projectRoot.current?.id, snapshot);
        if (!canOpen()) return;
        boards.deactivate();
        setSideBySide(false);
        documents.select();
        dispatch(drawing);
        dispatch(ActionCreators.clearHistory());
      }
    } else if (!(await documents.open(file, canOpen)) || !canOpen()) {
      return;
    }
    if (!schematic) {
      boards.deactivate();
      setSideBySide(false);
    }
    if (mode === 'keep') keepOpen(key);
    if (mode !== 'preview' || existing) return;
    const replaced = previewKey.current;
    if (replaced && replaced !== key) {
      if (replaced.startsWith('file:')) {
        documents.removeWhere((id) => id === replaced.slice(5), false);
      } else {
        closeSchematics(new Set([replaced]));
        if (!schematic) documents.select(file.id);
      }
      replaceTabKey(replaced, key);
    } else {
      markPreview(key);
    }
  }

  async function enter(next: ProjectOpenLocation) {
    if (projectRoot.current?.id === next.id) return;
    assertProjectCanOpen(store.getState());
    transition.current = true;
    setRestoring(true);
    setError('');
    setOrder([]);
    setPinned([]);
    markPreview();
    boards.remove(boards.get().tabs.map(({ id }) => id));
    setSideBySide(false);
    dispatch(enableSchematicTabs(false));
    clearDrawing(true);
    documents.clear();
    opening.current++;
    dispatch(enableSchematicTabs(true, next.id));
    projectRoot.current = next;
    setRoot(next);
    setPanel('files');
    setShowSidebar(true);
    setGitCount(0);
    setGitSnapshot(undefined);
    saveStartupMode('project');
    try {
      await startProjectLibraries(next.id, dispatch, store.getState).catch(report);
      if (next.initialDrawing) {
        await open({ ...next.initialDrawing, folder: next.id, ancestors: [] });
        return;
      }
      const session = readProjectTabSession(next.id, account);
      const restored: {
        key: string;
        kind: 'drawing' | 'file' | 'board';
        index: number;
        id: string;
      }[] = [];
      for (const [index, tab] of (session?.tabs ?? []).entries()) {
        const file =
          tab.kind === 'schematic'
            ? { ...tab.location, folder: tab.location.folderId ?? next.id }
            : tab.kind === 'board'
            ? undefined
            : tab;
        if (!file || !isInside(next.id, file.id)) continue;
        try {
          if (tab.kind === 'drawing' || tab.kind === 'schematic') {
            await open({
              ...file,
              name: 'name' in file ? file.name : '',
              ancestors: [],
            });
            restored.push({
              key: schematicFileTabKey({
                id: file.id,
                name: 'name' in file ? file.name : '',
              }),
              kind: 'drawing',
              index,
              id: file.id,
            });
          } else {
            const items = await projectRequest({
              operation: 'list',
              folder: file.folder,
              tree: true,
            });
            const item = items.find(
              (entry) => entry.id === file.id && !entry.unsupported,
            );
            if (item) {
              await open({
                ...item,
                folder: file.folder,
                ancestors: [
                  ...(tab.kind === 'file' ? tab.ancestors ?? [] : []),
                ],
              });
              const board = isBoardFile(item.name) && boards.get().tabs.find(({ document }) => document.fileId === file.id);
              restored.push(board
                ? { key: 'board:' + board.id, kind: 'board', index, id: board.id }
                : { key: 'file:' + file.id, kind: 'file', index, id: file.id });
            }
          }
        } catch {
          // A renamed, missing or unsupported file should not stop the other tabs restoring.
        }
      }
      setOrder(restored.map(({ key }) => key));
      setPinned(restored.filter(({ index }) => session?.pinned?.includes(index)).map(({ key }) => key));
      markPreview(restored.find(({ index }) => index === session?.preview)?.key);
      const selected =
        restored.find(({ index }) => index === session?.active) ??
        restored.at(-1);
      if (selected?.kind === 'drawing') activate(selected.key);
      if (selected?.kind === 'file') selectDocument(selected.id);
      if (selected?.kind === 'board') selectBoard(selected.id);
    } finally {
      transition.current = false;
      setRestoring(false);
    }
  }

  function leave() {
    if (!root || !canReplace('Close the project and discard unsaved changes?'))
      return;
    opening.current++;
    documents.clear();
    boards.remove(projectBoards.map(({ id }) => id));
    setSideBySide(false);
    dispatch(enableSchematicTabs(false));
    endProjectLibraries(dispatch, store.getState);
    clearDrawing();
    projectRoot.current = undefined;
    setRoot(undefined);
    setOrder([]);
    setPinned([]);
    markPreview();
    setError('');
    saveStartupMode('single');
  }

  function closeSchematics(keys: ReadonlySet<string>) {
    const current = store.getState();
    if (keys.has(activeSchematicTabKey(current))) {
      const other = openSchematicTabs(current).findLast(({ key }) => !keys.has(key));
      if (other) dispatch(activateSchematicTab(other.key));
      else clearDrawing(true);
    }
    for (const key of keys) dispatch(removeSchematicTab(key));
  }

  function beforeFileChange(
    id: string,
    kind: 'relocate' | 'trash',
    name?: string,
  ) {
    const current = store.getState();
    if (
      saveLock.current ||
      current.altStore.saveInProgress ||
      documents.isSaving()
    )
      throw new Error('Wait for the open files to finish saving.');
    if (projectBoards.some(({ document }) => {
      const location = boardLocation(document);
      return location && isInside(id, location.id);
    }))
      throw new Error('Close the open PCB before moving or deleting it.');
    const drawings = openSchematicTabs(current).filter(
      ({ tab }) => typeof tab.file.id === 'string' && isInside(id, tab.file.id),
    );
    if (
      kind === 'trash' &&
      (drawings.some(({ tab }) => schematicTabDirty(tab)) ||
        documents.hasDirty((file) => isInside(id, file)))
    )
      throw new Error('Save or close the open files before deleting them.');
    if (
      kind === 'relocate' &&
      drawings.some(({ tab }) => tab.file.id === id) &&
      !isDrawingFile(name)
    )
      throw new Error('Close the schematic before changing its file type.');
    const document = documents.files.find((file) => file.id === id);
    if (
      kind === 'relocate' &&
      document &&
      (isDrawingFile(name) || isBoardFile(name) ||
        /\.tclib$/i.test(name) ||
        document.kind !== projectDocumentKind(name).kind)
    )
      throw new Error('Close the open file before changing its file type.');
  }

  function relocateOpenFiles(
    previous: ProjectItem,
    next: ProjectItem,
    parent: string,
  ) {
    function move(path: string) {
      return path && isInside(previous.id, path)
        ? next.id + path.slice(previous.id.length)
        : path;
    }
    function directory(id: string) {
      const last = id.lastIndexOf(pathSeparator(root.id));
      return id.slice(0, Math.max(root.id.length, last));
    }
    const drawings = Object.fromEntries(
      openSchematicTabs(store.getState()).flatMap(({ key, tab: { file } }) =>
        typeof file.id === 'string' && isInside(previous.id, file.id)
          ? [
              [
                key,
                {
                  ...file,
                  id: move(file.id),
                  name: file.id === previous.id ? next.name : file.name,
                  folderId:
                    file.id === previous.id ? parent : directory(move(file.id)),
                },
              ],
            ]
          : [],
      ),
    );
    const supporting = Object.fromEntries(
      documents.files.flatMap((file) => {
        if (!isInside(previous.id, file.id)) return [];
        const id = move(file.id);
        const folder = directory(id);
        const ancestors = folder
          .slice(root.id.length)
          .split(pathSeparator(root.id))
          .filter(Boolean)
          .reduce(
            (ids, part) => [
              ...ids,
              ids.at(-1).replace(/[\\/]$/, '') + pathSeparator(root.id) + part,
            ],
            [root.id],
          );
        return [
          [
            file.id,
            {
              id,
              folder,
              ancestors,
              name: file.id === previous.id ? next.name : file.name,
            },
          ],
        ];
      }),
    );
    if (Object.keys(drawings).length) dispatch(relocateSchematicTabs(drawings));
    if (Object.keys(supporting).length) documents.relocate(supporting);
    const relocatedKey = (key: string) =>
      drawings[key]
        ? schematicFileTabKey(drawings[key])
        : key.startsWith('file:') && supporting[key.slice(5)]
        ? 'file:' + supporting[key.slice(5)].id
        : key;
    setOrder((keys) => keys.map(relocatedKey));
    setPinned((keys) => keys.map(relocatedKey));
    if (previewKey.current) markPreview(relocatedKey(previewKey.current));
  }

  function closeRemovedFiles(id: string) {
    const removed = openSchematicTabs(store.getState()).filter(
      ({ tab: { file } }) =>
        typeof file.id === 'string' && isInside(id, file.id),
    );
    const drawingKeys = new Set(removed.map(({ key }) => key));
    const removedFile = (file: string) => isInside(id, file);
    closeSchematics(drawingKeys);
    documents.removeWhere(removedFile);
    if (documents.active && !removedFile(documents.active)) documents.select(documents.active);
    forgetClosed(new Set([
      ...drawingKeys,
      ...documents.files.filter((file) => removedFile(file.id)).map((file) => 'file:' + file.id),
    ]));
  }

  async function saveAll() {
    if (
      saveLock.current ||
      store.getState().altStore.saveInProgress ||
      documents.isSaving() || projectBoardsBusy()
    )
      throw new Error('A save is already in progress.');
    saveLock.current = true;
    setSaving(true);
    try {
      const failures: string[] = [];
      for (const { key, tab } of openSchematicTabs(store.getState()).filter(
        ({ tab }) => schematicTabDirty(tab),
      )) {
        try {
          if (key === activeSchematicTabKey(store.getState())) {
            const saved = await fileSave(dispatch, store.getState);
            if (!saved) throw new Error('Save did not complete.');
          } else {
            const meta = await saveSchematicFile(
              tab.file,
              tab.history.present.drawing,
              false,
              root?.id,
            );
            dispatch(
              savedSchematicTab(
                key,
                tab,
                {
                  ...tab.file,
                  id: meta.id,
                  name: meta.name,
                  projectVersion: meta.version,
                  folderId: meta.version ? meta.folderId ?? tab.file.folderId : tab.file.folderId,
                },
                tab.history.present.drawingVersion,
              ),
            );
            const savedKey = schematicFileTabKey({ ...tab.file, id: meta.id, name: meta.name });
            if (savedKey && savedKey !== key) replaceTabKey(key, savedKey);
            if (!tab.file.id && typeof meta.id === 'string') {
              await bindDrawingExports({
                project: root?.id,
                drawingId: meta.id,
                draftId: tab.history.present.drawing.documentId || tab.file.name,
                name: meta.name,
              }).catch((error) => report(
                `${meta.name} was saved, but its export locations could not be remembered. ${String(error)}`,
              ));
            }
          }
        } catch (error) {
          failures.push(
            `${tab.file.name} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      for (const { document: { session } } of projectBoards) {
        if (!session.dirty) continue;
        try {
          await session.save();
          if (session.dirty) throw new Error('Save did not complete.');
        } catch (error) {
          failures.push(`${session.path} — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const result = await documents.saveAll();
      failures.push(
        ...result.failed.map(({ name, message }) => `${name} — ${message}`),
      );
      window.dispatchEvent(new Event(projectFilesChanged));
      if (failures.length) throw new Error(failures.join('\n'));
      if (hasDirtyDrawings() || documents.hasDirty() || projectBoardsDirty())
        throw new Error('Some files changed during the save.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function refreshOpenFiles(repository: string) {
    for (const { id, document } of projectBoards) {
      const location = boardLocation(document);
      if (!location || location.kind !== 'file' || !isInside(repository, location.id) ||
          document.session.dirty || document.session.busy) continue;
      try {
        const version = await projectRequest({ operation: 'fingerprint', id: location.id });
        if (version === document.session.savedVersion) continue;
        const { openProjectBoardFile } = await import('../../io/projectBoardWorkspace');
        const path = location.id.slice(root.id.length).replace(/^[\\/]/, '');
        const session = await openProjectBoardFile({
          id: location.id, folder: location.folder, path,
          name: location.id.slice(location.folder.length + 1),
        }, root.id);
        if (!document.session.dirty && !document.session.busy)
          boards.replace(id, { ...document, session }, document);
      } catch (error) {
        report(error);
      }
    }
    const unavailable = await documents.refresh((id) =>
      isInside(repository, id),
    );
    for (const { key, tab } of openSchematicTabs(store.getState())) {
      const { file } = tab;
      const id = file.id;
      if (
        !file.projectVersion ||
        typeof id !== 'string' ||
        !isInside(repository, id) ||
        schematicTabDirty(tab)
      )
        continue;
      try {
        const version = await projectRequest({ operation: 'fingerprint', id });
        if (version === file.projectVersion) continue;
        const drawing = await readProjectDrawing({
          id,
          name: file.name,
          folder: file.folderId,
        }, projectRoot.current?.id);
        const current = store.getState();
        if (activeSchematicTabKey(current) === key) {
          if (
            !current.altStore.saveInProgress &&
            current.altStore.file === file &&
            current.altStore.savedVersion ===
              current.docStore.present.drawingVersion
          ) {
            dispatch(drawing);
            dispatch(ActionCreators.clearHistory());
          }
        } else {
          dispatch(reloadSchematicTab(key, tab, drawing));
        }
      } catch {
        unavailable.push(file.name);
      }
    }
    if (unavailable.length)
      report(new Error(`Could not reload: ${unavailable.join(', ')}`));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('project') === '1') {
      void openLaunchedProject(store.getState).catch(report);
      return;
    }
    if (
      startupMode() !== 'project' ||
      ['project', 'file', 'library', 'action', 'workspace'].some((name) => params.has(name))
    )
      return;
    void projectRequest({ operation: 'recent-project-folder' })
      .then((recent) => {
        if (recent) activateProjectFolder(recent);
      })
      .catch(report);
  }, []);

  useEffect(() => {
    const onOpen = (event: CustomEvent<ProjectOpenLocation>) => {
      void enter(event.detail).catch(report);
    };
    const onCheckOpen = (event: Event) => {
      const boardsToClose = root ? projectBoards : boards.get().tabs;
      if (transition.current || saveLock.current || documents.isSaving() || documents.hasDirty() ||
          boardsToClose.some(({ document }) => document.session.busy || document.session.dirty))
        event.preventDefault();
    };
    const onClose = () => leave();
    const onNewDesign = (event: Event) => {
      if (!projectRoot.current) return;
      event.preventDefault();
      void createDesign(projectRoot.current).catch(report);
    };
    const onSaveAll = () => {
      if (root) void saveAll().catch(report);
    };
    const onSave = (event: Event) => {
      if (saveLock.current || transition.current) {
        event.preventDefault();
        return;
      }
      if (boards.get().activeId && (!splitBoard || boardFocus)) return;
      if (!documents.active && (!root || activeSchematicTabKey(store.getState()))) return;
      event.preventDefault();
      if (!documents.active) return;
      if (event instanceof CustomEvent && event.detail === 'file-save-as') return;
      if (!documents.isSaving())
        void documents.save(documents.active).catch(report);
    };
    const onEditHistory = (event: Event) => {
      if (!documents.active || !(event instanceof CustomEvent))
        return;
      event.preventDefault();
      if (event.detail === 'undo' || event.detail === 'redo')
        editHistory(event.detail);
    };
    const onConfirmClose = (event: Event) => {
      if (root && !canReplace('Quit and discard unsaved project changes?'))
        event.preventDefault();
    };
    const onBoard = (event: WindowEventMap[typeof boardOpened]) => {
      const project = projectRoot.current;
      if (!project || saveLock.current || transition.current) return;
      const { session, fileId } = event.detail;
      const existing = fileId && boards.get().tabs.find(({ document }) => (document.session.file?.id ?? document.fileId) === fileId);
      if (existing) {
        selectBoard(existing.id);
      } else if (fileId && isInside(project.id, fileId)) {
        const separator = pathSeparator(project.id);
        const folder = fileId.slice(0, fileId.lastIndexOf(separator));
        const name = fileId.slice(folder.length + 1);
        void open({ id: fileId, folder, name, ancestors: [] }, 'keep').catch(report);
      } else {
        opening.current++;
        documents.select();
        setBoardFocus(true);
        const id = boards.add({ session, fileId, projectRootId: project.id }, false);
        keepOpen('board:' + id);
      }
    };
    window.addEventListener(boardOpened, onBoard);
    window.addEventListener(projectFolderOpened, onOpen);
    window.addEventListener(checkProjectOpen, onCheckOpen);
    window.addEventListener(closeProjectMode, onClose);
    window.addEventListener(newProjectDesign, onNewDesign);
    window.addEventListener(saveProjectTabs, onSaveAll);
    window.addEventListener(saveActiveProjectFile, onSave);
    window.addEventListener(editProjectHistory, onEditHistory);
    window.addEventListener(confirmProjectClose, onConfirmClose);
    return () => {
      window.removeEventListener(boardOpened, onBoard);
      window.removeEventListener(projectFolderOpened, onOpen);
      window.removeEventListener(checkProjectOpen, onCheckOpen);
      window.removeEventListener(closeProjectMode, onClose);
      window.removeEventListener(newProjectDesign, onNewDesign);
      window.removeEventListener(saveProjectTabs, onSaveAll);
      window.removeEventListener(saveActiveProjectFile, onSave);
      window.removeEventListener(editProjectHistory, onEditHistory);
      window.removeEventListener(confirmProjectClose, onConfirmClose);
    };
  });

  useEffect(() => {
    let previousState = store.getState();
    return store.subscribe(() => {
      const next = store.getState();
      const previous = activeSchematicTabKey(previousState);
      const current = activeSchematicTabKey(next);
      const edited = !transition.current && current && current === previous &&
        next.docStore.present.drawingVersion > previousState.docStore.present.drawingVersion &&
        next.docStore.present.drawingVersion !== next.altStore.savedVersion;
      if (current && previewKey.current === current &&
          next.docStore.present.drawingVersion !== next.altStore.savedVersion)
        keepOpen(current);
      const previousDrawing = previousState.docStore.present.drawing;
      previousState = next;
      if (edited) rememberLibraries();
      if (current === previous) return;
      if (!transition.current && current && previousDrawing !== next.docStore.present.drawing) {
        boards.deactivate();
        setSideBySide(false);
      }
      if (previous && current && previousDrawing === next.docStore.present.drawing) {
        replaceTabKey(previous, current);
      }
      opening.current++;
      documents.select();
    });
  }, [store, documents.select, boards.deactivate]);

  function boardLocation(document: typeof projectBoards[number]['document']): Extract<ProjectTabLocation, { kind: 'file' }> | undefined {
    if (!root) return;
    const id = document.session.file?.id ?? document.fileId;
    if (typeof id !== 'string' || !isInside(root.id, id)) return;
    const folder = document.folderId ?? id.slice(0, id.lastIndexOf(pathSeparator(root.id)));
    return { kind: 'file', id, folder };
  }

  const drawingTabs: Tab[] = root
    ? openSchematicTabs(state).map(({ key, tab }) => ({
        key,
        name: tab.file.name,
        dirty: schematicTabDirty(tab),
        select: () => activate(key),
        location: drawingLocation(tab.file, root.id),
      }))
    : [];
  const allTabs: Tab[] = [
    ...drawingTabs,
    ...(root ? projectBoards.map(({ id, document }): Tab => ({
      key: 'board:' + id,
      name: document.session.path,
      dirty: document.session.dirty,
      select: () => selectBoard(id),
      location: boardLocation(document),

    })) : []),
    ...documents.files.map(
      (file): Tab => ({
        key: 'file:' + file.id,
        name: file.name,
        dirty: dirtyProjectDocument(file),
        select: () => {
          opening.current++;
          selectDocument(file.id);
        },
        location: {
          kind: 'file',
          id: file.id,
          folder: file.folder,
          ancestors: file.ancestors,
        },
      }),
    ),
  ];
  const tabs = [
    ...order.flatMap((key) => allTabs.filter((tab) => tab.key === key)),
    ...allTabs.filter(({ key }) => !order.includes(key)),
  ];
  const selection = activeBoard && root ? 'board:' + activeBoard.id : documents.active ? 'file:' + documents.active : activeKey;

  function closeTabs(keys: string[]) {
    const current = store.getState();
    if (transition.current || saveLock.current || current.altStore.saveInProgress || documents.isSaving() || projectBoardsBusy()) return;
    const closing = new Set(keys);
    const dirty = tabs.filter((tab) => closing.has(tab.key) && tab.dirty);
    if (dirty.length && !window.confirm(
      `Discard unsaved changes in ${dirty.map(({ name }) => name).join(', ')}?`,
    )) return;
    const index = tabs.findIndex(({ key }) => key === selection);
    const next = closing.has(selection)
      ? tabs.slice(index + 1).find(({ key }) => !closing.has(key)) ??
        tabs.slice(0, index).findLast(({ key }) => !closing.has(key))
      : tabs[index];
    opening.current++;
    boards.remove(keys.filter((key) => key.startsWith('board:')).map((key) => key.slice(6)));
    closeSchematics(new Set(keys.filter((key) => !key.startsWith('file:') && !key.startsWith('board:'))));
    documents.removeWhere((id) => closing.has('file:' + id), false);
    forgetClosed(closing);
    if (next) next.select();
    else documents.select();
  }

  function moveTab(index: number, offset: -1 | 1) {
    const keys = tabs.map(({ key }) => key);
    const target = index + offset;
    if (!keys[target]) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    setOrder(keys);
  }

  function togglePin(key: string) {
    keepOpen(key);
    setPinned((keys) => keys.includes(key) ? keys.filter((id) => id !== key) : [...keys, key]);
  }

  const tabOrder = JSON.stringify(tabs.map(({ key }) => key));
  const restorable = tabs.filter(({ location }) => location);
  const cached = JSON.stringify(
    restorable.map(({ location }) => location),
  );
  const activeIndex = restorable.findIndex(({ key }) => key === selection);
  const previewIndex = restorable.findIndex(({ key }) => key === preview);
  const pinnedIndices = JSON.stringify(restorable.flatMap(({ key }, index) => pinned.includes(key) ? [index] : []));

  useEffect(() => {
    setOrder(JSON.parse(tabOrder));
  }, [tabOrder]);
  useEffect(() => {
    if (root && !restoring)
      writeProjectTabSession(root.id, account, {
        tabs: JSON.parse(cached),
        active: activeIndex >= 0 ? activeIndex : undefined,
        preview: previewIndex >= 0 ? previewIndex : undefined,
        pinned: pinnedIndices === '[]' ? undefined : JSON.parse(pinnedIndices),
      });
  }, [root, restoring, cached, activeIndex, previewIndex, pinnedIndices]);

  const selectedId =
    (activeBoard && boardLocation(activeBoard.document)?.id) ?? documents.active ??
    (typeof activeFile.id === 'string' ? activeFile.id : undefined);
  const openFolder = () => {
    void openProjectFolder(store.getState).catch(report);
  };
  const openDocument = documents.files.find(
    ({ id }) => id === documents.active,
  );
  const sheet = state.docStore.present.view.selected_sheet;
  const editor = activeBoard && (!splitBoard || boardFocus) ? 'pcb' : openDocument?.kind ?? (root && !tabs.length
    ? 'empty'
    : sheet === -1 ? 'bom' : sheet < -1 ? 'web' : 'design');
  useEffect(() => {
    window.electronAPI?.setEditorMenuState?.({ project: !!root, editor });
  }, [!!root, editor]);
  const saveAllAction = root && {
    run: () => {
      void saveAll().catch(report);
    },
    disabled:
      restoring ||
      saving ||
      state.altStore.saveInProgress ||
      documents.writing.size > 0 || projectBoardsBusy(),
  };

  function editHistory(command: 'undo' | 'redo') {
    textEditor?.run(command);
  }

  function selectPanel(next: ProjectPanel) {
    setPanel(next);
    if (next === 'hierarchy') setShowSidebar(true);
  }

  useEffect(() => {
    if (!root || !activeKey || openDocument) return;
    let timer: ReturnType<typeof setTimeout>;
    let revision = 0;
    const refresh = () => {
      clearTimeout(timer);
      const ticket = ++revision;
      timer = setTimeout(() => {
        const current = store.getState();
        const source = current.docStore.present.drawing;
        if (!source.sheets.some((sheet) => sheet.items.some(
          (item) => item.NodeName === DocItemTypes.Symbol && item.hierarchicalFile !== undefined,
        ))) return;
        void readCurrentHierarchy(current, true).then((drawing) => {
          if (ticket === revision && projectRoot.current === root &&
              activeSchematicTabKey(store.getState()) === activeKey)
            dispatch({ ...actionCommand('refresh_hierarchical_symbol'), hierarchicalReload: { source, drawing } });
        }).catch((error) => { if (ticket === revision) report(error); });
      }, 150);
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(projectFilesChanged, refresh);
    const unsubscribe = window.electronAPI.onProjectFoldersChanged(refresh);
    return () => {
      revision++;
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(projectFilesChanged, refresh);
      unsubscribe();
    };
  }, [root, activeKey, openDocument, store]);

  useEffect(() => {
    if (!root) return;
    const listener = (event: Event) => {
      const result = (event as CustomEvent<DrcError>).detail;
      if (!result) return;
      const state = store.getState();
      const checkedId = state.altStore.projectDrcTabKey;
      const selection = ++drcSelection.current;
      const currentReport = () => projectRoot.current === root && selection === drcSelection.current &&
        store.getState().altStore.projectDrcTabKey === checkedId;
      const center = () => {
        const current = store.getState();
        if (currentReport() && drcResultInActiveDrawing(current, result) &&
            current.docStore.present.drawing.sheets.some((sheet) => sheet.name === result.sheet))
          dispatch(actionFindSelection(3, result.source ? result : {
            ...result, source: { sheet: result.sheet, instance: 0, instancePath: [] },
          }));
      };
      const show = async () => {
        if (documents.active || !drcResultInActiveDrawing(state, result)) {
          const fileId = result.source?.fileId;
          const tab = openSchematicTabs(state).find(({ key, tab }) => fileId ? tab.file.id === fileId : key === checkedId);
          if (tab) activate(tab.key);
          else if (fileId) {
            const file = await projectRequest({ operation: 'read-hierarchical-drawing', project: root.id, filename: fileId });
            if (!currentReport()) return;
            await open({ id: file.id, name: file.id.split(/[\\/]/).at(-1), folder: file.folder, ancestors: [] }, 'keep', file);
          }
        }
        center();
        requestAnimationFrame(center);
      };
      void show().catch(report);
    };
    window.addEventListener(projectDrcResultSelected, listener);
    return () => window.removeEventListener(projectDrcResultSelected, listener);
  });

  useEffect(() => {
    if (!root) return;
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const { command, symbolId } = event.detail;
      if (command !== 'open' && command !== 'refresh' && command !== 'change') return;
      const { altStore, docStore: { present } } = store.getState();
      if (altStore.saveInProgress || saveLock.current || documents.active) return;
      const index = present.view.selected_sheet;
      const source = present.drawing.sheets[index];
      const item = source?.items.find((item) => item._id === symbolId);
      if (item?.NodeName !== DocItemTypes.Symbol || item.hierarchicalFile === undefined) return;
      const owner = typeof altStore.file.id === 'string' ? altStore.file.id : undefined;
      const stillCurrent = () => {
        const current = store.getState().docStore.present;
        return projectRoot.current === root && current.drawing === present.drawing &&
          current.view.selected_sheet === index;
      };
      const handle = async () => {
        if (command === 'open') {
          const linked = await projectRequest({
            operation: 'read-hierarchical-drawing', project: root.id, owner: item._hierarchicalOwner ?? owner, filename: item.hierarchicalFile,
          });
          if (!stillCurrent()) return;
          const { id, folder } = linked;
          await open({ id, name: id.split(/[\\/]/).at(-1), folder, ancestors: [] }, 'keep', linked);
        } else {
          let placement = item;
          if (command === 'change') {
            const selection = await projectRequest({ operation: 'choose-hierarchical-drawing', project: root.id });
            if (!selection || !stillCurrent()) return;
            const { relative } = await projectRequest({
              operation: 'read-hierarchical-drawing', project: root.id, owner, filename: selection.id,
            });
            placement = { ...item, hierarchicalFile: relative, _hierarchicalOwner: owner, text: item.text.map((field) =>
              field.description === 'Design' ? { ...field, value: selection.name } : field) };
          }
          const { resolveProjectHierarchy } = await import('../../io/projectHierarchy');
          const drawing = await resolveProjectHierarchy(
            { ...present.drawing, sheets: [{ ...source, items: [placement] }] },
            root.id, owner, openHierarchyEdits(store.getState()),
          );
          if (!stillCurrent()) return;
          const refreshed = drawing.sheets[0].items[0] as dsnSymbol;
          if (placement !== item && refreshed._hierarchicalError)
            throw new Error(refreshed._hierarchicalError);
          dispatch({
            ...actionCommand('refresh_hierarchical_symbol'),
            ...(placement === item ? { hierarchicalRefresh: refreshed } : { hierarchicalRedirect: refreshed }),
          });
        }
      };
      if (command === 'change') requestAnimationFrame(() => void handle().catch(report));
      else void handle().catch(report);
    };
    const choose = () => {
      if (!activeKey || documents.active || !hierarchySheet ||
          hierarchySheet.hierarchicalSymbol || hierarchySheet.kind === 'simulation') return;
      const drawing = store.getState().docStore.present.drawing;
      void projectRequest({ operation: 'choose-hierarchical-drawing', project: root.id })
        .then((file) => {
          if (file && projectRoot.current === root && drawing === store.getState().docStore.present.drawing)
            return insertHierarchy(file.id);
        }).catch(report);
    };
    window.addEventListener('tinycad:hierarchy-symbol', listener);
    window.addEventListener('tinycad:insert-hierarchical-symbol', choose);
    const drop = (event: WindowEventMap[typeof hierarchyDropEvent]) => {
      if (event.detail.project === root.id)
        void insertHierarchy(event.detail.id, event.detail.point).catch(report);
    };
    window.addEventListener(hierarchyDropEvent, drop);
    return () => {
      window.removeEventListener('tinycad:hierarchy-symbol', listener);
      window.removeEventListener('tinycad:insert-hierarchical-symbol', choose);
      window.removeEventListener(hierarchyDropEvent, drop);
    };
  });

  const hierarchySheet = state.docStore.present.drawing.sheets[sheet];
  const unresolvedLink = root && !activeBoard && !openDocument && state.docStore.present.drawing.sheets
    .flatMap((part) => part.items)
    .find((item): item is dsnSymbol => item.NodeName === DocItemTypes.Symbol && !!item._hierarchicalError);
  const canInsertHierarchy = !!(activeKey && (!activeBoard || splitBoard && !boardFocus) && !openDocument && hierarchySheet &&
    !hierarchySheet.hierarchicalSymbol && hierarchySheet.kind !== 'simulation');

  async function insertHierarchy(fileId: string, point?: Coordinate) {
    const currentState = store.getState();
    const { docStore: { present }, altStore } = currentState;
    if (!canInsertHierarchy || altStore.saveInProgress || saveLock.current) return;
    const currentSheet = present.view.selected_sheet;
    const owner = typeof altStore.file.id === 'string' ? altStore.file.id : undefined;
    const { prepareHierarchicalPlacement } = await import('../../io/projectHierarchy');
    const openDrawings = openHierarchyEdits(currentState);
    const placement = await prepareHierarchicalPlacement(present.drawing, currentSheet, root.id, owner, fileId, openDrawings);
    const latest = store.getState();
    const current = latest.docStore.present;
    if (projectRoot.current !== root ||
        activeSchematicTabKey(latest) !== activeSchematicTabKey(currentState) ||
        current.drawingVersion !== present.drawingVersion ||
        current.view.selected_sheet !== currentSheet)
      return;
    dispatch({ ...actionCommand('add_hierarchical_symbol'), hierarchicalPlacement: placement, hierarchicalDropPoint: point });
  }

  async function openHierarchyDesign(design: HierarchyDesign) {
    if (design.tab) {
      activate(design.tab);
    } else if (design.id) {
      const folder = design.id.slice(0, Math.max(root.id.length, design.id.lastIndexOf(pathSeparator(root.id))));
      await open({ id: design.id, name: design.filename, folder, ancestors: [] }, 'keep');
    }
    const current = store.getState();
    if (projectRoot.current !== root ||
        activeSchematicTabKey(current) !== (design.tab ?? schematicFileTabKey({ id: design.id, name: design.filename })))
      return;
    if (design.tab) keepOpen(design.tab);
    const { drawing, view } = current.docStore.present;
    if (drawing.sheets[view.selected_sheet]?.hierarchicalSymbol) {
      const circuit = drawing.sheets.findIndex((sheet) => !sheet.hierarchicalSymbol && sheet.kind !== 'simulation');
      if (circuit !== -1) dispatch(actionSheetSelect(circuit));
    }
  }

  return children({
    boardFootprintsRef,
    closeBoard: root && activeBoard ? () => closeTabs(['board:' + activeBoard.id]) : undefined,
    splitBoard,
    boardActive: !splitBoard || boardFocus,
    focusBoard: () => setBoardFocus(true),
    focusCircuit: () => setBoardFocus(false),
    chatProject: root && { root, active: openDocument, pdfPage },
    projectSidebar: root && {
      visible: showSidebar,
      showFootprints: () => { setPanel('libraries'); setShowSidebar(true); },
      activityBar: (
        <nav className="project-activity-bar" aria-label="Project views">
          <SidePanelToggle
            className="project-sidebar-toggle"
            expanded={showSidebar}
            controls={sidebarId}
            onToggle={() => setShowSidebar((visible) => !visible)}
          />
          <Button
            appearance="subtle"
            icon={<FolderRegular />}
            aria-label="Files"
            title="Files"
            aria-controls={sidebarId}
            aria-pressed={showSidebar && panel === 'files'}
            onClick={() => selectPanel('files')}
          />
          <Button
            appearance="subtle"
            icon={<BranchForkRegular />}
            aria-label="Git"
            title={gitCount ? `Git (${gitCount} changes)` : 'Git'}
            aria-controls={sidebarId}
            aria-pressed={showSidebar && panel === 'git'}
            onClick={() => selectPanel('git')}
          >
            {gitCount > 0 && (
              <span className="project-activity-count" aria-hidden="true">
                {gitCount}
              </span>
            )}
          </Button>
          <Button
            appearance="subtle"
            icon={<LibraryRegular />}
            aria-label={t('library.libraries')}
            title={t('library.libraries')}
            aria-controls={sidebarId}
            aria-pressed={showSidebar && panel === 'libraries'}
            onClick={() => selectPanel('libraries')}
          />
          <Button
            appearance="subtle"
            icon={<OrganizationRegular />}
            aria-label={t('projectHierarchy.title')}
            title={t('projectHierarchy.title')}
            aria-controls={sidebarId}
            aria-pressed={showSidebar && panel === 'hierarchy'}
            onClick={() => selectPanel('hierarchy')}
          />
          <Button
            appearance="subtle"
            icon={<FolderOpenRegular />}
            aria-label="Open Project Folder…"
            title="Open Project Folder…"
            onClick={openFolder}
          />
          <Button
            appearance="subtle"
            icon={<DismissRegular />}
            aria-label="Close project"
            title="Close project"
            onClick={leave}
          />
        </nav>
      ),
      content: (
        <aside
          className="project-workspace-sidebar side-panel-surface"
          aria-label="Project sidebar"
          id={sidebarId}
          hidden={!showSidebar}
        >
          <div
            className="project-files-panel"
            hidden={panel !== 'files' || restoring}
          >
            <ProjectFileBrowser
              key={root.id}
              root={root}
              active={selectedId}
              open={(file, keep) => open(file, keep ? 'keep' : 'preview')}
              addLibrary={async (id) => { await addProjectLibraries(id)(dispatch, store.getState); }}
              edited={rememberLibraries}
              insertHierarchy={canInsertHierarchy ? insertHierarchy : undefined}
              report={report}
              gitChanges={
                gitSnapshot &&
                new Map(
                  gitSnapshot.changes
                    .filter(({ outside }) => !outside)
                    .map((change) => [
                      gitSnapshot.root.replace(/[\\/]$/, '') +
                        pathSeparator(gitSnapshot.root) +
                        change.path.replaceAll(
                          '/',
                          pathSeparator(gitSnapshot.root),
                        ),
                      change.conflicted
                        ? 'U'
                        : change.working !== '.'
                        ? change.working
                        : change.index,
                    ]),
                )
              }
              beforeChange={beforeFileChange}
              relocated={relocateOpenFiles}
              removed={closeRemovedFiles}
            />
          </div>
          <div
            className="project-git-panel"
            hidden={panel !== 'git' || restoring}
          >
            <ProjectSourceControl
              key={root.id}
              root={root}
              openFolder={openFolder}
              setCount={setGitCount}
              onSnapshot={setGitSnapshot}
              schematicDirty={() => hasDirtyDrawings() || projectBoardsDirty()}
              supportingFilesDirty={documents.hasDirty}
              saveOpenFiles={saveAll}
              refreshOpenFiles={refreshOpenFiles}
            />
          </div>
          <div
            className="project-hierarchy-panel"
            hidden={panel !== 'hierarchy' || restoring}
          >
            <ProjectHierarchyBrowser key={root.id} project={root.id} state={state}
              showActive={!openDocument} canInsert={canInsertHierarchy}
              open={openHierarchyDesign} insert={insertHierarchy} report={report} />
          </div>
          <div
            className="project-libraries-panel"
            hidden={panel !== 'libraries' || restoring}
          >
            {activeBoard && (!splitBoard || boardFocus) ? <div ref={setBoardFootprintsRef} /> : <SidePanelContainer />}
          </div>
        </aside>
      ),
    },
    status: error ? (
      <p className="project-error" role="alert">
        {error}
      </p>
    ) : restoring ? (
      <p role="status">Restoring project tabs…</p>
    ) : unresolvedLink ? (
      <p className="project-error" role="status">
        {unresolvedLink.hierarchicalFile} · {unresolvedLink._hierarchicalError}
      </p>
    ) : undefined,
    tabs: root && (
      <>
      <ProjectFileTabs
        tabs={tabs}
        selection={selection}
        preview={preview}
        pinned={pinned}
        disabled={saveAllAction.disabled}
        saveAll={saveAllAction.run}
        closeTabs={closeTabs}
        moveTab={moveTab}
        keepOpen={keepOpen}
        togglePin={togglePin}
      />
      {activeBoard && activeKey && (
        <Button size="small" aria-pressed={splitBoard} onClick={() => setSideBySide(!sideBySide)}>
          Side by side
        </Button>
      )}
      </>
    ),
    saveBlocked: saveAllAction?.disabled,
    documentToolbar: root && (openDocument || !tabs.length) && (
      <>
        <ToolbarButton
          icon={<SaveRegular />}
          aria-label={t('toolbar.save')}
          title={t('toolbar.save')}
          disabled={!openDocument || !dirtyProjectDocument(openDocument) || saveAllAction.disabled}
          onClick={() => {
            if (openDocument) void documents.save(openDocument.id).catch(report);
          }}
        />
        <EditorToolbarDivider />
        <ToolbarButton
          icon={<ArrowUndoRegular />}
          aria-label="Undo"
          title="Undo"
          disabled={!textEditor?.canUndo}
          onClick={() => editHistory('undo')}
        />
        <ToolbarButton
          icon={<ArrowRedoRegular />}
          aria-label="Redo"
          title="Redo"
          disabled={!textEditor?.canRedo}
          onClick={() => editHistory('redo')}
        />
      </>
    ),
    document: root && (documents.files.length > 0 || !tabs.length) && (
      <div className="project-document-area" hidden={!openDocument && !!tabs.length}>
        {!tabs.length && <p className="project-empty-editor">Open a project file to get started.</p>}
        {documents.files.map((file) => (
          <ProjectDocumentEditor
            key={file.id}
            file={file}
            active={file === openDocument}
            editorRef={setTextEditor}
            onPdfPageChange={setPdfPage}
            onEdit={(value) => {
              if (file.kind === 'text' && file.value !== value) {
                keepOpen('file:' + file.id);
                rememberLibraries();
              }
              documents.edit(file.id, value);
            }}
          />
        ))}
      </div>
    ),
  });
}
