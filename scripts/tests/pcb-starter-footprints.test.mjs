import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const generator = fileURLToPath(
  new URL('../pcb/generate-starter-footprints.py', import.meta.url),
);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

test('the starter generator reproduces native footprints with embedded STEP bytes', async (t) => {
  const first = await mkdtemp(path.join(tmpdir(), 'tinycad-starter-a-'));
  const second = await mkdtemp(path.join(tmpdir(), 'tinycad-starter-b-'));
  t.after(() =>
    Promise.all(
      [first, second].map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    ),
  );
  for (const output of [first, second])
    execFileSync('python3', [
      generator,
      output,
      '--bundle',
      path.join(output, 'bundle.json.gz'),
    ]);
  const names = (await readdir(first)).sort();
  assert.deepEqual(names, (await readdir(second)).sort());
  for (const name of names)
    assert.deepEqual(
      await readFile(path.join(first, name)),
      await readFile(path.join(second, name)),
      name,
    );
  const index = JSON.parse(
    await readFile(path.join(first, 'index.json'), 'utf8'),
  );
  const bundled = await readFile(
    new URL('../../bundled-footprints/starter-v1.json.gz', import.meta.url),
  );
  assert.deepEqual(
    gunzipSync(bundled),
    gunzipSync(await readFile(path.join(first, 'bundle.json.gz'))),
  );
  const entries = JSON.parse(gunzipSync(bundled));
  assert.deepEqual(
    entries.variants.map(({ id }) => id),
    index.variants.map(({ id }) => id),
  );

  const families = new Set(index.variants.map(({ family }) => family));
  assert(index.variants.length >= 100);
  for (const family of [
    'axial',
    'axial-diode',
    'chip-led',
    'chip-passive',
    'dip',
    'film-capacitor',
    'header',
    'radial',
    'radial-electrolytic',
    'radial-inductor',
    'radial-led',
    'smd-diode',
    'smd-electrolytic',
    'smd-inductor',
    'smd-transformer',
    'smd-transistor',
    'soic',
    'terminal-block',
    'tht-transformer',
    'tht-transistor',
  ])
    assert(families.has(family), family);
  const sourced = entries.variants.find(({ id }) => id === 'ti-lm358dr-d0008a');
  assert.equal(sourced?.documentation.partNumber, 'LM358DR');
  assert.equal(sourced?.documentation.pinoutByPad['8'], 'V+');
  const tiLand =
    sourced?.footprint.definition.pads[0].stack.copper.top.vertices;
  assert.equal(
    Math.max(...tiLand.map(({ x }) => x)) -
      Math.min(...tiLand.map(({ x }) => x)),
    1_550_000,
  );
  assert.equal(
    Math.max(...tiLand.map(({ y }) => y)) -
      Math.min(...tiLand.map(({ y }) => y)),
    600_000,
  );
  assert(tiLand.length > 4);
  const api = await layoutRuntime();
  const reviews = path.join(first, 'reviews');
  const reviewedOutput = path.join(first, 'reviewed.json');
  await mkdir(reviews);
  const approved = await api.publishFootprintDevice(sourced.footprint, {
    widthNm: sourced.bodyNm[0],
    heightNm: sourced.bodyNm[1],
    packageName: 'LM358DR fixture',
    license: 'CC0-1.0',
    reviewer: 'Integration test',
    evidence: 'Fixture review covering the assembly of a generated catalogue',
    mappings: new Map(
      sourced.footprint.definition.pads.map(({ id, label }) => [
        id,
        { kind: 'signal', terminal: sourced.documentation.pinoutByPad[label] },
      ]),
    ),
  });
  const record = path.join(reviews, 'fixture.tcdevice.json');
  await writeFile(record, approved);
  execFileSync('python3', [
    generator,
    first,
    '--reviewed-devices',
    reviews,
    '--reviewed-bundle',
    reviewedOutput,
  ]);
  const reviewedBundle = JSON.parse(await readFile(reviewedOutput, 'utf8'));
  assert.equal(reviewedBundle.devices.length, 1);
  const device = await api.readLibraryDevice(
    new TextEncoder().encode(JSON.stringify(reviewedBundle.devices[0])),
  );
  assert.equal(device.definition.review.by, 'Integration test');
  assert.equal(
    device.definition.footprint.definitionDigest,
    sourced.footprint.definition.definitionDigest,
  );
  const altered = {
    ...reviewedBundle.devices[0],
    footprint: { ...device.definition.footprint, revision: 'wrong' },
  };
  await writeFile(record, JSON.stringify(altered));
  assert.throws(
    () =>
      execFileSync(
        'python3',
        [
          generator,
          first,
          '--reviewed-devices',
          reviews,
          '--reviewed-bundle',
          reviewedOutput,
        ],
        { stdio: 'pipe' },
      ),
    /does not match an exact generated footprint revision/,
  );

  const partId = crypto.randomUUID();
  const unitId = crypto.randomUUID();
  const circuit = {
    schemaVersion: 1,
    snapshotId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    nets: [],
    noConnects: [],
    components: [
      {
        id: partId,
        reference: 'U1',
        role: 'electrical',
        value: 'LM358DR',
        units: [{ id: unitId, sheetId: crypto.randomUUID() }],
        signals: device.definition.terminals.map(({ name }) => ({
          id: crypto.randomUUID(),
          name,
          terminals: [{ unitId, pinId: crypto.randomUUID() }],
        })),
      },
    ],
  };
  const selectedDevices = new Map([
    [
      partId,
      {
        revision: device,
        bindings: device.definition.terminals.map(
          ({ id: terminalId }, index) => ({
            terminalId,
            signalId: circuit.components[0].signals[index].id,
          }),
        ),
      },
    ],
  ]);
  const blank = api.createBoard('Catalogue fixture', 2, [
    { x: 0, y: 0 },
    { x: 20_000_000, y: 0 },
    { x: 20_000_000, y: 20_000_000 },
    { x: 0, y: 20_000_000 },
  ]);
  const transfer = await api.previewCircuitEco(blank, undefined, circuit, {
    selectedDevices,
  });
  const placed = await api.placeUnplacedComponent(
    api.applyCircuitEco(blank, transfer),
    partId,
    {
      positionNm: { x: 11_000_000, y: 9_000_000 },
      rotationMicrodegree: 90_000_000,
      side: 'bottom',
    },
  );
  const boardData = await api.encodeBoard(placed);

  for (const entry of index.variants) {
    const filename = path.join(first, entry.footprint);
    const footprint = await api.decodeFootprintLibrary(
      await readFile(filename),
    );
    const step = await readFile(path.join(first, entry.step));
    assert.equal(footprint.definition.pads.length, entry.pinCount);
    assert.equal(footprint.definition.models[0].quality, 'generated-envelope');
    assert.equal(footprint.definition.models[0].assetId, sha256(step));
    assert.equal(entry.stepSha256, sha256(step));
    assert.equal(entry.status, 'unreviewed');
    assert.deepEqual(
      Buffer.from(await api.readBoardModelAsset(footprint.assets[0])),
      step,
    );
  }
  await rm(first, { recursive: true, force: true });
  const offline = await api.decodeBoard(boardData);
  assert.deepEqual(offline.footprints, placed.footprints);
  assert.deepEqual(
    offline.deviceDefinitions[0].assignments,
    placed.deviceDefinitions[0].assignments,
  );
  const sourceHash = device.definition.footprint.models[0].assetId;
  assert.equal(
    sha256(await api.readBoardModelAsset(offline.modelAssets[0])),
    sourceHash,
  );
});
