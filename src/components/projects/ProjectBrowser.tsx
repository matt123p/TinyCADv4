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
  MAX_PROJECT_FILE_BYTES,
  PROJECT_FILE_EXTENSION,
  projectFileTitle,
} from '../../../shared/projectFiles';
import { fileOpenProject } from '../../io/files';
import {
  createProjectFile,
  projectFilesChanged,
  projectRequest,
  readProject,
  saveProjectDrawing,
} from '../../io/projects';
import { projectFileName } from '../../io/projectStorage';
import type { ProjectItem, ProjectLocation } from '../../io/projectStorage';
import { decodeProjectArchive } from '../../pcb/projectArchive';
import { parseBoard } from '../../pcb/board';
import type { docDrawing } from '../../state/undo/undo';
import { ProjectNameDialog } from './ProjectNameDialog';
import { ProjectRevisionDialog } from './ProjectRevisionDialog';
import type { ProjectRevisionComparison } from './ProjectRevisionDialog';
import {
  compareProjectRevisions,
  revisionInventory,
} from '../../pcb/projectRevisions';
import type { RevisionInventory } from '../../pcb/projectRevisions';

interface ProjectSummary {
  title: string;
  entries: { id: string; kind: 'schematic' | 'board'; label: string }[];
}

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
  const [summary, setSummary] = useState<ProjectSummary>();
  const [refresh, setRefresh] = useState(0);
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
  const [comparison, setComparison] = useState<ProjectRevisionComparison>();
  const importField = useRef<HTMLInputElement>();
  const drive = process.env.TARGET_SYSTEM === 'google';
  const storageKey = `tinycad.driveProjectFolder.${userId || ''}`;
  const folder = trail[trail.length - 1];
  const blocked = busy || saving;
  const reload = () => setRefresh((value) => value + 1);

  useEffect(() => {
    let current = true;
    projectRequest({ operation: 'root' })
      .then((root) => {
        if (!current) return;
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
  }, [drive, storageKey]);

  useEffect(() => {
    window.addEventListener(projectFilesChanged, reload);
    return () => window.removeEventListener(projectFilesChanged, reload);
  }, []);

  useEffect(() => {
    if (!folder) return;
    let current = true;
    setLoading(true);
    projectRequest({ operation: 'list', folder: folder.id })
      .then((result) => {
        if (!current) return;
        setItems(
          result.sort(
            (a, b) =>
              Number(b.folder) - Number(a.folder) ||
              a.name.localeCompare(b.name, undefined, { numeric: true }),
          ),
        );
        setSelected((item) => result.find(({ id }) => id === item?.id));
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
  }, [folder, refresh]);

  useEffect(() => {
    setSummary(undefined);
    if (!selected || selected.folder) return;
    let current = true;
    readProject(selected.id)
      .then(({ project }) => {
        if (!current) return;
        const entries: ProjectSummary['entries'] = [];
        const schematics = project.entries.filter(
          ({ kind }) => kind === 'schematic',
        );
        for (const [index, entry] of schematics.entries()) {
          entries.push({
            id: entry.id,
            kind: 'schematic',
            label:
              schematics.length === 1
                ? t('projects.schematic')
                : t('projects.numberedSchematic', { number: index + 1 }),
          });
        }
        for (const entry of project.entries.filter(
          ({ kind }) => kind === 'board',
        )) {
          const board = parseBoard(new TextDecoder().decode(entry.data));
          entries.push({ id: entry.id, kind: 'board', label: board.title });
        }
        setSummary({ title: project.title, entries });
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [selected, t]);

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
    setSummary(undefined);
    setSearch('');
    setError('');
    setTrail(next);
  }

  const open = (item: ProjectItem) => {
    setError('');
    if (item.folder) navigate([...trail, item]);
    else setSelected(item);
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

  const importArchive = (file: File) =>
    run(async () => {
      if (file.size > MAX_PROJECT_FILE_BYTES)
        throw new Error(t('projects.sizeLimit'));
      const data = new Uint8Array(await file.arrayBuffer());
      await decodeProjectArchive(data);
      await projectRequest({
        operation: 'write',
        folder: folder.id,
        name: projectFileName(file.name),
        data,
      });
    });

  const protectedItem = (item: ProjectItem) =>
    activeProject?.id === item.id ||
    (item.folder &&
      (activeProject?.folderId === item.id ||
        (!drive && activeProject?.id.startsWith(`${item.id}\\`)) ||
        (!drive && activeProject?.id.startsWith(`${item.id}/`))));

  const changeLocation = (item: ProjectItem, name: string, from = folder.id) =>
    projectRequest({
      operation: from === folder.id ? 'rename' : 'move',
      id: item.id,
      from,
      folder: folder.id,
      name,
      directory: item.folder,
    });

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
                disabled={!folder}
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
              <MenuItem
                disabled={!folder || editingLibrary}
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
                disabled={!folder}
                onClick={() => importField.current.click()}
              >
                {t('projects.import')}
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
        <input
          ref={importField}
          hidden
          type="file"
          accept={PROJECT_FILE_EXTENSION}
          onChange={(event) => {
            const [file] = event.currentTarget.files;
            event.currentTarget.value = '';
            if (file && folder && !blocked) void importArchive(file);
          }}
        />
      </div>
      <Input
        size="small"
        value={search}
        onChange={(_, data) => setSearch(data.value)}
        placeholder={t('projects.search')}
        aria-label={t('projects.search')}
      />
      {error && (
        <div className="project-browser-status" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <Spinner size="tiny" label={t('projects.loading')} />
      ) : (
        <ul className="project-browser-list">
          {visibleItems.map((item) => (
            <li key={item.id}>
              <Button
                size="small"
                className="project-file-label"
                title={item.name}
                appearance={selected?.id === item.id ? 'primary' : 'subtle'}
                icon={item.folder ? <FolderRegular /> : <DocumentRegular />}
                disabled={blocked}
                onClick={() => open(item)}
              >
                {item.name}
              </Button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button
                    size="small"
                    appearance="subtle"
                    icon={<MoreHorizontalRegular />}
                    aria-label={t('projects.itemActions', { name: item.name })}
                    disabled={blocked}
                  />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem
                      icon={<FolderOpenRegular />}
                      onClick={() => open(item)}
                    >
                      {t('projects.open')}
                    </MenuItem>
                    <MenuItem
                      disabled={protectedItem(item)}
                      onClick={() =>
                        setPrompt({
                          title: t('common.rename'),
                          name: item.name,
                          submit: async (name) => {
                            await changeLocation(
                              item,
                              item.folder ? name : projectFileName(name),
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
                    {!item.folder && (
                      <MenuItem
                        onClick={() =>
                          setPrompt({
                            title: t('projects.duplicate'),
                            name: projectFileTitle(item.name) + '-copy',
                            submit: async (name) => {
                              await createProjectFile(folder.id, name, item.id);
                            },
                          })
                        }
                      >
                        {t('projects.duplicate')}
                      </MenuItem>
                    )}
                    {!item.folder && (
                      <MenuItem
                        icon={<ArrowDownloadRegular />}
                        onClick={() =>
                          run(async () => {
                            const { data } = await readProject(item.id);
                            saveAs(
                              new Blob([new Uint8Array(data).buffer], {
                                type: 'application/zip',
                              }),
                              item.name,
                            );
                          }, false)
                        }
                      >
                        {t('projects.download')}
                      </MenuItem>
                    )}
                    {!item.folder && (
                      <MenuItem
                        onClick={() =>
                          run(async () => {
                            const inventory = await revisionInventory(
                              (
                                await readProject(item.id)
                              ).project,
                            );
                            setRevisionBase({ name: item.name, inventory });
                          }, false)
                        }
                      >
                        {t('projects.setBaseRevision')}
                      </MenuItem>
                    )}
                    {!item.folder && revisionBase && (
                      <MenuItem
                        onClick={() =>
                          run(async () => {
                            const before = revisionBase.inventory;
                            const after = await revisionInventory(
                              (
                                await readProject(item.id)
                              ).project,
                            );
                            setComparison({
                              before,
                              after,
                              changes: compareProjectRevisions(before, after),
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
          ))}
          {!visibleItems.length && folder && !error && (
            <li className="project-browser-status">
              {t(search ? 'projects.noMatches' : 'projects.empty')}
            </li>
          )}
        </ul>
      )}
      {summary && selected && (
        <div className="project-browser-contents">
          <strong>{summary.title}</strong>
          {summary.entries.map((entry) => (
            <Button
              key={entry.id}
              size="small"
              appearance="subtle"
              disabled={
                blocked || (editingLibrary && entry.kind === 'schematic')
              }
              title={entry.label}
              icon={
                entry.kind === 'board' ? (
                  <ArrowDownloadRegular />
                ) : (
                  <DocumentRegular />
                )
              }
              onClick={() => {
                if (entry.kind === 'schematic') {
                  dispatch(
                    fileOpenProject({
                      type: 'file-open-project',
                      location: {
                        id: selected.id,
                        name: selected.name,
                        folderId: folder.id,
                        entryId: entry.id,
                      },
                    }) as any,
                  );
                } else {
                  void run(async () => {
                    const { project } = await readProject(selected.id);
                    const board = project.entries.find(
                      ({ kind, id }) => kind === 'board' && id === entry.id,
                    );
                    if (!board) throw new Error(t('projects.refresh'));
                    saveAs(
                      new Blob([new Uint8Array(board.data).buffer], {
                        type: 'application/json',
                      }),
                      `${entry.label.replace(/[<>:"/\\|?*]/g, '_')}.dpn`,
                    );
                  }, false);
                }
              }}
            >
              {entry.kind === 'board'
                ? t('projects.downloadBoard', { name: entry.label })
                : entry.label}
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
