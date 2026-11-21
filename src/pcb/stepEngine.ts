import occt from 'occt-import-js';
import wasmUrl from 'url:occt-import-js/dist/occt-import-js.wasm';
import type { StepResult } from './stepMesh';

export async function loadStepEngine() {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error('Could not load the STEP reader.');
  return occt({ wasmBinary: await response.arrayBuffer() }) as Promise<{
    ReadStepFile(
      bytes: Uint8Array,
      options: {
        linearUnit: string;
        linearDeflectionType: string;
        linearDeflection: number;
        angularDeflection: number;
      },
    ): StepResult;
  }>;
}
