import catalogueUrl from 'url:../../bundled-footprints/reviewed-v1.json';
import { readLibraryDeviceCatalogue } from '../pcb/deviceLibrary';
import type { DeviceRevision } from '../pcb/deviceLibrary';

let reviewed: Promise<DeviceRevision[]>;

export function starterReviewedDevices(): Promise<DeviceRevision[]> {
  reviewed ??= fetch(catalogueUrl)
    .then(async (response) => {
      if (!response.ok)
        throw new Error('The bundled device catalogue could not be loaded.');
      return readLibraryDeviceCatalogue(await response.json());
    })
    .catch((error) => {
      reviewed = undefined;
      throw error;
    });
  return reviewed;
}
