import { readFileSync } from 'node:fs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

try {
  const bundle = JSON.parse(readFileSync(0, 'utf8'));
  const { readLibraryDeviceCatalogue } = await layoutRuntime();
  await readLibraryDeviceCatalogue(bundle);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
