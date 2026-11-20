import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [destination, readerModule, cataloguePath] = process.argv.slice(2);
if (!destination)
  throw new Error(
    'Pass the generated catalogue directory, optional occt-import-js module path and optional source catalogue path.',
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
const catalogue = JSON.parse(
  await readFile(
    cataloguePath ?? new URL('./starter-footprints.json', import.meta.url),
    'utf8',
  ),
);
const recipes = new Map(
  catalogue.variants.map((recipe) => [recipe.id, recipe]),
);
const nm = (mm) => Math.round(mm * 1_000_000);
const within = (actual, expected) => Math.abs(actual - expected) <= 5;
function matchesBounds([x, y, z], center, size, baseZ) {
  return (
    within(nm((x[0] + x[1]) / 2), center.x) &&
    within(nm((y[0] + y[1]) / 2), center.y) &&
    within(nm(x[1] - x[0]), size[0]) &&
    within(nm(y[1] - y[0]), size[1]) &&
    within(nm(z[0]), baseZ) &&
    within(nm(z[1] - z[0]), size[2])
  );
}
for (const entry of index.variants) {
  const recipe = recipes.get(entry.id);
  assert(recipe, 'Missing source dimensions for ' + entry.id);
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
  const { envelopeNm, standoffNm } = recipe.body;
  const body = remaining.findIndex((bounds) =>
    matchesBounds(bounds, { x: 0, y: 0 }, envelopeNm, standoffNm),
  );
  assert.notEqual(body, -1, entry.step + ' body dimensions or datum');
  remaining.splice(body, 1);
  const { crossSectionNm, protrusionNm } = recipe.lead;
  const leadSize = [
    ...crossSectionNm,
    standoffNm + Math.floor(envelopeNm[2] / 2) + protrusionNm,
  ];
  // Match each terminal to its native pad datum independently of STEP solid order.
  for (const pad of terminals) {
    const match = remaining.findIndex((bounds) =>
      matchesBounds(bounds, pad.positionNm, leadSize, -protrusionNm),
    );
    assert.notEqual(match, -1, entry.step + ' pad ' + pad.label);
    remaining.splice(match, 1);
  }
  assert.equal(remaining.length, 0, entry.step);
}
console.log(
  `Verified ${index.variants.length} STEP models, body dimensions and terminal positions with OpenCascade.`,
);
