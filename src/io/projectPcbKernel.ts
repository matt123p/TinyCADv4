import wasmUrl from 'url:clipper2-wasm/dist/es/clipper2z.wasm';
import { loadPolygonKernel } from '../pcb/polygonKernel';
import type { PolygonKernel } from '../pcb/polygonKernel';

let kernel: Promise<PolygonKernel> | undefined;

export function projectPcbKernel(): Promise<PolygonKernel> {
  kernel ??= fetch(wasmUrl)
    .then((response) => {
      if (!response.ok)
        throw new Error('Could not load the PCB geometry engine.');
      return response.arrayBuffer();
    })
    .then(loadPolygonKernel)
    .catch((error) => {
      kernel = undefined;
      throw error;
    });
  return kernel;
}
