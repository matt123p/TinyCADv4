export type SymbolSortMode = 'default' | 'az' | 'za';

const SYMBOL_SORT_STORAGE_KEY = 'tinycad.librarySortMode';

export function sortEntriesByName<T>(
  entries: T[],
  getName: (entry: T) => string,
  sortMode: SymbolSortMode,
): T[] {
  if (sortMode === 'default') {
    return entries;
  }

  const sorted = [...entries].sort((left, right) =>
    getName(left).localeCompare(getName(right), undefined, {
      sensitivity: 'base',
      numeric: true,
    }),
  );

  return sortMode === 'za' ? sorted.reverse() : sorted;
}

export function loadSymbolSortMode(): SymbolSortMode {
  try {
    const value = window.localStorage?.getItem(SYMBOL_SORT_STORAGE_KEY);
    return value === 'az' || value === 'za' ? value : 'default';
  } catch {
    return 'default';
  }
}

export function saveSymbolSortMode(sortMode: SymbolSortMode): void {
  try {
    window.localStorage?.setItem(SYMBOL_SORT_STORAGE_KEY, sortMode);
  } catch {
    // Ignore storage failures, the sort mode is still applied for this session
  }
}
