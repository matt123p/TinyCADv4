import React, { useEffect, useRef, useState } from 'react';
import { useSelector, useStore } from 'react-redux';
import { ActionCreators } from 'redux-undo';
import { Button } from '@fluentui/react-components';
import {
  BranchForkRegular,
  DismissRegular,
  FolderRegular,
} from '@fluentui/react-icons';
import { isDrawingFile } from '../../../shared/drawingFiles';
import { fileSave, saveSchematicFile } from '../../io/files';
import { blank } from '../../io/ioXml';
import {
  closeProjectMode,
  confirmProjectClose,
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
import type { ProjectLocation } from '../../io/projectStorage';
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
import {
  activeSchematicTabKey,
  activateSchematicTab,
  enableSchematicTabs,
  openSchematicTabs,
  reloadSchematicTab,
  removeSchematicTab,
  savedSchematicTab,
  schematicFileTabKey,
  schematicTabDirty,
} from '../../state/schematicTabs';
import type { docDrawing } from '../../state/undo/undo';
import ProjectDocumentEditor from './ProjectDocumentEditor';
import ProjectFileBrowser from './ProjectFileBrowser';
import type { BrowserFile } from './ProjectFileBrowser';
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
  sidebar?: React.ReactNode;
  tabs?: React.ReactNode;
  document?: React.ReactNode;
};

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
      previous.docStore.present.drawingVersion ===
        current.docStore.present.drawingVersion &&
      activeSchematicTabKey(previous) === activeSchematicTabKey(current),
  );
  const activeKey = activeSchematicTabKey(state);
  const activeFile = state.altStore.file;
  const [root, setRoot] = useState<ProjectLocation>();
  const [restoring, setRestoring] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [panel, setPanel] = useState<'files' | 'git'>('files');
  const [review, setReview] = useState<GitReview>();
  const [showReview, setShowReview] = useState(false);
  const [error, setError] = useState('');
  const [gitCount, setGitCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const transition = useRef(false);
  const opening = useRef(0);
  const [order, setOrder] = useState<string[]>([]);
  const documents = useProjectDocuments();

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : String(error));
  }

  function clearDrawing() {
    dispatch(actionSetDocument(blank(), 'tCad1.dsn', null, null));
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
    setRoot(next);
    setPanel('files');
    setShowSidebar(true);
    setGitCount(0);
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

  async function saveAll() {
    if (saveLock.current || store.getState().altStore.saveInProgress)
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
      if (documents.active && !showReview)
        void documents.save(documents.active).catch(report);
    };
    const onConfirmClose = (event: Event) => {
      if (root && !canReplace('Quit and discard unsaved project changes?'))
        event.preventDefault();
    };
    window.addEventListener(projectFolderOpened, onOpen);
    window.addEventListener(closeProjectMode, onClose);
    window.addEventListener(saveProjectTabs, onSaveAll);
    window.addEventListener(saveActiveProjectFile, onSave);
    window.addEventListener(confirmProjectClose, onConfirmClose);
    return () => {
      window.removeEventListener(projectFolderOpened, onOpen);
      window.removeEventListener(closeProjectMode, onClose);
      window.removeEventListener(saveProjectTabs, onSaveAll);
      window.removeEventListener(saveActiveProjectFile, onSave);
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

  return children({
    sidebar: root ? (
      <aside
        className="project-workspace-sidebar"
        aria-label="Project Manager"
        hidden={!showSidebar}
      >
        <div className="project-actions">
          <Button
            size="small"
            icon={<FolderRegular />}
            aria-pressed={panel === 'files'}
            onClick={() => setPanel('files')}
          >
            Files
          </Button>
          <Button
            size="small"
            icon={<BranchForkRegular />}
            aria-pressed={panel === 'git'}
            onClick={() => setPanel('git')}
          >
            Git{gitCount > 0 && ` (${gitCount})`}
          </Button>
          <Button
            size="small"
            icon={<DismissRegular />}
            aria-label="Close project"
            onClick={leave}
          />
        </div>
        <Button size="small" onClick={openFolder}>
          Open Project Folder…
        </Button>
        <div hidden={panel !== 'files' || restoring}>
          <ProjectFileBrowser
            key={root.id}
            root={root}
            active={selectedId}
            open={open}
            report={report}
            isOpen={(id) =>
              documents.isProtected(id) ||
              drawingTabs.some(
                ({ location }) =>
                  location?.kind === 'drawing' && isInside(id, location.id),
              )
            }
          />
        </div>
        <div hidden={panel !== 'git' || restoring}>
          <ProjectSourceControl
            key={root.id}
            root={root}
            openFolder={openFolder}
            setCount={setGitCount}
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
        {restoring && <p role="status">Restoring project tabs…</p>}
        {error && (
          <p className="project-error" role="alert">
            {error}
          </p>
        )}
      </aside>
    ) : error ? (
      <p className="project-error" role="alert">
        {error}
      </p>
    ) : undefined,
    tabs: root && (
      <div className="project-file-tabs" aria-label="Open files">
        <Button
          size="small"
          appearance="subtle"
          icon={<FolderRegular />}
          aria-label="Show Project Manager"
          aria-pressed={showSidebar}
          onClick={() => setShowSidebar((visible) => !visible)}
        />
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
                appearance="subtle"
                icon={<DismissRegular />}
                aria-label={`Close ${tab.name}`}
                disabled={restoring || saving}
                onClick={tab.close}
              />
            </div>
          ))}
        </div>
        <Button
          size="small"
          disabled={restoring || saving}
          onClick={() => {
            void saveAll().catch(report);
          }}
        >
          Save All
        </Button>
      </div>
    ),
    document:
      root &&
      (showReview && review ? (
        <section className="project-document-editor" aria-label={review.title}>
          <div className="project-actions">
            <strong>{review.title}</strong>
            <Button size="small" onClick={() => setShowReview(false)}>
              Close Review
            </Button>
          </div>
          {review.stageHunk &&
            review.hunks?.map((hunk, index) => (
              <div key={index}>
                <Button size="small" onClick={() => review.stageHunk(index)}>
                  Stage Hunk
                </Button>
                <pre>{hunk}</pre>
              </div>
            ))}
          {(!review.stageHunk || !review.hunks?.length) && (
            <pre>{review.text}</pre>
          )}
        </section>
      ) : (
        openDocument && (
          <div className="project-document-area">
            {openDocument.kind === 'text' && (
              <Button
                size="small"
                disabled={
                  !dirtyProjectDocument(openDocument) ||
                  documents.writing.has(openDocument.id)
                }
                onClick={() => {
                  void documents.save(openDocument.id).catch(report);
                }}
              >
                Save {openDocument.name}
              </Button>
            )}
            <ProjectDocumentEditor
              key={openDocument.id}
              file={openDocument}
              active
              onEdit={(value) => documents.edit(openDocument.id, value)}
            />
          </div>
        )
      )),
  });
}
