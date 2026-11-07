import initSqlJs from 'sql.js/dist/sql-wasm.js';
import { Database, SqlJsStatic, Statement } from 'sql.js';
import wasm from 'url:sql.js/dist/sql-wasm.wasm';
import {
  normalizeTclibLoadError,
  tclib,
  tclibLibraryAttributes,
} from '../model/tclib';
import { FileIdType } from './files';
import { newIdentity } from '../plugins/persistence';
import type { ExtensionOwner } from '../plugins/types';

let loadedSQL: SqlJsStatic = null;
let loadingSQL: Promise<SqlJsStatic> = null;

function getSql(): Promise<SqlJsStatic> {
  if (loadedSQL) {
    return Promise.resolve(loadedSQL);
  }

  if (!loadingSQL) {
    loadingSQL = initSqlJs({
      locateFile: () => wasm,
    })
      .then((SQL: SqlJsStatic) => {
        loadedSQL = SQL;
        return SQL;
      })
      .catch((error) => {
        loadingSQL = null;
        throw normalizeTclibLoadError(error, 'Unable to initialize SQLite.');
      });
  }

  return loadingSQL;
}

export function loadTcLibrary(
  fileId: FileIdType,
  name: string,
  modified: string,
  ab: ArrayBuffer,
): Promise<tclib> {
  return getSql().then((SQL) =>
    loadTcLibImplementation(SQL, fileId, name, modified, ab),
  );
}

function loadTcLibImplementation(
  SQL: SqlJsStatic,
  fileId: FileIdType,
  name: string,
  modified: string,
  ab: ArrayBuffer,
): Promise<tclib> {
  return new Promise((resolve, reject) => {
    const r: tclib = {
      fileId: fileId,
      modified: modified,
      name: name,
      names: [],
      symbols: [],
      persistentId: newIdentity(),
    };

    let db: Database;
    let stmt: Statement;
    let stmtData: Statement;
    try {
      db = new SQL.Database(new Uint8Array(ab));

      // Here are the  table in a TC library:
      // Symbol
      // Attribute
      // Name

      // Prepare a statement
      stmt = db.prepare(
        'SELECT [NameID], [Name], [SymbolID], [Reference], [ppp], [Description], [ShowName], [ShowRef] FROM [Name] WHERE [Type]=0',
      );

      stmtData = db.prepare('SELECT [Data] FROM [Symbol] WHERE [SymbolId]=$id');

      // Bind new values
      while (stmt.step()) {
        // Add the symbol name
        const row = stmt.getAsObject();

        const stmtAttr = db.prepare(
          'SELECT [AttName], [AttValue], [ShowAtt] FROM [Attribute] WHERE [NameID]=$id',
        );
        stmtAttr.bind({ $id: Number(row.NameID) });
        const attributes: tclibLibraryAttributes[] = [];
        while (stmtAttr.step()) {
          const a = stmtAttr.getAsObject();
          attributes.push({
            AttName: a.AttName.toString(),
            AttValue: a.AttValue.toString(),
            ShowAtt: Number(a.ShowAtt),
          });
        }
        stmtAttr.free();

        r.names.push({
          persistentId: newIdentity(),
          id: null,
          NameID: Number(row.NameID),
          Name: row.Name.toString(),
          SymbolID: Number(row.SymbolID),
          Reference: row.Reference.toString(),
          ppp: Number(row.ppp),
          Description: row.Description.toString(),
          ShowName: Number(row.ShowName),
          ShowRef: Number(row.ShowRef),
          Attributes: attributes,
        });

        // Add the symbol data (if we don't already have it)
        if (
          r.symbols.findIndex((d) => d.SymbolId === Number(row.SymbolID)) === -1
        ) {
          const data = stmtData.getAsObject({ $id: row.SymbolID })
            .Data as Uint8Array;
          r.symbols.push({
            persistentId: newIdentity(),
            SymbolId: Number(row.SymbolID),
            Data: new TextDecoder('utf-8').decode(data),
          });
        }
      }
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='TinyCADPluginData'");
      if (tables.length) {
        const rows = db.exec('SELECT Scope, Target, Data FROM TinyCADPluginData');
        for (const row of rows[0]?.values || []) {
          const [scope, target, data] = row.map(String);
          const owner = scope === 'library' ? r : scope === 'name' ? r.names.find(n => String(n.NameID) === target) : scope === 'definition' ? r.symbols.find(s => String(s.SymbolId) === target) : undefined;
          if (owner) {
            const extension = JSON.parse(data);
            if (!extension || typeof extension !== 'object') throw new Error('Invalid library plugin metadata.');
            owner.persistentId = extension.persistentId || owner.persistentId;
            owner.pluginData = extension.pluginData; owner.pluginDataXml = extension.pluginDataXml;
          } else (r.pluginRows ||= []).push({ scope, target, data });
        }
      }
    } catch (e) {
      reject(normalizeTclibLoadError(e));
      return;
    } finally {
      if (stmt) {
        stmt.free();
      }
      if (stmtData) {
        stmtData.free();
      }
      if (db) {
        db.close();
      }
    }

    resolve(r);
  });
}

export function saveTcLibrary(library: tclib): Promise<ArrayBuffer> {
  return getSql().then(() => saveTcLibImplementation(library));
}

function saveTcLibImplementation(library: tclib): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    let db: Database;
    db = new loadedSQL.Database();

    // Create the tables
    db.exec(`CREATE TABLE [Name] (
        [NameID] INTEGER PRIMARY KEY,
        [Name] TEXT,
        [SymbolID] INTEGER,
        [Type] INTEGER,
        [Reference] TEXT,
        [ppp] INTEGER,
        [Description] TEXT,
        [ShowName] INTEGER,
        [ShowRef] INTEGER,
        [DefRotate] INTEGER
      )`);
    db.exec(`CREATE TABLE [Attribute] (
        [NameID] INTEGER,
        [AttName] TEXT,
        [AttValue] TEXT,
        [ShowAtt] INTEGER
      )`);
    db.exec(`CREATE TABLE [Symbol] (
        [SymbolID] INTEGER PRIMARY KEY,
        [Data] BLOB
      )`);
    db.exec('CREATE TABLE TinyCADPluginData (Scope TEXT NOT NULL, Target TEXT NOT NULL, Data TEXT NOT NULL, PRIMARY KEY (Scope, Target))');
    const pluginStatement = db.prepare('INSERT INTO TinyCADPluginData (Scope, Target, Data) VALUES (?, ?, ?)');
    const writeOwner = (scope: string, target: string, owner: ExtensionOwner) => {
      pluginStatement.run([scope, target, JSON.stringify({ persistentId: owner.persistentId || newIdentity(), pluginData: owner.pluginData, pluginDataXml: owner.pluginDataXml })]);
    };
    writeOwner('library', '', library);
    for (const name of library.names) writeOwner('name', String(name.NameID), name);
    for (const symbol of library.symbols) writeOwner('definition', String(symbol.SymbolId), symbol);
    for (const row of library.pluginRows || []) pluginStatement.run([row.scope, row.target, row.data]);
    pluginStatement.free();

    // Write the data from library in to the database tables
    const stmtNames = db.prepare(
      'INSERT INTO [Name] ([NameID], [Name], [SymbolID], [Reference], [ppp], [Description], [ShowName], [ShowRef], [Type], [DefRotate]) VALUES ($id, $name, $symbol, $reference, $ppp, $description, $showname, $showref, $type, $defrotate)',
    );
    const stmtSymbols = db.prepare(
      'INSERT INTO [Symbol] ([SymbolID], [Data]) VALUES ($id, $data)',
    );
    const stmtAttributes = db.prepare(
      'INSERT INTO [Attribute] ([NameID], [AttName], [AttValue], [ShowAtt]) VALUES ($id, $attname, $attvalue, $showatt)',
    );

    // Write the symbol data from the library in to the database symbol table
    library.symbols.forEach((s) => {
      stmtSymbols.run({
        $id: s.SymbolId,
        $data: new Uint8Array(new TextEncoder().encode(s.Data)),
      });
    });

    // Write the names from the library in to the database name table
    library.names.forEach((n) => {
      stmtNames.run({
        $id: n.NameID,
        $name: n.Name,
        $symbol: n.SymbolID,
        $reference: n.Reference,
        $ppp: n.ppp,
        $description: n.Description,
        $showname: n.ShowName,
        $showref: n.ShowRef,
        $type: 0,
        $defrotate: 3,
      });

      // Write the attributes from the library in to the database attribute table
      n.Attributes.forEach((a) => {
        stmtAttributes.run({
          $id: n.NameID,
          $attname: a.AttName,
          $attvalue: a.AttValue,
          $showatt: a.ShowAtt,
        });
        stmtNames;
      });
    });

    // Free the prepared statements
    stmtNames.free();
    stmtSymbols.free();
    stmtAttributes.free();

    // Get the database as a blob
    const ab = db.export();
    db.close();

    // Return the database as an ArrayBuffer
    // We slice the buffer here to ensure we only return the data we need
    // and not the underlying buffer which could be larger (e.g. WASM heap)
    const buffer = ab.buffer.slice(
      ab.byteOffset,
      ab.byteOffset + ab.byteLength,
    ) as ArrayBuffer;
    resolve(buffer);
  });
}
