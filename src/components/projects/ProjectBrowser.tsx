import type { ProjectBoardWorkspace } from '../../io/projectBoardWorkspace';
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
  createProjectFile,
  duplicateProject,
  projectFilesChanged,
  projectRequest,
  projectRootChanged,
  readProject,
  readProjectBoard,
  savedProjectRevision,
  saveProjectDrawing,
} from '../../io/projects';
import { projectFileName } from '../../io/projectStorage';
import type { ProjectItem, ProjectLocation } from '../../io/projectStorage';
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
import type { BoardProbeMatch } from '../../io/projectPcbProbe';
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
import { readProjectSchematic } from '../../io/projectHierarchy';
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
const ProjectBoardWorkspaceDialog = React.lazy(
  () => import('./ProjectBoardWorkspaceDialog'),
);
const FootprintEditorDialog = React.lazy(
  () => import('./FootprintEditorDialog'),
);
const ProjectDeviceDialog = React.lazy(() => import('./ProjectDeviceDialog'));

interface NamePrompt {
  title: string;
  name?: string;
  submit: (name: string) => Promise<void>;
}

export default function ProjectBrowser() {
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
  const [trail, setTrail] = useState<ProjectLocation[]>([]);
  const [items, setItems] = useState<ProjectItem[]>([]);
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<NamePrompt>();
  const [trash, setTrash] = useState<ProjectItem>();
  const [cut, setCut] = useState<{ item: ProjectItem; from: string }>();
  const [revisionBase, setRevisionBase] = useState<{
    name: string;
    inventory: RevisionInventory;
  }>();
  const importSchematic = useRef<HTMLInputElement>(null);
  const [comparison, setComparison] = useState<ProjectRevisionComparison>();
  const [boardWorkspace, setBoardWorkspace] = useState<ProjectBoardWorkspace>();
  const [boardWorkspaceProbe, setBoardWorkspaceProbe] = useState<{
    componentId: string;
    padId?: string;
  }>();
  const [footprintEditor, setFootprintEditor] = useState(false);
  const [pcbProbe, setPcbProbe] = useState<BoardProbeMatch[]>();
  const selectedUnit = useSelector((state: docDrawing) => {
    const present = state.docStore.present;
    if (present.view._selected_array.length !== 1) return undefined;
    const item = activeSheet(present)?.items.find(
      ({ _id }) => _id === present.view._selected_array[0],
    );
    if (item?.NodeName === DocItemTypes.Symbol && !item.hierarchy)
      return item.unitId;
    return undefined;
  });
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
  const blocked = busy || saving;
  const atProjectRoot = !!context && context.root.id === folder?.id;
  const treeMode = Boolean(context);
  const markerId = context?.marker.id;
  const projectRootId = context?.root.id;
  const relativePrefix = context
    ? trail
        .slice(trail.findIndex(({ id }) => id === context.root.id) + 1)
        .map(({ name }) => name)
        .join('/')
    : '';
  const relativePath = (item: ProjectItem) =>
    relativePrefix ? relativePrefix + '/' + item.name : item.name;
  const linkedPaths = context?.project.settings.entries || [];
  const reload = () => setRefresh((value) => value + 1);

  useEffect(() => {
    let current = true;
    projectRequest({ operation: 'root' })
      .then((root) => {
        if (!current) return;
        setContext(undefined);
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
        setTrail([home || root]);
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [drive, rootRefresh, storageKey]);

  useEffect(() => {
    const resetRoot = () => {
      setSelected(undefined);
      setItems([]);
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
    let current = true;
    setLoading(true);
    projectRequest({ operation: 'list', folder: folder.id, tree: treeMode })
      .then(async (result) => {
        if (!current) return;
        setItems(
          result.sort(
            (a, b) =>
              Number(b.folder) - Number(a.folder) ||
              a.name.localeCompare(b.name, undefined, { numeric: true }),
          ),
        );
        setSelected((item) => result.find(({ id }) => id === item?.id));
        if (treeMode && !atProjectRoot) {
          const project = await readProject(markerId, projectRootId);
          if (current)
            setContext((value) =>
              value?.marker.id === markerId && value.root.id === projectRootId
                ? { ...value, project }
                : value,
            );
          return;
        }
        const markers = result.filter(
          (item) =>
            !item.folder && !item.unsupported && isProjectFile(item.name),
        );
        if (markers.length !== 1) {
          if (atProjectRoot) setContext(undefined);
          if (markers.length > 1) setError(t('projects.ambiguousSettings'));
          return;
        }
        const [marker] = markers;
        try {
          const project = await readProject(marker.id, folder.id);
          if (!current) return;
          setContext({ marker, root: folder, parent: trail.at(-2), project });
        } catch (reason) {
          if (current) {
            setContext(undefined);
            setError(String(reason));
          }
        }
      })
      .catch((reason) => {
        if (current) {
          setItems([]);
          setSelected(undefined);
          setError(String(reason));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    folder,
    refresh,
    treeMode,
    atProjectRoot,
    markerId,
    projectRootId,
    trail,
    t,
  ]);

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
    setItems([]);
    setSelected(undefined);
    if (!next.some(({ id }) => id === context?.root.id)) setContext(undefined);
    setSearch('');
    setError('');
    setTrail(next);
  }

  const openDrawing = (project: ProjectContext, entryId: string) => {
    if (editingLibrary) return;
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

  function openBoardWorkspace(
    context: ProjectContext,
    id: string,
    probe?: { componentId: string; padId?: string },
  ) {
    setBoardWorkspaceProbe(probe);
    void run(async () => {
      const { openProjectBoardWorkspace } = await import(
        '../../io/projectBoardWorkspace'
      );
      setBoardWorkspace(
        await openProjectBoardWorkspace(
          { id: context.marker.id, rootId: context.root.id },
          id,
        ),
      );
    }, false);
  }

  function navigateFromBoardCanvas(
    source: ReturnType<typeof boardPadSources>[number]['source'],
  ) {
    if (!context || !boardWorkspace?.circuit) return;
    void run(async () => {
      const { navigateSchematicSource } = await import(
        '../../io/projectHierarchy'
      );
      const { circuit } = boardWorkspace;
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
      setBoardWorkspace(undefined);
      dispatch(
        fileOpenProject({
          type: 'file-open-project',
          location: destination,
        }) as any,
      );
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
        const state = store.getState();
        const location = state.altStore.file.project;
        return location?.id === context.marker.id &&
          location.entryId === sourceId
          ? state.docStore.present.drawing
          : undefined;
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
        const state = store.getState();
        const current = state.altStore.file.project;
        return (
          current?.id === location.id &&
          current.entryId === id &&
          state.docStore.present.drawingVersion !== state.altStore.savedVersion
        );
      },
    );
    setReferenceDialog({ kind, operation });
  }

  function reloadAnnotatedDrawing(undo: ProjectReferenceUndo) {
    const current = store.getState().altStore.file.project;
    if (
      current?.id !== undo.projectId ||
      (current.entryId !== undo.affectedEntry &&
        current.hierarchyTrail?.[0]?.entryId !== undo.affectedEntry)
    )
      return;
    dispatch(
      fileOpenProject({ type: 'file-open-project', location: current }) as any,
    );
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

  const open = (item: ProjectItem) => {
    setError('');
    if (item.folder) {
      navigate([...trail, item]);
      return;
    }
    setSelected(item);
    if (isProjectFile(item.name)) {
      if (context?.marker.id !== item.id)
        void run(async () => {
          const project = await readProject(item.id, folder.id);
          setContext({
            marker: item,
            root: folder,
            parent: trail.at(-2),
            project,
          });
        }, false);
      return;
    }
    if (!context) return;
    const link = linkedPaths.find(
      ({ path }) => path.toLowerCase() === relativePath(item).toLowerCase(),
    );
    if (link?.kind === 'schematic') openDrawing(context, link.id);
    else if (link?.kind === 'board') openBoardWorkspace(context, link.id);
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
      const root = await projectRequest({
        operation: 'choose',
      });
      if (!root) return;
      if (drive) window.localStorage.removeItem(storageKey);
      navigate([root]);
    }, false);

  const protectedItem = (item: ProjectItem) =>
    item.unsupported ||
    context?.marker.id === item.id ||
    linkedPaths.some(
      ({ path }) =>
        path === relativePath(item) ||
        (item.folder && path.startsWith(relativePath(item) + '/')),
    ) ||
    activeProject?.id === item.id ||
    (item.folder &&
      (activeProject?.rootId === item.id ||
        activeProject?.folderId === item.id ||
        (!drive && activeProject?.id.startsWith(`${item.id}\\`)) ||
        (!drive && activeProject?.id.startsWith(`${item.id}/`))));

  const changeLocation = (
    item: ProjectItem,
    name: string,
    from = folder.id,
  ) => {
    if (treeMode && !item.folder && isProjectFile(item.name))
      throw new Error(t('projects.noNestedProject'));
    return projectRequest({
      operation: from === folder.id ? 'rename' : 'move',
      id: item.id,
      from,
      folder: folder.id,
      name,
      directory: item.folder,
    });
  };

  const schematicPath = (name: string) =>
    (relativePrefix ? relativePrefix + '/' : '') +
    (/\.d[sz]n$/i.test(name) ? name : name + '.dsn');

  const addSchematic = async (
    name: string,
    file?: File,
    useExisting = false,
  ) => {
    const { marker, root } = context;
    if (file && file.size > MAX_PROJECT_FILE_BYTES)
      throw new Error(t('hierarchy.fileTooLarge'));
    await addProjectSchematic(
      { id: marker.id, rootId: root.id },
      schematicPath(name),
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

  const placeChild = (link: (typeof linkedPaths)[number]) =>
    run(async () => {
      const initial = store.getState();
      const sheet = activeSheet(initial.docStore.present);
      if (!sheet || sheet.hierarchicalSymbol || sheet.kind === 'simulation')
        throw new Error(t('hierarchy.circuitOnly'));
      const loaded = await readProject(context.marker.id, context.root.id);
      const entry = loaded.settings.entries.find(
        ({ kind, id }) => kind === 'schematic' && id === link.id,
      );
      if (!entry) throw new Error(t('hierarchy.noChild'));
      const drawing = await readProjectSchematic(loaded, entry);
      const art = await childInterface(drawing, entry.path.split('/').pop());
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
        link: { path: entry.path, documentId: entry.id, cached: true },
      });
    }, false);

  const visibleItems = items.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <section
      className="project-browser"
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
          onClick={() => navigate(trail.slice(0, -1))}
        />
        <span title={trail.map(({ name }) => name).join(' / ')}>
          {folder?.name}
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
                disabled={!folder || treeMode}
                onClick={() =>
                  setPrompt({
                    title: t('projects.newProject'),
                    submit: async (name) => {
                      await createProjectFile(folder.id, name);
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
                  cut.from === folder.id ||
                  protectedItem(cut.item)
                }
                onClick={() =>
                  run(async () => {
                    await changeLocation(cut.item, cut.item.name, cut.from);
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
              const key =
                store.getState().docStore.present.view.hover_pins?.[0];
              const pinId =
                key && key.includes(':@') ? key.split(':@')[1] : undefined;
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
      {error && (
        <div className="project-browser-status" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <Spinner size="tiny" label={t('projects.loading')} />
      ) : (
        <ul className="project-browser-list">
          {visibleItems.map((item) => {
            const link = linkedPaths.find(
              ({ path }) =>
                path.toLowerCase() === relativePath(item).toLowerCase(),
            );
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
              <li key={item.id}>
                <Button
                  size="small"
                  className="project-file-label"
                  title={item.name}
                  appearance={selected?.id === item.id ? 'primary' : 'subtle'}
                  icon={item.folder ? <FolderRegular /> : <DocumentRegular />}
                  disabled={blocked || item.unsupported}
                  onClick={() => open(item)}
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
                        onClick={() => open(item)}
                      >
                        {t('projects.open')}
                      </MenuItem>
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
                      {context &&
                        !link &&
                        !item.folder &&
                        !item.unsupported &&
                        /\.d[sz]n$/i.test(item.name) && (
                          <MenuItem
                            onClick={() =>
                              void run(() =>
                                addSchematic(item.name, undefined, true),
                              )
                            }
                          >
                            {t('hierarchy.registerSchematic')}
                          </MenuItem>
                        )}
                      <MenuItem
                        disabled={protectedItem(item)}
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
                              );
                            },
                          })
                        }
                      >
                        {t('common.rename')}
                      </MenuItem>
                      <MenuItem
                        disabled={protectedItem(item)}
                        onClick={() => setCut({ item, from: folder.id })}
                      >
                        {t('projects.cut')}
                      </MenuItem>
                      {!item.folder && isProjectFile(item.name) && (
                        <MenuItem
                          disabled={atProjectRoot && !context.parent && !drive}
                          onClick={() =>
                            setPrompt({
                              title: t('projects.duplicate'),
                              name: projectFileTitle(item.name) + '-copy',
                              submit: async (name) => {
                                await duplicateProject(
                                  atProjectRoot
                                    ? context.parent?.id ?? 'root'
                                    : folder.id,
                                  name,
                                  { id: item.id, rootId: folder.id },
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
                                folder.id,
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
                                  folder.id,
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
                        disabled={protectedItem(item)}
                        onClick={() => setTrash(item)}
                      >
                        {t('projects.trash')}
                      </MenuItem>
                    </MenuList>
                  </MenuPopover>
                </Menu>
              </li>
            );
          })}
          {!visibleItems.length && folder && !error && (
            <li className="project-browser-status">
              {t(search ? 'projects.noMatches' : 'projects.empty')}
            </li>
          )}
        </ul>
      )}
      {atProjectRoot && (
        <div className="project-browser-contents">
          <strong>{context.project.settings.title}</strong>
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
      {comparison && (
        <ProjectRevisionDialog
          comparison={comparison}
          onClose={() => setComparison(undefined)}
        />
      )}
      {boardWorkspace && (
        <React.Suspense fallback={<Spinner />}>
          <ProjectBoardWorkspaceDialog
            session={boardWorkspace}
            probe={boardWorkspaceProbe}
            onProbe={navigateFromBoardCanvas}
            onUpdate={() => {
              setBoardWorkspace(undefined);
              if (context)
                void run(
                  () =>
                    openCircuitEco(context, {
                      boardId: boardWorkspace.board.boardId,
                    }),
                  false,
                );
            }}
            onEditReferences={() => {
              setBoardWorkspace(undefined);
              if (context)
                void run(
                  () =>
                    openReferenceDialog(
                      context,
                      boardWorkspace.board.boardId,
                      'edit',
                    ),
                  false,
                );
            }}
            onBackAnnotate={() => {
              setBoardWorkspace(undefined);
              if (context)
                void run(
                  () =>
                    openReferenceDialog(
                      context,
                      boardWorkspace.board.boardId,
                      'annotate',
                    ),
                  false,
                );
            }}
            syncStatus={
              sync.get(context?.marker.id + ':' + boardWorkspace.board.boardId)
                ? t(
                    'projects.syncStatus.' +
                      sync.get(
                        context?.marker.id + ':' + boardWorkspace.board.boardId,
                      ).status,
                  )
                : undefined
            }
            onClose={() => setBoardWorkspace(undefined)}
          />
        </React.Suspense>
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
            onShow={({ boardId, componentId }, padId) => {
              setPcbProbe(undefined);
              if (context)
                openBoardWorkspace(context, boardId, { componentId, padId });
            }}
            onClose={() => setPcbProbe(undefined)}
          />
        </React.Suspense>
      )}
      {referenceDialog && (
        <React.Suspense fallback={<Spinner />}>
          <ProjectReferenceDialog
            state={referenceDialog}
            onClose={() => setReferenceDialog(undefined)}
            onApplied={(undo) => {
              setReferenceUndo(undo);
              reloadAnnotatedDrawing(undo);
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
                        reloadAnnotatedDrawing(referenceUndo);
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
            onApplied={setCircuitUndo}
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
                {t('projects.confirmTrash', { name: trash.name })}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setTrash(undefined)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  appearance="primary"
                  onClick={() => {
                    setTrash(undefined);
                    void run(() =>
                      projectRequest({
                        operation: 'trash',
                        id: trash.id,
                        directory: trash.folder,
                      }),
                    );
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
