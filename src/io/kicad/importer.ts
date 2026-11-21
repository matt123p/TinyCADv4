import { DocItem } from '../../model/dsnItem';
import { tclibLibraryEntry } from '../../model/tclib';

export interface ImportedSymbol {
  name: tclibLibraryEntry;
  symbolData: DocItem[][];
  spiceImportError?: string;
}

export interface ImportModelFile {
  fileName: string;
  content: string;
}

export interface SymbolImportFile extends ImportModelFile {
  modelFiles?: ImportModelFile[];
}

export interface SymbolImporter {
  id: string;
  title: string;
  supports(fileName: string): boolean;
  importSymbols(sourceText: string, sourceName: string, modelFiles?: ImportModelFile[]): Promise<ImportedSymbol[]>;
}

import { kicadImporter } from './kicadImporter';

const importers: SymbolImporter[] = [kicadImporter];

export function findImporter(fileName: string): SymbolImporter | null {
  return importers.find((imp) => imp.supports(fileName)) || null;
}

export function allImporters(): SymbolImporter[] {
  return [...importers];
}
