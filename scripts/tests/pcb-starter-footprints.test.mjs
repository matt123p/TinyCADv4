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
const starterRecipes = new URL(
  '../pcb/starter-footprints.json',
  import.meta.url,
);

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
    'axial-inductor',
    'module-header',
    'mounting-hole',
    'test-point',
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
  const nand = entries.variants.find(({ id }) => id === 'ti-sn74hc00n-pdip14');
  assert.equal(nand.documentation.pinoutByPad['7'], 'GND');
  assert.equal(nand.documentation.pinoutByPad['14'], 'VCC');
  assert.equal(nand.rowSpacingNm, 7_620_000);
  assert.equal(nand.pitchNm, 2_540_000);
  const connector = entries.variants.find(
    ({ id }) => id === 'phoenix-1715721-mkds-508',
  );
  assert.deepEqual(
    connector.footprint.definition.pads.map(({ positionNm, stack }) => [
      positionNm,
      stack.drill.widthNm,
    ]),
    [
      [{ x: -2_540_000, y: -300_000 }, 1_300_000],
      [{ x: 2_540_000, y: -300_000 }, 1_300_000],
    ],
  );
  const api = await layoutRuntime();
  const reviews = path.join(first, 'reviews');
  const reviewedOutput = path.join(first, 'reviewed.json');
  await mkdir(reviews);
  const throughHole = entries.variants.find(
    ({ id }) => id === 'vishay-1n4148-tap-do35-762',
  );
  assert.equal(throughHole.documentation.pinoutByPad['1'], 'Cathode');
  assert.equal(
    throughHole.footprint.definition.pads[0].stack.drill.widthNm,
    900_000,
  );
  const reviewedFixtures = [sourced, throughHole];
  for (const entry of reviewedFixtures) {
    const approved = await api.publishFootprintDevice(entry.footprint, {
      widthNm: entry.bodyNm[0],
      heightNm: entry.bodyNm[1],
      packageName: entry.documentation.partNumber,
      license: 'CC0-1.0',
      reviewer: 'Integration test',
      evidence: 'Fixture review covering the assembly of a generated catalogue',
      mappings: new Map(
        entry.footprint.definition.pads.map(({ id, label }) => [
          id,
          { kind: 'signal', terminal: entry.documentation.pinoutByPad[label] },
        ]),
      ),
    });
    await writeFile(path.join(reviews, entry.id + '.tcdevice.json'), approved);
  }
  const record = path.join(reviews, sourced.id + '.tcdevice.json');
  const publishArgs = [
    generator,
    first,
    '--reviewed-devices',
    reviews,
    '--reviewed-bundle',
    reviewedOutput,
  ];
  execFileSync('python3', publishArgs);
  const publishedCatalogue = await readFile(reviewedOutput, 'utf8');
  const reviewedBundle = JSON.parse(publishedCatalogue);
  assert.equal(reviewedBundle.devices.length, reviewedFixtures.length);
  const renderReview = fileURLToPath(
    new URL('../pcb/render-starter-review.mjs', import.meta.url),
  );
  const reviewHtml = path.join(first, 'review.html');
  const reviewArgs = [
    renderReview,
    reviewHtml,
    path.join(first, 'bundle.json.gz'),
    reviewedOutput,
  ];
  execFileSync(process.execPath, reviewArgs);
  const report = await readFile(reviewHtml, 'utf8');
  assert(
    report.includes(
      `${index.variants.length} footprint revisions · ${reviewedFixtures.length} reviewed device records`,
    ),
  );
  assert(report.includes('Reviewed device TI LM358DR'));
  assert(report.includes('Human review pending'));
  assert.match(report, /<svg[^>]+width="[\d.]+mm"[^>]*height="[\d.]+mm"/);

  const badBundle = path.join(first, 'invalid-reviewed.json');
  const [firstDevice] = reviewedBundle.devices;
  await writeFile(
    badBundle,
    JSON.stringify({
      version: 1,
      devices: [
        { ...firstDevice, assignments: firstDevice.assignments.slice(1) },
      ],
    }),
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [...reviewArgs.slice(0, -1), badBundle], {
        stdio: 'pipe',
      }),
    /has no assignment/,
  );
  assert.equal(await readFile(reviewHtml, 'utf8'), report);

  for (const [broken, message] of [
    [
      { ...firstDevice, assignments: firstDevice.assignments.slice(1) },
      /has no assignment/,
    ],
    [
      {
        ...firstDevice,
        models: firstDevice.models.map((asset) => ({
          ...asset,
          base64: 'VElOWQ==',
        })),
      },
      /STEP asset SHA-256 does not match its ID/,
    ],
  ]) {
    await writeFile(record, JSON.stringify(broken));
    assert.throws(
      () => execFileSync('python3', publishArgs, { stdio: 'pipe' }),
      message,
    );
    assert.equal(await readFile(reviewedOutput, 'utf8'), publishedCatalogue);
  }
  assert.throws(
    () =>
      execFileSync(
        'python3',
        [generator, first, '--reviewed-bundle', reviewedOutput],
        { stdio: 'pipe' },
      ),
    /must be provided together/,
  );
  assert.equal(await readFile(reviewedOutput, 'utf8'), publishedCatalogue);

  const devices = await api.readLibraryDeviceCatalogue(reviewedBundle);
  for (const [index, { definition }] of devices.entries()) {
    assert.equal(definition.review.by, 'Integration test');
    assert.equal(
      definition.footprint.definitionDigest,
      reviewedFixtures[index].footprint.definition.definitionDigest,
    );
  }
  const altered = {
    ...devices[0].definition,
    footprint: { ...devices[0].definition.footprint, revision: 'wrong' },
  };
  await writeFile(record, JSON.stringify(altered));
  assert.throws(
    () => execFileSync('python3', publishArgs, { stdio: 'pipe' }),
    /does not match an exact generated footprint revision/,
  );
  assert.equal(await readFile(reviewedOutput, 'utf8'), publishedCatalogue);

  const components = devices.map(({ definition }, index) => {
    const unitId = crypto.randomUUID();
    return {
      id: crypto.randomUUID(),
      reference: index === 0 ? 'U1' : 'D1',
      role: 'electrical',
      value: definition.packageNames[0],
      units: [{ id: unitId, sheetId: crypto.randomUUID() }],
      signals: definition.terminals.map(({ name }) => ({
        id: crypto.randomUUID(),
        name,
        terminals: [{ unitId, pinId: crypto.randomUUID() }],
      })),
    };
  });
  const circuit = {
    schemaVersion: 1,
    snapshotId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    revision: 1,
    nets: [],
    noConnects: [],
    components,
  };
  const selectedDevices = new Map(
    components.map((part, index) => [
      part.id,
      {
        revision: devices[index],
        bindings: devices[index].definition.terminals.map(
          ({ id: terminalId }, signalIndex) => ({
            terminalId,
            signalId: part.signals[signalIndex].id,
          }),
        ),
      },
    ]),
  );
  const blank = api.createBoard('Catalogue fixture', 2, [
    { x: 0, y: 0 },
    { x: 25_000_000, y: 0 },
    { x: 25_000_000, y: 20_000_000 },
    { x: 0, y: 20_000_000 },
  ]);
  const transfer = await api.previewCircuitEco(blank, undefined, circuit, {
    selectedDevices,
  });
  const surfacePlaced = await api.placeUnplacedComponent(
    api.applyCircuitEco(blank, transfer),
    components[0].id,
    {
      positionNm: { x: 7_000_000, y: 9_000_000 },
      rotationMicrodegree: 90_000_000,
      side: 'bottom',
    },
  );
  const placed = await api.placeUnplacedComponent(
    surfacePlaced,
    components[1].id,
    {
      positionNm: { x: 18_000_000, y: 9_000_000 },
      rotationMicrodegree: 180_000_000,
      side: 'top',
    },
  );
  const boardData = await api.encodeBoard(placed);

  const recipes = JSON.parse(await readFile(starterRecipes, 'utf8'));
  const recipesById = new Map(
    recipes.variants.map((recipe) => [recipe.id, recipe]),
  );
  const kernel = await api.loadPolygonKernel(
    new Uint8Array(
      await readFile(
        new URL(
          '../../node_modules/clipper2-wasm/dist/umd/clipper2z.wasm',
          import.meta.url,
        ),
      ),
    ).buffer,
  );
  const presetsById = new Map(
    entries.variants.map((entry) => [entry.id, entry]),
  );
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
    const recipe = recipesById.get(entry.id);
    const preset = presetsById.get(entry.id);
    assert(entry.assemblyProcess.trim());
    assert.equal(preset.assemblyProcess, recipe.manufacturing.process);
    assert.deepEqual(preset.bodyNm, recipe.body.envelopeNm);
    assert.deepEqual(
      api.inspectFootprintDimensions(
        footprint.definition,
        kernel,
        recipe.manufacturing.minAnnulusNm,
      ),
      [],
      entry.id,
    );
    assert.deepEqual(
      Buffer.from(await api.readBoardModelAsset(footprint.assets[0])),
      step,
    );
  }
  await rm(first, { recursive: true, force: true });
  const offline = await api.decodeBoard(boardData);
  assert.deepEqual(offline.footprints, placed.footprints);
  assert.deepEqual(offline.deviceDefinitions, placed.deviceDefinitions);
  assert.deepEqual(offline.footprintDefinitions, placed.footprintDefinitions);
  for (const { definition } of devices) {
    const sourceHash = definition.footprint.models[0].assetId;
    const embedded = offline.modelAssets.find(({ id }) => id === sourceHash);
    assert.equal(sha256(await api.readBoardModelAsset(embedded)), sourceHash);
  }
  const diode = offline.footprintDefinitions.find(({ name }) =>
    name.includes('1N4148-TAP'),
  );
  assert(diode.pads.every(({ stack }) => stack.drill.plated));
});

test('a pitch change moves generated native lands without replacing their pad identities', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'tinycad-starter-pitch-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const catalogue = JSON.parse(await readFile(starterRecipes, 'utf8'));
  const recipe = catalogue.variants.find(({ id }) => id === 'chip-0603');
  const file = path.join(scratch, 'recipe.json');
  const variants = [recipe];
  async function generate(folder) {
    const output = path.join(scratch, folder);
    await writeFile(
      file,
      JSON.stringify({ version: catalogue.version, variants }),
    );
    execFileSync('python3', [generator, output, '--catalogue', file]);
    return {
      footprint: JSON.parse(
        await readFile(
          path.join(output, recipe.id + '.tcfootprint.json'),
          'utf8',
        ),
      ).definition,
      step: await readFile(path.join(output, recipe.id + '.step')),
    };
  }
  const original = await generate('original');
  recipe.terminals.pitchNm = 1_600_000;
  recipe.revision = 'pitch-fixture';
  const revised = await generate('revised');
  assert.deepEqual(revised, await generate('repeated'));
  assert.equal(revised.footprint.id, original.footprint.id);
  assert.notEqual(
    revised.footprint.definitionDigest,
    original.footprint.definitionDigest,
  );
  for (const [index, pad] of revised.footprint.pads.entries()) {
    assert.equal(pad.id, original.footprint.pads[index].id);
    assert.equal(pad.positionNm.x, index === 0 ? -800_000 : 800_000);
    assert.deepEqual(pad.stack, original.footprint.pads[index].stack);
  }
  assert.notEqual(sha256(revised.step), sha256(original.step));
  assert.equal(revised.footprint.models[0].assetId, sha256(revised.step));
});
