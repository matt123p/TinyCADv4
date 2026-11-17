import type { BundledLibraryEntry } from '../../shared/bundledLibraries';
import type { tclib, tclibLibraryEntry } from '../model/tclib';

export interface BundledSearchSource {
  initialize(): Promise<void>;
  getSnapshot(): {
    catalog: { libraries: BundledLibraryEntry[] } | null;
    error: string;
  };
  readLibrary(id: string): Promise<tclib>;
}

export async function searchBundledSymbols(
  source: BundledSearchSource,
  args: { query: string; libraryId?: string; page?: number; pageSize?: number },
  signal: AbortSignal,
) {
  const terms = args.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new Error('Provide bundled-library search terms.');
  await source.initialize();
  signal.throwIfAborted();
  const snapshot = source.getSnapshot();
  if (!snapshot.catalog)
    throw new Error(
      snapshot.error || 'Bundled library catalog is unavailable.',
    );
  const libraries = snapshot.catalog.libraries.filter(
    (entry) => !args.libraryId || entry.id === args.libraryId,
  );
  if (args.libraryId && !libraries.length)
    throw new Error(
      `Unknown bundled library: ${args.libraryId}. Use an ID from the runtime catalog.`,
    );
  const matches: {
    library: BundledLibraryEntry;
    entry: tclibLibraryEntry;
    definition: string;
    score: number;
  }[] = [];
  const errors: { libraryId: string; message: string }[] = [];
  const searchedLibraries: string[] = [];
  for (const library of libraries) {
    signal.throwIfAborted();
    try {
      const data = await source.readLibrary(library.id);
      signal.throwIfAborted();
      const symbols = new Map(
        data.symbols.map((symbol) => [symbol.SymbolId, symbol.Data]),
      );
      for (const entry of data.names) {
        const text = [
          entry.Name,
          entry.Description,
          ...entry.Attributes.flatMap((a) => [a.AttName, a.AttValue]),
        ]
          .join(' ')
          .toLowerCase();
        if (!terms.every((term) => text.includes(term))) continue;
        const definition = symbols.get(entry.SymbolID);
        if (!definition) throw new Error(`Missing artwork for ${entry.Name}.`);
        const name = entry.Name.toLowerCase();
        matches.push({
          library,
          entry,
          definition,
          score:
            name === args.query.trim().toLowerCase()
              ? 2
              : terms.every((term) => name.includes(term))
              ? 1
              : 0,
        });
      }
      searchedLibraries.push(library.id);
    } catch (error) {
      signal.throwIfAborted();
      errors.push({
        libraryId: library.id,
        message:
          error instanceof Error ? error.message : 'Unable to load library.',
      });
    }
  }
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      a.library.id.localeCompare(b.library.id) ||
      a.entry.Name.localeCompare(b.entry.Name) ||
      a.entry.NameID - b.entry.NameID,
  );
  const page = args.page ?? 1,
    pageSize = args.pageSize ?? 10;
  const offset = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    total: matches.length,
    hasMore: offset + pageSize < matches.length,
    complete: !errors.length,
    errors,
    searchedLibraries,
    matches: matches.slice(offset, offset + pageSize),
  };
}
