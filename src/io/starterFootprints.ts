import catalogueUrl from 'url:../../bundled-footprints/starter-v1.json.gz';
import type { FootprintLibrary } from '../pcb/footprintLibrary';
import { decodeFootprintLibrary } from '../pcb/footprintLibrary';

interface StarterEntry {
  id: string;
  family: string;
  footprint: FootprintLibrary;
  bodyNm: readonly [number, number, number];
  assemblyProcess: string;
  documentation?: {
    package: string;
    pinout: string;
    partNumber: string;
    sourceRevision: string;
    pinoutByPad: Record<string, string>;
  };
}

let catalogue: Promise<StarterEntry[]>;

export function starterFootprints(): Promise<StarterEntry[]> {
  catalogue ??= fetch(catalogueUrl)
    .then(async (response) => {
      if (!response.ok || !response.body)
        throw new Error('The bundled footprint catalogue could not be loaded.');
      const decoded = response.body.pipeThrough(
        new DecompressionStream('gzip'),
      );
      const manifest = await new Response(decoded).json();
      if (manifest.version !== 1 || !Array.isArray(manifest.variants))
        throw new Error('Unsupported bundled footprint catalogue.');
      return manifest.variants as StarterEntry[];
    })
    .catch((error) => {
      catalogue = undefined;
      throw error;
    });
  return catalogue;
}

export async function openStarterFootprint(entry: StarterEntry) {
  return decodeFootprintLibrary(
    new TextEncoder().encode(JSON.stringify(entry.footprint)),
  );
}
