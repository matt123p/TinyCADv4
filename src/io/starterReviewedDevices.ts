import { readStarterDevices } from '../pcb/starterCatalogue';
import type { DeviceRevision } from '../pcb/deviceLibrary';
import { starterPcbLibrary } from './starterPcbLibrary';

let reviewed: Promise<DeviceRevision[]>;

export function starterReviewedDevices(): Promise<DeviceRevision[]> {
  reviewed ??= starterPcbLibrary()
    .then(readStarterDevices)
    .catch((error) => {
      reviewed = undefined;
      throw error;
    });
  return reviewed;
}
