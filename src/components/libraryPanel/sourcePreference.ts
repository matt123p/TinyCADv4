export type LibrarySource = 'standard' | 'online' | 'personal';

const LIBRARY_SOURCE_STORAGE_KEY = 'tinycad.librarySource';

export function loadLibrarySource(): LibrarySource {
  try {
    const value = window.localStorage?.getItem(LIBRARY_SOURCE_STORAGE_KEY);
    return value === 'online' || value === 'personal' ? value : 'standard';
  } catch {
    return 'standard';
  }
}

export function saveLibrarySource(source: LibrarySource): void {
  try {
    window.localStorage?.setItem(LIBRARY_SOURCE_STORAGE_KEY, source);
  } catch {
    // The selected source remains usable when preference storage is unavailable.
  }
}
