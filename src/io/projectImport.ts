import {
  isProjectFile,
  MAX_PROJECT_FILE_BYTES,
  validProjectName,
} from '../../shared/projectFiles';
import { projectRequest } from './projects';
import type { ProjectItem, ProjectLocation } from './projectStorage';

export type ImportSource = {
  path: readonly string[];
  read?: () => Promise<File>;
  error?: string;
};

export type ImportConflict = {
  path: string;
  replaceable: boolean;
};

export type ImportChoice = 'keep' | 'replace' | 'skip';

export function pickedProjectFiles(files: Iterable<File>): ImportSource[] {
  return Array.from(files, (file) => ({
    path: file.webkitRelativePath
      ? file.webkitRelativePath.split('/')
      : [file.name],
    read: async () => file,
  }));
}

async function droppedEntry(
  entry: FileSystemEntry,
  parent: readonly string[],
): Promise<ImportSource[]> {
  const path = [...parent, entry.name];
  if (entry.isFile) {
    return [
      {
        path,
        read: () =>
          new Promise((resolve, reject) => {
            (entry as FileSystemFileEntry).file(resolve, reject);
          }),
      },
    ];
  }
  if (!entry.isDirectory)
    return [{ path, error: 'Unsupported file or folder.' }];
  try {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const results: ImportSource[] = [{ path }];
    for (;;) {
      const children = await new Promise<FileSystemEntry[]>(
        (resolve, reject) => {
          reader.readEntries(resolve, reject);
        },
      );
      if (!children.length) return results;
      for (const child of children)
        for (const source of await droppedEntry(child, path))
          results.push(source);
    }
  } catch (error) {
    return [{ path, error: errorMessage(error) }];
  }
}

export async function droppedProjectFiles(
  transfer: DataTransfer,
): Promise<ImportSource[]> {
  const fallback = pickedProjectFiles(transfer.files);
  const tasks = Array.from(transfer.items ?? [])
    .filter(({ kind }) => kind === 'file')
    .map(async (item, index): Promise<ImportSource[]> => {
      try {
        const entry = item.webkitGetAsEntry?.();
        if (entry) return await droppedEntry(entry, []);
        const file = item.getAsFile();
        return file ? pickedProjectFiles([file]) : [];
      } catch (error) {
        return [
          {
            path: fallback[index]?.path ?? ['Dropped item'],
            error: errorMessage(error),
          },
        ];
      }
    });
  const sources = (await Promise.all(tasks)).flat();
  return sources.length ? sources : fallback;
}

const key = (name: string) => name.toLowerCase();
const label = (path: readonly string[]) => path.join('/');
const errorMessage = (error: unknown) =>
  error instanceof Error || error instanceof DOMException
    ? error.message
    : String(error);

function availableCopyName(
  name: string,
  folder: boolean,
  used: ReadonlySet<string>,
) {
  const lastDot = name.lastIndexOf('.');
  const dot = !folder && name.length - lastDot <= 200 ? lastDot : -1;
  const extension = dot > 0 ? name.slice(dot) : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;
  for (let index = 2; ; ++index) {
    const suffix = ` (${index})${extension}`;
    const candidate = stem.slice(0, Math.max(1, 240 - suffix.length)) + suffix;
    if (validProjectName(candidate) && !used.has(key(candidate)))
      return candidate;
  }
}

export async function importProjectFiles({
  sources,
  destination,
  protectedFiles,
  choose,
  report,
  signal,
}: {
  sources: readonly ImportSource[];
  destination: ProjectLocation;
  protectedFiles: ReadonlySet<string>;
  choose(conflict: ImportConflict): Promise<ImportChoice>;
  report(completed: number, path: string): void;
  signal: AbortSignal;
}) {
  const folders = new Map<string, ProjectLocation | null>([['', destination]]);
  const failed: { source: ImportSource; message: string }[] = [];
  let added = 0;
  let skipped = 0;

  async function siblings(folder: string, name: string) {
    const entries = await projectRequest({
      operation: 'list',
      folder,
      tree: true,
    });
    return {
      used: new Set(entries.map((entry) => key(entry.name))),
      matches: entries.filter((entry) => key(entry.name) === key(name)),
    };
  }

  async function openFolder(
    path: readonly string[],
  ): Promise<ProjectLocation | null> {
    const relative = label(path);
    if (folders.has(relative)) return folders.get(relative);
    const parent = await openFolder(path.slice(0, -1));
    if (!parent) return null;
    let name = path.at(-1);
    const { used, matches } = await siblings(parent.id, name);
    const [existing] = matches;
    if (matches.length === 1 && existing.folder && !existing.unsupported) {
      folders.set(relative, existing);
      return existing;
    }
    if (matches.length) {
      const choice = await choose({ path: relative, replaceable: false });
      if (choice !== 'keep') {
        folders.set(relative, null);
        return null;
      }
      name = availableCopyName(name, true, used);
    }
    signal.throwIfAborted();
    const folder = await projectRequest({
      operation: 'mkdir',
      folder: parent.id,
      name,
    });
    folders.set(relative, folder);
    return folder;
  }

  for (const [index, source] of sources.entries()) {
    if (signal.aborted) break;
    const { path, read } = source;
    const relative = label(path);
    report(index, relative);
    try {
      if (source.error) throw new Error(source.error);
      if (!path.length || path.some((part) => !validProjectName(part)))
        throw new Error('Invalid project file or folder name.');
      if (read && isProjectFile(path.at(-1)))
        throw new Error('Open project settings with Open Project Folder.');
      const parent = await openFolder(read ? path.slice(0, -1) : path);
      if (!parent) {
        skipped++;
        continue;
      }
      if (!read) continue;

      let name = path.at(-1);
      const { used, matches } = await siblings(parent.id, name);
      const [existing] = matches;
      let replace: ProjectItem;
      let version: string;
      if (matches.length) {
        const replaceable =
          matches.length === 1 &&
          !existing.folder &&
          !existing.unsupported &&
          !protectedFiles.has(existing.id);
        const current = replaceable
          ? await projectRequest({ operation: 'read', id: existing.id }).catch(
              (): undefined => undefined,
            )
          : undefined;
        signal.throwIfAborted();
        const choice = await choose({ path: relative, replaceable: !!current });
        if (choice === 'skip') {
          skipped++;
          continue;
        }
        if (choice === 'keep') name = availableCopyName(name, false, used);
        else {
          if (!current)
            throw new Error('The destination file cannot be replaced.');
          replace = existing;
          name = replace.name;
          version = current.version;
        }
      }
      const file = await read();
      if (file.size > MAX_PROJECT_FILE_BYTES)
        throw new Error('The file exceeds the project file size limit.');
      const data = new Uint8Array(await file.arrayBuffer());
      signal.throwIfAborted();
      await projectRequest({
        operation: 'write',
        folder: parent.id,
        name,
        data,
        mediaType: file.type,
        ...(replace ? { id: replace.id, version } : {}),
      });
      added++;
    } catch (error) {
      if (!signal.aborted)
        failed.push({ source, message: errorMessage(error) });
    }
  }
  return { added, skipped, failed };
}
