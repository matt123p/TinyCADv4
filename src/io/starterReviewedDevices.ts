import catalogueUrl from 'url:../../bundled-footprints/reviewed-v1.json';
import { readLibraryDevice } from '../pcb/deviceLibrary';
import type { DeviceRevision } from '../pcb/deviceLibrary';

let reviewed: Promise<DeviceRevision[]>;

export function starterReviewedDevices(): Promise<DeviceRevision[]> {
  reviewed ??= fetch(catalogueUrl)
    .then(async (response) => {
      if (!response.ok)
        throw new Error('The bundled device catalogue could not be loaded.');
      const bundle = await response.json();
      if (bundle.version !== 1 || !Array.isArray(bundle.devices))
        throw new Error('Unsupported bundled device catalogue.');
      const encoder = new TextEncoder();
      return Promise.all(
        bundle.devices.map((data: unknown) =>
          readLibraryDevice(encoder.encode(JSON.stringify(data))),
        ),
      );
    })
    .catch((error) => {
      reviewed = undefined;
      throw error;
    });
  return reviewed;
}
