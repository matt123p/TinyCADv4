/** @typedef {{ path: string, symbols: (string | number)[] }} BundledSymbolFolder */
/** @typedef {{ id: string, name: string, path: string, folder?: string, description?: string, symbolFolders?: BundledSymbolFolder[] }} BundledLibraryEntry */
/** @typedef {{ version: 1, libraries: BundledLibraryEntry[] }} BundledLibraryCatalog */

/** Paths are relative to the catalog directory, on every platform. */
export function validateLibraryPath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\\:%?#\u0000-\u001f]/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid bundled library path: ${value}`);
  }
  if (!value.toLowerCase().endsWith('.tclib')) {
    throw new Error(`Bundled library must be a .tclib file: ${value}`);
  }
  return value;
}

export function validateSymbolFolderPath(value) {
  if (typeof value !== 'string') throw new Error('Invalid symbol folder path.');
  const parts = value.split('/').map((part) => part.trim());
  if (
    parts.some((part) => !part || part === '.' || part === '..') ||
    /[\\\u0000-\u001f]/.test(value)
  ) {
    throw new Error('Invalid symbol folder path.');
  }
  return parts.join('/');
}

/** @param {unknown} input @returns {BundledLibraryCatalog} */
export function parseBundledLibraryCatalog(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    input.version !== 1 ||
    !Array.isArray(input.libraries)
  ) {
    throw new Error(
      'Bundled library config must contain version: 1 and a libraries array.',
    );
  }
  const ids = new Set();
  const libraries = input.libraries.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry.id) ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      ids.has(entry.id)
    ) {
      throw new Error(
        'Each bundled library needs a unique stable id and a name.',
      );
    }
    ids.add(entry.id);
    const file = validateLibraryPath(entry.path);
    if (
      entry.folder !== undefined &&
      (typeof entry.folder !== 'string' ||
        entry.folder
          .split('/')
          .some((part) => !part.trim() || part === '.' || part === '..') ||
        /[\\\u0000-\u001f]/.test(entry.folder))
    ) {
      throw new Error(`Invalid folder for bundled library: ${entry.id}`);
    }
    if (
      entry.description !== undefined &&
      typeof entry.description !== 'string'
    ) {
      throw new Error(`Invalid description for bundled library: ${entry.id}`);
    }
    let symbolFolders;
    if (entry.symbolFolders !== undefined) {
      if (!Array.isArray(entry.symbolFolders))
        throw new Error(`Invalid symbol folders: ${entry.id}`);
      const paths = new Set();
      symbolFolders = entry.symbolFolders.map((folder) => {
        if (
          !folder ||
          typeof folder !== 'object' ||
          !Array.isArray(folder.symbols) ||
          folder.symbols.some((symbol) =>
            typeof symbol === 'string'
              ? !symbol.trim()
              : !Number.isSafeInteger(symbol) || symbol < 0,
          )
        ) {
          throw new Error(`Invalid symbol folder: ${entry.id}`);
        }
        const path = validateSymbolFolderPath(folder.path);
        if (paths.has(path))
          throw new Error(`Duplicate symbol folder: ${path}`);
        paths.add(path);
        return { path, symbols: [...folder.symbols] };
      });
    }
    return {
      id: entry.id,
      name: entry.name.trim(),
      path: file,
      folder: entry.folder,
      description: entry.description,
      symbolFolders,
    };
  });
  return { version: 1, libraries };
}
