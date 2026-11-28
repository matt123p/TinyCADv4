import { docStore } from '../state/stores/docStoreReducer';
import { TextDisplayMethod, tclib, tclibLibraryEntry } from '../model/tclib';
import { updateLibrary } from '../manipulators/updateLibrary';
import { XMLBuilder } from '../util/xmlbuilder';
import { ioXML } from '../io/ioXml';

export interface StoredComponent {
  componentId: string;
  name: string;
  reference?: string;
  description?: string;
  definition?: string;
  source?: any;
  attributes?: { name: string; value: string }[];
  pins?: unknown[];
}
export function librarySummary(state: docStore) {
  return {
    name: state.editLibrary?.name,
    activeNameId: state.editSymbol?.NameID,
    components:
      state.editLibrary?.names.map((entry) => ({
        nameId: entry.NameID,
        symbolId: entry.SymbolID,
        name: entry.Name,
        reference: entry.Reference,
        description: entry.Description,
        partsPerPackage: entry.ppp,
        attributes: entry.Attributes,
      })) || [],
  };
}
export function prepareLibraryAddition(
  state: docStore,
  components: StoredComponent[],
) {
  if (!state.editLibrary)
    throw new Error('Open a library to add reusable components.');
  let library: tclib = state.editSymbol
    ? new updateLibrary(state.editLibrary).writeSymbolData(
        state.editSymbol,
        state.drawing,
      )
    : state.editLibrary;
  let nameId = Math.max(0, ...library.names.map((entry) => entry.NameID));
  let symbolId = Math.max(0, ...library.symbols.map((entry) => entry.SymbolId));
  const names = [...library.names],
    symbols = [...library.symbols];
  const added: tclibLibraryEntry[] = [];
  for (const component of components) {
    if (
      !component.name.trim() ||
      names.some(
        (entry) => entry.Name.toLowerCase() === component.name.toLowerCase(),
      )
    )
      throw new Error(
        `Component name already exists or is blank: ${component.name}. Use a distinct name.`,
      );
    const entry: tclibLibraryEntry = {
      NameID: ++nameId,
      SymbolID: ++symbolId,
      Name: component.name,
      Reference: component.reference || 'U?',
      Description: component.description || '',
      ppp: 1,
      ShowName: 0,
      ShowRef: 0,
      Attributes: (component.attributes || []).map((attribute) => ({
        AttName: attribute.name,
        AttValue: attribute.value,
        ShowAtt: attribute.name.startsWith('$$') ? TextDisplayMethod.NeverShow : TextDisplayMethod.HideValue,
      })),
    };
    names.push(entry);
    symbols.push({ SymbolId: symbolId, Data: component.definition });
    added.push(entry);
  }
  library = { ...library, names, symbols };
  const xml = new XMLBuilder();
  xml.fromText(components[components.length - 1].definition);
  const drawing = new ioXML().from_dsn(xml);
  return { library, symbol: added[added.length - 1], drawing, added };
}
