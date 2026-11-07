import { blankXML, ioXML } from '../io/ioXml';
import { dsnDrawing, dsnSheet } from '../model/dsnDrawing';
import { tclib, tclibLibraryEntry, tclibSymbol } from '../model/tclib';
import { XMLBuilder } from '../util/xmlbuilder';
import update from 'immutability-helper';
import { DocItemTypes } from '../model/dsnItem';
import { copyOwnerIdentity, ensureDrawingIds, newIdentity } from '../plugins/persistence';

export class updateLibrary {
  constructor(public lib: tclib) {}

  public setLib(lib: tclib) {
    this.lib = lib;
  }

  public getSymbolDoc(name: tclibLibraryEntry) {
    const editSymbol = this.lib.symbols.find(
      (s) => s.SymbolId === name.SymbolID,
    );
    const io = new ioXML();
    const xmlBuilder = new XMLBuilder();
    xmlBuilder.fromText(editSymbol.Data);
    return io.from_dsn(xmlBuilder);
  }

  public writeSymbolData(name: tclibLibraryEntry, doc: dsnDrawing) {
    const io = new ioXML();
    const editSymbolIndex = this.lib.symbols.findIndex(
      (s) => s.SymbolId === name.SymbolID,
    );

    // Remove any pins that are no longer visible in the symbol
    let maxPin = 0;
    if (doc.sheets.length === 1) {
      maxPin = name.ppp;
    }
    let sheets: dsnSheet[] = doc.sheets.map((sheet) => ({
      ...sheet,
      items: sheet.items.filter(
        (item) =>
          (item.NodeName == DocItemTypes.Pin && item.part <= maxPin) ||
          item.NodeName !== DocItemTypes.Pin,
      ),
    }));

    let xml = io.to_dsn({ ...doc, sheets: sheets }, false, false).tostring();
    // Keep a single XML root: document-level plugin data and identity must survive.

    return update(this.lib, {
      symbols: {
        [editSymbolIndex]: {
          Data: {
            $set: xml,
          },
        },
      },
    });
  }

  public deleteLibrarySymbol(nameId: number) {
    const nameIndex = this.lib.names.findIndex((s) => s.NameID === nameId);
    return update(this.lib, {
      names: {
        $splice: [[nameIndex, 1]],
      },
    });
  }

  public duplicateLibrarySymbol(nameId: number) {
    const nameIndex = this.lib.names.findIndex((s) => s.NameID === nameId);
    const name = this.lib.names[nameIndex];
    const symbol = this.lib.symbols.find((s) => s.SymbolId === name.SymbolID);

    const newNameId =
      this.lib.names.reduce((id, n) => Math.max(n.NameID, id), 0) + 1;
    const newSymbolId =
      this.lib.symbols.reduce((id, s) => Math.max(s.SymbolId, id), 0) + 1;

    const newName: tclibLibraryEntry = {
      ...copyOwnerIdentity(name),
      NameID: newNameId,
      Name: name.Name + '_copy',
      SymbolID: newSymbolId,
    };
    const newSymbol: tclibSymbol = {
      ...copyOwnerIdentity(symbol),
      SymbolId: newSymbolId,
    };
    const copied = this.getSymbolDoc(name);
    const fresh = { ...copied, persistentId: newIdentity(), sheets: copied.sheets.map(sheet => ({ ...sheet, persistentId: newIdentity(), items: sheet.items.map(item => ({ ...item, persistentId: newIdentity() })) })) };
    newSymbol.Data = new ioXML().to_dsn(ensureDrawingIds(fresh), false, false).tostring();

    return {
      name: newName,
      lib: update(this.lib, {
        names: {
          $push: [newName],
        },
        symbols: {
          $push: [newSymbol],
        },
      }),
    };
  }

  public addNewLibrarySymbol() {
    const nameId =
      this.lib.names.reduce((id, n) => Math.max(n.NameID, id), 0) + 1;
    const symbolId =
      this.lib.symbols.reduce((id, s) => Math.max(s.SymbolId, id), 0) + 1;
    const name: tclibLibraryEntry = {
      NameID: nameId,
      Name: 'New Symbol',
      SymbolID: symbolId,
      Reference: 'U?',
      ppp: 1,
      Description: 'New Symbol',
      ShowName: 1,
      ShowRef: 1,
      Attributes: [
        {
          AttName: 'Package',
          AttValue: '',
          ShowAtt: 1,
        },
      ],
    };
    const symbol = {
      SymbolId: symbolId,
      Data: blankXML(),
    };
    return update(this.lib, {
      names: {
        $push: [name],
      },
      symbols: {
        $push: [symbol],
      },
    });
  }
}
