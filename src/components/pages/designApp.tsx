import React, {
  FunctionComponent,
  useState,
  useCallback,
  useEffect,
  lazy,
  Suspense,
} from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import {
  makeStyles, Button, ToggleButton, Dialog, DialogSurface, DialogBody,
  DialogTitle, DialogContent, DialogActions, Tab, TabList,
} from '@fluentui/react-components';
import { useTranslation } from 'react-i18next';
import { BookOpenRegular, BranchForkRegular, DismissRegular, FolderOpenRegular, FolderRegular, PanelLeftExpandRegular } from '@fluentui/react-icons';
import ToolbarContainer from '../../state/containers/toolbarContainer';
import SidePanelContainer from '../../state/containers/sidePanelContainer';
import BomContainer from '../../state/containers/bomContainer';
import SheetbarContainer from '../../state/containers/sheetbarContainer';
import BottomPanelContainer from '../../state/containers/bottomPanelContainer';
import { EditorDrawingStack, EditorSidePanel } from '../panel/EditorLayout';
import { stopActiveSimulation } from '../../simulation/lifecycle';
import { actionSelectDialog, actionSheetSelect } from '../../state/dispatcher/AppDispatcher';
import { Browser } from '../sheets/browser';
import { tclibLibraryEntry } from '../../model/tclib';
import { isBoardFile } from '../../../shared/drawingFiles';
import { BrowserSheetData } from '../../model/dsnView';
import { boardOpened, circuitOpened, confirmBoardClose, saveActiveBoard, boardHistoryCommand, editorHeaderDocument } from '../../io/boardWorkspaceEvents';
import { projectFilesChanged, projectFolderOpened } from '../../io/projectStorage';
import { chooseProjectFolder, closeProjectMode, saveProjectTabs, startupMode } from '../../io/projectMode';
import type { docDrawing } from '../../state/undo/undo';
import type { ProjectLocation } from '../../io/projectStorage';
import { activateSchematicTab, enableSchematicTabs, openSchematicTabs, schematicTabDirty, schematicTabKey } from '../../state/schematicTabs';
import { useOpenBoards } from '../../io/useOpenBoards';
import { dirtyProjectDocument, useProjectDocuments } from '../../io/useProjectDocuments';
import { fileOpen, saveSchematicFile } from '../../io/files';
import type { SaveSummary } from '../../io/useProjectDocuments';
import type { GitReview } from '../projects/ProjectSourceControl';
import type { BoardWorkspaceDocument } from '../pcb/BoardWorkspace';
import type { StandardLibraryNavigation } from '../../state/actions/libraryActions';

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
  toggleButton: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: 1000,
    minWidth: '32px',
    padding: '6px',
  },
});

export interface DesignAppProps {
  hasExampleExplanation?: boolean;
  standardLibraryNavigation?: StandardLibraryNavigation;
  simulationPanelVisible?: boolean;
  simulationPanelActivated?: boolean;
  firstSchematicSheet: number;
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
    setActiveWorkspace('circuit');
  }, [documents.select]);
  const showCircuitDesign = () => {
    activateCircuit();
    setSimulationSuppressed(true);
    if (props.simulationSheet && props.firstSchematicSheet >= 0)
      dispatch(actionSheetSelect(props.firstSchematicSheet));
    dispatch({ type: 'simulation/panel', visible: false });
  };
  const showSimulation = () => {
    setSideBySide(false);
    activateCircuit();
    setSimulationSuppressed(false);
    dispatch({ type: 'simulation/panel', visible: true });
  };
  useEffect(() => {
    if (props.simulationPanelVisible) setSimulationSuppressed(false);
  }, [props.simulationPanelVisible]);
  useEffect(() => {
    if (!simulationActive) stopActiveSimulation();
  }, [simulationActive]);
  const activateBoard = useCallback((id: string) => {
    selectBoard(id);
    documents.select();
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
      if (session.savedVersion === document.session.savedVersion)
        replaceBoard(existing.id, { ...document, session });
      else if (!session.dirty)
        replaceBoard(existing.id, document);
      else if (document.probe)
        replaceBoard(existing.id, { ...existing.document, probe: document.probe });
      activateBoard(existing.id);
      return;
    }
    if (!projectMode && current?.document.session.dirty &&
      !window.confirm('Discard unsaved edits to the current PCB?')) return;
    activateBoard(addBoard(document, !projectMode));
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
    const open = (event: CustomEvent<BoardWorkspaceDocument['session']>) =>
      openBoard({ session: event.detail });
    window.addEventListener(boardOpened, open);
    window.addEventListener(circuitOpened, activateCircuit);
    return () => {
      window.removeEventListener(boardOpened, open);
      window.removeEventListener(circuitOpened, activateCircuit);
    };
  }, [openBoard, activateCircuit]);
  const createBoard = () => {
    void import('../../io/boardWorkspace').then(({ newStandaloneBoard }) =>
      openBoard({ session: newStandaloneBoard() }),
    ).catch((error) => dispatch(actionSelectDialog('io_failure', { message: String(error) })));
  };
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
      void import('../../io/boardWorkspace').then(({ newStandaloneBoard }) =>
        openBoard({ session: newStandaloneBoard() }),
      ).catch((error) => dispatch(actionSelectDialog('io_failure', { message: String(error) })));
    }
  }, [dispatch, openBoard]);
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
  const currentSchematic = useSelector((state: docDrawing) => state.altStore.file.project);
  const schematicVersion = useSelector((state: docDrawing) => state.docStore.present.drawingVersion);
  const schematicSavedVersion = useSelector((state: docDrawing) => state.altStore.savedVersion);
  const schematicTabs = React.useMemo(() => openSchematicTabs(store.getState()),
    [schematicRegistry, currentSchematic, schematicVersion, schematicSavedVersion, store]);
  const selectedSchematic = schematicTabKey(currentSchematic);
  const canSplit = projectMode && !!selectedSchematic && !!pcb?.projectRootId &&
    currentSchematic.rootId === pcb.projectRootId &&
    props.selected_sheet >= 0 && !props.simulationSheet && !props.editLibrary && !props.editSymbol;
  useEffect(() => {
    if (!canSplit) setSideBySide(false);
  }, [canSplit]);
  const [schematicToClose, setSchematicToClose] = useState<string>();
  const [closingSchematic, setClosingSchematic] = useState(false);
  const pendingCloseSchematic = schematicTabs.find(({ key }) => key === schematicToClose);
  useEffect(() => {
    dispatch(enableSchematicTabs(projectMode) as any);
  }, [dispatch, projectMode]);

  const restoreProjectAtStartup = React.useRef(projectMode);
  const projectModeChanged = React.useRef(false);
  const [showSourceControl, setShowSourceControl] = useState(false);
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
  const [showProjects, setShowProjects] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);
  const [confirmCloseProject, setConfirmCloseProject] = useState(false);
  const [closingProject, setClosingProject] = useState(false);
  const [closeProjectError, setCloseProjectError] = useState('');
  const [openedProjectRoot, setOpenedProjectRoot] = useState<ProjectLocation>();
  const [showLibraries, setShowLibraries] = useState(true);
  const [showFootprints, setShowFootprints] = useState(true);
  const [sidePanelWidth, setSidePanelWidth] = useState(loadSidePanelWidth);
  const [sidePanelResizing, setSidePanelResizing] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  const [simulationToolbarTarget, setSimulationToolbarTarget] =
    useState<HTMLSpanElement>(null);

  const enterProject = useCallback((root: ProjectLocation) => {
    setSideBySide(false);
    setOpenedProjectRoot(root);
    setGitRoot(root);
    setGitReview(undefined);
    setProjectMode(true);
    setShowProjects(true);
    setSidePanelVisible(true);
  }, []);

  useEffect(() => {
    if (!ProjectBrowser) return;
    const openProject = (event: CustomEvent<ProjectLocation>) => {
      projectModeChanged.current = true;
      if (process.env.TARGET_SYSTEM === 'google') {
        try {
          const user = store.getState().altStore.user?.id || '';
          localStorage.setItem(`tinycad.driveProjectFolder.${user}`, JSON.stringify(event.detail));
        } catch {
          // The current folder remains available for this session.
        }
      }
      enterProject(event.detail);
    };
    const browse = () => setChoosingProject(true);
    window.addEventListener(projectFolderOpened, openProject);
    if (DriveProjectFolderDialog) window.addEventListener(chooseProjectFolder, browse);
    return () => {
      window.removeEventListener(projectFolderOpened, openProject);
      window.removeEventListener(chooseProjectFolder, browse);
    };
  }, [enterProject, store]);

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
        const saved = JSON.parse(localStorage.getItem(`tinycad.driveProjectFolder.${user}`));
        if (typeof saved?.id === 'string' && typeof saved.name === 'string') {
          await projectRequest({ operation: 'list', folder: saved.id });
          root = saved;
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
    const dirtyDrawing = linkedDrawing && state.altStore.savedVersion !== state.docStore.present.drawingVersion;
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
      if (linkedDrawing || closingBoards.length || Object.keys(state.schematicTabs?.inactive ?? {}).length) {
        const { closeLinkedSchematic, saveProjectDrawing, closeProjectSchematicTab, saveInactiveSchematic } = await loadProjectServices();
        for (const { document: { session } } of closingBoards) {
          if (save && session.dirty) {
            await session.save();
            if (session.dirty) throw new Error(t('projects.pcbStillUnsaved'));
          }
        }
        if (save && dirtyDrawing) {
          await saveProjectDrawing(dispatch, store.getState);
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
        removeBoards(closingBoards.map(({ id }) => id));
        if (!getBoards().activeId) setActiveWorkspace('circuit');
      }
      documents.clear();
      projectModeChanged.current = true;
      setProjectMode(false);
      setOpenedProjectRoot(undefined);
      setGitRoot(undefined);
      setGitCount(0);
      setGitReview(undefined);
      setShowSourceControl(false);
      setShowProjects(false);
      setShowLibraries(true);
      setSidePanelVisible(true);
      setConfirmCloseProject(false);
    } catch (error) {
      setCloseProjectError(error instanceof Error ? error.message : String(error));
      setConfirmCloseProject(true);
    } finally {
      setClosingProject(false);
    }
  }, [closingProject, dispatch, documents, getBoards, removeBoards, store, t]);

  useEffect(() => {
    if (!projectMode) return;
    const requestClose = () => {
      const state = store.getState();
      if (closingProject || state.altStore.saveInProgress || documents.writing.size || batch.current) return;
      setCloseProjectError('');
      if (
        documents.hasDirty() || projectBoardsToClose().some(({ document }) => document.session.dirty) ||
        (state.altStore.file.project && state.altStore.savedVersion !== state.docStore.present.drawingVersion) ||
        Object.values(state.schematicTabs?.inactive ?? {}).some(schematicTabDirty)
      ) setConfirmCloseProject(true);
      else void finishCloseProject(false);
    };
    window.addEventListener(closeProjectMode, requestClose);
    return () => window.removeEventListener(closeProjectMode, requestClose);
  }, [closingProject, documents, finishCloseProject, getBoards, projectMode, store]);

  useEffect(() => {
    if (props.standardLibraryNavigation || props.editLibrary) {
      setSidePanelVisible(true);
      setShowLibraries(true);
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
          await saveNative(tab.file.project.documentPath, () => saveInactiveSchematic(key, tab, dispatch, store.getState));
      }
      if (showSummary || summary.failed.length) setFileSaveSummary(summary);
      if (!showSummary && summary.failed.length) throw new Error('Some project files still have unsaved changes.');
    } finally {
      batch.current = false;
      setSavingTabBatch(false);
    }
  }

  const activeProjectFile = documents.files.find(({ id }) => id === documents.active);
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
      const { closeProjectSchematicTab, saveProjectDrawing } = await loadProjectServices();
      if (save) {
        await saveProjectDrawing(dispatch, store.getState, undefined, false);
        const current = store.getState();
        if (current.docStore.present.drawingVersion !== current.altStore.savedVersion)
          throw new Error('The schematic still has unsaved changes.');
      }
      await closeProjectSchematicTab(dispatch, store.getState, key, discard);
      setSchematicToClose(undefined);
    } catch (error) {
      setTabError(error instanceof Error ? error.message : String(error));
    } finally {
      setClosingSchematic(false);
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
  const panelsVisible = sidePanelVisible && (projectMode
    ? showProjects || (showLibraries && !boardOnly) || showSourceControl
    : !boardOnly);
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
  />;

  return (
    <div
      onKeyDown={handleKeyDown}
      className={boardToolbarAtTop ? "page-container pcb-window-toolbar" : "page-container"}
      style={{ top: process.env.TARGET_SYSTEM === 'electron' ? 0 : undefined }}
    >
      {simulationActive && <Suspense fallback={null}><SimulationFailureDialog /></Suspense>}
      {!pcbActive && !activeProjectFile && !splitVisible && schematicToolbar}
      {!props.editLibrary && <div className="workspace-switcher" role="group" aria-label="Design workspaces">
        <ToggleButton size="small" checked={!pcbActive && !simulationActive} onClick={showCircuitDesign}>Circuit Design</ToggleButton>
        <ToggleButton size="small" checked={pcbActive} onClick={activeBoard ? () => activateBoard(activeBoard.id) : createBoard}>PCB Design</ToggleButton>
        <ToggleButton size="small" checked={!!simulationActive} onClick={showSimulation}>Circuit Design + Simulation</ToggleButton>
        {pcbActive && DriveProjectFolderDialog && !projectMode && (
          <Button size="small" icon={<FolderOpenRegular />}
            onClick={() => window.dispatchEvent(new Event(chooseProjectFolder))}>
            {t('projects.openFolder')}
          </Button>
        )}
      </div>}
      {ProjectAutosave && (props.hasOpenProject || schematicTabs.length > 0) && (
        <Suspense fallback={null}><ProjectAutosave /></Suspense>
      )}
      {process.env.TARGET_SYSTEM === 'electron' && ChatPanel && (
        <Suspense fallback={null}>
          <ChatPanel open={chatOpen} onClose={closeChat} />
        </Suspense>
      )}
      {choosingProject && DriveProjectFolderDialog && (
        <Suspense fallback={null}><DriveProjectFolderDialog onClose={() => setChoosingProject(false)} /></Suspense>
      )}
      {confirmCloseProject && (
        <Dialog open onOpenChange={(_, data) => !data.open && !closingProject && setConfirmCloseProject(false)}>
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
                <Button disabled={closingProject} onClick={() => setConfirmCloseProject(false)}>{t('common.cancel')}</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {pendingCloseSchematic && (
        <Dialog open onOpenChange={(_, data) => !data.open && !closingSchematic && setSchematicToClose(undefined)}>
          <DialogSurface><DialogBody>
            <DialogTitle>Close {pendingCloseSchematic.tab.file.project.documentPath}</DialogTitle>
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
              appearance="subtle" icon={<FolderRegular />} checked={panelsVisible && showProjects && !showSourceControl}
              title={t('projects.title')} aria-label={t('projects.title')}
              onClick={() => {
                setShowProjects(panelsVisible && !showSourceControl ? !showProjects : true);
                setShowSourceControl(false);
                setSidePanelVisible(true);
              }}
            />
            <ToggleButton
              appearance="subtle" icon={<BookOpenRegular />}
              checked={boardOnly ? showFootprints : panelsVisible && showLibraries && !showSourceControl}
              title={t('projects.libraries')} aria-label={t('projects.libraries')} disabled={props.editLibrary}
              onClick={() => {
                if (boardOnly) {
                  setShowFootprints(!showFootprints);
                  return;
                }
                setShowLibraries(panelsVisible && !showSourceControl ? !showLibraries : true);
                setShowSourceControl(false);
                setSidePanelVisible(true);
              }}
            />
            {ProjectSourceControl && (
              <div className="git-activity-button">
                <ToggleButton appearance="subtle" icon={<BranchForkRegular />}
                  title={t('projects.sourceControl')} aria-label={t('projects.sourceControl')}
                  checked={panelsVisible && showSourceControl}
                  onClick={() => {
                    setShowSourceControl(!showSourceControl);
                    setSidePanelVisible(true);
                  }} />
                {gitCount > 0 && <small aria-label={t('projects.pendingGit', { count: gitCount })}>{gitCount}</small>}
              </div>
            )}
            <Button appearance="subtle" icon={<FolderOpenRegular />} title={t('projects.openFolder')}
              aria-label={t('projects.openFolder')} onClick={() => window.dispatchEvent(new Event(chooseProjectFolder))} />
            <Button appearance="subtle" icon={<DismissRegular />} title={t('projects.closeProject')}
              aria-label={t('projects.closeProject')} onClick={() => window.dispatchEvent(new Event(closeProjectMode))} />
          </div>
        )}
        <EditorSidePanel
          width={panelsVisible ? sidePanelWidth : undefined}
          collapsed={!panelsVisible}
          resizing={sidePanelResizing}
          onResize={panelsVisible ? handleSidePanelResize : undefined}
          onDragStateChange={setSidePanelResizing}
          hidden={!panelsVisible && (projectMode || boardOnly)}
        >
          {!panelsVisible && !projectMode && (
            <Button
              className={styles.toggleButton}
              appearance="subtle"
              icon={<PanelLeftExpandRegular />}
              onClick={toggleSidePanel}
              title={t('designApp.showSidePanel')}
            />
          )}
          {projectMode && ProjectBrowser ? (
            <>
              {showProjects && <div className="left-panel-section" hidden={!panelsVisible || showSourceControl}>
                <Suspense fallback={null}><ProjectBrowser openedRoot={openedProjectRoot} onGitRoot={openGitRoot}
                  onGitHistory={gitAvailable ? (filename) => {
                    setGitHistoryRequest({ filename });
                    setShowSourceControl(true);
                    setSidePanelVisible(true);
                  } : undefined} onOpenBoard={openBoard} onRefreshBoard={refreshProjectBoard} onActivateCircuit={activateCircuit}
                  isProjectDocumentOpen={(id) => documents.isProtected(id) || boards.tabs.some(({ document }) => document.fileId === id || document.projectRootId === id || document.ancestorIds?.includes(id))} openedDocumentIds={[...documents.files.map(({ id }) => id), ...boards.tabs.flatMap(({ document }) => document.fileId ? [document.fileId] : [])]} onOpenProjectDocument={async (file) => {
                    await documents.open(file);
                    setGitReview(undefined);
                    setTabError('');
                  }} /></Suspense>
              </div>}
              {!boardOnly && showLibraries && <div className="left-panel-section" hidden={!panelsVisible || showSourceControl}>
                <SidePanelContainer toggleSidePanel={toggleSidePanel} />
              </div>}
              {ProjectSourceControl && (gitRoot || showSourceControl) && (
                <div className="left-panel-section" hidden={!panelsVisible || !showSourceControl}>
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
          ) : <SidePanelContainer toggleSidePanel={toggleSidePanel} />}
        </EditorSidePanel>
        <div className="main-content-area">
          {projectMode && (documents.files.length > 0 || props.hasOpenProject || boards.tabs.length > 0) && (
            <div className="project-file-tabs">
              <TabList aria-label="Project files" selectedValue={gitReview ? 'git' : documents.active ? 'file:' + documents.active : pcbActive && boards.activeId ? 'board:' + boards.activeId : selectedSchematic ? 'schematic:' + selectedSchematic : 'design'}
                onTabSelect={(_, data) => {
                  setGitReview(undefined);
                  setTabError('');
                  const value = String(data.value);
                  if (value === 'design') activateCircuit();
                  else if (value.startsWith('schematic:') && !batch.current) {
                    dispatch(activateSchematicTab(value.slice(10)) as any);
                    activateCircuit();
                  }
                  else if (value.startsWith('board:')) activateBoard(value.slice(6));
                  else if (value.startsWith('file:')) documents.select(value.slice(5));
                }}>
                {!selectedSchematic && <Tab value="design">Design</Tab>}
                {schematicTabs.map(({ key, tab }) => (
                  <Tab key={key} value={'schematic:' + key} title={tab.file.project.documentPath} disabled={savingTabBatch}>
                    {tab.file.project.documentPath}{schematicTabDirty(tab) ? ' *' : ''}
                  </Tab>
                ))}
                {boards.tabs.map(({ id, document: { session } }) => (
                  <Tab key={id} value={'board:' + id} title={session.path}>
                    {session.path}{session.dirty ? ' *' : ''}
                  </Tab>
                ))}
                {documents.files.map((file) => (
                  <Tab key={file.id} value={'file:' + file.id}>
                    {file.name}{dirtyProjectDocument(file) ? ' *' : ''}
                  </Tab>
                ))}
              </TabList>
              {activeProjectFile && (
                <div className="project-preview-actions">
                  {(activeProjectFile.kind === 'text' || activeProjectFile.kind === 'settings') && <Button size="small"
                    disabled={!dirtyProjectDocument(activeProjectFile) || documents.writing.has(activeProjectFile.id) || savingTabBatch}
                    onClick={() => { void saveDocument(activeProjectFile.id).catch(() => {}); }}>Save file</Button>}
                  <Button size="small" disabled={savingTabBatch || documents.writing.has(activeProjectFile.id)}
                    onClick={() => {
                      setTabError('');
                      if (dirtyProjectDocument(activeProjectFile)) setFileToClose(activeProjectFile.id);
                      else documents.close(activeProjectFile.id);
                    }}>Close file</Button>
                </div>
              )}
              {!activeProjectFile && !pcbActive && selectedSchematic && !gitReview &&
                <Button size="small" disabled={savingTabBatch} onClick={() => {
                  setTabError('');
                  if (schematicVersion !== schematicSavedVersion) setSchematicToClose(selectedSchematic);
                  else void closeSchematicFile(selectedSchematic, false, false);
                }}>Close schematic tab</Button>}
              {!activeProjectFile && pcbActive && activeBoard && !gitReview &&
                <Button size="small" disabled={savingTabBatch} onClick={() => requestBoardClose(activeBoard.id)}>Close PCB tab</Button>}
              {canSplit && !activeProjectFile && !gitReview &&
                <ToggleButton size="small" checked={splitVisible} onClick={toggleSideBySide}>
                  Side by side
                </ToggleButton>}
              <Button size="small" disabled={savingTabBatch} onClick={() => { void saveProjectFiles(true); }}>Save All</Button>
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
          hidden={projectMode && !!(gitReview || activeProjectFile)}>
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
                    footprintsVisible={showFootprints} onToggleFootprints={setShowFootprints}
                    bottomPanelHeight={bottomPanelHeight} onBottomPanelResize={handleBottomPanelResize}
                    onOpen={() => dispatch(fileOpen() as any)}
                    onNew={createBoard}
                    onProjectFolder={DriveProjectFolderDialog ? () => window.dispatchEvent(new Event(chooseProjectFolder)) : undefined}
                    activeCommands={pcbActive} manageClose={projectMode} onClose={() => requestBoardClose(activeBoard.id)} />
                ) : <div role="status">Loading PCB Design…</div>}
              </Suspense>
            </div>
          )}
        </div>
        </div>
        {!splitVisible && !pcbActive && !props.editSymbol && (simulationActive || props.hasExampleExplanation) && (
          <div className={styles.rightPanels}>
            {simulationActive && (
              <Suspense fallback={null}>
                <ChartWorkspace />
                <InstrumentWindowHost />
              </Suspense>
            )}
            {props.hasExampleExplanation && (
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
