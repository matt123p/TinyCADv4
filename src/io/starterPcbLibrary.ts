import catalogueUrl from 'url:../../bundled-footprints/starter-v1.tplib';
import type { Database } from 'sql.js';
import { getSql } from './tclib';

let database: Promise<Database>;

export function starterPcbLibrary(): Promise<Database> {
  database ??= Promise.all([getSql(), fetch(catalogueUrl)])
    .then(async ([SQL, response]) => {
      if (!response.ok)
        throw new Error('The bundled PCB catalogue could not be loaded.');
      return new SQL.Database(new Uint8Array(await response.arrayBuffer()));
    })
    .catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}
