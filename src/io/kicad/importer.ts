import { DocItem } from '../../model/dsnItem';
import { tclibLibraryEntry } from '../../model/tclib';

export interface ImportedSymbol {
  name: tclibLibraryEntry;
  symbolData: DocItem[][];
}

export interface SymbolImporter {
  id: string;
  title: string;
  supports(fileName: string): boolean;
  importSymbols(sourceText: string, sourceName: string): Promise<ImportedSymbol[]>;
}

import { kicadImporter } from './kicadImporter';

const importers: SymbolImporter[] = [kicadImporter];

export function findImporter(fileName: string): SymbolImporter | null {
  return importers.find((imp) => imp.supports(fileName)) || null;
}

export function allImporters(): SymbolImporter[] {
  return [...importers];
}
