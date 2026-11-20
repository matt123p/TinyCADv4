import {
  readStarterFootprint,
  readStarterFootprints,
} from '../pcb/starterCatalogue';
import type { StarterEntry } from '../pcb/starterCatalogue';
import { starterPcbLibrary } from './starterPcbLibrary';

export async function starterFootprints(): Promise<StarterEntry[]> {
  return readStarterFootprints(await starterPcbLibrary());
}

export async function openStarterFootprint(entry: StarterEntry) {
  return readStarterFootprint(await starterPcbLibrary(), entry);
}
