import type { tclib, tclibLibraryEntry } from './tclib';
import { validateSymbolFolderPath } from '../../shared/bundledLibraries';

export function symbolFolderPath(value: string): string {
  return validateSymbolFolderPath(value);
}

/** Includes implicit parent folders and folders used by symbols. */
export function getSymbolFolders(library: tclib): string[] {
  const folders = new Set<string>();
  for (const path of [
    ...(library.symbolFolders || []),
    ...library.names.map((name) => name.folder).filter(Boolean),
  ]) {
    const parts = symbolFolderPath(path).split('/');
    parts.forEach((_, index) =>
      folders.add(parts.slice(0, index + 1).join('/')),
    );
  }
  return [...folders];
}

export type SymbolFolderChange =
  | { operation: 'create'; folder: string }
  | { operation: 'rename'; previous: string; folder: string }
  | { operation: 'remove'; folder: string }
  | { operation: 'move'; nameId: number; folder: string };

export function changeSymbolFolders(
  library: tclib,
  change: SymbolFolderChange,
): tclib {
  if (library.readOnly) return library;
  const folders = getSymbolFolders(library);
  const folder = change.folder ? symbolFolderPath(change.folder) : '';
  if (change.operation === 'move') {
    if (folder && !folders.includes(folder))
      throw new Error('Unknown symbol folder.');
    const entry = library.names.find((name) => name.NameID === change.nameId);
    if (!entry || (entry.folder || '') === folder) return library;
    return {
      ...library,
      symbolFolders: folders,
      names: library.names.map((name) =>
        name === entry ? { ...name, folder: folder || undefined } : name,
      ),
    };
  }
  if (!folder) throw new Error('A folder path is required.');
  if (change.operation === 'create') {
    if (folders.includes(folder))
      throw new Error('Symbol folder already exists.');
    return { ...library, symbolFolders: [...folders, folder] };
  }
  const previous =
    change.operation === 'rename' ? symbolFolderPath(change.previous) : folder;
  if (!folders.includes(previous)) throw new Error('Unknown symbol folder.');
  const contains = (path: string) =>
    path === previous || path?.startsWith(previous + '/');
  if (change.operation === 'rename') {
    if (previous === folder) return library;
    if (folder.startsWith(previous + '/') || folders.includes(folder))
      throw new Error('Symbol folder already exists.');
    const replace = (path: string) =>
      contains(path) ? folder + path.slice(previous.length) : path;
    return {
      ...library,
      symbolFolders: folders.map(replace),
      names: library.names.map((name) =>
        contains(name.folder)
          ? { ...name, folder: replace(name.folder) }
          : name,
      ),
    };
  }
  const parent = previous.includes('/')
    ? previous.slice(0, previous.lastIndexOf('/'))
    : undefined;
  return {
    ...library,
    symbolFolders: folders.filter((path) => !contains(path)),
    names: library.names.map((name) =>
      contains(name.folder) ? { ...name, folder: parent } : name,
    ),
  };
}

export interface SymbolFolderNode {
  path: string;
  name: string;
  folders: Map<string, SymbolFolderNode>;
  entries: tclibLibraryEntry[];
}

export function symbolFolderTree(
  library: tclib,
  entries: tclibLibraryEntry[],
  includeEmpty = true,
): SymbolFolderNode {
  const root: SymbolFolderNode = {
    path: '',
    name: '',
    folders: new Map(),
    entries: [],
  };
  const ensure = (path: string) => {
    let node = root;
    const parts = path ? path.split('/') : [];
    parts.forEach((name, index) => {
      if (!node.folders.has(name))
        node.folders.set(name, {
          path: parts.slice(0, index + 1).join('/'),
          name,
          folders: new Map(),
          entries: [],
        });
      node = node.folders.get(name)!;
    });
    return node;
  };
  if (includeEmpty) getSymbolFolders(library).forEach(ensure);
  entries.forEach((entry) => ensure(entry.folder || '').entries.push(entry));
  return root;
}

export interface BundledSymbolFolder {
  path: string;
  symbols: (string | number)[];
}

/** Apply catalog metadata after loading a selected library, without changing its file. */
export function applyBundledSymbolFolders(
  library: tclib,
  folders?: BundledSymbolFolder[],
): tclib {
  if (!folders?.length) return library;
  const assignments = new Map<number, string>();
  for (const folder of folders) {
    for (const symbol of folder.symbols) {
      const matches = library.names.filter((entry) =>
        typeof symbol === 'number'
          ? entry.NameID === symbol
          : entry.Name === symbol,
      );
      if (!matches.length)
        throw new Error(`Unknown symbol in folder "${folder.path}": ${symbol}`);
      for (const entry of matches) {
        if (assignments.has(entry.NameID))
          throw new Error(
            `Symbol assigned to more than one folder: ${entry.Name}`,
          );
        assignments.set(entry.NameID, folder.path);
      }
    }
  }
  return {
    ...library,
    symbolFolders: [
      ...getSymbolFolders(library),
      ...folders.map((folder) => folder.path),
    ],
    names: library.names.map((entry) =>
      assignments.has(entry.NameID)
        ? { ...entry, folder: assignments.get(entry.NameID) }
        : entry,
    ),
  };
}
