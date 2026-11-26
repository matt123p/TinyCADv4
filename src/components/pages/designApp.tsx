import React, {
  FunctionComponent,
  useState,
  useCallback,
  useEffect,
  lazy,
  Suspense,
} from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { ActionCreators } from 'redux-undo';
import {
  makeStyles, Button, ToggleButton, Dialog, DialogSurface, DialogBody,
  DialogTitle, DialogContent, DialogActions, Tab, TabList,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { BookOpenRegular, BranchForkRegular, DismissRegular, FolderRegular } from '@fluentui/react-icons';
import { ProjectFileIcon } from '../projects/ProjectFileIcon';
import ToolbarContainer from '../../state/containers/toolbarContainer';
import { EditorToolbar } from '../toolbar/EditorToolbar';
import { EditorSaveAllButton, EditorSaveButton } from '../toolbar/FileToolbarControls';
import SidePanelContainer from '../../state/containers/sidePanelContainer';
import BomContainer from '../../state/containers/bomContainer';
import SheetbarContainer from '../../state/containers/sheetbarContainer';
import BottomPanelContainer from '../../state/containers/bottomPanelContainer';
import { EditorDrawingStack, EditorSidePanel } from '../panel/EditorLayout';
import { stopActiveSimulation } from '../../simulation/lifecycle';
import { actionSelectDialog, actionSetDocument } from '../../state/dispatcher/AppDispatcher';
import { Browser } from '../sheets/browser';
import { tclibLibraryEntry } from '../../model/tclib';
import { isBoardFile } from '../../../shared/drawingFiles';
import { BrowserSheetData } from '../../model/dsnView';
import { boardOpened, circuitOpened, confirmBoardClose, confirmCircuitOpen, editFootprintLibrary, saveActiveBoard, boardHistoryCommand, editorHeaderDocument } from '../../io/boardWorkspaceEvents';
import { projectDocumentOpened, projectFilesChanged, projectFolderOpened } from '../../io/projectStorage';
import { readProjectTabSession, writeProjectTabSession } from '../../io/projectTabSession';
import type { ProjectTabLocation, ProjectTabRestore } from '../../io/projectTabSession';
import { chooseProjectFolder, closeProjectMode, recentDriveProjectFolders, rememberDriveProjectFolder, saveProjectTabs, startupMode } from '../../io/projectMode';
import type { docDrawing } from '../../state/undo/undo';
import type { ProjectLocation } from '../../io/projectStorage';
import { activateSchematicTab, enableSchematicTabs, openSchematicTabs, schematicFileTabKey, schematicTabDirty } from '../../state/schematicTabs';
import { useOpenBoards } from '../../io/useOpenBoards';
import { dirtyProjectDocument, useProjectDocuments } from '../../io/useProjectDocuments';
import { fileOpen, handleMenuCommand, saveSchematicFile } from '../../io/files';
import { blank } from '../../io/ioXml';
import type { SaveSummary } from '../../io/useProjectDocuments';
import type { GitReview } from '../projects/ProjectSourceControl';
import type { BoardWorkspaceDocument } from '../pcb/BoardWorkspace';
import type { StandardLibraryNavigation } from '../../state/actions/libraryActions';

const untrackedSchematicTab = 'untracked-schematic';

// Keep the entire chatbot dependency graph out of browser builds.
const ChatPanel = process.env.TARGET_SYSTEM === 'electron'
  ? lazy(() => import('../chat/ChatPanel').then((m) => ({ default: m.ChatPanel })))
  : null;

const HierarchyPanel = process.env.TARGET_SYSTEM === 'electron' || process.env.TARGET_SYSTEM === 'google'
  ? lazy(() => import('../projects/HierarchyPanel'))
  : null;
const ProjectBrowser = process.env.TARGET_SYSTEM === 'electron' || process.env.TARGET_SYSTEM === 'google'
  ? lazy(() => import('../projects/ProjectBrowser'))
  : null;
const DriveProjectFolderDialog = process.env.TARGET_SYSTEM === 'google'
  ? lazy(() => import('../projects/DriveProjectFolderDialog'))
  : null;
const loadProjectServices = process.env.TARGET_SYSTEM === 'electron' || process.env.TARGET_SYSTEM === 'google'
  ? () => import('../../io/projects')
  : null;
const ProjectDocumentEditor = process.env.TARGET_SYSTEM === 'electron' || process.env.TARGET_SYSTEM === 'google'
  ? lazy(() => import('../projects/ProjectDocumentEditor'))
  : null;
const ProjectSourceControl = process.env.TARGET_SYSTEM === 'electron'
  ? lazy(() => import('../projects/ProjectSourceControl'))
  : null;
const ProjectAutosave = process.env.TARGET_SYSTEM === 'electron' || process.env.TARGET_SYSTEM === 'google'
  ? lazy(() => import('../projects/ProjectAutosave'))
  : null;

const SheetContainer = lazy(() => import('../../state/containers/sheetContainer'));
const BoardWorkspace = lazy(() => import('../pcb/BoardWorkspace'));
const FootprintEditorDialog = lazy(() => import('../projects/FootprintEditorDialog'));

const SimulationFailureDialog = lazy(() => import('../simulation/SimulationFailureDialog').then(
  (module) => ({ default: module.SimulationFailureDialog }),
));

const SimulationSheet = lazy(() =>
  import('../simulation/SimulationSheet').then((m) => ({
    default: m.SimulationSheet,
  })),
);
const ChartWorkspace = lazy(() =>
  import('../simulation/ChartWorkspace').then((m) => ({
    default: m.ChartWorkspace,
  })),
);
const ExampleExplanationPanel = lazy(() =>
  import('../examples/ExampleExplanationPanel').then((m) => ({
    default: m.ExampleExplanationPanel,
  })),
);
const InstrumentWindowHost = lazy(() =>
  import('../simulation/InstrumentWindows').then((m) => ({
    default: m.InstrumentWindowHost,
  })),
);

// TODO: These styles seem common, maybe they should be in a common CSS or utility?
// For now, mirroring what was seen in mainAppElectron.tsx
const useStyles = makeStyles({
  rightPanels: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    maxWidth: '60vw',
    flexShrink: 0,
  },
});

export interface DesignAppProps {
  hasExampleExplanation?: boolean;
  standardLibraryNavigation?: StandardLibraryNavigation;
  simulationPanelVisible?: boolean;
  simulationPanelActivated?: boolean;
  selectedSpiceControl?: boolean;
  simulationSheet: boolean;
  editSymbol: tclibLibraryEntry;
  editLibrary?: boolean;
  hasOpenProject?: boolean;
  selected_sheet: number;
  drawingName: string;
  drawingDirty: boolean;
  browserSheets: BrowserSheetData[];
  creating: boolean;
  dialogOpen: boolean;
  cancelCreation: () => void;
}

const SIDE_PANEL_WIDTH_STORAGE_KEY = 'tinycad.sidePanelWidth';
const DEFAULT_SIDE_PANEL_WIDTH = 288;
const MIN_SIDE_PANEL_WIDTH = 220;
const MAX_SIDE_PANEL_WIDTH = 600;

function loadSidePanelWidth(): number {
  try {
    const parsed = parseInt(
      window.localStorage?.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY) || '',
      10,
    );
    if (isNaN(parsed)) {
      return DEFAULT_SIDE_PANEL_WIDTH;
    }

    return Math.max(
      MIN_SIDE_PANEL_WIDTH,
      Math.min(MAX_SIDE_PANEL_WIDTH, parsed),
    );
  } catch {
    return DEFAULT_SIDE_PANEL_WIDTH;
  }
}

function saveSidePanelWidth(width: number) {
  try {
    window.localStorage?.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    return;
  }
}

export const DesignApp: FunctionComponent<DesignAppProps> = (props) => {
  const dispatch = useDispatch();
  const documents = useProjectDocuments();
  const [fileToClose, setFileToClose] = useState<string>();
  const [fileSaveSummary, setFileSaveSummary] = useState<SaveSummary>();
  const [savingTabBatch, setSavingTabBatch] = useState(false);
  const [tabError, setTabError] = useState('');
  const batch = React.useRef(false);
  const editorStore = useStore<docDrawing>();

  const [simulationSuppressed, setSimulationSuppressed] = useState(false);
  const [footprintEditorOpen, setFootprintEditorOpen] = useState(false);
  useEffect(() => {
    const open = () => setFootprintEditorOpen(true);
    window.addEventListener(editFootprintLibrary, open);
    return () => window.removeEventListener(editFootprintLibrary, open);
  }, []);
  useEffect(() => {
    const show = () => {
      setSimulationSuppressed(false);
      dispatch({ type: 'simulation/panel', visible: true });
    };
    window.addEventListener('tinycad:show-charts', show);
    return () => window.removeEventListener('tinycad:show-charts', show);
  }, [dispatch]);
  useEffect(() => {
    if (props.simulationSheet || props.selectedSpiceControl) {
      setSimulationSuppressed(false);
      dispatch({ type: 'simulation/panel', visible: true });
    }
  }, [dispatch, props.simulationSheet, props.selectedSpiceControl]);
  const styles = useStyles();
  const { t } = useTranslation();
  const [projectMode, setProjectMode] = useState(() => !!ProjectBrowser && startupMode() === 'project');
  const [sideBySide, setSideBySide] = useState(false);
  const boards = useOpenBoards();
  const { get: getBoards, add: addBoard, select: selectBoard, replace: replaceBoard, remove: removeBoards } = boards;
  const activeBoard = boards.tabs.find(({ id }) => id === boards.activeId);
  const pcb = activeBoard?.document;
  const [boardToClose, setBoardToClose] = useState<string>();
  const [untrackedTabClosed, setUntrackedTabClosed] = useState(false);
  const [closingBoard, setClosingBoard] = useState(false);
  const initialWorkspace = React.useRef(new URLSearchParams(window.location.search));
  const [activeWorkspace, setActiveWorkspace] = useState<'circuit' | 'pcb'>(() => {
    const params = initialWorkspace.current;
    return params.get('workspace') === 'pcb' || isBoardFile(params.get('file') ?? '')
      ? 'pcb'
      : 'circuit';
  });
  const pcbActive = activeWorkspace === 'pcb';
  const simulationActive = !pcbActive && !props.editLibrary &&
    (!simulationSuppressed && props.simulationPanelActivated || props.simulationSheet);
  const activateCircuit = useCallback(() => {
    documents.select();
    setGitReview(undefined);
    setActiveWorkspace('circuit');
  }, [documents.select]);
  useEffect(() => {
    if (props.simulationPanelVisible) setSimulationSuppressed(false);
  }, [props.simulationPanelVisible]);
  useEffect(() => {
    if (!simulationActive) stopActiveSimulation();
  }, [simulationActive]);
  const activateBoard = useCallback((id: string) => {
    selectBoard(id);
    documents.select();
    setUntrackedTabClosed(true);
    setGitReview(undefined);
    setActiveWorkspace('pcb');
  }, [selectBoard, documents.select]);

  const openBoard = useCallback((document: BoardWorkspaceDocument) => {
    const { tabs, activeId } = getBoards();
    const current = tabs.find(({ id }) => id === activeId);
    const key = document.session.key;
    const existing = tabs.find(({ document: opened }) =>
      (document.fileId && opened.fileId === document.fileId) || (key && opened.session.key === key));
    if (existing && (projectMode || existing.document.session.savedVersion === document.session.savedVersion)) {
      const session = existing.document.session;
      if (existing.document.projectRootId && !document.projectRootId) {
        activateBoard(existing.id);
        return existing.id;
      }
      if (!session.dirty && document.projectRootId && !existing.document.projectRootId)
        replaceBoard(existing.id, document);
      else if (session.savedVersion === document.session.savedVersion)
        replaceBoard(existing.id, { ...document, session });
      else if (!session.dirty)
        replaceBoard(existing.id, document);
      else if (document.probe)
        replaceBoard(existing.id, { ...existing.document, probe: document.probe });
      activateBoard(existing.id);
      return existing.id;
    }
    if (!projectMode && current?.document.session.dirty &&
      !window.confirm('Discard unsaved edits to the current PCB?')) return;
    const id = addBoard(document, !projectMode);
    activateBoard(id);
    return id;
  }, [activateBoard, addBoard, getBoards, projectMode, replaceBoard]);

  const refreshBoardTab = useCallback(async (id: string, document: BoardWorkspaceDocument) => {
    const { session, reloadProjectBoard } = document;
    if (!reloadProjectBoard || session.dirty) return;
    const version = session.savedVersion;
    const updated = await reloadProjectBoard();
    if (!session.dirty && session.savedVersion === version && updated.session.savedVersion !== version)
      replaceBoard(id, updated, document);
  }, [replaceBoard]);

  const refreshProjectBoard = useCallback(async (fileId: string) => {
    const tab = getBoards().tabs.find(({ document }) => document.fileId === fileId);
    if (!tab) return;
    try {
      await refreshBoardTab(tab.id, tab.document);
    } catch (error) {
      setTabError('Could not reload the updated PCB: ' + (error instanceof Error ? error.message : String(error)));
    }
  }, [getBoards, refreshBoardTab]);

  useEffect(() => {
    const open = (event: WindowEventMap[typeof boardOpened]) => openBoard(event.detail);
    const confirm = (event: Event) => {
      if (!projectMode && pcbActive && activeBoard?.document.session.dirty &&
        !window.confirm('Discard unsaved edits to the current PCB?')) event.preventDefault();
    };
    const openCircuit = () => {
      if (!projectMode && pcbActive && activeBoard) removeBoards([activeBoard.id]);
      setUntrackedTabClosed(false);
      activateCircuit();
    };
    window.addEventListener(boardOpened, open);
    window.addEventListener(confirmCircuitOpen, confirm);
    window.addEventListener(circuitOpened, openCircuit);
    return () => {
      window.removeEventListener(boardOpened, open);
      window.removeEventListener(confirmCircuitOpen, confirm);
      window.removeEventListener(circuitOpened, openCircuit);
    };
  }, [openBoard, activateCircuit, activeBoard, pcbActive, projectMode, removeBoards]);
  useEffect(() => {
    const confirmClose = (event: Event) => {
      if ((documents.hasDirty() || Object.values(editorStore.getState().schematicTabs?.inactive ?? {}).some(schematicTabDirty)) &&
          !window.confirm('Close with unsaved project file edits?')) {
        event.preventDefault();
        return;
      }
      if (getBoards().tabs.some(({ document }) => document.session.dirty) &&
          !window.confirm('Close with unsaved PCB edits?')) event.preventDefault();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (getBoards().tabs.some(({ document }) => document.session.dirty) || documents.hasDirty() ||
          Object.values(editorStore.getState().schematicTabs?.inactive ?? {}).some(schematicTabDirty)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener(confirmBoardClose, confirmClose);
    if (process.env.TARGET_SYSTEM !== 'electron')
      window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener(confirmBoardClose, confirmClose);
      if (process.env.TARGET_SYSTEM !== 'electron')
        window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [getBoards, documents, editorStore]);
  useEffect(() => {
    const params = initialWorkspace.current;
    const workspace = params.get('workspace');
    if (!workspace) return;
    params.delete('workspace');
    if (workspace === 'simulation') {
      dispatch({ type: 'simulation/panel', visible: true });
    } else if (workspace === 'pcb' && !params.has('file')) {
      dispatch(handleMenuCommand('file-new-pcb') as any);
    }
  }, [dispatch]);
  const closeBoard = useCallback((id: string) => {
    removeBoards([id]);
    if (!getBoards().activeId) setActiveWorkspace('circuit');
  }, [getBoards, removeBoards]);

  function requestBoardClose(id: string) {
    if (savingTabBatch) return;
    const tab = getBoards().tabs.find((tab) => tab.id === id);
    if (!tab) return;
    if (projectMode && tab.document.session.dirty) {
      setTabError('');
      setBoardToClose(id);
    } else closeBoard(id);
  }

  function projectBoardsToClose() {
    const { tabs, activeId } = getBoards();
    const standalone = tabs.filter(({ document }) => !document.projectRootId && !document.session.projectId);
    const retained = standalone.find(({ id }) => id === activeId) ?? standalone.at(-1);
    return tabs.filter((tab) => tab !== retained);
  }

  const [chatOpen, setChatOpen] = useState(false);
  const toggleChat = useCallback(() => setChatOpen(previous => !previous), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const [sidePanelVisible, setSidePanelVisible] = useState(true);
  const store = editorStore;
  const schematicRegistry = useSelector((state: docDrawing) => state.schematicTabs);
  const currentFile = useSelector((state: docDrawing) => state.altStore.file);
  const currentSchematic = currentFile.project;
  const selectedSchematic = schematicFileTabKey(currentFile);
  const schematicVersion = useSelector((state: docDrawing) => state.docStore.present.drawingVersion);
  const schematicSavedVersion = useSelector((state: docDrawing) => state.altStore.savedVersion);
  const schematicSaving = useSelector((state: docDrawing) => state.altStore.saveInProgress);
  const schematicTabs = React.useMemo(() => openSchematicTabs(store.getState()),
    [schematicRegistry, currentSchematic, selectedSchematic, schematicVersion, schematicSavedVersion, store]);
  const canSplit = projectMode && !!selectedSchematic && !!pcb?.projectRootId &&
    currentSchematic?.rootId === pcb.projectRootId &&
    props.selected_sheet >= 0 && !props.simulationSheet && !props.editLibrary && !props.editSymbol;
  useEffect(() => {
    if (!canSplit) setSideBySide(false);
  }, [canSplit]);
  const [schematicToClose, setSchematicToClose] = useState<string>();
  const [closingSchematic, setClosingSchematic] = useState(false);
  const closingSchematicTab = schematicTabs.find(({ key }) => key === schematicToClose);
  const pendingCloseSchematic = schematicToClose === untrackedSchematicTab
    ? { key: untrackedSchematicTab, name: currentFile.name }
    : closingSchematicTab && { key: closingSchematicTab.key, name: closingSchematicTab.tab.file.name };
  useEffect(() => {
    dispatch(enableSchematicTabs(projectMode) as any);
  }, [dispatch, projectMode]);

  const restoreProjectAtStartup = React.useRef(projectMode);
  const projectModeChanged = React.useRef(false);
  const [projectPanel, setProjectPanel] = useState<'projects' | 'libraries' | 'source'>('libraries');
  const [gitRoot, setGitRoot] = useState<ProjectLocation>();
  const [gitCount, setGitCount] = useState(0);
  const [gitAvailable, setGitAvailable] = useState(false);
  const [gitHistoryRequest, setGitHistoryRequest] = useState<{ filename: string }>();
  const [gitReview, setGitReview] = useState<GitReview>();
  const openGitRoot = useCallback((root?: ProjectLocation) => {
    setGitRoot((previous) => previous?.id === root?.id ? previous : root);
  }, []);
  useEffect(() => {
    setGitReview(undefined);
    setGitCount(0);
    setGitAvailable(false);
    setGitHistoryRequest(undefined);
  }, [gitRoot?.id]);
  const [choosingProject, setChoosingProject] = useState(false);
  const [confirmCloseProject, setConfirmCloseProject] = useState(false);
  const [closingProject, setClosingProject] = useState(false);
  const [closeProjectError, setCloseProjectError] = useState('');
  const [openedProjectRoot, setOpenedProjectRoot] = useState<ProjectLocation>();
  const [projectTabRoot, setProjectTabRoot] = useState<{ id: string; account: string }>();
  const pendingProjectRoot = React.useRef<ProjectLocation>();
  const [restoreTabs, setRestoreTabs] = useState<ProjectTabRestore>();
  const [footprintsHost, setFootprintsHost] = useState<HTMLDivElement>(null);
  const [pcbRightPanelHost, setPcbRightPanelHost] = useState<HTMLElement>(null);
  const [sidePanelWidth, setSidePanelWidth] = useState(loadSidePanelWidth);
  const [sidePanelResizing, setSidePanelResizing] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  const [simulationToolbarTarget, setSimulationToolbarTarget] =
    useState<HTMLSpanElement>(null);

  const loadProjectTabs = useCallback((root: ProjectLocation) => {
    const account = store.getState().altStore.user?.id || '';
    const session = readProjectTabSession(root.id, account);
    setProjectTabRoot({ id: root.id, account });
    setRestoreTabs(session && { root: root.id, session });
    if (session) setUntrackedTabClosed(true);
  }, [store]);

  const enterProject = useCallback((root: ProjectLocation) => {
    if (process.env.TARGET_SYSTEM === 'google') {
      rememberDriveProjectFolder(store.getState().altStore.user?.id || '', root);
    }
    loadProjectTabs(root);
    setSideBySide(false);
    setOpenedProjectRoot(root);
    setGitRoot(root);
    setGitReview(undefined);
    setProjectMode(true);
    setProjectPanel('projects');
    setSidePanelVisible(true);
  }, [loadProjectTabs, store]);

  const useDefaultProjectRoot = useCallback((root: ProjectLocation) => {
    if (!projectTabRoot && !openedProjectRoot) loadProjectTabs(root);
  }, [loadProjectTabs, openedProjectRoot, projectTabRoot]);

  useEffect(() => {
    if (!ProjectBrowser) return;
    const browse = () => setChoosingProject(true);
    if (DriveProjectFolderDialog) window.addEventListener(chooseProjectFolder, browse);
    return () => {
      window.removeEventListener(chooseProjectFolder, browse);
    };
  }, []);

  useEffect(() => {
    if (!loadProjectServices) return;
    if (!restoreProjectAtStartup.current || initialWorkspace.current.get('project') === '1') return;
    let current = true;
    async function restore() {
      const { projectRequest } = await loadProjectServices();
      let root: ProjectLocation;
      if (process.env.TARGET_SYSTEM === 'electron') {
        root = await projectRequest({ operation: 'recent-project-folder' });
      } else if (process.env.TARGET_SYSTEM === 'google') {
        const user = store.getState().altStore.user?.id || '';
        for (const saved of recentDriveProjectFolders(user)) {
          try {
            root = await projectRequest({ operation: 'open-recent-project-folder', id: saved.id });
            break;
          } catch {
            // Try older folders when the newest one is unavailable.
          }
        }
      }
      if (root && current && !projectModeChanged.current) enterProject(root);
    }
    void restore().catch(() => {
      // The project folder command stays available when the last root is gone.
    });
    return () => { current = false; };
  }, [enterProject, store]);

  const finishCloseProject = useCallback(async (save: boolean) => {
    if (!loadProjectServices) return;
    const state = store.getState();
    if (closingProject || state.altStore.saveInProgress || documents.writing.size || batch.current) return;
    const closingBoards = projectBoardsToClose();
    const linkedDrawing = state.altStore.file.project;
    const unlinkedProjectDrawing = !linkedDrawing && state.altStore.file.folderId && schematicFileTabKey(state.altStore.file);
    const dirtyDrawing = (linkedDrawing || unlinkedProjectDrawing) && state.altStore.savedVersion !== state.docStore.present.drawingVersion;
    setClosingProject(true);
    setCloseProjectError('');
    try {
      if (save && documents.hasDirty()) {
        const summary = await documents.saveAll();
        if (summary.failed.length) {
          setFileSaveSummary(summary);
          return;
        }
      }
      if (linkedDrawing || unlinkedProjectDrawing || closingBoards.length || Object.keys(state.schematicTabs?.inactive ?? {}).length) {
        const { closeLinkedSchematic, saveProjectDrawing, closeProjectSchematicTab, saveInactiveSchematic } = await loadProjectServices();
        for (const { document: { session } } of closingBoards) {
          if (save && session.dirty) {
            await session.save();
            if (session.dirty) throw new Error(t('projects.pcbStillUnsaved'));
          }
        }
        if (save && dirtyDrawing) {
          if (linkedDrawing) await saveProjectDrawing(dispatch, store.getState);
          else await saveSchematicFile(dispatch, store.getState);
          const current = store.getState();
          if (current.altStore.savedVersion !== current.docStore.present.drawingVersion) {
            setConfirmCloseProject(false);
            return;
          }
        }
        for (const [key, tab] of Object.entries(state.schematicTabs?.inactive ?? {})) {
          if (save && schematicTabDirty(tab)) await saveInactiveSchematic(key, tab, dispatch, store.getState);
          await closeProjectSchematicTab(dispatch, store.getState, key, !save);
        }
        if (linkedDrawing) await closeLinkedSchematic(dispatch, store.getState, !save && dirtyDrawing);
        else if (unlinkedProjectDrawing)
          await closeProjectSchematicTab(dispatch, store.getState, unlinkedProjectDrawing, !save);
        removeBoards(closingBoards.map(({ id }) => id));
        if (!getBoards().activeId) setActiveWorkspace('circuit');
      }
      documents.clear();
      projectModeChanged.current = true;
      setGitCount(0);
      setGitReview(undefined);
      if (pendingProjectRoot.current) {
        const root = pendingProjectRoot.current;
        pendingProjectRoot.current = undefined;
        enterProject(root);
      } else {
        setProjectMode(false);
        setOpenedProjectRoot(undefined);
        setProjectTabRoot(undefined);
        setRestoreTabs(undefined);
        setGitRoot(undefined);
        setProjectPanel('projects');
        setSidePanelVisible(true);
      }
      setConfirmCloseProject(false);
    } catch (error) {
      setCloseProjectError(error instanceof Error ? error.message : String(error));
      setConfirmCloseProject(true);
    } finally {
      setClosingProject(false);
    }
  }, [closingProject, dispatch, documents, enterProject, getBoards, removeBoards, store, t]);

  function cancelProjectClose() {
    pendingProjectRoot.current = undefined;
    setConfirmCloseProject(false);
  }

  useEffect(() => {
    const requestClose = (nextRoot?: ProjectLocation) => {
      const state = store.getState();
      if (closingProject || restoreTabs || state.altStore.saveInProgress || documents.writing.size || batch.current) return;
      pendingProjectRoot.current = nextRoot;
      setCloseProjectError('');
      if (
        documents.hasDirty() || projectBoardsToClose().some(({ document }) => document.session.dirty) ||
        ((state.altStore.file.project || state.altStore.file.folderId) &&
          state.altStore.savedVersion !== state.docStore.present.drawingVersion) ||
        Object.values(state.schematicTabs?.inactive ?? {}).some(schematicTabDirty)
      ) setConfirmCloseProject(true);
      else void finishCloseProject(false);
    };
    const openProject = (event: CustomEvent<ProjectLocation>) => {
      projectModeChanged.current = true;
      const root = event.detail;
      if (projectMode && projectTabRoot) {
        if (root.id !== projectTabRoot.id) requestClose(root);
      } else enterProject(root);
    };
    const close = () => requestClose();
    window.addEventListener(projectFolderOpened, openProject);
    if (projectMode) window.addEventListener(closeProjectMode, close);
    return () => {
      window.removeEventListener(projectFolderOpened, openProject);
      window.removeEventListener(closeProjectMode, close);
    };
  }, [closingProject, documents, enterProject, finishCloseProject, getBoards, projectMode, projectTabRoot, restoreTabs, store]);

  useEffect(() => {
    if (props.standardLibraryNavigation || props.editLibrary) {
      setSidePanelVisible(true);
      setProjectPanel('libraries');
    }
  }, [props.standardLibraryNavigation, props.editLibrary]);

  const toggleSidePanel = useCallback(() => {
    setSidePanelVisible((prev) => !prev);
  }, []);

  const handleSidePanelResize = useCallback((delta: number) => {
    setSidePanelWidth((prev) => {
      const next = Math.max(
        MIN_SIDE_PANEL_WIDTH,
        Math.min(MAX_SIDE_PANEL_WIDTH, prev + delta),
      );
      saveSidePanelWidth(next);
      return next;
    });
  }, []);

  const handleBottomPanelResize = useCallback((delta: number) => {
    setBottomPanelHeight((prev) => Math.max(100, Math.min(500, prev - delta)));
  }, []);

  useEffect(() => {
    if (props.editSymbol) {
      setBottomPanelHeight(350);
    } else if (props.selectedSpiceControl) {
      setBottomPanelHeight(340);
    }
  }, [props.editSymbol, props.selectedSpiceControl]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      !props.creating ||
      props.dialogOpen
    ) {
      return;
    }
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]',
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.cancelCreation();
  };

  async function saveProjectFiles(showSummary: boolean) {
    if (!loadProjectServices || batch.current) return;
    batch.current = true;
    setSavingTabBatch(true);
    try {
      const summary = await documents.saveAll();
      async function saveNative(name: string, save: () => Promise<void>) {
        try {
          await save();
          summary.saved.push(name);
        } catch (error) {
          summary.failed.push({ name, message: error instanceof Error ? error.message : String(error) });
        }
      }
      for (const { document: { session } } of getBoards().tabs) {
        if (!session.dirty) continue;
        await saveNative(session.path, async () => {
          await session.save();
          if (session.dirty) throw new Error(t('projects.pcbStillUnsaved'));
        });
      }
      const state = store.getState();
      if (!state.docStore.present.editLibrary && state.altStore.savedVersion !== state.docStore.present.drawingVersion) {
        await saveNative(state.altStore.file.name, async () => {
          if (state.altStore.file.project) {
            const { saveProjectDrawing } = await loadProjectServices();
            await saveProjectDrawing(dispatch, store.getState, undefined, false);
          } else await saveSchematicFile(dispatch, store.getState);
          const current = store.getState();
          if (current.altStore.savedVersion !== current.docStore.present.drawingVersion)
            throw new Error('The schematic still has unsaved changes.');
        });
      }
      const inactive = Object.entries(store.getState().schematicTabs?.inactive ?? {})
        .filter(([, tab]) => schematicTabDirty(tab));
      if (inactive.length) {
        const { saveInactiveSchematic } = await loadProjectServices();
        for (const [key, tab] of inactive)
          await saveNative(tab.file.project?.documentPath ?? tab.file.name, () => saveInactiveSchematic(key, tab, dispatch, store.getState));
      }
      if (showSummary || summary.failed.length) setFileSaveSummary(summary);
      if (!showSummary && summary.failed.length) throw new Error('Some project files still have unsaved changes.');
    } finally {
      batch.current = false;
      setSavingTabBatch(false);
    }
  }

  const activeProjectFile = documents.files.find(({ id }) => id === documents.active);
  const fileTabs = React.useMemo(() => [
    ...schematicTabs.map(({ key, tab }) => ({
      id: 'schematic:' + key, name: tab.file.name, title: tab.file.project?.documentPath ?? tab.file.name,
      dirty: schematicTabDirty(tab),
      location: tab.file.project ? {
        kind: 'schematic', location: {
          id: tab.file.project.id, name: tab.file.project.name, rootId: tab.file.project.rootId,
          entryId: tab.file.project.entryId, folderId: tab.file.project.folderId,
        },
      } as ProjectTabLocation
        : typeof tab.file.id === 'string' && tab.file.folderId
          ? { kind: 'file', id: tab.file.id, folder: tab.file.folderId } as ProjectTabLocation : undefined,
    })),
    ...boards.tabs.map(({ id, document: { session, projectRootId, fileId, folderId, ancestorIds } }) => ({
      id: 'board:' + id, name: session.path, title: session.path, dirty: session.dirty,
      location: session.projectId && projectRootId
        ? { kind: 'board', rootId: projectRootId, boardId: session.board.boardId } as ProjectTabLocation
        : fileId && folderId ? {
          kind: 'file', id: fileId, folder: folderId, path: session.path, ancestors: ancestorIds,
        } as ProjectTabLocation : undefined,
    })),
    ...documents.files.map((file) => ({
      id: 'file:' + file.id, name: file.name, title: file.name, dirty: dirtyProjectDocument(file),
      location: { kind: 'file', id: file.id, folder: file.folder, ancestors: file.ancestors } as ProjectTabLocation,
    })),
  ], [schematicTabs, boards, documents.files]);
  const [fileTabOrder, setFileTabOrder] = useState<string[]>([]);
  useEffect(() => {
    setFileTabOrder((previous) => {
      const current = new Set(fileTabs.map(({ id }) => id));
      const retained = previous.filter((id) => current.delete(id));
      return current.size || retained.length !== previous.length ? [...retained, ...current] : previous;
    });
  }, [fileTabs]);
  const tabPositions = new Map(fileTabOrder.map((id, index) => [id, index]));
  const orderedFileTabs = [...fileTabs].sort((a, b) =>
    (tabPositions.get(a.id) ?? fileTabOrder.length) - (tabPositions.get(b.id) ?? fileTabOrder.length));
  const schematicDirty = schematicVersion !== schematicSavedVersion;
  if (!selectedSchematic && !props.editLibrary && (schematicDirty || !untrackedTabClosed)) {
    orderedFileTabs.unshift({ id: untrackedSchematicTab, name: currentFile.name,
      title: currentFile.name, dirty: schematicDirty, location: undefined });
  }
  const selectedFileTab = gitReview ? 'git' : documents.active ? 'file:' + documents.active
    : pcbActive && boards.activeId ? 'board:' + boards.activeId
    : selectedSchematic ? 'schematic:' + selectedSchematic : untrackedSchematicTab;
  useEffect(() => {
    if (!projectMode || !projectTabRoot || restoreTabs || closingProject) return;
    const tabs = orderedFileTabs.filter(({ location }) => location);
    const active = tabs.findIndex(({ id }) => id === selectedFileTab);
    writeProjectTabSession(projectTabRoot.id, projectTabRoot.account, {
      tabs: tabs.map(({ location }) => location),
      active: active < 0 ? undefined : active,
    });
  }, [projectMode, projectTabRoot, restoreTabs, closingProject, orderedFileTabs, selectedFileTab]);
  const pendingCloseBoard = boards.tabs.find(({ id }) => id === boardToClose);
  const pendingCloseFile = documents.files.find(({ id }) => id === fileToClose);

  async function finishBoardClose(save: boolean) {
    if (!pendingCloseBoard || closingBoard) return;
    setClosingBoard(true);
    setTabError('');
    try {
      const { id, document: { session } } = pendingCloseBoard;
      if (save) {
        await session.save();
        if (session.dirty) throw new Error(t('projects.pcbStillUnsaved'));
      }
      closeBoard(id);
      setBoardToClose(undefined);
    } catch (error) {
      setTabError(error instanceof Error ? error.message : String(error));
    } finally {
      setClosingBoard(false);
    }
  }

  async function closeSchematicFile(key: string, save: boolean, discard: boolean) {
    if (!loadProjectServices || batch.current || closingSchematic) return;
    setClosingSchematic(true);
    setTabError('');
    try {
      const { closeProjectSchematicTab, saveInactiveSchematic, saveProjectDrawing } = await loadProjectServices();
      const state = store.getState();
      const untracked = key === untrackedSchematicTab;
      const active = untracked || schematicFileTabKey(state.altStore.file) === key;
      let closeKey = untracked ? undefined : key;
      if (save) {
        if (active) {
          if (state.altStore.file.project) await saveProjectDrawing(dispatch, store.getState, undefined, false);
          else await saveSchematicFile(dispatch, store.getState);
          const current = store.getState();
          if (current.docStore.present.drawingVersion !== current.altStore.savedVersion)
            throw new Error('The schematic still has unsaved changes.');
          closeKey = schematicFileTabKey(current.altStore.file);
        } else {
          const inactive = state.schematicTabs.inactive[key];
          await saveInactiveSchematic(key, inactive, dispatch, store.getState);
          const saved = store.getState().schematicTabs.inactive;
          closeKey = Object.keys(saved).find((id) => saved[id].history === inactive.history);
        }
      }
      if (closeKey) await closeProjectSchematicTab(dispatch, store.getState, closeKey, discard);
      else if (untracked) {
        dispatch(actionSetDocument(blank(), 'tCad1.dsn', null, null));
        dispatch(ActionCreators.clearHistory());
      }
      if ((untracked || active) && !schematicFileTabKey(store.getState().altStore.file)) {
        setUntrackedTabClosed(true);
        if (selectedFileTab === (untracked ? untrackedSchematicTab : 'schematic:' + key)) {
          const index = orderedFileTabs.findIndex((tab) => tab.id === selectedFileTab);
          const next = orderedFileTabs[index + 1] ?? orderedFileTabs[index - 1];
          if (next) selectProjectTab(next.id);
        }
      }
      setSchematicToClose(undefined);
    } catch (error) {
      setTabError(error instanceof Error ? error.message : String(error));
    } finally {
      setClosingSchematic(false);
    }
  }

  function selectProjectTab(id: string) {
    setGitReview(undefined);
    setTabError('');
    if (id === untrackedSchematicTab) activateCircuit();
    else if (id.startsWith('schematic:') && !batch.current && !schematicSaving) {
      dispatch(activateSchematicTab(id.slice(10)) as any);
      activateCircuit();
    } else if (id.startsWith('board:')) activateBoard(id.slice(6));
    else if (id.startsWith('file:')) documents.select(id.slice(5));
  }

  function completeTabRestore(order: string[], active?: string) {
    setFileTabOrder(order);
    setUntrackedTabClosed(true);
    if (active) selectProjectTab(active);
    setRestoreTabs(undefined);
  }

  function requestTabClose(id: string, dirty: boolean) {
    if (savingTabBatch || schematicSaving) return;
    setTabError('');
    if (id.startsWith('board:')) requestBoardClose(id.slice(6));
    else if (id.startsWith('file:')) {
      const fileId = id.slice(5);
      if (documents.writing.has(fileId)) return;
      if (dirty) setFileToClose(fileId);
      else documents.close(fileId);
    } else {
      const key = id === untrackedSchematicTab ? id : id.slice(10);
      if (dirty) setSchematicToClose(key);
      else void closeSchematicFile(key, false, false);
    }
  }

  async function saveDocument(id: string) {
    setTabError('');
    try {
      await documents.save(id);
    } catch (error) {
      setTabError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  useEffect(() => {
    if (!projectMode) return;
    const saveAll = () => { void saveProjectFiles(true); };
    const saveActive = (event: Event) => {
      if (!activeProjectFile) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if ((event as CustomEvent<boolean>).detail) {
        setTabError('Use Save file to update this project file.');
        return;
      }
      if ((activeProjectFile.kind === 'text' || activeProjectFile.kind === 'settings') && !documents.writing.has(activeProjectFile.id))
        void saveDocument(activeProjectFile.id).catch(() => {});
    };
    const history = (event: Event) => {
      if (!activeProjectFile) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const focused = document.activeElement;
      const editor = focused instanceof HTMLInputElement && focused.closest('.project-metadata-fields')
        ? focused : document.querySelector<HTMLTextAreaElement>('.project-document-editor:not([hidden]) textarea:not([hidden])');
      if (editor) {
        editor.focus();
        document.execCommand((event as CustomEvent<'undo' | 'redo'>).detail);
      }
    };
    window.addEventListener(boardHistoryCommand, history, true);
    window.addEventListener(saveProjectTabs, saveAll);
    window.addEventListener(saveActiveBoard, saveActive, true);
    return () => {
      window.removeEventListener(boardHistoryCommand, history, true);
      window.removeEventListener(saveProjectTabs, saveAll);
      window.removeEventListener(saveActiveBoard, saveActive, true);
    };
  });

  async function refreshSourceControlFiles(repo: string) {
    if (!loadProjectServices) return;
    window.dispatchEvent(new Event(projectFilesChanged));
    const canonical = (filename: string) => filename.replaceAll(String.fromCharCode(92), '/');
    const contains = (root?: string) => !!root &&
      (canonical(root) === canonical(repo) || canonical(root).startsWith(canonical(repo).replace(/\/$/, '') + '/'));
    const state = store.getState();
    const linked = state.altStore.file.project;
    if (linked && contains(linked.rootId) && state.altStore.savedVersion === state.docStore.present.drawingVersion) {
      const { openProjectDrawing } = await loadProjectServices();
      await openProjectDrawing({ type: 'file-open-project', location: linked, refresh: true }, dispatch, store.getState);
    }
    const { refreshInactiveSchematics } = await loadProjectServices();
    const unavailable = await documents.refresh(contains);
    unavailable.push(...await refreshInactiveSchematics(dispatch, store.getState, (location) => contains(location.rootId)));
    for (const { id, document } of getBoards().tabs) {
      if (!contains(document.projectRootId)) continue;
      try {
        await refreshBoardTab(id, document);
      } catch {
        unavailable.push(document.session.path);
      }
    }
    if (unavailable.length) throw new Error('Could not reload project files: ' + unavailable.join(', '));
  }

  const splitVisible = sideBySide && canSplit && !gitReview && !activeProjectFile;
  const boardOnly = pcbActive && !splitVisible && !gitReview && !activeProjectFile;
  const boardToolbarAtTop = boardOnly && !!pcb;
  const panelsVisible = sidePanelVisible;
  const boardLibrary = pcbActive && !gitReview && !activeProjectFile && !!pcb;
  const libraryPanel = boardLibrary
    ? <div className="project-footprints" role="region" aria-label="Footprints" ref={setFootprintsHost} />
    : <SidePanelContainer />;
  function selectProjectPanel(panel: typeof projectPanel) {
    setSidePanelVisible(!(panelsVisible && projectPanel === panel));
    setProjectPanel(panel);
  }
  const openProjectDocument = async (file: Parameters<typeof documents.open>[0]) => {
    await documents.open(file);
    setUntrackedTabClosed(true);
    setGitReview(undefined);
    setTabError('');
  };
  useEffect(() => {
    if (!projectMode) return;
    const open = ({ detail }: WindowEventMap[typeof projectDocumentOpened]) => {
      void openProjectDocument({ ...detail, ancestors: [detail.folder] })
        .catch((error) => dispatch(actionSelectDialog('io_failure', { message: String(error) })));
    };
    window.addEventListener(projectDocumentOpened, open);
    return () => window.removeEventListener(projectDocumentOpened, open);
  }, [dispatch, documents, projectMode]);
  const ownHeader = !!activeProjectFile || (pcbActive && !!pcb);
  const activeName = activeProjectFile?.name || (pcbActive && pcb ? pcb.session.path : props.drawingName);
  const activeDirty = activeProjectFile ? dirtyProjectDocument(activeProjectFile)
    : pcbActive && pcb ? pcb.session.dirty : props.drawingDirty;
  useEffect(() => {
    const title = activeName ? `TinyCAD - ${activeName}${activeDirty ? '*' : ''}` : 'TinyCAD';
    document.title = title;
    if (process.env.TARGET_SYSTEM === 'electron') window.electronAPI.setTitle(title);
    else window.dispatchEvent(new CustomEvent(editorHeaderDocument, {
      detail: ownHeader ? { name: activeName, dirty: activeDirty } : undefined,
    }));
  }, [ownHeader, activeName, activeDirty]);
  function toggleSideBySide() {
    if (!sideBySide) {
      setSimulationSuppressed(true);
      dispatch({ type: 'simulation/panel', visible: false });
    }
    setSideBySide(!sideBySide);
  }
  const schematicToolbar = <ToolbarContainer
    simulationToolbarRef={setSimulationToolbarTarget}
    chatOpen={chatOpen}
    onToggleChat={process.env.TARGET_SYSTEM === 'electron' ? toggleChat : undefined}
    showSaveAll={projectMode && (!splitVisible || !pcbActive)}
    saveAllDisabled={savingTabBatch}
  />;
  const showPcbRightPanel = (pcbActive || splitVisible) && pcb && !gitReview && !activeProjectFile;
  const showCircuitRightPanel = !splitVisible && !pcbActive && !props.editSymbol &&
    (simulationActive || props.hasExampleExplanation);

  return (
    <div
      onKeyDown={handleKeyDown}
      className={boardToolbarAtTop ? "page-container pcb-window-toolbar" : "page-container"}
      style={{ top: process.env.TARGET_SYSTEM === 'electron' ? 0 : undefined }}
    >
      {simulationActive && <Suspense fallback={null}><SimulationFailureDialog /></Suspense>}
      {!pcbActive && !activeProjectFile && !splitVisible && schematicToolbar}
      {projectMode && (activeProjectFile || (gitReview && pcbActive)) && (
        <EditorToolbar label={t('toolbar.file')}>
          <EditorSaveButton label={t('projects.saveFile', { defaultValue: 'Save file' })}
            disabled={!activeProjectFile || !dirtyProjectDocument(activeProjectFile) || documents.writing.has(activeProjectFile.id) || savingTabBatch}
            onClick={() => { if (activeProjectFile) void saveDocument(activeProjectFile.id).catch(() => {}); }} />
          <EditorSaveAllButton disabled={savingTabBatch || schematicSaving} />
        </EditorToolbar>
      )}
      {footprintEditorOpen && (
        <Suspense fallback={null}>
          <FootprintEditorDialog onClose={() => setFootprintEditorOpen(false)} />
        </Suspense>
      )}
      {ProjectAutosave && (props.hasOpenProject || schematicTabs.some(({ tab }) => tab.file.project)) && (
        <Suspense fallback={null}><ProjectAutosave /></Suspense>
      )}
      {process.env.TARGET_SYSTEM === 'electron' && ChatPanel && (
        <Suspense fallback={null}>
          <ChatPanel open={chatOpen} onClose={closeChat} />
        </Suspense>
      )}
      {choosingProject && DriveProjectFolderDialog && (
        <Suspense fallback={null}>
          <DriveProjectFolderDialog account={store.getState().altStore.user?.id || ''}
            onClose={() => setChoosingProject(false)} />
        </Suspense>
      )}
      {confirmCloseProject && (
        <Dialog open onOpenChange={(_, data) => !data.open && !closingProject && cancelProjectClose()}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{t('projects.closeProject')}</DialogTitle>
              <DialogContent>
                <p>{t('projects.unsavedProject')}</p>
                {closeProjectError && <p role="alert">{closeProjectError}</p>}
              </DialogContent>
              <DialogActions>
                <Button appearance="primary" disabled={closingProject} onClick={(): void => { void finishCloseProject(true); }}>{t('projects.saveAndClose')}</Button>
                <Button disabled={closingProject} onClick={(): void => { void finishCloseProject(false); }}>{t('projects.discardAndClose')}</Button>
                <Button disabled={closingProject} onClick={cancelProjectClose}>{t('common.cancel')}</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {pendingCloseSchematic && (
        <Dialog open onOpenChange={(_, data) => !data.open && !closingSchematic && setSchematicToClose(undefined)}>
          <DialogSurface><DialogBody>
            <DialogTitle>Close {pendingCloseSchematic.name}</DialogTitle>
            <DialogContent>
              <p>Save your schematic changes before closing this tab?</p>
              {tabError && <p role="alert">{tabError}</p>}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={closingSchematic}
                onClick={() => { void closeSchematicFile(pendingCloseSchematic.key, true, false); }}>Save and close</Button>
              <Button disabled={closingSchematic}
                onClick={() => { void closeSchematicFile(pendingCloseSchematic.key, false, true); }}>Discard and close</Button>
              <Button disabled={closingSchematic} onClick={() => setSchematicToClose(undefined)}>Cancel</Button>
            </DialogActions>
          </DialogBody></DialogSurface>
        </Dialog>
      )}
      {pendingCloseBoard && (
        <Dialog open onOpenChange={(_, data) => !data.open && !closingBoard && setBoardToClose(undefined)}>
          <DialogSurface><DialogBody>
            <DialogTitle>Close {pendingCloseBoard.document.session.path}</DialogTitle>
            <DialogContent>
              <p>Save your PCB changes before closing this tab?</p>
              {tabError && <p role="alert">{tabError}</p>}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={closingBoard} onClick={() => { void finishBoardClose(true); }}>Save and close</Button>
              <Button disabled={closingBoard} onClick={() => { void finishBoardClose(false); }}>Discard and close</Button>
              <Button disabled={closingBoard} onClick={() => setBoardToClose(undefined)}>Cancel</Button>
            </DialogActions>
          </DialogBody></DialogSurface>
        </Dialog>
      )}
      {pendingCloseFile && (
        <Dialog open onOpenChange={(_, data) => !data.open && !documents.writing.has(pendingCloseFile.id) && setFileToClose(undefined)}>
          <DialogSurface><DialogBody>
            <DialogTitle>Close {pendingCloseFile.name}</DialogTitle>
            <DialogContent>
              <p>Save your changes before closing this file?</p>
              {tabError && <p role="alert">{tabError}</p>}
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" disabled={documents.writing.has(pendingCloseFile.id)} onClick={() => {
                void saveDocument(pendingCloseFile.id).then(() => {
                  documents.close(pendingCloseFile.id);
                  setFileToClose(undefined);
                }).catch(() => {});
              }}>Save and close</Button>
              <Button disabled={documents.writing.has(pendingCloseFile.id)} onClick={() => {
                documents.close(pendingCloseFile.id);
                setFileToClose(undefined);
              }}>Discard and close</Button>
              <Button disabled={documents.writing.has(pendingCloseFile.id)} onClick={() => setFileToClose(undefined)}>Cancel</Button>
            </DialogActions>
          </DialogBody></DialogSurface>
        </Dialog>
      )}
      {fileSaveSummary && (
        <Dialog open onOpenChange={(_, data) => !data.open && setFileSaveSummary(undefined)}>
          <DialogSurface><DialogBody>
            <DialogTitle>Save All</DialogTitle>
            <DialogContent>
              {!fileSaveSummary.saved.length && !fileSaveSummary.failed.length && <p>No modified project files.</p>}
              {!!fileSaveSummary.saved.length && <ul aria-label="Saved files">{fileSaveSummary.saved.map((name, index) => <li key={index}>{name}</li>)}</ul>}
              {!!fileSaveSummary.failed.length && <ul aria-label="Files still needing attention">
                {fileSaveSummary.failed.map(({ name, message }, index) => <li key={index}>{name} — {message}</li>)}
              </ul>}
            </DialogContent>
            <DialogActions><Button onClick={() => setFileSaveSummary(undefined)}>Close</Button></DialogActions>
          </DialogBody></DialogSurface>
        </Dialog>
      )}
      <div className="mid-container">
        {projectMode && (
          <div className="project-activity-bar" role="group" aria-label={t('projects.activityBar')}>
            <ToggleButton
              appearance="subtle" icon={<FolderRegular />} checked={panelsVisible && projectPanel === 'projects'}
              title={t('projects.title')} aria-label={t('projects.title')}
              onClick={() => selectProjectPanel('projects')}
            />
            <ToggleButton
              appearance="subtle" icon={<BookOpenRegular />}
              checked={panelsVisible && projectPanel === 'libraries'}
              title={t('projects.libraries')} aria-label={t('projects.libraries')} disabled={props.editLibrary}
              onClick={() => selectProjectPanel('libraries')}
            />
            {ProjectSourceControl && (
              <div className="git-activity-button">
                <ToggleButton appearance="subtle" icon={<BranchForkRegular />}
                  title={t('projects.sourceControl')} aria-label={t('projects.sourceControl')}
                  checked={panelsVisible && projectPanel === 'source'}
                  onClick={() => selectProjectPanel('source')} />
                {gitCount > 0 && <small aria-label={t('projects.pendingGit', { count: gitCount })}>{gitCount}</small>}
              </div>
            )}
          </div>
        )}
        <EditorSidePanel
          width={panelsVisible ? sidePanelWidth : undefined}
          collapsed={!panelsVisible}
          onToggle={toggleSidePanel}
          resizing={sidePanelResizing}
          onResize={panelsVisible ? handleSidePanelResize : undefined}
          onDragStateChange={setSidePanelResizing}
        >
          {projectMode && ProjectBrowser ? (
            <>
              <div className="left-panel-section" hidden={!panelsVisible || projectPanel !== 'projects'}>
                <Suspense fallback={null}><ProjectBrowser openedRoot={openedProjectRoot} onGitRoot={openGitRoot}
                  onDefaultRoot={useDefaultProjectRoot} restoreTabs={restoreTabs} onRestoreTabs={completeTabRestore}
                  activeFileId={activeProjectFile?.id ?? (pcbActive ? activeBoard?.document.fileId : typeof currentFile.id === 'string' ? currentFile.id : undefined)}
                  schematicActive={!activeProjectFile && !pcbActive}
                  onGitHistory={gitAvailable ? (filename) => {
                    setGitHistoryRequest({ filename });
                    setProjectPanel('source');
                    setSidePanelVisible(true);
                  } : undefined} onOpenBoard={openBoard} onRefreshBoard={refreshProjectBoard} onActivateCircuit={activateCircuit}
                  isProjectDocumentOpen={(id) => documents.isProtected(id) || schematicTabs.some(({ tab }) => tab.file.id === id) || boards.tabs.some(({ document }) => document.fileId === id || document.projectRootId === id || document.ancestorIds?.includes(id))} openedDocumentIds={[...documents.files.map(({ id }) => id), ...schematicTabs.flatMap(({ tab }) => typeof tab.file.id === 'string' ? [tab.file.id] : []), ...boards.tabs.flatMap(({ document }) => document.fileId ? [document.fileId] : [])]} onOpenProjectDocument={openProjectDocument} /></Suspense>
              </div>
              <div className="left-panel-section" hidden={!panelsVisible || projectPanel !== 'libraries'}>
                {libraryPanel}
              </div>
              {ProjectSourceControl && (gitRoot || projectPanel === 'source') && (
                <div className="left-panel-section" hidden={!panelsVisible || projectPanel !== 'source'}>
                  <Suspense fallback={null}>
                    <ProjectSourceControl key={gitRoot?.id ?? ''} root={gitRoot}
                      openFolder={() => window.dispatchEvent(new Event(chooseProjectFolder))}
                      setCount={setGitCount} setAvailable={setGitAvailable}
                      historyRequest={gitHistoryRequest} openReview={setGitReview}
                      boardDirty={() => getBoards().tabs.some(({ document }) => document.session.dirty)}
                      supportingFilesDirty={() => documents.hasDirty() || Object.values(store.getState().schematicTabs?.inactive ?? {}).some(schematicTabDirty)}
                      saveOpenFiles={() => saveProjectFiles(false)} refreshOpenFiles={refreshSourceControlFiles} />
                  </Suspense>
                </div>
              )}
            </>
          ) : libraryPanel}
        </EditorSidePanel>
        <div className="main-content-area">
          {projectMode && orderedFileTabs.length > 0 && (
            <div className="project-file-tabs">
              <TabList aria-label="Project files" aria-busy={!!restoreTabs} selectedValue={selectedFileTab}
                onTabSelect={(_, data) => selectProjectTab(String(data.value))}>
                {orderedFileTabs.map(({ id, name, title, dirty }) => {
                  const closeDisabled = !!restoreTabs || savingTabBatch || schematicSaving ||
                    (id.startsWith('file:') && documents.writing.has(id.slice(5)));
                  const closeLabel = t('projects.closeTab', { name: title, defaultValue: 'Close {{name}}' });
                  return <div className="project-file-tab" key={id} role="presentation">
                    <Tab value={id} title={title} icon={<ProjectFileIcon name={name} />} disabled={!!restoreTabs || savingTabBatch}
                      onKeyDown={(event) => {
                        if (event.key !== 'Delete' || closeDisabled) return;
                        event.preventDefault();
                        event.stopPropagation();
                        requestTabClose(id, dirty);
                      }}>
                      {name}{dirty ? ' *' : ''}
                    </Tab>
                    <Button appearance="subtle" size="small" icon={<DismissRegular />}
                      className="project-file-tab-close" tabIndex={-1} title={closeLabel}
                      aria-label={closeLabel} disabled={closeDisabled}
                      onClick={() => requestTabClose(id, dirty)} />
                  </div>;
                })}
              </TabList>
              {canSplit && !activeProjectFile && !gitReview &&
                <ToggleButton size="small" checked={splitVisible} onClick={toggleSideBySide}>
                  Side by side
                </ToggleButton>}
            </div>
          )}
          {(activeProjectFile || selectedSchematic) && tabError && !pendingCloseFile && !pendingCloseBoard && !pendingCloseSchematic && <p role="alert" className="project-tab-error">{tabError}</p>}
          {ProjectDocumentEditor && projectMode && (
            <Suspense fallback={<p role="status">Opening project file…</p>}>
              {documents.files.map((file) => (
                <ProjectDocumentEditor key={file.kind === 'pdf' || file.kind === 'image' ? file.id + ':' + file.version : file.id} file={file} active={documents.active === file.id && !gitReview}
                  onEdit={(value) => documents.edit(file.id, value)}
                  onSettingsChange={(key, value) => documents.editSettings(file.id, key, value)} />
              ))}
            </Suspense>
          )}
        {gitReview && projectMode && (
          <section className="main-content-area git-review" aria-label="Git review">
            <div className="git-review-tabs">
              <div role="tablist" aria-label="Git review tabs">
                <button type="button" role="tab" aria-selected="true" aria-controls="project-git-diff">
                  {gitReview.title}
                </button>
              </div>
              <Button appearance="subtle" icon={<DismissRegular />}
                title="Close Git review" aria-label="Close Git review" onClick={() => setGitReview(undefined)} />
            </div>
            <div id="project-git-diff" role="tabpanel" className="git-diff-body">
              {gitReview.hunks?.length ? gitReview.hunks.map((hunk, index) => (
                <div key={index}>
                  <Button size="small" onClick={() => gitReview.stageHunk(index)}>Stage hunk {index + 1}</Button>
                  <pre>{hunk}</pre>
                </div>
              )) : <pre>{gitReview.text}</pre>}
            </div>
          </section>
        )}
        <div className={'main-content-area' + (splitVisible ? ' project-design-split' : '')}
          hidden={projectMode && (!!(gitReview || activeProjectFile) ||
            untrackedTabClosed && !orderedFileTabs.length && !props.editLibrary)}>
          {(!pcbActive || splitVisible) && (
          <div className="project-design-pane" role={splitVisible ? 'group' : undefined}
            aria-label={splitVisible ? 'Schematic pane' : undefined}
            data-active-pane={(splitVisible && !pcbActive) || undefined}
            onFocusCapture={splitVisible ? () => setActiveWorkspace('circuit') : undefined}
            onPointerDownCapture={splitVisible ? () => setActiveWorkspace('circuit') : undefined}>
          {splitVisible && schematicToolbar}
          <EditorDrawingStack symbolEditor={!!props.editSymbol} bottomHeight={bottomPanelHeight}
            onBottomResize={handleBottomPanelResize} drawing={<>
            {props.selected_sheet >= 0 ? (
              props.simulationSheet ? (
                <Suspense fallback={null}>
                  <SimulationSheet toolbarTarget={simulationToolbarTarget} />
                </Suspense>
              ) : (
                <Suspense fallback={null}><SheetContainer /></Suspense>
              )
            ) : null}
            {props.selected_sheet === -1 ? <BomContainer /> : null}
            {props.selected_sheet < -1 ? (
              <Browser
                url={props.browserSheets[-2 - props.selected_sheet].url}
              />
            ) : null}
            {HierarchyPanel && <Suspense fallback={null}><HierarchyPanel /></Suspense>}
            <SheetbarContainer />
          </>}>
            <BottomPanelContainer />
          </EditorDrawingStack>
          </div>
          )}
          {(pcbActive || splitVisible) && !gitReview && !activeProjectFile && (
            <div className="project-design-pane" role={splitVisible ? 'group' : undefined}
              aria-label={splitVisible ? 'PCB pane' : undefined}
              data-active-pane={(splitVisible && pcbActive) || undefined}
              onFocusCapture={splitVisible ? () => setActiveWorkspace('pcb') : undefined}
              onPointerDownCapture={splitVisible ? () => setActiveWorkspace('pcb') : undefined}>
              <Suspense fallback={<div role="status">Loading PCB Design…</div>}>
                {pcb ? (
                  <BoardWorkspace key={activeBoard.id + ':' + activeBoard.mount} {...pcb}
                    rightPanelHost={pcbRightPanelHost}
                    footprintsHost={footprintsHost}
                    footprintsVisible={panelsVisible && (!projectMode || projectPanel === 'libraries')}
                    onShowFootprints={() => {
                      setProjectPanel('libraries');
                      setSidePanelVisible(true);
                    }}
                    bottomPanelHeight={bottomPanelHeight} onBottomPanelResize={handleBottomPanelResize}
                    onOpen={() => dispatch(fileOpen() as any)}
                    onProjectFolder={DriveProjectFolderDialog ? () => window.dispatchEvent(new Event(chooseProjectFolder)) : undefined}
                    saveAllDisabled={savingTabBatch || schematicSaving}
                    activeCommands={pcbActive} manageClose={projectMode} onClose={() => requestBoardClose(activeBoard.id)} />
                ) : <div role="status">Loading PCB Design…</div>}
              </Suspense>
            </div>
          )}
        </div>
        </div>
        {(showPcbRightPanel || showCircuitRightPanel) && (
          <div className={styles.rightPanels}>
            {showPcbRightPanel && <aside className="pcb-right-panel" aria-label="PCB panels" ref={setPcbRightPanelHost} />}
            {showCircuitRightPanel && simulationActive && (
              <Suspense fallback={null}>
                <ChartWorkspace />
                <InstrumentWindowHost />
              </Suspense>
            )}
            {showCircuitRightPanel && props.hasExampleExplanation && (
              <Suspense fallback={null}>
                <ExampleExplanationPanel />
              </Suspense>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
