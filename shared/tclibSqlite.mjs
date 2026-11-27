import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function readTclib(file) {
  const db = new DatabaseSync(resolve(file), { readOnly: true });
  try {
    db.exec('PRAGMA trusted_schema = OFF; BEGIN');
    const names = [];
    const symbols = new Map();
    const decoder = new TextDecoder();
    const symbolData = db.prepare('SELECT [Data] FROM [Symbol] WHERE [SymbolID] = ?');
    const attributes = db.prepare(
      'SELECT [AttName], [AttValue], [ShowAtt] FROM [Attribute] WHERE [NameID] = ?',
    );
    const components = db.prepare(`
      SELECT [NameID], [Name], [SymbolID], [Reference], [ppp], [Description],
             [ShowName], [ShowRef] FROM [Name] WHERE [Type] = 0
    `);
    for (const row of components.iterate()) {
      const nameId = Number(row.NameID);
      const symbolId = Number(row.SymbolID);
      names.push({
        id: null,
        NameID: nameId,
        Name: row.Name.toString(),
        SymbolID: symbolId,
        Reference: row.Reference.toString(),
        ppp: Number(row.ppp),
        Description: row.Description.toString(),
        ShowName: Number(row.ShowName),
        ShowRef: Number(row.ShowRef),
        Attributes: attributes.all(nameId).map((attribute) => ({
          AttName: attribute.AttName.toString(),
          AttValue: attribute.AttValue.toString(),
          ShowAtt: Number(attribute.ShowAtt),
        })),
      });
      if (!symbols.has(symbolId)) {
        const data = symbolData.get(row.SymbolID)?.Data;
        if (!(data instanceof Uint8Array))
          throw new Error(`Invalid artwork for library symbol ${symbolId}.`);
        symbols.set(symbolId, { SymbolId: symbolId, Data: decoder.decode(data) });
      }
    }
    return { names, symbols: [...symbols.values()] };
  } finally {
    db.close();
  }
}
