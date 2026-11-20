import type { Database } from 'sql.js';
import type { BoardModelAsset } from './boardAssets';
import { createBoardModelAsset } from './boardCodec';
import { readLibraryDeviceCatalogue } from './deviceLibrary';
import type { LibraryDevice } from './deviceLibrary';
import { decodeFootprintLibrary } from './footprintLibrary';
import type { FootprintLibrary } from './footprintLibrary';

type AssetReference = Omit<BoardModelAsset, 'base64'>;

export interface StarterEntry {
  id: string;
  family: string;
  footprint: Omit<FootprintLibrary, 'assets'> & {
    assets: readonly AssetReference[];
  };
  bodyNm: readonly [number, number, number];
  assemblyProcess: string;
  documentation?: {
    package: string;
    pinout: string;
    partNumber: string;
    sourceRevision: string;
    pinoutByPad: Record<string, string>;
    mechanicalPads?: readonly string[];
  };
}

export function readStarterFootprints(db: Database): StarterEntry[] {
  const version = db.exec('PRAGMA user_version')[0]?.values[0][0];
  if (version !== 1) throw new Error('Unsupported bundled PCB catalogue.');
  return (
    db.exec('SELECT entry FROM Footprint ORDER BY id')[0]?.values ?? []
  ).map(([entry]) => JSON.parse(String(entry)) as StarterEntry);
}

async function readModels(db: Database, references: readonly AssetReference[]) {
  return Promise.all(
    references.map(async ({ id, source, license }) => {
      const bytes = db.exec('SELECT bytes FROM Model WHERE id = ?', [id])[0]
        ?.values[0][0];
      if (!(bytes instanceof Uint8Array))
        throw new Error(`Missing bundled STEP asset ${id}.`);
      const model = await createBoardModelAsset(bytes, source, license);
      if (model.id !== id)
        throw new Error(`Bundled STEP asset ${id} failed validation.`);
      return model;
    }),
  );
}

export async function readStarterFootprint(db: Database, entry: StarterEntry) {
  const { footprint } = entry;
  const assets = await readModels(db, footprint.assets);
  return decodeFootprintLibrary(
    new TextEncoder().encode(JSON.stringify({ ...footprint, assets })),
  );
}

export async function readStarterDevices(db: Database) {
  const entries = new Map(
    readStarterFootprints(db).map((entry) => [entry.id, entry]),
  );
  const rows =
    db.exec(
      'SELECT footprint_id, definition FROM Device ORDER BY footprint_id',
    )[0]?.values ?? [];
  const devices = await Promise.all(
    rows.map(async ([id, data]) => {
      const { footprint } = entries.get(String(id));
      const device: Omit<LibraryDevice, 'footprint' | 'models'> = JSON.parse(
        String(data),
      );
      return {
        ...device,
        footprint: footprint.definition,
        models: await readModels(db, footprint.assets),
      };
    }),
  );
  return readLibraryDeviceCatalogue({ version: 1, devices });
}
