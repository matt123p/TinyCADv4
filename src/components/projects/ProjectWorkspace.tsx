import React, { useEffect, useId, useRef, useState } from 'react';
import { useSelector, useStore } from 'react-redux';
import { ActionCreators } from 'redux-undo';
import { useTranslation } from 'react-i18next';
import { Button, ToolbarButton } from '@fluentui/react-components';
import {
  ArrowRedoRegular,
  ArrowUndoRegular,
  BranchForkRegular,
  Dismiss12Regular,
  DismissRegular,
  FolderOpenRegular,
  FolderRegular,
  LibraryRegular,
  SaveCopyRegular,
  SaveRegular,
} from '@fluentui/react-icons';
import { isDrawingFile } from '../../../shared/drawingFiles';
import { fileSave, saveSchematicFile } from '../../io/files';
import type { GitSnapshot } from '../../io/projectGit';
import { projectDocumentKind } from '../../io/projectDocumentKind';
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
  openLaunchedProject,
  openProjectFolder,
  projectRequest,
  readProjectDrawing,
} from '../../io/projects';
import {
  projectFilesChanged,
  projectFolderOpened,
} from '../../io/projectStorage';
import type { ProjectItem, ProjectLocation } from '../../io/projectStorage';
import {
  readProjectTabSession,
  writeProjectTabSession,
} from '../../io/projectTabSession';
import type { ProjectTabLocation } from '../../io/projectTabSession';
import {
  dirtyProjectDocument,
  useProjectDocuments,
} from '../../io/useProjectDocuments';
import { actionSetDocument } from '../../state/dispatcher/AppDispatcher';
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
import type { BrowserFile } from './ProjectFileBrowser';
import ProjectGitDiff from './ProjectGitDiff';
import ProjectSourceControl from './ProjectSourceControl';
import type { GitReview } from './ProjectSourceControl';

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
  };
  status?: React.ReactNode;
  tabs?: React.ReactNode;
  document?: React.ReactNode;
  documentToolbar?: React.ReactNode;
  saveBlocked?: boolean;
};

type ProjectPanel = 'files' | 'git' | 'libraries';

type Tab = {
  key: string;
  name: string;
  dirty: boolean;
  select(): void;
  close(): void;
  location?: ProjectTabLocation;
};

export default function ProjectWorkspace({
  children,
}: {
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
      activeSchematicTabKey(previous) === activeSchematicTabKey(current),
  );
  const activeKey = activeSchematicTabKey(state);
  const activeFile = state.altStore.file;
  const [root, setRoot] = useState<ProjectLocation>();
  const projectRoot = useRef<ProjectLocation>();
  const [restoring, setRestoring] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [panel, setPanel] = useState<ProjectPanel>('files');
  const [review, setReview] = useState<GitReview>();
  const [showReview, setShowReview] = useState(false);
  const [error, setError] = useState('');
  const [gitCount, setGitCount] = useState(0);
  const [gitSnapshot, setGitSnapshot] = useState<GitSnapshot>();
  const [historyRequest, setHistoryRequest] = useState<{
    filename: string;
    blame?: boolean;
  }>();
  const [saving, setSaving] = useState(false);
  const [textEditor, setTextEditor] = useState<ProjectTextEditor>(null);
  const saveLock = useRef(false);
  const transition = useRef(false);
  const opening = useRef(0);
  const [order, setOrder] = useState<string[]>([]);
  const documents = useProjectDocuments();

  useEffect(() => {
    if (state.altStore.standardLibraryNavigation) {
      setPanel('libraries');
      setShowSidebar(true);
    }
  }, [state.altStore.standardLibraryNavigation]);

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : String(error));
  }

  function clearDrawing() {
    dispatch(actionSetDocument(blank(), 'tCad1.dsn', null, null));
    dispatch(ActionCreators.clearHistory());
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
      documents.writing.size
    )
      return false;
    return (
      !(hasDirtyDrawings() || documents.hasDirty()) || window.confirm(message)
    );
  }

  function activate(key: string) {
    opening.current++;
    setShowReview(false);
    documents.select();
    dispatch(activateSchematicTab(key));
  }

  async function open(file: BrowserFile) {
    if (saveLock.current || store.getState().altStore.saveInProgress) return;
    const epoch = ++opening.current;
    setError('');
    if (/\.tclib$/i.test(file.name)) {
      await projectRequest({ operation: 'edit-library', id: file.id });
      return;
    }
    if (!isDrawingFile(file.name)) {
      await documents.open(file);
      if (epoch === opening.current) setShowReview(false);
      return;
    }
    documents.select();
    const key = schematicFileTabKey(file);
    if (
      openSchematicTabs(store.getState()).some((entry) => entry.key === key)
    ) {
      activate(key);
      return;
    }
    const drawing = await readProjectDrawing(file);
    if (epoch !== opening.current || store.getState().altStore.saveInProgress)
      return;
    setShowReview(false);
    dispatch(drawing);
    dispatch(ActionCreators.clearHistory());
  }

  async function enter(next: ProjectLocation) {
    if (
      root?.id === next.id ||
      !canReplace('Switch projects and discard unsaved changes?')
    )
      return;
    transition.current = true;
    setRestoring(true);
    setError('');
    setShowReview(false);
    if (root) {
      dispatch(enableSchematicTabs(false));
      clearDrawing();
      documents.clear();
    }
    opening.current++;
    dispatch(enableSchematicTabs(true));
    projectRoot.current = next;
    setRoot(next);
    setPanel('files');
    setShowSidebar(true);
    setGitCount(0);
    setGitSnapshot(undefined);
    setHistoryRequest(undefined);
    saveStartupMode('project');
    try {
      const session = readProjectTabSession(next.id, account);
      const restored: {
        key: string;
        kind: 'drawing' | 'file';
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
              restored.push({
                key: 'file:' + file.id,
                kind: 'file',
                index,
                id: file.id,
              });
            }
          }
        } catch {
          // A renamed, missing or unsupported file should not stop the other tabs restoring.
        }
      }
      setOrder(restored.map(({ key }) => key));
      const selected =
        restored.find(({ index }) => index === session?.active) ??
        restored.at(-1);
      if (selected?.kind === 'drawing') activate(selected.key);
      if (selected?.kind === 'file') documents.select(selected.id);
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
    dispatch(enableSchematicTabs(false));
    clearDrawing();
    projectRoot.current = undefined;
    setRoot(undefined);
    setShowReview(false);
    setOrder([]);
    setError('');
    saveStartupMode('single');
  }

  function closeDrawing(key: string) {
    const current = store.getState();
    const tabs = openSchematicTabs(current);
    const closing = tabs.find((entry) => entry.key === key);
    if (!closing || saveLock.current || current.altStore.saveInProgress) return;
    if (
      schematicTabDirty(closing.tab) &&
      !window.confirm(`Discard changes to ${closing.tab.file.name}?`)
    )
      return;
    if (activeSchematicTabKey(current) === key) {
      const other = tabs.filter((entry) => entry.key !== key).at(-1);
      if (other) activate(other.key);
      else clearDrawing();
    }
    dispatch(removeSchematicTab(key));
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
      (isDrawingFile(name) ||
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
    setOrder((keys) =>
      keys.map((key) =>
        drawings[key]
          ? schematicFileTabKey(drawings[key])
          : key.startsWith('file:') && supporting[key.slice(5)]
          ? 'file:' + supporting[key.slice(5)].id
          : key,
      ),
    );
  }

  function closeRemovedFiles(id: string) {
    const current = store.getState();
    const tabs = openSchematicTabs(current);
    const removed = tabs.filter(
      ({ tab: { file } }) =>
        typeof file.id === 'string' && isInside(id, file.id),
    );
    if (removed.some(({ key }) => key === activeSchematicTabKey(current))) {
      const remaining = tabs.filter((tab) => !removed.includes(tab)).at(-1);
      if (remaining) activate(remaining.key);
      else clearDrawing();
    }
    for (const { key } of removed) dispatch(removeSchematicTab(key));
    documents.removeWhere((file) => isInside(id, file));
  }

  async function saveAll() {
    if (
      saveLock.current ||
      store.getState().altStore.saveInProgress ||
      documents.isSaving()
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
            );
            dispatch(
              savedSchematicTab(
                key,
                tab,
                {
                  ...tab.file,
                  id: meta.id,
                  name: meta.name,
                  projectVersion: tab.file.projectVersion
                    ? meta.version
                    : undefined,
                },
                tab.history.present.drawingVersion,
              ),
            );
          }
        } catch (error) {
          failures.push(
            `${tab.file.name} — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      const result = await documents.saveAll();
      failures.push(
        ...result.failed.map(({ name, message }) => `${name} — ${message}`),
      );
      window.dispatchEvent(new Event(projectFilesChanged));
      if (failures.length) throw new Error(failures.join('\n'));
      if (hasDirtyDrawings() || documents.hasDirty())
        throw new Error('Some files changed during the save.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function refreshOpenFiles(repository: string) {
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
        });
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
      void openLaunchedProject().catch(report);
      return;
    }
    if (
      startupMode() !== 'project' ||
      ['project', 'file', 'library', 'action'].some((name) => params.has(name))
    )
      return;
    void projectRequest({ operation: 'recent-project-folder' })
      .then((recent) => {
        if (recent)
          window.dispatchEvent(
            new CustomEvent(projectFolderOpened, { detail: recent }),
          );
      })
      .catch(report);
  }, []);

  useEffect(() => {
    const onOpen = (event: CustomEvent<ProjectLocation>) => {
      void enter(event.detail).catch(report);
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
      if (!documents.active && !showReview) return;
      event.preventDefault();
      if (documents.active && !showReview && !documents.isSaving())
        void documents.save(documents.active).catch(report);
    };
    const onEditHistory = (event: Event) => {
      if ((!documents.active && !showReview) || !(event instanceof CustomEvent))
        return;
      event.preventDefault();
      if (!showReview && (event.detail === 'undo' || event.detail === 'redo'))
        editHistory(event.detail);
    };
    const onConfirmClose = (event: Event) => {
      if (root && !canReplace('Quit and discard unsaved project changes?'))
        event.preventDefault();
    };
    window.addEventListener(projectFolderOpened, onOpen);
    window.addEventListener(closeProjectMode, onClose);
    window.addEventListener(newProjectDesign, onNewDesign);
    window.addEventListener(saveProjectTabs, onSaveAll);
    window.addEventListener(saveActiveProjectFile, onSave);
    window.addEventListener(editProjectHistory, onEditHistory);
    window.addEventListener(confirmProjectClose, onConfirmClose);
    return () => {
      window.removeEventListener(projectFolderOpened, onOpen);
      window.removeEventListener(closeProjectMode, onClose);
      window.removeEventListener(newProjectDesign, onNewDesign);
      window.removeEventListener(saveProjectTabs, onSaveAll);
      window.removeEventListener(saveActiveProjectFile, onSave);
      window.removeEventListener(editProjectHistory, onEditHistory);
      window.removeEventListener(confirmProjectClose, onConfirmClose);
    };
  });

  useEffect(() => {
    let previous = activeSchematicTabKey(store.getState());
    return store.subscribe(() => {
      const current = activeSchematicTabKey(store.getState());
      if (current === previous) return;
      previous = current;
      opening.current++;
      setShowReview(false);
      documents.select();
    });
  }, [store, documents.select]);

  const drawingTabs: Tab[] = root
    ? openSchematicTabs(state).map(({ key, tab }) => ({
        key,
        name: tab.file.name,
        dirty: schematicTabDirty(tab),
        select: () => activate(key),
        close: () => closeDrawing(key),
        location: drawingLocation(tab.file, root.id),
      }))
    : [];
  const allTabs: Tab[] = [
    ...drawingTabs,
    ...documents.files.map(
      (file): Tab => ({
        key: 'file:' + file.id,
        name: file.name,
        dirty: dirtyProjectDocument(file),
        select: () => {
          opening.current++;
          setShowReview(false);
          documents.select(file.id);
        },
        close: () => {
          if (
            !dirtyProjectDocument(file) ||
            window.confirm(`Discard changes to ${file.name}?`)
          )
            documents.close(file.id);
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
  const selection = documents.active ? 'file:' + documents.active : activeKey;
  const tabOrder = JSON.stringify(tabs.map(({ key }) => key));
  const cached = JSON.stringify(
    tabs.filter(({ location }) => location).map(({ location }) => location),
  );
  const activeIndex = tabs
    .filter(({ location }) => location)
    .findIndex(({ key }) => key === selection);

  useEffect(() => {
    setOrder(JSON.parse(tabOrder));
  }, [tabOrder]);
  useEffect(() => {
    if (root && !restoring)
      writeProjectTabSession(root.id, account, {
        tabs: JSON.parse(cached),
        active: activeIndex >= 0 ? activeIndex : undefined,
      });
  }, [root, restoring, cached, activeIndex]);

  const selectedId =
    documents.active ??
    (typeof activeFile.id === 'string' ? activeFile.id : undefined);
  const openFolder = () => {
    void openProjectFolder().catch(report);
  };
  const openDocument = documents.files.find(
    ({ id }) => id === documents.active,
  );
  const saveAllAction = root && {
    run: () => {
      void saveAll().catch(report);
    },
    disabled:
      restoring ||
      saving ||
      state.altStore.saveInProgress ||
      documents.writing.size > 0,
  };

  function editHistory(command: 'undo' | 'redo') {
    textEditor?.run(command);
  }

  function selectPanel(next: ProjectPanel) {
    setShowSidebar(next !== panel || !showSidebar);
    setPanel(next);
  }

  return children({
    projectSidebar: root && {
      visible: showSidebar,
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
              open={open}
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
              showHistory={
                gitSnapshot &&
                ((filename, blame) => {
                  setHistoryRequest({ filename, blame });
                  setPanel('git');
                  setShowSidebar(true);
                })
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
              historyRequest={historyRequest}
              openReview={(next) => {
                setReview(next);
                setShowReview(!!next);
              }}
              schematicDirty={hasDirtyDrawings}
              supportingFilesDirty={documents.hasDirty}
              saveOpenFiles={saveAll}
              refreshOpenFiles={refreshOpenFiles}
            />
          </div>
          <div
            className="project-libraries-panel"
            hidden={panel !== 'libraries' || restoring}
          >
            <SidePanelContainer />
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
    ) : undefined,
    tabs: root && (
      <div className="project-file-tabs" aria-label="Open files">
        <div className="project-tab-list">
          {tabs.map((tab) => (
            <div className="project-file-tab" key={tab.key}>
              <Button
                size="small"
                appearance={
                  selection === tab.key && !showReview ? 'primary' : 'subtle'
                }
                aria-pressed={selection === tab.key && !showReview}
                disabled={restoring || saving}
                onClick={tab.select}
              >
                {tab.name}
                {tab.dirty ? ' •' : ''}
              </Button>
              <Button
                size="small"
                className="project-file-tab-close"
                appearance="subtle"
                icon={<Dismiss12Regular />}
                aria-label={`Close ${tab.name}`}
                title={`Close ${tab.name}`}
                disabled={restoring || saving}
                onClick={tab.close}
              />
            </div>
          ))}
        </div>
        <Button
          size="small"
          appearance="subtle"
          className="project-save-all"
          icon={<SaveCopyRegular />}
          title="Save All"
          disabled={saveAllAction.disabled}
          onClick={saveAllAction.run}
        >
          Save All
        </Button>
      </div>
    ),
    saveBlocked: saveAllAction?.disabled,
    documentToolbar: root && (openDocument || showReview) && (
      <>
        <ToolbarButton
          icon={<SaveRegular />}
          aria-label={t('toolbar.save')}
          title={t('toolbar.save')}
          disabled={
            showReview ||
            !openDocument ||
            !dirtyProjectDocument(openDocument) ||
            saveAllAction.disabled
          }
          onClick={() => {
            void documents.save(openDocument.id).catch(report);
          }}
        />
        <EditorToolbarDivider />
        <ToolbarButton
          icon={<ArrowUndoRegular />}
          aria-label="Undo"
          title="Undo"
          disabled={!textEditor?.canUndo || showReview}
          onClick={() => editHistory('undo')}
        />
        <ToolbarButton
          icon={<ArrowRedoRegular />}
          aria-label="Redo"
          title="Redo"
          disabled={!textEditor?.canRedo || showReview}
          onClick={() => editHistory('redo')}
        />
      </>
    ),
    document: root && (documents.files.length > 0 || showReview) && (
      <div
        className="project-document-area"
        hidden={!openDocument && !showReview}
      >
        {showReview && review && (
          <ProjectGitDiff
            key={review.title}
            review={review}
            close={() => setShowReview(false)}
          />
        )}
        {documents.files.map((file) => (
          <ProjectDocumentEditor
            key={file.id}
            file={file}
            active={!showReview && file === openDocument}
            editorRef={setTextEditor}
            onEdit={(value) => documents.edit(file.id, value)}
          />
        ))}
      </div>
    ),
  });
}
