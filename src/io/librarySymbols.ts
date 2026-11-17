import { tclib, tclibLibraryEntry } from '../model/tclib';
import { actionSelectLibrarySymbol } from '../state/dispatcher/AppDispatcher';
import { XMLBuilder } from '../util/xmlbuilder';
import { ioXML } from './ioXml';

/** Use the same symbol data and attributes for panel and menu placement. */
export function librarySymbolSelection(
  library: tclib,
  name: tclibLibraryEntry,
  beginPlacement = false,
) {
  const symbol = library.symbols.find(
    (entry) => entry.SymbolId === name.SymbolID,
  );
  if (!symbol) throw new Error(`Symbol data is missing for ${name.Name}.`);
  const builder = new XMLBuilder();
  builder.fromText(symbol.Data);
  const drawing = new ioXML().from_dsn(builder);
  const action = actionSelectLibrarySymbol(
    name,
    drawing.sheets.map((sheet) => sheet.items),
    null,
  );
  return beginPlacement ? { ...action, beginPlacement: true } : action;
}
