import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import {
  ChevronDownRegular,
  ChevronRightRegular,
  DocumentAddRegular,
  DocumentRegular,
  FolderAddRegular,
  FolderOpenRegular,
  FolderRegular,
  MoreHorizontalRegular,
  ArrowClockwiseRegular,
} from '@fluentui/react-icons';
import {
  MAX_PROJECT_FILE_BYTES,
  validProjectName,
} from '../../../shared/projectFiles';
import { projectRequest } from '../../io/projects';
import { projectFilesChanged } from '../../io/projectStorage';
import type { ProjectItem, ProjectLocation } from '../../io/projectStorage';

export type BrowserFile = ProjectLocation & {
  folder: string;
  ancestors: string[];
};

type Entry = { item: ProjectItem; parent: string };
type Props = {
  root: ProjectLocation;
  active?: string;
  gitChanges?: ReadonlyMap<string, string>;
  showHistory?(id: string, blame?: boolean): void;
  open(file: BrowserFile): Promise<void>;
  beforeChange(id: string, kind: 'relocate' | 'trash', newName?: string): void;
  relocated(previous: ProjectItem, next: ProjectItem, parent: string): void;
  removed(id: string): void;
  report(error: unknown): void;
};

const newFileTypes = [
  ['Schematic (.dsn)', '.dsn'],
  ['Compressed schematic (.dzn)', '.dzn'],
  ['Symbol library (.tclib)', '.tclib'],
  ['Text file (.txt)', '.txt'],
  ['Markdown (.md)', '.md'],
  ['CSV (.csv)', '.csv'],
  ['JSON (.json)', '.json'],
  ['XML (.xml)', '.xml'],
  ['File with any extension', ''],
];
const sortItems = (first: ProjectItem, second: ProjectItem) =>
  Number(second.folder) - Number(first.folder) ||
  first.name.localeCompare(second.name, undefined, { numeric: true });
const isWithin = (path: string, directory: string) =>
  path === directory ||
  path.startsWith(
    directory.replace(/[\\/]$/, '') + (directory.includes('\\') ? '\\' : '/'),
  );
const rootReveal = /Mac/i.test(navigator.platform)
  ? 'Reveal in Finder'
  : /Win/i.test(navigator.platform)
  ? 'Reveal in File Explorer'
  : 'Reveal in File Manager';

function InlineName({
  item,
  busy,
  error,
  commit,
  cancel,
}: {
  item: ProjectItem;
  busy: boolean;
  error?: string;
  commit(name: string): Promise<void>;
  cancel(): void;
}) {
  const [name, setName] = useState(item.name);
  const input = useRef<HTMLInputElement>();
  useEffect(() => {
    input.current.focus();
    const dot = item.folder ? -1 : item.name.lastIndexOf('.');
    input.current.setSelectionRange(0, dot > 0 ? dot : item.name.length);
  }, [item]);
  const valid = validProjectName(name);
  return (
    <form
      className="project-inline-name"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) void commit(name);
      }}
    >
      <Input
        ref={input}
        size="small"
        value={name}
        readOnly={busy}
        aria-label={`Rename ${item.name}`}
        aria-invalid={!valid || !!error}
        onChange={(_, { value }) => setName(value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            cancel();
          }
        }}
      />
      {(!valid || error) && (
        <small role="alert">
          {!valid ? 'Enter a valid file or folder name.' : error}
        </small>
      )}
    </form>
  );
}

export default function ProjectFileBrowser({
  root,
  active,
  gitChanges,
  showHistory,
  open,
  beforeChange,
  relocated,
  removed,
  report,
}: Props) {
  const expansionKey = 'tinycad.projectFolders.' + root.id;
  const [expanded, setExpanded] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(expansionKey));
      if (Array.isArray(saved))
        return saved.filter((id): id is string => typeof id === 'string');
    } catch {
      // Folder expansion is optional.
    }
    return [];
  });
  const [folders, setFolders] = useState<Record<string, ProjectItem[]>>({});
  const [selected, setSelected] = useState<Entry>();
  const [clipboard, setClipboard] = useState<Entry & { move: boolean }>();
  const [dragged, setDragged] = useState<Entry>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [renaming, setRenaming] = useState<Entry>();
  const [renameError, setRenameError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const filePicker = useRef<HTMLInputElement>();
  const treeRef = useRef<HTMLDivElement>();
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
          const items = await projectRequest({
            operation: 'list',
            folder,
            tree: true,
          });
          return [
            folder,
            items.filter(({ name }) => name !== '.git').sort(sortItems),
          ] as const;
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

  async function change(operation: () => Promise<void>, onError = report) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await operation();
      window.dispatchEvent(new Event(projectFilesChanged));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  const destination = (entry?: Entry) =>
    entry?.item.folder ? entry.item.id : entry?.parent ?? root.id;
  const focusRow = (id: string) =>
    requestAnimationFrame(() => {
      Array.from(
        treeRef.current?.querySelectorAll<HTMLButtonElement>(
          'button[data-project-entry]',
        ) ?? [],
      )
        .find((row) => row.dataset.projectEntry === id)
        ?.focus();
    });
  const ensureExpanded = (id: string) => {
    if (id !== root.id)
      setExpanded((previous) =>
        previous.includes(id) ? previous : [...previous, id],
      );
  };
  const putItem = (entry: Entry, old?: Entry) =>
    setFolders((current) => {
      const next = { ...current };
      if (old)
        next[old.parent] = (next[old.parent] ?? []).filter(
          ({ id }) => id !== old.item.id,
        );
      next[entry.parent] = [
        ...(next[entry.parent] ?? []).filter(({ id }) => id !== entry.item.id),
        entry.item,
      ].sort(sortItems);
      return next;
    });

  function startRename(entry: Entry) {
    if (entry.item.unsupported) return;
    setSelected(entry);
    setRenameError('');
    setRenaming(entry);
  }

  function create(folder: string, directory: boolean, extension = '') {
    void change(async () => {
      const location = await projectRequest({
        operation: 'create-entry',
        folder,
        directory,
        extension,
      });
      const entry = {
        item: { ...location, folder: directory },
        parent: folder,
      };
      ensureExpanded(folder);
      putItem(entry);
      startRename(entry);
    });
  }

  async function relocate(entry: Entry, folder: string, name: string) {
    beforeChange(entry.item.id, 'relocate', name);
    if (folder === entry.parent && name === entry.item.name) return entry;
    const location = await projectRequest({
      operation: folder === entry.parent ? 'rename' : 'move',
      id: entry.item.id,
      from: entry.parent,
      folder,
      name,
      directory: entry.item.folder,
    });
    const next = { item: { ...entry.item, ...location }, parent: folder };
    if (entry.item.folder) {
      setExpanded((previous) =>
        previous.map((id) =>
          isWithin(id, entry.item.id)
            ? location.id + id.slice(entry.item.id.length)
            : id,
        ),
      );
    }
    relocated(entry.item, next.item, folder);
    putItem(next, entry);
    ensureExpanded(folder);
    setSelected(next);
    setClipboard((current) =>
      current?.item.id === entry.item.id ? undefined : current,
    );
    return next;
  }

  function finishRename(name: string) {
    return change(
      async () => {
        const next = await relocate(renaming, renaming.parent, name);
        setRenaming(undefined);
        focusRow(next.item.id);
      },
      (error) =>
        setRenameError(error instanceof Error ? error.message : String(error)),
    );
  }

  function remove(entry: Entry) {
    if (
      entry.item.unsupported ||
      !window.confirm(`Move "${entry.item.name}" to the system Trash?`)
    )
      return;
    void change(async () => {
      beforeChange(entry.item.id, 'trash');
      if (
        !(await projectRequest({
          operation: 'trash',
          id: entry.item.id,
          directory: entry.item.folder,
        }))
      )
        return;
      removed(entry.item.id);
      setExpanded((previous) =>
        previous.filter((id) => !isWithin(id, entry.item.id)),
      );
      setFolders((current) => ({
        ...current,
        [entry.parent]:
          current[entry.parent]?.filter(({ id }) => id !== entry.item.id) ?? [],
      }));
      setSelected((current) =>
        current?.item.id === entry.item.id ? undefined : current,
      );
      setClipboard((current) =>
        current?.item.id === entry.item.id ? undefined : current,
      );
    });
  }

  function reveal(entry?: Entry) {
    void projectRequest({
      operation: 'reveal',
      id: entry?.item.id ?? root.id,
      directory: entry?.item.folder ?? true,
      openFolder: !entry,
    }).catch(report);
  }

  function paste(folder: string) {
    if (!clipboard) return;
    void change(async () => {
      const { item, move } = clipboard;
      if (move) {
        await relocate(clipboard, folder, item.name);
        setClipboard(undefined);
        return;
      }
      const siblings = await projectRequest({
        operation: 'list',
        folder,
        tree: true,
      });
      const names = new Set(siblings.map(({ name }) => name.toLowerCase()));
      const dot = item.folder ? -1 : item.name.lastIndexOf('.');
      const ext = dot > 0 ? item.name.slice(dot) : '';
      const stem = ext ? item.name.slice(0, -ext.length) : item.name;
      let name = item.name;
      for (let number = 1; names.has(name.toLowerCase()); number++)
        name = stem + (number === 1 ? ' copy' : ` copy ${number}`) + ext;
      const location = await projectRequest({
        operation: 'copy',
        id: item.id,
        folder,
        name,
        directory: item.folder,
      });
      const entry = { item: { ...item, ...location }, parent: folder };
      putItem(entry);
      ensureExpanded(folder);
      setSelected(entry);
      focusRow(entry.item.id);
    });
  }

  function newFileMenu(folder: string, toolbar: boolean) {
    return (
      <Menu positioning={toolbar ? 'below-end' : 'after-top'}>
        <MenuTrigger disableButtonEnhancement={!toolbar}>
          {toolbar ? (
            <Button
              size="small"
              appearance="subtle"
              icon={<DocumentAddRegular />}
              aria-label="New File"
              title="New File"
              disabled={busy}
            />
          ) : (
            <MenuItem icon={<DocumentAddRegular />} disabled={busy}>
              New File
            </MenuItem>
          )}
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {newFileTypes.map(([label, extension]) => (
              <MenuItem
                key={label}
                onClick={() => create(folder, false, extension)}
              >
                {label}
              </MenuItem>
            ))}
          </MenuList>
        </MenuPopover>
      </Menu>
    );
  }

  function actions(entry?: Entry) {
    const restricted = !entry || entry.item.unsupported;
    return (
      <MenuList>
        {newFileMenu(destination(entry), false)}
        <MenuItem
          disabled={busy}
          onClick={() => create(destination(entry), true)}
        >
          New Folder
        </MenuItem>
        <MenuDivider />
        {entry && (
          <>
            <MenuItem
              disabled={busy || restricted}
              onClick={() => startRename(entry)}
            >
              Rename
            </MenuItem>
            <MenuItem
              disabled={busy || restricted}
              onClick={() => setClipboard({ ...entry, move: true })}
            >
              Cut
            </MenuItem>
            <MenuItem
              disabled={busy || restricted}
              onClick={() => setClipboard({ ...entry, move: false })}
            >
              Copy
            </MenuItem>
          </>
        )}
        <MenuItem
          disabled={busy || !clipboard}
          onClick={() => paste(destination(entry))}
        >
          Paste
        </MenuItem>
        <MenuDivider />
        <MenuItem
          disabled={!!entry?.item.unsupported}
          onClick={() => reveal(entry)}
        >
          {entry ? rootReveal : rootReveal.replace('Reveal in', 'Open in')}
        </MenuItem>
        {showHistory &&
          entry &&
          !entry.item.folder &&
          !entry.item.unsupported && (
            <>
              <MenuItem onClick={() => showHistory(entry.item.id)}>
                File History
              </MenuItem>
              {!/\.(?:dsn|dzn|dpn|tcproject|tclib|tplib|pdf|png|jpe?g|gif|webp|bmp|avif)$/i.test(
                entry.item.name,
              ) && (
                <MenuItem onClick={() => showHistory(entry.item.id, true)}>
                  Line History
                </MenuItem>
              )}
            </>
          )}
        {entry && (
          <MenuItem disabled={busy || restricted} onClick={() => remove(entry)}>
            Move to Trash
          </MenuItem>
        )}
        {!entry && (
          <MenuItem disabled={busy} onClick={() => filePicker.current.click()}>
            Import Files…
          </MenuItem>
        )}
      </MenuList>
    );
  }

  function toggle(id: string) {
    setExpanded((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id],
    );
  }

  function moveTo(event: React.DragEvent, folder: string) {
    event.stopPropagation();
    if (!dragged || isWithin(folder, dragged.item.id)) return;
    event.preventDefault();
    const source = dragged;
    setDragged(undefined);
    setDropTarget(undefined);
    void change(async () => {
      const next = await relocate(source, folder, source.item.name);
      focusRow(next.item.id);
    });
  }

  function dragOver(event: React.DragEvent, folder: string) {
    event.stopPropagation();
    if (!dragged || isWithin(folder, dragged.item.id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(folder);
  }

  function tree(folder: string, ancestors: string[]) {
    return (
      <ul className="project-files">
        {(folders[folder] ?? []).map((item) => {
          const entry = { item, parent: folder };
          const isExpanded = expanded.includes(item.id);
          const gitStatus = gitChanges?.get(item.id);
          return (
            <li key={item.id}>
              {renaming?.item.id === item.id ? (
                <InlineName
                  item={renaming.item}
                  error={renameError}
                  busy={busy}
                  commit={finishRename}
                  cancel={() => {
                    setRenaming(undefined);
                    focusRow(item.id);
                  }}
                />
              ) : (
                <Menu openOnContext>
                  <MenuTrigger disableButtonEnhancement>
                    <button
                      type="button"
                      title={item.name}
                      aria-label={item.name}
                      data-project-entry={item.id}
                      data-cut={
                        (clipboard?.move && clipboard.item.id === item.id) ||
                        undefined
                      }
                      data-drop-target={dropTarget === item.id || undefined}
                      aria-expanded={item.folder ? isExpanded : undefined}
                      aria-current={
                        (selected?.item.id ?? active) === item.id
                          ? 'true'
                          : undefined
                      }
                      draggable={!busy && !item.unsupported}
                      onDragStart={(event) => {
                        setDragged(entry);
                        event.dataTransfer.setData('text/plain', item.name);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDragged(undefined);
                        setDropTarget(undefined);
                      }}
                      onDragOver={
                        item.folder
                          ? (event) => dragOver(event, item.id)
                          : undefined
                      }
                      onDrop={
                        item.folder
                          ? (event) => moveTo(event, item.id)
                          : undefined
                      }
                      onFocus={() => setSelected(entry)}
                      onClick={() => {
                        setSelected(entry);
                        if (item.folder) toggle(item.id);
                        else if (!item.unsupported)
                          void open({ ...item, folder, ancestors }).catch(
                            report,
                          );
                      }}
                    >
                      {item.folder ? (
                        isExpanded ? (
                          <ChevronDownRegular />
                        ) : (
                          <ChevronRightRegular />
                        )
                      ) : (
                        <span className="project-tree-spacer" />
                      )}
                      {item.folder ? (
                        isExpanded ? (
                          <FolderOpenRegular />
                        ) : (
                          <FolderRegular />
                        )
                      ) : (
                        <DocumentRegular />
                      )}
                      <span>{item.name}</span>
                      {gitStatus && (
                        <small
                          className="project-tree-git-status"
                          data-change={gitStatus}
                          aria-hidden="true"
                        >
                          {gitStatus === '?' ? 'U' : gitStatus}
                        </small>
                      )}
                    </button>
                  </MenuTrigger>
                  <MenuPopover>{actions(entry)}</MenuPopover>
                </Menu>
              )}
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
      <div className="project-explorer-header">
        <button
          type="button"
          className="project-root-name"
          title={root.id}
          aria-pressed={!selected}
          onClick={() => setSelected(undefined)}
        >
          {root.name}
        </button>
        {newFileMenu(destination(selected), true)}
        <Button
          size="small"
          appearance="subtle"
          icon={<FolderAddRegular />}
          aria-label="New Folder"
          title="New Folder"
          disabled={busy}
          onClick={() => create(destination(selected), true)}
        />
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowClockwiseRegular />}
          aria-label="Refresh files"
          title="Refresh files"
          onClick={invalidate}
        />
        <Menu>
          <MenuTrigger>
            <Button
              size="small"
              appearance="subtle"
              icon={<MoreHorizontalRegular />}
              aria-label="Project file actions"
            />
          </MenuTrigger>
          <MenuPopover>{actions()}</MenuPopover>
        </Menu>
      </div>
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
                  folder: destination(selected),
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
      <div
        ref={treeRef}
        className="project-tree-body"
        data-drop-target={dropTarget === root.id || undefined}
        onDragOver={(event) => dragOver(event, root.id)}
        onDrop={(event) => moveTo(event, root.id)}
        onDragLeave={(event) => {
          if (
            !(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
          )
            setDropTarget(undefined);
        }}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            busy ||
            renaming ||
            (event.target as HTMLElement).closest('input, [role="menu"]')
          )
            return;
          const command = event.ctrlKey || event.metaKey;
          const key = event.key.toLowerCase();
          if (command && key === 'v' && clipboard) paste(destination(selected));
          else if (!selected || selected.item.unsupported) return;
          else if (command && (key === 'x' || key === 'c')) {
            setClipboard({ ...selected, move: key === 'x' });
          } else if (key === 'f2') startRename(selected);
          else if (key === 'delete') remove(selected);
          else if (
            key === 'arrowright' &&
            selected.item.folder &&
            !expanded.includes(selected.item.id)
          )
            toggle(selected.item.id);
          else if (
            key === 'arrowleft' &&
            selected.item.folder &&
            expanded.includes(selected.item.id)
          )
            toggle(selected.item.id);
          else if (key === 'arrowup' || key === 'arrowdown') {
            const rows = Array.from(
              treeRef.current.querySelectorAll<HTMLButtonElement>(
                'button[data-project-entry]',
              ),
            );
            const row =
              rows[
                rows.indexOf(document.activeElement as HTMLButtonElement) +
                  (key === 'arrowup' ? -1 : 1)
              ];
            row?.focus();
          } else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {tree(root.id, [root.id])}
      </div>
    </section>
  );
}
