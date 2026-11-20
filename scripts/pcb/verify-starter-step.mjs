import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [destination, readerModule] = process.argv.slice(2);
if (!destination)
  throw new Error(
    'Pass the generated catalogue directory and optionally the occt-import-js module path.',
  );

const { default: loadReader } = await import(
  readerModule
    ? pathToFileURL(path.resolve(readerModule)).href
    : 'occt-import-js'
);
const reader = await loadReader();
const index = JSON.parse(
  await readFile(path.join(destination, 'index.json'), 'utf8'),
);
const nm = (mm) => Math.round(mm * 1_000_000);
const within = (actual, expected) => Math.abs(actual - expected) <= 5;
for (const entry of index.variants) {
  const native = JSON.parse(
    await readFile(path.join(destination, entry.footprint), 'utf8'),
  );
  const model = reader.ReadStepFile(
    await readFile(path.join(destination, entry.step)),
    { linearUnit: 'millimeter' },
  );
  assert.equal(model.success, true, entry.step);
  const terminals = native.definition.pads.filter(
    ({ stack }) => stack.drill?.plated !== false,
  );
  assert.equal(model.meshes.length, terminals.length + 1, entry.step);
  const remaining = model.meshes.map((mesh) => {
    const coords = mesh.attributes.position.array;
    const bounds = [
      [Infinity, -Infinity],
      [Infinity, -Infinity],
      [Infinity, -Infinity],
    ];
    for (let i = 0; i < coords.length; i++) {
      const axis = bounds[i % 3];
      axis[0] = Math.min(axis[0], coords[i]);
      axis[1] = Math.max(axis[1], coords[i]);
    }
    for (const [low, high] of bounds) assert(high > low, entry.step);
    assert(mesh.index.array.length >= 36, entry.step);
    return bounds;
  });
  // The generator writes one solid per terminal, centred at the authored pad datum.
  for (const pad of terminals) {
    const match = remaining.findIndex(
      ([x, y, z]) =>
        within(nm((x[0] + x[1]) / 2), pad.positionNm.x) &&
        within(nm((y[0] + y[1]) / 2), pad.positionNm.y) &&
        (pad.stack.drill ? z[0] < 0 : within(nm(z[0]), 0)),
    );
    assert.notEqual(match, -1, entry.step + ' pad ' + pad.label);
    remaining.splice(match, 1);
  }
  assert.equal(remaining.length, 1, entry.step);
}
console.log(
  `Verified ${index.variants.length} STEP models and terminal locations with OpenCascade.`,
);
