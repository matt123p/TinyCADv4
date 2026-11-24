import { SymbolImporter } from './importer';
import { parseKicadSym } from './kicadSymParser';
import { convertKicadLibrary } from './kicadToTinyCAD';

export const kicadImporter: SymbolImporter = {
  id: 'kicad',
  title: 'KiCad Symbols',
  supports(fileName: string) {
    return fileName.toLowerCase().endsWith('.kicad_sym');
  },
  async importSymbols(sourceText, _sourceName, modelFiles = []) {
    const parsed = parseKicadSym(sourceText);
    const companions = new Map<string, string>();
    for (const { fileName, content } of modelFiles) {
      const key = fileName.toLowerCase();
      if (companions.has(key) && companions.get(key) !== content)
        throw new Error('More than one SPICE file was supplied as ' + fileName + '.');
      companions.set(key, content);
    }
    return convertKicadLibrary(parsed, companions);
  },
};
