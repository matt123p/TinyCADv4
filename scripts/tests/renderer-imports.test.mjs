import test from 'node:test';
import assert from 'node:assert/strict';
import { literalModuleSpecifiers } from '../renderer-imports.mjs';
test('renderer checks inspect real import edges and ignore generated worker source strings', () => {
  assert.deepEqual(
    literalModuleSpecifiers(`
    import('./real.js');
    import.meta.resolve('mapped-asset');
    const worker = 'const lazy = import("\\u0024{t}")';
    const example = "import('not-an-import')";
    // import('comment')
    import(computedPath);
  `),
    ['./real.js', 'mapped-asset'],
  );
});
test('literal missing dependencies stay visible to the Electron build check', () => {
  assert.deepEqual(
    literalModuleSpecifiers('const load = () => import("unmapped-package");'),
    ['unmapped-package'],
  );
});
