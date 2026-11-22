import { isBoardFile } from '../../../shared/drawingFiles';
import { projectDocumentKind } from '../../io/projectDocumentKind';
import type { ProjectDocumentLocation } from '../../io/useProjectDocuments';
import {
  droppedProjectFiles,
  pickedProjectFiles,
} from '../../io/projectImport';
import type { ImportSource } from '../../io/projectImport';
import type { ProjectImportJob } from './ProjectFileImportDialog';
import type { BoardWorkspaceDocument } from '../pcb/BoardWorkspace';
import type { projectCircuitStatus } from '../../io/projectCircuitStatus';
import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowUpRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DocumentRegular,
  FolderOpenRegular,
  FolderRegular,
  MoreHorizontalRegular,
} from '@fluentui/react-icons';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { saveAs } from 'file-saver';
import {
  isProjectFile,
  projectFileTitle,
  MAX_PROJECT_FILE_BYTES,
} from '../../../shared/projectFiles';
import { fileOpenProject } from '../../io/files';
import {
  addProjectSchematic,
  chooseDesktopProjectFolder,
  createProjectFile,
  duplicateProject,
  projectFilesChanged,
  projectRequest,
  projectRootChanged,
  readProject,
  readProjectBoard,
  refreshInactiveSchematics,
  savedProjectRevision,
  saveProjectDrawing,
} from '../../io/projects';
import { projectFileName } from '../../io/projectStorage';
import type { ProjectItem, ProjectLocation } from '../../io/projectStorage';
import type { ProjectTrashPreview } from '../../io/projectTrash';
import { linkedSchematicSnapshot, openSchematicTabs, schematicTabDirty } from '../../state/schematicTabs';
import type { docDrawing } from '../../state/undo/undo';
import { ProjectNameDialog } from './ProjectNameDialog';
import { ProjectRevisionDialog } from './ProjectRevisionDialog';
import type { ProjectRevisionComparison } from './ProjectRevisionDialog';
import { compareProjectRevisions } from '../../pcb/projectRevisions';
import type { RevisionInventory } from '../../pcb/projectRevisions';
import type {
  ProjectCircuitEco,
  ProjectCircuitUndo,
} from '../../io/projectCircuitEco';
import type {
  BoardPlacementGroup,
  BoardProbeMatch,
  BoardWorkspaceProbe,
} from '../../io/projectPcbProbe';
import type { CircuitSchematicSource } from '../../pcb/circuitSnapshot';
import type { ProjectReferenceUndo } from '../../io/projectReferenceEco';
import type { ReferenceDialogState } from './ProjectReferenceDialog';
import type { ProjectDeviceReview } from '../../io/projectDevices';

type LoadedProject = Awaited<ReturnType<typeof readProject>>;

interface ProjectContext {
  marker: ProjectItem;
  root: ProjectLocation;
  parent: ProjectLocation;
  project: LoadedProject;
}

import { childInterface, hierarchyDefinition } from '../../io/hierarchyDrawing';
import { linkedBoardSource, readProjectSchematic } from '../../io/projectHierarchy';
import type { boardPadSources } from '../../pcb/hierarchicalSnapshot';
import type { reviewProjectCircuit } from '../../io/netlists/activeNetlist';
import { DocActionTypes } from '../../state/actions/docActions';
import { DocItemTypes } from '../../model/dsnItem';
import { activeSheet } from '../../state/stores/docStoreReducer';

const ProjectCircuitDialog = React.lazy(() => import('./ProjectCircuitDialog'));
const ProjectReferenceDialog = React.lazy(
  () => import('./ProjectReferenceDialog'),
);
const ProjectPcbProbeDialog = React.lazy(
  () => import('./ProjectPcbProbeDialog'),
);
const FootprintEditorDialog = React.lazy(
  () => import('./FootprintEditorDialog'),
);
const ProjectDeviceDialog = React.lazy(() => import('./ProjectDeviceDialog'));

const ProjectFileImportDialog = React.lazy(
  () => import('./ProjectFileImportDialog'),
);
const ProjectOutputsDialog = React.lazy(() => import('./ProjectOutputsDialog'));

function selectedSchematicUnits(present: docDrawing['docStore']['present']) {
  const selection = present.view._selected_array;
  if (!selection.length) return [];
  const items = new Map(
    activeSheet(present)?.items.map((item) => [item._id, item]),
  );
  return selection.flatMap((id) => {
    const item = items.get(id);
    return item?.NodeName === DocItemTypes.Symbol &&
      !item.hierarchy &&
      item.unitId
      ? [item.unitId]
      : [];
  });
}

interface FolderListing {
  items: ProjectItem[];
  refresh: number;
  tree: boolean;
  error?: string;
}

interface ProjectTreeRow {
  item: ProjectItem;
  parentTrail: ProjectLocation[];
  depth: number;
}

interface NamePrompt {
  title: string;
  name?: string;
  submit: (name: string) => Promise<void>;
}

export default function ProjectBrowser({
  openedRoot,
  onGitRoot,
  onGitHistory,
  onOpenBoard,
  onRefreshBoard,
  onOpenProjectDocument,
  isProjectDocumentOpen,
  openedDocumentIds,
  onActivateCircuit,
}: {
  openedRoot?: ProjectLocation;
  onGitRoot?(root?: ProjectLocation): void;
  onGitHistory?(filename: string): void;
  onOpenBoard(document: BoardWorkspaceDocument): void;
  onRefreshBoard(fileId: string): Promise<void>;
  onOpenProjectDocument(file: ProjectDocumentLocation): Promise<void>;
  isProjectDocumentOpen(id: string): boolean;
  openedDocumentIds: readonly string[];
  onActivateCircuit(): void;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const store = useStore<docDrawing>();
  const userId = useSelector((state: docDrawing) => state.altStore.user?.id);
  const activeProject = useSelector(
    (state: docDrawing) => state.altStore.file.project,
  );
  const saving = useSelector(
    (state: docDrawing) => state.altStore.saveInProgress,
  );
  const editingLibrary = useSelector(
    (state: docDrawing) => !!state.docStore.present.editLibrary,
  );
  const [outputProject, setOutputProject] = useState<ProjectContext & { boardId?: string }>();
  const [trail, setTrail] = useState<ProjectLocation[]>([]);
  const [listings, setListings] = useState(new Map<string, FolderListing>());
  const [expanded, setExpanded] = useState(new Set<string>());
  const [chosenRoot, setChosenRoot] = useState<ProjectLocation>();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ProjectItem>();
  const [context, setContext] = useState<ProjectContext>();
  const [rootRefresh, setRootRefresh] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const drawingVersion = useSelector((state: docDrawing) =>
    state.altStore.file.project
      ? state.docStore.present.drawingVersion
      : undefined,
  );
  const [sync, setSync] = useState<
    ReadonlyMap<string, Awaited<ReturnType<typeof projectCircuitStatus>>>
  >(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<NamePrompt>();
  const [trash, setTrash] = useState<{ item: ProjectItem; preview?: ProjectTrashPreview }>();
  const [cut, setCut] = useState<{ item: ProjectItem; parentTrail: ProjectLocation[]; project?: string }>();
  const [revisionBase, setRevisionBase] = useState<{
    name: string;
    inventory: RevisionInventory;
  }>();
  const importSchematic = useRef<HTMLInputElement>(null);
  const addFilesInput = useRef<HTMLInputElement>(null);
  const [fileImport, setFileImport] = useState<ProjectImportJob>();
  const [dropTarget, setDropTarget] = useState<string>();
  const consumedOpenedRoot = useRef<ProjectLocation>();
  const [comparison, setComparison] = useState<ProjectRevisionComparison>();
  const [footprintEditor, setFootprintEditor] = useState(false);
  const [pcbProbe, setPcbProbe] = useState<BoardProbeMatch[]>();
  const [placementGroups, setPlacementGroups] =
    useState<BoardPlacementGroup[]>();
  const selectedUnit = useSelector((state: docDrawing) => {
    const present = state.docStore.present;
    return present.view._selected_array.length === 1
      ? selectedSchematicUnits(present)[0]
      : undefined;
  });
  const hasSchematicGroup = useSelector(
    (state: docDrawing) =>
      selectedSchematicUnits(state.docStore.present).length > 1,
  );
  const [boardProbe, setBoardProbe] = useState<{
    name: string;
    targets: ReturnType<typeof boardPadSources>;
    open: (target: ReturnType<typeof boardPadSources>[number]) => Promise<void>;
    review: () => ReturnType<typeof reviewProjectCircuit>;
  }>();
  const [referenceDialog, setReferenceDialog] =
    useState<ReferenceDialogState>();
  const [referenceUndo, setReferenceUndo] = useState<ProjectReferenceUndo>();
  const [confirmReferenceUndo, setConfirmReferenceUndo] = useState(false);
  const [circuitUndo, setCircuitUndo] = useState<ProjectCircuitUndo>();
  const [confirmCircuitUndo, setConfirmCircuitUndo] = useState(false);
  const [circuitEco, setCircuitEco] = useState<ProjectCircuitEco>();
  const [deviceReview, setDeviceReview] = useState<ProjectDeviceReview>();
  const [boardReview, setBoardReview] =
    useState<Awaited<ReturnType<typeof reviewProjectCircuit>>['review']>();
  const drive = process.env.TARGET_SYSTEM === 'google';
  const storageKey = `tinycad.driveProjectFolder.${userId || ''}`;
  const folder = trail[trail.length - 1];
  const blocked = busy || saving || Boolean(fileImport);
  const atProjectRoot = !!context && context.root.id === folder?.id;
  const explicitRoot = chosenRoot ?? openedRoot;
  const treeMode = Boolean(context || explicitRoot);
  const markerId = context?.marker.id;
  const projectRootId = context?.root.id;
  const projectRootIndex = trail.findIndex(({ id }) => id === projectRootId);
  const treeRootIndex = explicitRoot ? 0 : projectRootIndex;
  const treeRoot = treeMode && trail[treeRootIndex];
  const activeListing = listings.get(folder?.id);
  const loading = Boolean(folder &&
    (activeListing?.tree !== treeMode || activeListing.refresh !== refresh),
  );
  const pathWithinProject = (parentTrail: ProjectLocation[], name: string) => {
    if (!projectRootId) return;
    const index = parentTrail.findIndex(({ id }) => id === projectRootId);
    if (index < 0) return;
    return [...parentTrail.slice(index + 1).map(({ name }) => name), name].join('/');
  };
  const linkedPaths = context?.project.settings.entries || [];
  const reload = () => setRefresh((value) => value + 1);

  const gitRoot = context?.root ?? explicitRoot;
  useEffect(() => {
    onGitRoot?.(gitRoot);
  }, [gitRoot, onGitRoot]);

  useEffect(() => {
    let current = true;
    const requestedRoot =
      openedRoot !== consumedOpenedRoot.current ? openedRoot : undefined;
    const rootRequest = requestedRoot
      ? Promise.resolve(requestedRoot)
      : projectRequest({ operation: 'root' });
    rootRequest
      .then((root) => {
        if (!current) return;
        consumedOpenedRoot.current = openedRoot;
        setContext(undefined);
        setSelected(undefined);
        setListings(new Map());
        setExpanded(new Set());
        setCut(undefined);
        setSearch('');
        setError('');
        let home: ProjectLocation;
        if (drive) {
          try {
            const saved = JSON.parse(window.localStorage.getItem(storageKey));
            if (typeof saved?.id === 'string' && typeof saved.name === 'string')
              home = saved;
          } catch {
            /* The default root works with storage disabled. */
          }
        }
        setChosenRoot(requestedRoot ? undefined : home);
        setTrail([requestedRoot ?? home ?? root]);
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [drive, openedRoot, rootRefresh, storageKey]);

  useEffect(() => {
    const resetRoot = () => {
      setSelected(undefined);
      setListings(new Map());
      setExpanded(new Set());
      setCut(undefined);
      setError('');
      setSearch('');
      setRootRefresh((value) => value + 1);
    };
    window.addEventListener(projectFilesChanged, reload);
    window.addEventListener(projectRootChanged, resetRoot);
    return () => {
      window.removeEventListener(projectFilesChanged, reload);
      window.removeEventListener(projectRootChanged, resetRoot);
    };
  }, []);

  useEffect(() => {
    if (!folder) return;
    const ids = new Set([folder.id]);
    if (treeRoot) {
      ids.add(treeRoot.id);
      for (const id of expanded) ids.add(id);
    }
    const stale = [...ids].filter((id) => {
      const listing = listings.get(id);
      return listing?.tree !== treeMode || listing.refresh !== refresh;
    });
    if (!stale.length) return;
    let current = true;
    void Promise.all(stale.map(async (id): Promise<[string, FolderListing]> => {
      try {
        const items = await projectRequest({ operation: 'list', folder: id, tree: treeMode });
        items.sort(
          (a, b) => Number(b.folder) - Number(a.folder) ||
            a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
        return [id, { items, refresh, tree: treeMode }];
      } catch (reason) {
        return [id, { items: [], refresh, tree: treeMode, error: String(reason) }];
      }
    })).then((results) => {
      if (current)
        setListings((before) => {
          const next = new Map(before);
          for (const [id, listing] of results) next.set(id, listing);
          return next;
        });
    });
    return () => { current = false; };
  }, [folder, treeRoot, expanded, listings, refresh, treeMode]);

  useEffect(() => {
    if (!folder || !activeListing || loading) return;
    if (activeListing.error) {
      setError(activeListing.error);
      return;
    }
    const markers = activeListing.items.filter(
      (item) => !item.folder && !item.unsupported && isProjectFile(item.name),
    );
    const [marker] = markers;
    const readingWithinProject = Boolean(markerId && !atProjectRoot);
    if (!readingWithinProject && markers.length !== 1) {
      if (atProjectRoot) setContext(undefined);
      if (markers.length > 1) setError(t('projects.ambiguousSettings'));
      return;
    }
    let current = true;
    readProject(
      readingWithinProject ? markerId : marker.id,
      readingWithinProject ? projectRootId : folder.id,
    ).then((project) => {
      if (!current) return;
      if (readingWithinProject) {
        setContext((value) =>
          value?.marker.id === markerId && value.root.id === projectRootId
            ? { ...value, project }
            : value,
        );
      } else {
        setContext({ marker, root: folder, parent: trail.at(-2), project });
      }
    }).catch((reason) => {
      if (!current) return;
      if (!readingWithinProject) setContext(undefined);
      setError(String(reason));
    });
    return () => { current = false; };
  }, [folder, activeListing, loading, atProjectRoot, markerId, projectRootId, trail, t]);

  useEffect(() => {
    if (!context || !folder || saving) return;
    let current = true;
    const { project, root } = context;
    const parentPath = trail
      .slice(trail.findIndex(({ id }) => id === root.id) + 1)
      .map(({ name }) => name)
      .join('/')
      .toLowerCase();
    const boards = project.settings.entries.filter(
      ({ kind, path }) =>
        kind === 'board' &&
        path.split('/').slice(0, -1).join('/').toLowerCase() === parentPath,
    );
    const timer = window.setTimeout(async () => {
      const { projectCircuitStatus } = await import(
        '../../io/projectCircuitStatus'
      );
      if (!current) return;
      const state = store.getState();
      const source =
        state.altStore.file.project?.id === context.marker.id
          ? state.docStore.present.drawing
          : undefined;
      for (const board of boards) {
        if (!current) return;
        const status = await projectCircuitStatus(
          project,
          root.id,
          board.id,
          source,
        );
        if (current)
          setSync((previous) =>
            new Map(previous).set(context.marker.id + ':' + board.id, status),
          );
      }
    }, 350);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [
    context,
    folder,
    trail,
    saving,
    refresh,
    drawingVersion,
    activeProject,
    store,
  ]);

  async function run(operation: () => Promise<unknown>, updateListing = true) {
    setError('');
    setBusy(true);
    try {
      await operation();
      if (updateListing) reload();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: ProjectLocation[]) {
    const nextFolder = next.at(-1);
    setListings((before) => {
      const listing = before.get(nextFolder?.id);
      if (!listing) return before;
      return new Map(before).set(nextFolder.id, { ...listing, refresh: -1 });
    });
    setSelected(undefined);
    if (context && !next.some(({ id }) => id === context.root.id)) {
      setContext(undefined);
      if (!explicitRoot) setExpanded(new Set());
    }
    setSearch('');
    setError('');
    setTrail(next);
  }

  const openDrawing = (project: ProjectContext, entryId: string) => {
    if (editingLibrary) return;
    onActivateCircuit();
    dispatch(
      fileOpenProject({
        type: 'file-open-project',
        location: {
          id: project.marker.id,
          name: project.marker.name,
          folderId: project.parent?.id ?? (drive ? 'root' : undefined),
          rootId: project.root.id,
          entryId,
        },
      }) as any,
    );
  };

  const download = (name: string, data: Uint8Array) => {
    saveAs(new Blob([new Uint8Array(data).buffer]), name);
  };

  async function linkedBoardDocument(
    context: ProjectContext,
    id: string,
    probe?: BoardWorkspaceProbe,
  ): Promise<BoardWorkspaceDocument> {
    const { openProjectBoardWorkspace } = await import(
      '../../io/projectBoardWorkspace'
    );
    const session = await openProjectBoardWorkspace(
      { id: context.marker.id, rootId: context.root.id },
      id,
      userId ?? '',
      (sourceId) => {
        const tab = linkedSchematicSnapshot(store.getState(), context.marker.id, sourceId);
        return tab && schematicTabDirty(tab) ? tab.history.present.drawing : undefined;
      },
    );
    return {
      session,
      probe,
      projectRootId: context.root.id,
      fileId: context.project.files.get(session.path)?.id,
      async reloadProjectBoard() {
        const project = await readProject(context.marker.id, context.root.id);
        return linkedBoardDocument({ ...context, project }, id);
      },
      onProbe: (source) =>
        navigateFromBoardCanvas(context, session.circuit, source),
      onUpdate: () =>
        void run(() => openCircuitEco(context, { boardId: id }), false),
      onEditReferences: () =>
        void run(() => openReferenceDialog(context, id, 'edit'), false),
      onBackAnnotate: () =>
        void run(() => openReferenceDialog(context, id, 'annotate'), false),
    };
  }

  function openBoardWorkspace(
    context: ProjectContext,
    id: string,
    probe?: BoardWorkspaceProbe,
  ) {
    void run(
      async () => onOpenBoard(await linkedBoardDocument(context, id, probe)),
      false,
    );
  }

  async function unlinkedBoardDocument(
    file: { id: string; name: string; folder: string; path: string },
    rootId: string,
    ancestorIds: readonly string[],
  ): Promise<BoardWorkspaceDocument> {
    const { openProjectBoardFile } = await import(
      '../../io/projectBoardWorkspace'
    );
    const session = await openProjectBoardFile(file, userId ?? '');
    return {
      session,
      projectRootId: rootId,
      fileId: file.id,
      ancestorIds,
      reloadProjectBoard: () =>
        unlinkedBoardDocument(file, rootId, ancestorIds),
    };
  }

  function navigateFromBoardCanvas(
    context: ProjectContext,
    circuit: BoardWorkspaceDocument['session']['circuit'],
    source: ReturnType<typeof boardPadSources>[number]['source'],
  ) {
    if (!circuit) return;
    void run(async () => {
      const { navigateSchematicSource } = await import(
        '../../io/projectHierarchy'
      );
      const root = context.project.settings.entries.find(
        ({ id, kind }) => id === circuit.documentId && kind === 'schematic',
      );
      const drawing = await readProjectSchematic(context.project, root);
      const destination = await navigateSchematicSource(
        {
          id: context.marker.id,
          rootId: context.root.id,
          name: context.marker.name,
          folderId: context.parent?.id ?? (drive ? 'root' : undefined),
          entryId: root.id,
        },
        drawing,
        source,
      );
      await dispatch(
        fileOpenProject({
          type: 'file-open-project',
          location: destination,
        }) as any,
      );
      onActivateCircuit();
    }, false);
  }

  async function openCircuitEco(
    context: ProjectContext,
    destination: Parameters<
      typeof import('../../io/projectCircuitEco').openProjectCircuitEco
    >[1],
  ) {
    const { openProjectCircuitEco } = await import(
      '../../io/projectCircuitEco'
    );
    const next = await openProjectCircuitEco(
      { id: context.marker.id, rootId: context.root.id },
      destination,
      (sourceId) => {
        const tab = linkedSchematicSnapshot(store.getState(), context.marker.id, sourceId);
        return tab && schematicTabDirty(tab) ? tab.history.present.drawing : undefined;
      },
    );
    setCircuitEco(next);
  }

  async function openReferenceDialog(
    context: ProjectContext,
    boardId: string,
    kind: ReferenceDialogState['kind'],
  ) {
    const location = { id: context.marker.id, rootId: context.root.id };
    const access = await import('../../io/projectReferenceEco');
    if (kind === 'edit') {
      setReferenceDialog({
        kind,
        operation: await access.openBoardReferenceEdit(location, boardId),
      });
      return;
    }
    const operation = await access.openProjectBackAnnotation(
      location,
      boardId,
      (id) => {
        const tab = linkedSchematicSnapshot(store.getState(), location.id, id);
        return !!tab && schematicTabDirty(tab);
      },
    );
    setReferenceDialog({ kind, operation });
  }

  async function reloadAnnotatedDrawing(undo: ProjectReferenceUndo) {
    const matches = (location: NonNullable<docDrawing['altStore']['file']['project']>) =>
      location.id === undo.projectId &&
      (location.entryId === undo.affectedEntry ||
        location.hierarchyTrail?.[0]?.entryId === undo.affectedEntry);
    const current = store.getState().altStore.file.project;
    const state = store.getState();
    if (current && matches(current) && state.altStore.savedVersion === state.docStore.present.drawingVersion)
      await dispatch(
        fileOpenProject({ type: 'file-open-project', location: current, refresh: true }) as any,
      );
    const unavailable = await refreshInactiveSchematics(dispatch, store.getState, matches);
    if (unavailable.length) throw new Error('Could not reload project files: ' + unavailable.join(', '));
  }

  async function locateReference(source: CircuitSchematicSource) {
    if (!context || referenceDialog?.kind !== 'annotate') return;
    const { navigateSchematicSource } = await import(
      '../../io/projectHierarchy'
    );
    const location = await navigateSchematicSource(
      {
        id: context.marker.id,
        name: context.marker.name,
        rootId: context.root.id,
        folderId: context.parent?.id ?? (drive ? 'root' : undefined),
        entryId: referenceDialog.operation.sourceId,
      },
      referenceDialog.operation.drawing,
      source,
    );
    dispatch(fileOpenProject({ type: 'file-open-project', location }) as any);
  }

  const inspectBoardPads = (
    context: ProjectContext,
    boardId: string,
    name: string,
  ) =>
    run(async () => {
      const project = await readProject(context.marker.id, context.root.id);
      const { board, circuit } = await readProjectBoard(project, boardId);
      const { boardPadSources } = await import(
        '../../pcb/hierarchicalSnapshot'
      );
      const entry = project.settings.entries.find(
        ({ kind, id }) => kind === 'schematic' && id === circuit?.documentId,
      );
      if (!entry || !circuit?.sources)
        throw new Error(t('projects.boardProbeMissing'));
      const location = {
        id: context.marker.id,
        name: context.marker.name,
        rootId: context.root.id,
        folderId: context.parent?.id ?? (drive ? 'root' : undefined),
        entryId: entry.id,
      };
      const readRoot = (state: docDrawing) => {
        const active = state.altStore.file.project;
        return active?.id === location.id && active.entryId === entry.id
          ? state.docStore.present.drawing
          : readProjectSchematic(project, entry);
      };
      setBoardReview(undefined);
      setBoardProbe({
        name,
        targets: boardPadSources(board, circuit),
        open: async (target) => {
          const state = store.getState();
          const root = await readRoot(state);
          const { navigateSchematicSource } = await import(
            '../../io/projectHierarchy'
          );
          const result = await navigateSchematicSource(
            location,
            root,
            target.source,
          );
          const current = store.getState();
          if (
            current.altStore.file !== state.altStore.file ||
            current.docStore.present.drawing !== state.docStore.present.drawing
          )
            return;
          setBoardProbe(undefined);
          dispatch(
            fileOpenProject({
              type: 'file-open-project',
              location: result,
            }) as any,
          );
        },
        review: async () => {
          const root = await readRoot(store.getState());
          const { reviewProjectCircuit } = await import(
            '../../io/netlists/activeNetlist'
          );
          return reviewProjectCircuit(location, root, circuit);
        },
      });
    }, false);

  const open = (item: ProjectItem, parentTrail: ProjectLocation[]) => {
    const parent = parentTrail.at(-1);
    setError('');
    if (item.folder) {
      if (treeMode) setExpanded((before) => new Set(before).add(item.id));
      navigate([...parentTrail, item]);
      return;
    }
    setSelected(item);
    if (isProjectFile(item.name)) {
      if (context?.marker.id !== item.id)
        void run(async () => {
          const project = await readProject(item.id, parent.id);
          if (parent.id !== folder.id) navigate(parentTrail);
          setContext({
            marker: item,
            root: parent,
            parent: parentTrail.at(-2),
            project,
          });
        }, false);
      return;
    }
    if (!treeMode) return;
    const linkedPath = pathWithinProject(parentTrail, item.name)?.toLowerCase();
    const link = linkedPaths.find(({ path }) => path.toLowerCase() === linkedPath);
    if (link?.kind === 'schematic') openDrawing(context, link.id);
    else if (link?.kind === 'board') openBoardWorkspace(context, link.id);
    else if (isBoardFile(item.name)) {
      const rootId = (linkedPath && context.root.id) || explicitRoot?.id || parent.id;
      const rootIndex = parentTrail.findIndex(({ id }) => id === rootId);
      const relative = [
        ...parentTrail.slice(rootIndex + 1).map(({ name }) => name),
        item.name,
      ].join('/');
      const file = {
        id: item.id,
        name: item.name,
        folder: parent.id,
        path: relative,
      };
      const ancestors = parentTrail.map(({ id }) => id);
      void run(
        async () =>
          onOpenBoard(await unlinkedBoardDocument(file, rootId, ancestors)),
        false,
      );
    } else if (projectDocumentKind(item.name))
      void run(
        () =>
          onOpenProjectDocument({
            ...item,
            folder: parent.id,
            ancestors: parentTrail.map(({ id }) => id),
          }),
        false,
      );
    else
      void run(async () => {
        const { data } = await projectRequest({
          operation: 'read',
          id: item.id,
        });
        download(item.name, data);
      }, false);
  };

  const choose = () =>
    run(async () => {
      if (!drive) {
        await chooseDesktopProjectFolder();
        return;
      }
      const root = await projectRequest({ operation: 'choose' });
      if (!root) return;
      window.localStorage.removeItem(storageKey);
      setChosenRoot(root);
      setExpanded(new Set());
      setCut(undefined);
      navigate([root]);
    }, false);

  const hasProjectLinks = (item: ProjectItem, parentTrail: ProjectLocation[]) => {
    const relative = pathWithinProject(parentTrail, item.name)?.toLowerCase();
    return relative && linkedPaths.some(({ path }) =>
      path.toLowerCase() === relative ||
      (item.folder && path.toLowerCase().startsWith(relative + '/')),
    );
  };

  const protectedItem = (item: ProjectItem, parentTrail: ProjectLocation[]) =>
    item.unsupported ||
    isProjectDocumentOpen(item.id) ||
    context?.marker.id === item.id ||
    (item.folder && projectRootIndex >= 0 &&
      trail.slice(0, projectRootIndex + 1).some(({ id }) => id === item.id)
    ) ||
    activeProject?.id === item.id ||
    (item.folder &&
      (activeProject?.rootId === item.id ||
        activeProject?.folderId === item.id ||
        (!drive && activeProject?.id.startsWith(`${item.id}\\`)) ||
        (!drive && activeProject?.id.startsWith(item.id + '/'))));

  const isEditorOpen = (id: string) => {
    if (isProjectDocumentOpen(id)) return true;
    const state = store.getState();
    const linked = (project: typeof activeProject) => Boolean(
      project && project.id === context?.marker.id && context.project.files.get(project.documentPath)?.id === id,
    );
    return linked(state.altStore.file.project) ||
      openSchematicTabs(state).some(({ tab }) => linked(tab.file.project));
  };

  const requestTrash = (item: ProjectItem, parentTrail: ProjectLocation[]) => {
    const path = pathWithinProject(parentTrail, item.name);
    if (!path) {
      setTrash({ item });
      return;
    }
    void run(async () => {
      const { previewProjectTrash } = await import('../../io/projectTrash');
      const preview = await previewProjectTrash(context.marker.id, context.root.id, {
        id: item.id, path, name: item.name, folder: parentTrail.at(-1).id, directory: item.folder,
      });
      setTrash({ item, preview });
    }, false);
  };

  const confirmTrash = ({ item, preview }: NonNullable<typeof trash>) =>
    run(async () => {
      if (preview) {
        if (context?.marker.id !== preview.key)
          throw new Error('The active project changed. Open a fresh trash preview.');
        const { trashProjectPath } = await import('../../io/projectTrash');
        await trashProjectPath(preview, isEditorOpen);
      } else {
        if (isEditorOpen(item.id))
          throw new Error('Close the affected project documents before moving them to trash.');
        await projectRequest({ operation: 'trash', id: item.id, directory: item.folder });
      }
      if (item.folder) collapseFolder(item.id);
    });

  const changeLocation = async (
    item: ProjectItem,
    name: string,
    sourceTrail: ProjectLocation[],
    destinationTrail = sourceTrail,
  ) => {
    if (treeMode && !item.folder && isProjectFile(item.name))
      throw new Error(t('projects.noNestedProject'));
    const from = sourceTrail.at(-1).id;
    const destination = destinationTrail.at(-1).id;
    const sourcePath = pathWithinProject(sourceTrail, item.name);
    const destinationPath = pathWithinProject(destinationTrail, name);
    if (hasProjectLinks(item, sourceTrail) && !destinationPath)
      throw new Error('Choose a destination inside this project for linked files.');
    if (sourcePath && destinationPath) {
      const { relocateProjectPath } = await import('../../io/projectRelocation');
      const marker = context.marker.id;
      const root = context.root.id;
      await relocateProjectPath(
        marker, root, item,
        { path: sourcePath, folder: from, name: item.name },
        { path: destinationPath, folder: destination, name },
        isEditorOpen,
      );
    } else {
      await projectRequest({
        operation: from === destination ? 'rename' : 'move',
        id: item.id,
        from,
        folder: destination,
        name,
        directory: item.folder,
      });
    }
    if (item.folder && (from !== destination || name !== item.name)) collapseFolder(item.id);
  };

  const addSchematic = async (
    name: string,
    file?: File,
    useExisting = false,
    parentTrail = trail,
  ) => {
    const { marker, root } = context;
    if (file && file.size > MAX_PROJECT_FILE_BYTES)
      throw new Error(t('hierarchy.fileTooLarge'));
    const filename = /\.d[sz]n$/i.test(name) ? name : name + '.dsn';
    await addProjectSchematic(
      { id: marker.id, rootId: root.id },
      pathWithinProject(parentTrail, filename) ?? filename,
      file ? new Uint8Array(await file.arrayBuffer()) : undefined,
      useExisting,
    );
  };

  const canPlace = (entryId: string) =>
    !!activeProject &&
    activeProject.id === context?.marker.id &&
    activeProject.entryId !== entryId &&
    !activeProject.hierarchyTrail?.some(
      ({ entryId: ancestor }) => ancestor === entryId,
    ) &&
    !editingLibrary;

  const placeChild = (link: (typeof linkedPaths)[number], boardId?: string) =>
    run(async () => {
      const initial = store.getState();
      const sheet = activeSheet(initial.docStore.present);
      if (!sheet || sheet.hierarchicalSymbol || sheet.kind === 'simulation')
        throw new Error(t('hierarchy.circuitOnly'));
      const loaded = await readProject(context.marker.id, context.root.id);
      const boardLink = boardId ? linkedBoardSource(loaded, boardId) : undefined;
      const entry = boardLink?.source ?? loaded.settings.entries.find(
        ({ kind, id }) => kind === 'schematic' && id === link.id,
      );
      if (!entry) throw new Error(t('hierarchy.noChild'));
      const drawing = await readProjectSchematic(loaded, entry);
      const art = boardLink
        ? await (await import('../../io/projectSystem')).boardInstanceArtwork(drawing, boardLink.board)
        : await childInterface(drawing, entry.path.split('/').pop());
      const current = store.getState();
      if (
        current.altStore.file !== initial.altStore.file ||
        activeSheet(current.docStore.present) !== sheet
      )
        return;
      dispatch({
        type: DocActionTypes.PlaceChild,
        source: sheet,
        definition: hierarchyDefinition(sheet, art),
        link: {
          path: entry.path,
          documentId: entry.id,
          cached: true,
          ...(boardId ? { boardInstance: { boardId, ports: [] } } : {}),
        },
      });
    }, false);

  function startFileImport(
    destination: ProjectLocation,
    sources: Promise<ImportSource[]>,
  ) {
    const protectedFiles = new Set(openedDocumentIds);
    for (const { items } of listings.values())
      for (const item of items)
        if (isProjectDocumentOpen(item.id)) protectedFiles.add(item.id);
    if (context) {
      protectedFiles.add(context.marker.id);
      for (const file of context.project.files.values())
        protectedFiles.add(file.id);
    }
    setFileImport({ destination, sources, protectedFiles });
  }

  function dropHandlers(destination: ProjectLocation) {
    const externalFiles = (event: React.DragEvent) =>
      Array.from(event.dataTransfer.types).includes('Files');
    return {
      onDragOver(event: React.DragEvent) {
        if (!externalFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
        if (!blocked) setDropTarget(destination.id);
      },
      onDragLeave(event: React.DragEvent) {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        setDropTarget((target) =>
          target === destination.id ? undefined : target,
        );
      },
      onDrop(event: React.DragEvent) {
        if (!externalFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(undefined);
        if (!blocked)
          startFileImport(destination, droppedProjectFiles(event.dataTransfer));
      },
    };
  }

  useEffect(() => {
    setFileImport(undefined);
    setDropTarget(undefined);
  }, [openedRoot, rootRefresh]);

  const filter = search.trim().toLocaleLowerCase();
  function visibleRows(parentTrail: ProjectLocation[], depth = 0): ProjectTreeRow[] {
    const listing = listings.get(parentTrail.at(-1)?.id);
    if (listing?.tree !== treeMode) return [];
    return listing.items.flatMap((item) => {
      const children = treeMode && item.folder && expanded.has(item.id)
        ? visibleRows([...parentTrail, item], depth + 1)
        : [];
      return children.length || item.name.toLocaleLowerCase().includes(filter)
        ? [{ item, parentTrail, depth }, ...children]
        : [];
    });
  }
  const rows = folder
    ? visibleRows(treeRoot ? trail.slice(0, treeRootIndex + 1) : trail)
    : [];
  const dropRoot = treeRoot || folder;
  function collapseFolder(id: string) {
    const closed = new Set([id]);
    for (const folderId of closed) {
      for (const item of listings.get(folderId)?.items ?? [])
        if (item.folder) closed.add(item.id);
    }
    setExpanded((before) => new Set([...before].filter((id) => !closed.has(id))));
    setListings((before) => {
      const next = new Map(before);
      for (const id of closed) next.delete(id);
      return next;
    });
    const index = trail.findIndex((folder) => folder.id === id);
    if (index > 0) navigate(trail.slice(0, index));
  }

  function toggleFolder(item: ProjectItem, parentTrail: ProjectLocation[]) {
    if (treeMode && expanded.has(item.id)) collapseFolder(item.id);
    else open(item, parentTrail);
  }
  return (
    <section
      className={`project-browser${
        dropRoot && dropTarget === dropRoot.id ? ' project-drop-target' : ''
      }`}
      {...(dropRoot && treeMode ? dropHandlers(dropRoot) : {})}
      aria-label={t('projects.title')}
      aria-busy={loading || busy}
    >
      <div className="project-browser-toolbar">
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowUpRegular />}
          title={t('projects.up')}
          aria-label={t('projects.up')}
          disabled={blocked || trail.length < 2}
          onClick={() => {
            if (treeMode && expanded.has(folder.id))
              collapseFolder(folder.id);
            else navigate(trail.slice(0, -1));
          }}
        />
        <span title={trail.map(({ name }) => name).join(' / ')}>
          {dropRoot?.name}
        </span>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <MenuButton
              size="small"
              appearance="subtle"
              icon={<MoreHorizontalRegular />}
              aria-label={t('projects.folderActions')}
              disabled={blocked}
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem
                disabled={!folder || !treeMode || blocked}
                onClick={() => addFilesInput.current.click()}
              >
                {t('projects.addFiles')}
              </MenuItem>
              <MenuItem
                disabled={!folder || !treeMode}
                onClick={() =>
                  setPrompt({
                    title: t('projects.newFile'),
                    name: 'Notes.md',
                    submit: async (name) => {
                      const type = projectDocumentKind(name);
                      if (!type || type.kind !== 'text')
                        throw new Error(
                          'Choose a .txt, .md, .csv, .tsv or .log filename.',
                        );
                      const names = await projectRequest({
                        operation: 'list',
                        folder: folder.id,
                        tree: true,
                      });
                      if (
                        names.some(
                          (item) =>
                            item.name.toLowerCase() === name.toLowerCase(),
                        )
                      )
                        throw new Error(
                          'A file or folder already has that name.',
                        );
                      const file = await projectRequest({
                        operation: 'write',
                        folder: folder.id,
                        name,
                        data: new Uint8Array(),
                        mediaType: type.mime,
                      });
                      await onOpenProjectDocument({
                        ...file,
                        folder: folder.id,
                        ancestors: trail.map(({ id }) => id),
                      });
                    },
                  })
                }
              >
                {t('projects.newFile')}
              </MenuItem>
              <MenuItem disabled={!drive && !!activeProject} onClick={choose}>
                {t(drive ? 'projects.driveRoot' : 'projects.chooseFolder')}
              </MenuItem>
              {drive && folder && folder.id !== 'root' && (
                <MenuItem
                  onClick={() =>
                    run(async () => {
                      window.localStorage.setItem(
                        storageKey,
                        JSON.stringify(folder),
                      );
                      setChosenRoot(folder);
                      setExpanded(new Set());
                      setCut(undefined);
                      navigate([folder]);
                    }, false)
                  }
                >
                  {t('projects.useFolder')}
                </MenuItem>
              )}
              <MenuItem
                disabled={!folder}
                onClick={() =>
                  setPrompt({
                    title: t('projects.newFolder'),
                    submit: async (name) => {
                      await projectRequest({
                        operation: 'mkdir',
                        name,
                        folder: folder.id,
                      });
                    },
                  })
                }
              >
                {t('projects.newFolder')}
              </MenuItem>
              <MenuItem
                disabled={!folder || !!context}
                onClick={() =>
                  setPrompt({
                    title: t('projects.newProject'),
                    submit: async (name) => {
                      await createProjectFile(
                        folder.id,
                        name,
                        explicitRoot?.id === folder.id,
                      );
                    },
                  })
                }
              >
                {t('projects.newProject')}
              </MenuItem>
              {context && (
                <>
                  <MenuItem
                    onClick={() =>
                      setPrompt({
                        title: t('hierarchy.newSchematic'),
                        submit: (name) => addSchematic(name),
                      })
                    }
                  >
                    {t('hierarchy.newSchematic')}
                  </MenuItem>
                  <MenuItem onClick={() => importSchematic.current.click()}>
                    {t('hierarchy.importSchematic')}
                  </MenuItem>
                </>
              )}
              <MenuItem
                disabled={!folder || treeMode || editingLibrary}
                onClick={() =>
                  setPrompt({
                    title: t('projects.saveDrawing'),
                    submit: (name) =>
                      saveProjectDrawing(dispatch, store.getState, {
                        name,
                        folderId: folder.id,
                      }),
                  })
                }
              >
                {t('projects.saveDrawing')}
              </MenuItem>
              <MenuItem
                disabled={
                  !folder ||
                  !cut ||
                  cut.parentTrail.at(-1)?.id === folder.id ||
                  trail.some(({ id }) => id === cut.item.id) ||
                  protectedItem(cut.item, cut.parentTrail) ||
                  (cut.project !== undefined && (cut.project !== markerId || !pathWithinProject(trail, cut.item.name)))
                }
                onClick={() =>
                  run(async () => {
                    await changeLocation(
                      cut.item, cut.item.name, cut.parentTrail, trail,
                    );
                    setCut(undefined);
                  })
                }
              >
                {t('projects.paste')}
              </MenuItem>
              <MenuItem
                disabled={blocked}
                onClick={() => setFootprintEditor(true)}
              >
                {t('projects.footprintEditor')}
              </MenuItem>
              <MenuItem
                disabled={!folder}
                onClick={() => {
                  setError('');
                  reload();
                }}
              >
                {t('projects.refresh')}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      <input
        ref={addFilesInput}
        type="file"
        multiple
        hidden
        aria-label={t('projects.addFiles')}
        onChange={(event) => {
          const sources = pickedProjectFiles(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (sources.length && folder && treeMode && !blocked)
            startFileImport(folder, Promise.resolve(sources));
        }}
      />
      {fileImport && (
        <React.Suspense fallback={null}>
          <ProjectFileImportDialog
            job={fileImport}
            onClose={() => setFileImport(undefined)}
          />
        </React.Suspense>
      )}
      <input
        ref={importSchematic}
        type="file"
        hidden
        accept=".dsn,.dzn"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file && context)
            setPrompt({
              title: t('hierarchy.importSchematic'),
              name: file.name,
              submit: (name) => addSchematic(name, file),
            });
        }}
      />
      <Input
        size="small"
        value={search}
        onChange={(_, data) => setSearch(data.value)}
        placeholder={t('projects.search')}
        aria-label={t('projects.search')}
      />
      {context && activeProject?.id === context.marker.id && selectedUnit && (
        <Button
          appearance="subtle"
          size="small"
          disabled={blocked}
          onClick={(): void => {
            void run(async () => {
              const { locateSchematicComponentOnBoards } = await import(
                '../../io/projectPcbProbe'
              );
              const view = store.getState().docStore.present.view;
              const pinPrefix = view._selected_array[0] + ':@';
              const key = view.hover_pins?.find((pin) =>
                pin.startsWith(pinPrefix),
              );
              const pinId = key?.slice(pinPrefix.length);
              setPcbProbe(
                await locateSchematicComponentOnBoards(
                  activeProject,
                  selectedUnit,
                  pinId,
                ),
              );
            }, false);
          }}
        >
          {t('projects.findInPcb')}
        </Button>
      )}
      {context &&
        activeProject?.id === context.marker.id &&
        hasSchematicGroup && (
          <Button
            appearance="subtle"
            size="small"
            disabled={blocked}
            onClick={() => {
              const ids = selectedSchematicUnits(
                store.getState().docStore.present,
              );
              void run(async () => {
                const { locateSchematicPlacementGroups } = await import(
                  '../../io/projectPcbProbe'
                );
                setPlacementGroups(
                  await locateSchematicPlacementGroups(activeProject, ids),
                );
              }, false);
            }}
          >
            Place selected schematic components…
          </Button>
        )}
      {error && (
        <div className="project-browser-status" role="alert">
          {error}
        </div>
      )}
      {loading && <Spinner size="tiny" label={t('projects.loading')} />}
      {(!loading || rows.length > 0) && (
        <ul className="project-browser-list">
          {rows.map(({ item, parentTrail, depth }) => {
            const parent = parentTrail.at(-1);
            const relative = pathWithinProject(parentTrail, item.name)?.toLowerCase();
            const link = linkedPaths.find(({ path }) => path.toLowerCase() === relative);
            const expandable = treeMode && item.folder && !item.unsupported;
            const isExpanded = expandable && expanded.has(item.id);
            const selectedRow = selected?.id === item.id || (expandable && folder.id === item.id);
            const inSettingsFolder = parent.id === projectRootId;
            const status =
              link?.kind === 'board' && context
                ? sync.get(context.marker.id + ':' + link.id)
                : undefined;
            const associatedBoards =
              link?.kind === 'schematic'
                ? linkedPaths.filter(
                    (board) =>
                      board.kind === 'board' &&
                      context.project.settings.associations?.some(
                        ({ schematic, board: id }) =>
                          schematic === link.id && id === board.id,
                      ),
                  )
                : [];
            return (
              <li
                key={item.id}
                style={depth ? { paddingInlineStart: Math.min(depth * 12, 96) } : undefined}
                className={
                  dropTarget === item.id ? 'project-drop-target' : undefined
                }
                {...(treeMode && item.folder && !item.unsupported
                  ? dropHandlers(item)
                  : {})}
              >
                <Button
                  size="small"
                  className="project-file-label"
                  title={item.name}
                  appearance={selectedRow ? 'primary' : 'subtle'}
                  icon={expandable
                    ? isExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />
                    : item.folder ? <FolderRegular /> : <DocumentRegular />}
                  aria-expanded={expandable ? isExpanded : undefined}
                  disabled={blocked || item.unsupported}
                  onClick={() => item.folder ? toggleFolder(item, parentTrail) : open(item, parentTrail)}
                >
                  {item.name}
                </Button>
                {status && (
                  <small className="project-board-sync" title={status.detail}>
                    {t('projects.syncStatus.' + status.status)}
                  </small>
                )}
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<MoreHorizontalRegular />}
                      aria-label={t('projects.itemActions', {
                        name: item.name,
                      })}
                      disabled={blocked}
                    />
                  </MenuTrigger>
                  <MenuPopover>
                    <MenuList>
                      <MenuItem
                        icon={<FolderOpenRegular />}
                        disabled={item.unsupported}
                        onClick={() => open(item, parentTrail)}
                      >
                        {t('projects.open')}
                      </MenuItem>
                      {onGitHistory && !item.folder && !item.unsupported && (
                        <MenuItem onClick={() => onGitHistory(item.id)}>
                          {t('projects.gitFileHistory')}
                        </MenuItem>
                      )}
                      {!editingLibrary &&
                        associatedBoards.map((board) => (
                          <MenuItem
                            key={board.id}
                            onClick={(): void => {
                              void run(
                                () =>
                                  openCircuitEco(context, {
                                    boardId: board.id,
                                  }),
                                false,
                              );
                            }}
                          >
                            {t('projects.updateBoardCircuit')}
                            {associatedBoards.length > 1
                              ? ' · ' + board.path
                              : ''}
                          </MenuItem>
                        ))}
                      {link?.kind === 'schematic' && canPlace(link.id) && (
                        <MenuItem onClick={() => void placeChild(link)}>
                          {t('hierarchy.placeChild')}
                        </MenuItem>
                      )}
                      {link?.kind === 'board' && activeProject &&
                        !activeProject.documentPath.includes('/') &&
                        context?.project.settings.associations?.some(
                          ({ board, schematic }) => board === link.id && canPlace(schematic),
                        ) && (
                        <MenuItem onClick={() => void placeChild(link, link.id)}>
                          Place board instance
                        </MenuItem>
                      )}
                      {link?.kind === 'board' && context && (
                        <MenuItem onClick={() => setOutputProject({ ...context, boardId: link.id })}>
                          Configure PCB outputs…
                        </MenuItem>
                      )}
                      {link?.kind === 'board' && context && (
                        <MenuItem
                          icon={<ArrowDownloadRegular />}
                          onClick={(): void => {
                            void run(async () => {
                              const { data } = await readProjectBoard(
                                context.project,
                                link.id,
                              );
                              download(item.name, data);
                            }, false);
                          }}
                        >
                          {t('projects.downloadBoard')}
                        </MenuItem>
                      )}
                      {link?.kind === 'board' && !editingLibrary && (
                        <MenuItem
                          onClick={() =>
                            void inspectBoardPads(context, link.id, item.name)
                          }
                        >
                          {t('projects.boardProbe')}
                        </MenuItem>
                      )}
                      {link?.kind === 'board' && context && !editingLibrary && (
                        <MenuItem
                          onClick={(): void =>
                            void run(async () => {
                              const { openProjectDeviceReview } = await import(
                                '../../io/projectDevices'
                              );
                              setDeviceReview(
                                await openProjectDeviceReview(
                                  {
                                    id: context.marker.id,
                                    rootId: context.root.id,
                                  },
                                  link.id,
                                ),
                              );
                            }, false)
                          }
                        >
                          {t('projects.reviewBoardDevices')}
                        </MenuItem>
                      )}
                      {link?.kind === 'board' && context && !editingLibrary && (
                        <MenuItem
                          onClick={(): void =>
                            void run(
                              () =>
                                openCircuitEco(context, { boardId: link.id }),
                              false,
                            )
                          }
                        >
                          {t('projects.updateBoardCircuit')}
                        </MenuItem>
                      )}
                      {link?.kind === 'board' && context && !editingLibrary && (
                        <>
                          <MenuItem
                            onClick={(): void => {
                              void run(
                                () =>
                                  openReferenceDialog(context, link.id, 'edit'),
                                false,
                              );
                            }}
                          >
                            {t('projects.editBoardReferences')}
                          </MenuItem>
                          <MenuItem
                            onClick={(): void => {
                              void run(
                                () =>
                                  openReferenceDialog(
                                    context,
                                    link.id,
                                    'annotate',
                                  ),
                                false,
                              );
                            }}
                          >
                            {t('projects.updateSchematicReferences')}
                          </MenuItem>
                        </>
                      )}
                      {link?.kind === 'board' &&
                        referenceUndo?.boardId === link.id &&
                        referenceUndo.projectId === context?.marker.id && (
                          <MenuItem
                            onClick={() => setConfirmReferenceUndo(true)}
                          >
                            {t('projects.undoReferenceAnnotation')}
                          </MenuItem>
                        )}
                      {link?.kind === 'board' &&
                        circuitUndo?.boardId === link.id &&
                        circuitUndo.projectId === context?.marker.id && (
                          <MenuItem onClick={() => setConfirmCircuitUndo(true)}>
                            {t('projects.undoCircuitUpdate')}
                          </MenuItem>
                        )}
                      {link?.kind === 'schematic' &&
                        context &&
                        !editingLibrary && (
                          <MenuItem
                            onClick={() =>
                              setPrompt({
                                title: t('projects.createBoardCircuit'),
                                name: link.path.replace(/\.d[sz]n$/i, '.dpn'),
                                submit: (path) =>
                                  openCircuitEco(context, {
                                    sourceId: link.id,
                                    path,
                                  }),
                              })
                            }
                          >
                            {t('projects.createBoardCircuit')}
                          </MenuItem>
                        )}
                      {relative &&
                        !link &&
                        !item.folder &&
                        !item.unsupported &&
                        /\.d[sz]n$/i.test(item.name) && (
                          <MenuItem
                            onClick={() =>
                              void run(() =>
                                addSchematic(item.name, undefined, true, parentTrail),
                              )
                            }
                          >
                            {t('hierarchy.registerSchematic')}
                          </MenuItem>
                        )}
                      <MenuItem
                        disabled={protectedItem(item, parentTrail)}
                        onClick={() =>
                          setPrompt({
                            title: t('common.rename'),
                            name: item.name,
                            submit: async (name) => {
                              await changeLocation(
                                item,
                                !item.folder && isProjectFile(item.name)
                                  ? projectFileName(name)
                                  : name,
                                parentTrail,
                              );
                            },
                          })
                        }
                      >
                        {t('common.rename')}
                      </MenuItem>
                      <MenuItem
                        disabled={protectedItem(item, parentTrail)}
                        onClick={() => setCut({
                          item, parentTrail,
                          project: hasProjectLinks(item, parentTrail) ? markerId : undefined,
                        })}
                      >
                        {t('projects.cut')}
                      </MenuItem>
                      {!item.folder && isProjectFile(item.name) && (
                        <MenuItem
                          disabled={inSettingsFolder && !context.parent && !drive}
                          onClick={() =>
                            setPrompt({
                              title: t('projects.duplicate'),
                              name: projectFileTitle(item.name) + '-copy',
                              submit: async (name) => {
                                await duplicateProject(
                                  inSettingsFolder
                                    ? context.parent?.id ?? 'root'
                                    : parent.id,
                                  name,
                                  { id: item.id, rootId: parent.id },
                                );
                              },
                            })
                          }
                        >
                          {t('projects.duplicate')}
                        </MenuItem>
                      )}
                      {!item.folder && isProjectFile(item.name) && (
                        <MenuItem
                          icon={<ArrowDownloadRegular />}
                          onClick={() =>
                            run(async () => {
                              const { data } = await projectRequest({
                                operation: 'read',
                                id: item.id,
                              });
                              download(item.name, data);
                            }, false)
                          }
                        >
                          {t('projects.downloadSettings')}
                        </MenuItem>
                      )}
                      {!item.folder && isProjectFile(item.name) && (
                        <MenuItem
                          onClick={() =>
                            run(async () => {
                              const inventory = await savedProjectRevision(
                                item.id,
                                parent.id,
                              );
                              setRevisionBase({ name: item.name, inventory });
                            }, false)
                          }
                        >
                          {t('projects.setBaseRevision')}
                        </MenuItem>
                      )}
                      {!item.folder &&
                        isProjectFile(item.name) &&
                        revisionBase && (
                          <MenuItem
                            onClick={() =>
                              run(async () => {
                                const before = revisionBase.inventory;
                                const after = await savedProjectRevision(
                                  item.id,
                                  parent.id,
                                );
                                setComparison({
                                  before,
                                  after,
                                  changes: compareProjectRevisions(
                                    before,
                                    after,
                                  ),
                                });
                              }, false)
                            }
                          >
                            {t('projects.compareWithBase', {
                              name: revisionBase.name,
                            })}
                          </MenuItem>
                        )}
                      <MenuItem
                        disabled={protectedItem(item, parentTrail)}
                        onClick={() => requestTrash(item, parentTrail)}
                      >
                        {t('projects.trash')}
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </li>
            );
          })}
          {!rows.length && folder && !loading && !error && (
            <li className="project-browser-status">
              {t(search ? 'projects.noMatches' : 'projects.empty')}
            </li>
          )}
        </ul>
      )}
      {atProjectRoot && (
        <div className="project-browser-contents">
          <strong>{context.project.settings.title}</strong>
          <Button
            size="small"
            appearance="subtle"
            disabled={blocked}
            onClick={(): void => {
              void run(
                () =>
                  onOpenProjectDocument({
                    ...context.marker,
                    folder: context.root.id,
                    ancestors: trail.map(({ id }) => id),
                  }),
                false,
              );
            }}
          >
            {t('projects.projectSettings')}
          </Button>
          <Button
            size="small"
            appearance="subtle"
            disabled={blocked}
            onClick={() => setOutputProject(context)}
          >
            Project outputs…
          </Button>
          {context.project.missingSchematics.length > 0 && (
            <span role="status">
              {t('hierarchy.unread', {
                paths: context.project.missingSchematics
                  .map(({ path }) => path)
                  .join(', '),
              })}
            </span>
          )}
          {context.project.settings.entries
            .filter(({ kind }) => kind === 'schematic')
            .map((entry) => (
              <Button
                key={entry.id}
                size="small"
                appearance="subtle"
                disabled={blocked || editingLibrary}
                title={entry.path}
                icon={<DocumentRegular />}
                onClick={() => openDrawing(context, entry.id)}
              >
                {entry.id === context.project.settings.primarySchematic
                  ? t('projects.schematic')
                  : t('hierarchy.openSchematicName', { path: entry.path })}
              </Button>
            ))}
        </div>
      )}
      {outputProject && (
        <React.Suspense fallback={<Spinner />}>
          <ProjectOutputsDialog
            initialProject={outputProject.project}
            boardId={outputProject.boardId}
            location={{
              id: outputProject.marker.id,
              rootId: outputProject.root.id,
            }}
            onClose={() => setOutputProject(undefined)}
          />
        </React.Suspense>
      )}
      {comparison && (
        <ProjectRevisionDialog
          comparison={comparison}
          onClose={() => setComparison(undefined)}
        />
      )}
      {footprintEditor && (
        <React.Suspense fallback={<Spinner />}>
          <FootprintEditorDialog onClose={() => setFootprintEditor(false)} />
        </React.Suspense>
      )}
      {pcbProbe && (
        <React.Suspense fallback={<Spinner />}>
          <ProjectPcbProbeDialog
            matches={pcbProbe}
            onShow={(boardId, probe) => {
              setPcbProbe(undefined);
              if (context) openBoardWorkspace(context, boardId, probe);
            }}
            onClose={() => setPcbProbe(undefined)}
          />
        </React.Suspense>
      )}
      {placementGroups && (
        <Dialog
          open
          onOpenChange={(_, data) =>
            !data.open && setPlacementGroups(undefined)
          }
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Place selected schematic components</DialogTitle>
              <DialogContent>
                {placementGroups.length ? (
                  <ul aria-label="Linked boards">
                    {placementGroups.map(({ boardId, path, componentIds }) => (
                      <li key={boardId}>
                        <Button
                          onClick={() => {
                            setPlacementGroups(undefined);
                            if (context)
                              openBoardWorkspace(context, boardId, {
                                componentId: componentIds[0],
                                placementQueue: componentIds,
                              });
                          }}
                        >
                          {path} · {componentIds.length}{' '}
                          {componentIds.length === 1 ? 'package' : 'packages'}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p role="status">
                    The selected components have no unplaced packages with
                    reviewed devices on linked boards.
                  </p>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setPlacementGroups(undefined)}>
                  Close
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {referenceDialog && (
        <React.Suspense fallback={<Spinner />}>
          <ProjectReferenceDialog
            state={referenceDialog}
            onClose={() => setReferenceDialog(undefined)}
            onApplied={(undo) => {
              setReferenceUndo(undo);
              void run(() => reloadAnnotatedDrawing(undo), false);
            }}
            onLocate={locateReference}
          />
        </React.Suspense>
      )}
      {confirmReferenceUndo && referenceUndo && (
        <Dialog
          open
          onOpenChange={(_, data) => {
            if (!data.open && !blocked) setConfirmReferenceUndo(false);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{t('projects.undoReferenceAnnotation')}</DialogTitle>
              <DialogContent>{t('projects.undoReferenceDetail')}</DialogContent>
              <DialogActions>
                <Button
                  appearance="primary"
                  disabled={blocked}
                  onClick={(): void => {
                    void run(async () => {
                      try {
                        await referenceUndo.restore();
                        await reloadAnnotatedDrawing(referenceUndo);
                        setReferenceUndo(undefined);
                      } finally {
                        setConfirmReferenceUndo(false);
                      }
                    }, false);
                  }}
                >
                  {t('projects.undoReferenceAction')}
                </Button>
                <Button
                  disabled={blocked}
                  onClick={() => setConfirmReferenceUndo(false)}
                >
                  {t('common.cancel')}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {circuitEco && (
        <React.Suspense fallback={<Spinner />}>
          <ProjectCircuitDialog
            update={circuitEco}
            onApplied={async (undo) => {
              setCircuitUndo(undo);
              await onRefreshBoard(undo.fileId);
            }}
            onCreated={(id) => {
              if (context) openBoardWorkspace(context, id);
            }}
            onClose={() => setCircuitEco(undefined)}
          />
        </React.Suspense>
      )}
      {confirmCircuitUndo && circuitUndo && (
        <Dialog
          open
          onOpenChange={(_, data) => {
            if (!data.open && !blocked) setConfirmCircuitUndo(false);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{t('projects.undoCircuitUpdate')}</DialogTitle>
              <DialogContent>
                {t('projects.undoCircuitUpdateDetail')}
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="primary"
                  disabled={blocked}
                  onClick={(): void => {
                    void run(async () => {
                      try {
                        await circuitUndo.restore();
                        await onRefreshBoard(circuitUndo.fileId);
                        setCircuitUndo(undefined);
                      } finally {
                        setConfirmCircuitUndo(false);
                      }
                    }, false);
                  }}
                >
                  {t('projects.undoCircuitUpdateAction')}
                </Button>
                <Button
                  disabled={blocked}
                  onClick={() => setConfirmCircuitUndo(false)}
                >
                  {t('common.cancel')}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {deviceReview && (
        <React.Suspense fallback={<Spinner />}>
          <ProjectDeviceDialog
            review={deviceReview}
            onClose={() => setDeviceReview(undefined)}
          />
        </React.Suspense>
      )}
      {boardProbe && (
        <Dialog
          open
          onOpenChange={(_, data) => {
            if (!data.open) setBoardProbe(undefined);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{boardProbe.name}</DialogTitle>
              <DialogContent>
                {error && <div role="alert">{error}</div>}
                {boardReview && (
                  <p role="status">
                    {t('projects.boardReviewSummary', {
                      retained: boardReview.nets.filter(
                        ({ retainedId }) => retainedId,
                      ).length,
                      proposed: boardReview.nets.filter(
                        ({ retainedId }) => !retainedId,
                      ).length,
                      removed: boardReview.removedIds.length,
                    })}
                  </p>
                )}
                {boardProbe.targets.length ? (
                  <ul
                    style={{
                      maxHeight: '50vh',
                      overflow: 'auto',
                      paddingInlineStart: 24,
                    }}
                  >
                    {boardProbe.targets.map((target) => (
                      <li
                        key={`${target.footprintId}:${target.padId}:${target.source.unitId}:${target.source.pinId}`}
                      >
                        <Button
                          appearance="subtle"
                          disabled={blocked}
                          onClick={(): void => {
                            void run(() => boardProbe.open(target), false);
                          }}
                        >
                          {target.reference} · {target.padLabel} ·{' '}
                          {target.signal}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t('projects.boardProbeEmpty')}</p>
                )}
              </DialogContent>
              <DialogActions>
                <Button
                  disabled={blocked}
                  onClick={(): void => {
                    void run(
                      async () =>
                        setBoardReview((await boardProbe.review()).review),
                      false,
                    );
                  }}
                >
                  {t('projects.boardReview')}
                </Button>
                <Button onClick={() => setBoardProbe(undefined)}>
                  {t('common.close')}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      {prompt && (
        <ProjectNameDialog
          title={prompt.title}
          initialName={prompt.name}
          onCancel={() => setPrompt(undefined)}
          onSubmit={(name) => {
            setPrompt(undefined);
            void run(() => prompt.submit(name));
          }}
        />
      )}
      {trash && (
        <Dialog
          open
          onOpenChange={(_, data) => {
            if (!data.open) setTrash(undefined);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>{t('projects.trash')}</DialogTitle>
              <DialogContent>
                <p>{t('projects.confirmTrash', { name: trash.item.name })}</p>
                {Boolean(trash.preview?.removedPaths.length) && (
                  <>
                    <strong>{t('projects.trashLinks')}</strong>
                    <ul>{trash.preview.removedPaths.map((path) => <li key={path}>{path}</li>)}</ul>
                  </>
                )}
                {Boolean(trash.preview?.removedAssociations.length) && (
                  <>
                    <strong>{t('projects.trashAssociations')}</strong>
                    <ul>{trash.preview.removedAssociations.map(({ schematic, board }) =>
                      <li key={board}>{schematic} → {board}</li>,
                    )}</ul>
                  </>
                )}
                {Boolean(trash.preview?.removedRecipes.length) && (
                  <>
                    <strong>{t('projects.trashRecipes')}</strong>
                    <ul>{trash.preview.removedRecipes.map((path) => <li key={path}>{path}</li>)}</ul>
                  </>
                )}
                {trash.preview?.removesNativeDesigns && (
                  <p>{t('projects.trashHierarchy')}</p>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setTrash(undefined)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    setTrash(undefined);
                    void confirmTrash(trash);
                  }}
                >
                  {t('projects.trash')}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </section>
  );
}
