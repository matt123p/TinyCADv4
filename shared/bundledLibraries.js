/** @typedef {{ id: string, name: string, path: string, description?: string }} BundledLibraryEntry */
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
      entry.description !== undefined &&
      typeof entry.description !== 'string'
    ) {
      throw new Error(`Invalid description for bundled library: ${entry.id}`);
    }
    return {
      id: entry.id,
      name: entry.name.trim(),
      path: file,
      description: entry.description,
    };
  });
  return { version: 1, libraries };
}
