import { tclib } from '../model/tclib';
import { LibraryFile, LibraryFolder, UserConfig } from '../state/stores/altStoreReducer';

function getFallbackLibraryName(id: unknown): string {
  if (typeof id !== 'string') {
    return '';
  }

  const normalizedPath = id.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  return parts[parts.length - 1] || id;
}

function normalizeLibraryFolder(folder: unknown): LibraryFolder | null {
  if (!folder || typeof folder !== 'object') {
    return null;
  }

  const value = folder as { id?: unknown; name?: unknown };
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return null;
  }

  const name =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.trim()
      : value.id.trim();

  return {
    id: value.id.trim(),
    name,
  };
}

function normalizeLibraryFile(file: unknown): LibraryFile | null {
  if (typeof file === 'string') {
    return {
      id: file,
      name: getFallbackLibraryName(file),
      folderId: null,
    };
  }

  if (!file || typeof file !== 'object') {
    return null;
  }

  const value = file as { id?: unknown; name?: unknown; folderId?: unknown };
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    return null;
  }

  const name =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.trim()
      : getFallbackLibraryName(value.id);

  const folderId =
    typeof value.folderId === 'string' && value.folderId.trim().length > 0
      ? value.folderId.trim()
      : null;

  return {
    id: value.id,
    name,
    folderId,
  };
}

export function normalizeUserConfig(config: Partial<UserConfig> | unknown): UserConfig {
  const value = config && typeof config === 'object' ? (config as Partial<UserConfig>) : {};
  const folderList = Array.isArray(value.libraryFolders) ? value.libraryFolders : [];
  const libraryList = Array.isArray(value.libraries) ? value.libraries : [];

  const seenFolders = new Set<string>();
  const libraryFolders = folderList.reduce<LibraryFolder[]>((items, folder) => {
    const normalized = normalizeLibraryFolder(folder);
    if (!normalized || seenFolders.has(normalized.id)) {
      return items;
    }

    seenFolders.add(normalized.id);
    items.push(normalized);
    return items;
  }, []);

  const seenLibraries = new Set<string>();
  const libraries = libraryList.reduce<LibraryFile[]>((items, file) => {
    const normalized = normalizeLibraryFile(file);
    if (!normalized) {
      return items;
    }

    const key = `${normalized.id}`;
    if (seenLibraries.has(key)) {
      return items;
    }

    seenLibraries.add(key);
    items.push({
      ...normalized,
      folderId:
        normalized.folderId && seenFolders.has(normalized.folderId)
          ? normalized.folderId
          : null,
    });
    return items;
  }, []);

  return {
    fileId: typeof value.fileId === 'string' ? value.fileId : null,
    libraryFolders,
    libraries,
  };
}

export function sortLibrariesByConfig(libraries: tclib[], config: UserConfig): tclib[] {
  const order = new Map<string, number>();
  config.libraries.forEach((library, index) => {
    order.set(`${library.id}`, index);
  });

  return [...libraries].sort((left, right) => {
    const leftOrder = order.get(`${left.fileId}`);
    const rightOrder = order.get(`${right.fileId}`);

    if (leftOrder == null && rightOrder == null) {
      return 0;
    }
    if (leftOrder == null) {
      return 1;
    }
    if (rightOrder == null) {
      return -1;
    }
    return leftOrder - rightOrder;
  });
}