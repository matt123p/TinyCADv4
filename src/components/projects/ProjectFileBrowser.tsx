import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
} from '@fluentui/react-components';
import {
  FolderRegular,
  ChevronDownRegular,
  ChevronRightRegular,
} from '@fluentui/react-icons';
import { MAX_PROJECT_FILE_BYTES } from '../../../shared/projectFiles';
import { projectDocumentKind } from '../../io/projectDocumentKind';
import { projectRequest } from '../../io/projects';
import { projectFilesChanged } from '../../io/projectStorage';
import type { ProjectItem, ProjectLocation } from '../../io/projectStorage';

export type BrowserFile = ProjectLocation & {
  folder: string;
  ancestors: string[];
};

type Props = {
  root: ProjectLocation;
  active?: string;
  open(file: BrowserFile): Promise<void>;
  isOpen(id: string): boolean;
  report(error: unknown): void;
};

export default function ProjectFileBrowser({
  root,
  active,
  open,
  isOpen,
  report,
}: Props) {
  const expansionKey = 'tinycad.projectFolders.' + root.id;
  const [expanded, setExpanded] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(expansionKey));
      if (Array.isArray(stored))
        return stored.filter((id): id is string => typeof id === 'string');
    } catch {
      // Folder expansion is optional.
    }
    return [];
  });
  const [folders, setFolders] = useState<Record<string, ProjectItem[]>>({});
  const [selected, setSelected] = useState<{
    item: ProjectItem;
    folder: string;
  }>();
  const [clipboard, setClipboard] = useState<{
    item: ProjectItem;
    folder: string;
    move: boolean;
  }>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const filePicker = useRef<HTMLInputElement>();
  const [nameDialog, setNameDialog] = useState<{
    title: string;
    name: string;
    action(name: string): Promise<unknown>;
  }>();
  const invalidate = () => setRefresh((current) => current + 1);

  useEffect(() => {
    try {
      localStorage.setItem(expansionKey, JSON.stringify(expanded));
    } catch {
      // Folder expansion is optional.
    }
    void projectRequest({
      operation: 'watch-folders',
      folders: [root.id, ...expanded],
    }).catch(report);
    return () => {
      void projectRequest({ operation: 'watch-folders', folders: [] }).catch(
        report,
      );
    };
  }, [root.id, expanded]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onProjectFoldersChanged(invalidate);
    window.addEventListener(projectFilesChanged, invalidate);
    return () => {
      unsubscribe();
      window.removeEventListener(projectFilesChanged, invalidate);
    };
  }, []);

  useEffect(() => {
    let listening = true;
    void Promise.all(
      [root.id, ...expanded].map(async (folder) => {
        try {
          const files = await projectRequest({
            operation: 'list',
            folder,
            tree: true,
          });
          const items = files
            .filter(({ name }) => name !== '.git')
            .sort(
              (first, second) =>
                Number(second.folder) - Number(first.folder) ||
                first.name.localeCompare(second.name),
            );
          return [folder, items] as const;
        } catch (error) {
          if (listening && folder === root.id) report(error);
          return [folder, []] as const;
        }
      }),
    ).then((results) => {
      if (listening) setFolders(Object.fromEntries(results));
    });
    return () => {
      listening = false;
    };
  }, [root.id, expanded, refresh]);

  async function change(operation: () => Promise<unknown>) {
    setBusy(true);
    try {
      await operation();
      setSelected(undefined);
      window.dispatchEvent(new Event(projectFilesChanged));
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  const destination = selected?.item.folder
    ? selected.item.id
    : selected?.folder ?? root.id;
  const protectedItem = selected && isOpen(selected.item.id);

  function tree(folder: string, ancestors: string[]) {
    return (
      <ul className="project-files">
        {(folders[folder] ?? []).map((item) => {
          const isExpanded = expanded.includes(item.id);
          return (
            <li key={item.id}>
              <button
                type="button"
                title={item.name}
                aria-expanded={item.folder ? isExpanded : undefined}
                aria-current={
                  active === item.id || selected?.item.id === item.id
                    ? 'true'
                    : undefined
                }
                onClick={() => {
                  setSelected({ item, folder });
                  if (item.folder) {
                    setExpanded(
                      isExpanded
                        ? expanded.filter((id) => id !== item.id)
                        : [...expanded, item.id],
                    );
                  } else if (!item.unsupported) {
                    void open({ ...item, folder, ancestors }).catch(report);
                  }
                }}
              >
                {item.folder &&
                  (isExpanded ? (
                    <ChevronDownRegular />
                  ) : (
                    <ChevronRightRegular />
                  ))}
                {item.folder && <FolderRegular />}
                <span>{item.name}</span>
              </button>
              {item.folder &&
                isExpanded &&
                tree(item.id, [...ancestors, item.id])}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="project-browser" aria-label="Project Files">
      <strong title={root.id}>{root.name}</strong>
      <div className="project-actions">
        <Button size="small" onClick={invalidate}>
          Refresh
        </Button>
        {selected && (
          <Button size="small" onClick={() => setSelected(undefined)}>
            Select Project Root
          </Button>
        )}
        <Button
          size="small"
          disabled={busy}
          onClick={() => {
            setNameDialog({
              title: 'New Folder',
              name: '',
              action: (name) =>
                projectRequest({
                  operation: 'mkdir',
                  folder: destination,
                  name,
                }),
            });
          }}
        >
          New Folder…
        </Button>
        <Button
          size="small"
          disabled={busy}
          onClick={() => {
            setNameDialog({
              title: 'New Text File',
              name: 'Notes.md',
              action: async (name) => {
                if (projectDocumentKind(name).kind !== 'text')
                  throw new Error(
                    'Enter a text filename such as Notes.md or Notes.txt.',
                  );
                const file = await projectRequest({
                  operation: 'write',
                  folder: destination,
                  name,
                  data: new Uint8Array(),
                });
                await open({
                  ...file,
                  folder: destination,
                  ancestors: [root.id, destination],
                });
              },
            });
          }}
        >
          New Text File…
        </Button>
        <Button
          size="small"
          disabled={busy}
          onClick={() => filePicker.current.click()}
        >
          Import Files…
        </Button>
        <input
          ref={filePicker}
          type="file"
          multiple
          hidden
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files);
            event.currentTarget.value = '';
            if (!files.length) return;
            void change(async () => {
              try {
                for (const file of files) {
                  if (file.size > MAX_PROJECT_FILE_BYTES)
                    throw new Error(
                      `${file.name} exceeds the project file size limit.`,
                    );
                  await projectRequest({
                    operation: 'write',
                    folder: destination,
                    name: file.name,
                    data: new Uint8Array(await file.arrayBuffer()),
                  });
                }
              } finally {
                invalidate();
              }
            });
          }}
        />
        <Button
          size="small"
          disabled={
            busy || !selected || selected.item.unsupported || protectedItem
          }
          onClick={() => {
            const { item, folder } = selected;
            setNameDialog({
              title: 'Rename',
              name: item.name,
              action: (name) =>
                projectRequest({
                  operation: 'rename',
                  id: item.id,
                  from: folder,
                  folder,
                  name,
                  directory: item.folder,
                }),
            });
          }}
        >
          Rename…
        </Button>
        <Button
          size="small"
          disabled={
            busy ||
            !selected ||
            selected.item.unsupported ||
            selected.item.folder
          }
          onClick={() => setClipboard({ ...selected, move: false })}
        >
          Copy
        </Button>
        <Button
          size="small"
          disabled={
            busy || !selected || selected.item.unsupported || protectedItem
          }
          onClick={() => setClipboard({ ...selected, move: true })}
        >
          Cut
        </Button>
        <Button
          size="small"
          disabled={
            busy || !clipboard || (clipboard.move && isOpen(clipboard.item.id))
          }
          onClick={() => {
            const { item, folder, move } = clipboard;
            const action = (name: string) =>
              move
                ? projectRequest({
                    operation: 'move',
                    id: item.id,
                    from: folder,
                    folder: destination,
                    name,
                    directory: item.folder,
                  })
                : projectRequest({
                    operation: 'copy',
                    id: item.id,
                    folder: destination,
                    name,
                  });
            setNameDialog({
              title: move ? 'Move File or Folder' : 'Copy File',
              name: item.name,
              action: async (name) => {
                await action(name);
                if (move) setClipboard(undefined);
              },
            });
          }}
        >
          Paste…
        </Button>
        <Button
          size="small"
          disabled={
            busy || !selected || selected.item.unsupported || protectedItem
          }
          onClick={() => {
            const { item } = selected;
            if (window.confirm(`Move ${item.name} to the trash?`))
              void change(() =>
                projectRequest({
                  operation: 'trash',
                  id: item.id,
                  directory: item.folder,
                }),
              );
          }}
        >
          Trash
        </Button>
      </div>
      {tree(root.id, [root.id])}
      <Dialog
        open={!!nameDialog}
        onOpenChange={(_, data) => {
          if (!data.open) setNameDialog(undefined);
        }}
      >
        <DialogSurface>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = nameDialog.name.trim();
              if (!name) return;
              setNameDialog(undefined);
              void change(() => nameDialog.action(name));
            }}
          >
            <DialogBody>
              <DialogTitle>{nameDialog?.title}</DialogTitle>
              <DialogContent>
                <Input
                  aria-label="Name"
                  value={nameDialog?.name ?? ''}
                  autoFocus
                  onChange={(_, { value }) =>
                    setNameDialog({ ...nameDialog, name: value })
                  }
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setNameDialog(undefined)}>Cancel</Button>
                <Button
                  appearance="primary"
                  type="submit"
                  disabled={!nameDialog?.name.trim()}
                >
                  OK
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
