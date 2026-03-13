import { SymbolImporter } from './importer';
import { parseKicadSym } from './kicadSymParser';
import { convertKicadLibrary } from './kicadToTinyCAD';

export const kicadImporter: SymbolImporter = {
  id: 'kicad',
  title: 'KiCad Symbols',
  supports(fileName: string) {
    return fileName.toLowerCase().endsWith('.kicad_sym');
  },
  async importSymbols(sourceText: string) {
    const parsed = parseKicadSym(sourceText);
    return convertKicadLibrary(parsed);
  },
};
