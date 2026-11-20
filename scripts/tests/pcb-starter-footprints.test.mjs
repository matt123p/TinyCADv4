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
import { createHash } from 'node:crypto';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { librarySqlite } from '../lib/library-from-sql.mjs';

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
      path.join(output, 'manifest.json'),
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
  const entries = JSON.parse(
    await readFile(path.join(first, 'manifest.json'), 'utf8'),
  );
  const packaged = await readFile(
    new URL('../../bundled-footprints/starter-v1.tplib', import.meta.url),
  );
  const packager = fileURLToPath(
    new URL('../pcb/build-starter-library.mjs', import.meta.url),
  );
  const rebuilt = path.join(first, 'starter.tplib');
  execFileSync(process.execPath, [
    packager,
    path.join(first, 'manifest.json'),
    rebuilt,
  ]);
  assert.deepEqual(await readFile(rebuilt), packaged);
  const SQL = await librarySqlite();
  const db = new SQL.Database(packaged);
  t.after(() => db.close());
  const api = await layoutRuntime();
  const stored = new Map(
    api.readStarterFootprints(db).map((entry) => [entry.id, entry]),
  );
  assert.equal(stored.size, entries.variants.length);
  const suppliedDevices = await api.readStarterDevices(db);
  assert.equal(suppliedDevices.length, 21);
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
    'connector',
    'film-capacitor',
    'header',
    'radial',
    'radial-electrolytic',
    'radial-inductor',
    'radial-led',
    'smd-diode',
    'smd-electrolytic',
    'smd-inductor',
    'smd-transistor',
    'soic',
    'terminal-block',
    'tht-transistor',
    'axial-inductor',
    'module-header',
    'mounting-hole',
    'test-point',
  ])
    assert(families.has(family), family);
  const byId = new Map(entries.variants.map((entry) => [entry.id, entry]));
  for (const entry of entries.variants) {
    const native = await api.readStarterFootprint(db, stored.get(entry.id));
    assert.deepEqual(native, entry.footprint, entry.id);
  }
  for (const {
    id,
    family,
    footprint: { definition },
  } of entries.variants) {
    if (family !== 'radial' && family !== 'film-capacitor') continue;
    assert.equal(definition.pads.length, 2, id);
    assert.deepEqual(definition.pads[0].stack, definition.pads[1].stack, id);
    assert.equal(definition.pads[0].stack.copper.top.kind, 'capsule', id);
    assert.ok(
      !definition.graphics.some(({ layer }) => layer === 'F.SilkS'),
      id,
    );
  }
  const [positive, negative] =
    byId.get('can-radial-63').footprint.definition.pads;
  assert.equal(positive.stack.copper.top.kind, 'polygon');
  assert.equal(negative.stack.copper.top.kind, 'capsule');
  for (const id of ['test-point-10', 'test-point-15', 'test-point-25']) {
    const { footprint, assemblyProcess } = byId.get(id);
    assert.equal(assemblyProcess, 'Bare PCB test pad');
    const { stack } = footprint.definition.pads[0];
    assert.ok(stack.copper.top && stack.mask.top);
    assert.equal(stack.paste, undefined);
  }
  const specifiedSmt = byId.get('chip-0402').footprint.definition.pads[0];
  assert.equal(specifiedSmt.stack.copper.top.vertices.length, 4);
  for (const [id, pitch, spacing, width, height] of [
    ['chip-0402', 1_050_000, undefined, 600_000, 600_000],
    ['chip-0603', 1_500_000, undefined, 750_000, 1_000_000],
    ['chip-0805', 1_950_000, undefined, 950_000, 1_450_000],
    ['chip-1206', 2_550_000, undefined, 1_050_000, 1_800_000],
    ['can-smd-40', 3_500_000, undefined, 2_500_000, 1_600_000],
    ['can-smd-50', 4_300_000, undefined, 2_800_000, 1_600_000],
    ['can-smd-63', 5_000_000, undefined, 3_200_000, 1_600_000],
    ['can-smd-80', 6_200_000, undefined, 4_000_000, 1_600_000],
    ['can-smd-100', 8_700_000, undefined, 4_100_000, 2_000_000],
    ['diode-sod-923', 840_000, undefined, 360_000, 250_000],
    ['diode-sod-523', 1_480_000, undefined, 670_000, 400_000],
    ['diode-sod-323', 2_230_000, undefined, 630_000, 830_000],
    ['diode-sod-123', 3_150_000, undefined, 900_000, 950_000],
    ['diode-sma', 4_000_000, undefined, 2_500_000, 1_700_000],
    ['diode-smb', 4_300_000, undefined, 2_500_000, 2_300_000],
    ['diode-smc', 6_900_000, undefined, 2_500_000, 3_300_000],
    ['led-chip-0603', 1_650_000, undefined, 800_000, 800_000],
    ['led-chip-0805', 2_350_000, undefined, 1_250_000, 1_100_000],
    ['led-chip-1206', 3_750_000, undefined, 1_750_000, 1_500_000],
    ['led-chip-1210', 3_200_000, undefined, 1_500_000, 2_200_000],
    ['led-chip-3528', 3_100_000, undefined, 1_500_000, 2_200_000],
    ['soic-8', 1_270_000, 5_400_000, 1_550_000, 600_000],
    ['soic-14', 1_270_000, 5_400_000, 1_550_000, 600_000],
    ['soic-16', 1_270_000, 5_400_000, 1_550_000, 600_000],
    ['soic-20', 1_270_000, 9_300_000, 2_000_000, 600_000],
    ['soic-24', 1_270_000, 9_400_000, 2_000_000, 600_000],
  ]) {
    const entry = byId.get(id);
    const pads = entry.footprint.definition.pads;
    const vertices = pads[0].stack.copper.top.vertices;
    const extent = (axis) => {
      const values = vertices.map((point) => point[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    assert.ok(entry.landPatternSource.url.startsWith('https://'), id);
    assert.deepEqual([extent('x'), extent('y')], [width, height], id);
    if (spacing) {
      assert.equal(pads[0].positionNm.y - pads[1].positionNm.y, pitch, id);
      assert.equal(
        pads.at(-1).positionNm.x - pads[0].positionNm.x,
        spacing,
        id,
      );
      assert.equal(pads.at(-1).positionNm.y, pads[0].positionNm.y, id);
    } else {
      assert.equal(pads[1].positionNm.x - pads[0].positionNm.x, pitch, id);
    }
  }
  const sod523 = byId.get('diode-sod-523').footprint.definition.pads[0].stack;
  assert.equal(sod523.copper.top.vertices.length, 20);
  assert.deepEqual(sod523.paste.top, sod523.copper.top);

  const straightTo92 = byId.get('to92-inline');
  const [, straightOval] = straightTo92.footprint.definition.pads;
  assert.equal(straightOval.stack.drill.widthNm, 850_000);
  assert.equal(straightOval.stack.copper.top.widthNm, 1_070_000);
  assert.equal(
    straightOval.stack.copper.top.end.y - straightOval.stack.copper.top.start.y,
    430_000,
  );
  const fiveLead = byId.get('to220-5');
  assert.equal(
    fiveLead.datasheetFitSource.url,
    fiveLead.footprint.definition.datasheetUrl,
  );
  assert.ok(
    fiveLead.footprint.definition.pads.every(
      ({ stack }) => stack.drill.widthNm === 1_300_000,
    ),
  );

  const formedTo92 = byId.get('to92-spread');
  const formedPads = formedTo92.footprint.definition.pads;
  assert.equal(
    formedTo92.footprint.definition.datasheetUrl,
    formedTo92.landPatternSource.url,
  );
  assert.deepEqual(
    formedPads.map(({ positionNm }) => positionNm.x),
    [-2_600_000, 0, 2_600_000],
  );
  assert.deepEqual(
    formedPads.map(({ stack }) => stack.drill.widthNm),
    [900_000, 900_000, 900_000],
  );
  assert.equal(formedPads[0].stack.copper.top.vertices.length, 20);
  assert.deepEqual(
    formedPads.slice(1).map(({ stack }) => stack.copper.top.widthNm),
    [1_400_000, 1_400_000],
  );

  for (const [pins, gap] of [
    [3, 950_000],
    [5, 950_000],
    [6, 950_000],
  ]) {
    const entry = byId.get('sot-23-' + pins);
    const pads = entry.footprint.definition.pads;
    assert.equal(pads[0].positionNm.y - pads[1].positionNm.y, gap);
    assert.equal(pads.at(-1).positionNm.x - pads[0].positionNm.x, 2_600_000);
  }
  const sot223 = byId.get('sot-223-4').footprint.definition.pads;
  assert.equal(sot223[3].label, '4');
  assert.deepEqual(sot223[3].positionNm, { x: 2_900_000, y: 0 });
  assert.deepEqual(byId.get('can-smd-80').documentation.pinoutByPad, {
    1: '+',
    2: '−',
  });
  assert.equal(
    byId.get('diode-sod-923').documentation.pinoutByPad['1'],
    'Cathode',
  );
  for (const rows of [3, 5, 8]) {
    const id = 'header-2x' + rows;
    const pads = byId.get(id).footprint.definition.pads;
    assert.deepEqual(
      pads.map(({ label, positionNm }) => [label, positionNm]),
      Array.from({ length: rows * 2 }, (_, i) => [
        String(i + 1),
        {
          x: i % 2 ? 1_270_000 : -1_270_000,
          y: (rows - 1 - 2 * Math.floor(i / 2)) * 1_270_000,
        },
      ]),
      id,
    );
    assert.ok(
      pads.every(({ stack }) => stack.copper.top && stack.copper.bottom),
      id,
    );
  }
  for (const [id, pins] of [
    ['bc847b-sot23', ['Base', 'Emitter', 'Collector']],
    ['bc857b-sot23', ['Base', 'Emitter', 'Collector']],
    ['bc547b-to92', ['Collector', 'Base', 'Emitter']],
    ['nexperia-2n7002bk-sot23', ['Gate', 'Source', 'Drain']],
    ['nexperia-bss84-sot23', ['Gate', 'Source', 'Drain']],
    ['onsemi-mmbfj113-sot23', ['Drain', 'Source', 'Gate']],
    ['onsemi-mmbfj176-sot23', ['Drain', 'Source', 'Gate']],
    ['onsemi-fqp30n06l-to220', ['Gate', 'Drain', 'Source']],
    ['st-stgp10nc60kd-to220', ['Gate', 'Collector', 'Emitter']],
    ['nexperia-bav99-sot23', ['A1', 'K2', 'K1/A2']],
    ['ti-tl431cdbzr-sot23', ['Cathode', 'REF', 'Anode']],
  ]) {
    const row = byId.get(id);
    assert.deepEqual(Object.values(row.documentation.pinoutByPad), pins, id);
    assert.ok(row.footprint.definition.datasheetUrl, id);
  }
  const audio = byId.get('samesky-sj1-3525n');
  const audioPads = new Map(
    audio.footprint.definition.pads.map((pad) => [pad.label, pad]),
  );
  assert.deepEqual(audio.documentation.pinoutByPad, {
    1: 'Sleeve',
    2: 'Tip',
    3: 'Ring',
    10: 'Tip switch',
    11: 'Ring switch',
  });
  assert.equal(
    audioPads.get('1').stack.drill.end.x -
      audioPads.get('1').stack.drill.start.x,
    700_000,
  );
  assert.equal(
    audioPads.get('2').stack.drill.end.y -
      audioPads.get('2').stack.drill.start.y,
    700_000,
  );
  assert.equal(audioPads.get('1').stack.drill.widthNm, 800_000);
  assert.equal(audio.documentation.mechanicalPads.length, 5);
  for (const label of audio.documentation.mechanicalPads) {
    assert.deepEqual(audioPads.get(label).stack.copper, {});
    assert.equal(audioPads.get(label).stack.drill.plated, false);
    assert.equal(audioPads.get(label).stack.drill.widthNm, 1_200_000);
  }
  const ethernet = byId.get('amphenol-rjhse5380');
  assert.equal(ethernet.footprint.definition.pads.length, 12);
  assert.equal(ethernet.documentation.pinoutByPad.SH1, 'Shield');
  assert.equal(ethernet.documentation.pinoutByPad.SH2, 'Shield');
  assert.deepEqual(ethernet.documentation.mechanicalPads, ['MP1', 'MP2']);
  const barrel = byId.get('samesky-pj-102a');
  assert.equal(barrel.documentation.pinoutByPad['3'], 'Sleeve switch');
  assert.equal(barrel.footprint.definition.pads[2].positionNm.y, -4_700_000);
  for (const pins of [2, 4]) {
    const { footprint } = byId.get('jst-xh-' + pins + '-vertical');
    assert.equal(footprint.definition.pads.length, pins);
    assert.equal(
      footprint.definition.pads[1].positionNm.x -
        footprint.definition.pads[0].positionNm.x,
      2_500_000,
    );
  }
  const sourced = entries.variants.find(({ id }) => id === 'ti-lm358dr-d0008a');
  assert.equal(sourced?.documentation.partNumber, 'LM358DR');
  assert.equal(
    sourced.footprint.definition.datasheetUrl,
    sourced.documentation.pinout,
  );
  assert.equal(
    byId.get('header-2x3').footprint.definition.datasheetUrl,
    'https://suddendocs.samtec.com/prints/tsw-mk.pdf',
  );
  assert.equal(
    byId.get('mount-m2').footprint.definition.datasheetUrl,
    undefined,
  );
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
  const reviews = path.join(first, 'reviews');
  const reviewedOutput = path.join(first, 'reviewed.json');
  await mkdir(reviews);
  const throughHole = entries.variants.find(
    ({ id }) => id === 'vishay-1n4148-tap-do35-762',
  );
  assert.equal(throughHole.documentation.pinoutByPad['1'], 'Cathode');
  assert.equal(
    throughHole.footprint.definition.pads[0].stack.drill.widthNm,
    800_000,
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
  const [firstDevice] = reviewedBundle.devices;
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

  const fixtureDevices = await api.readLibraryDeviceCatalogue(reviewedBundle);
  for (const [index, { definition }] of fixtureDevices.entries()) {
    assert.equal(definition.review.by, 'Integration test');
    assert.equal(
      definition.footprint.definitionDigest,
      reviewedFixtures[index].footprint.definition.definitionDigest,
    );
  }
  const altered = {
    ...fixtureDevices[0].definition,
    footprint: { ...fixtureDevices[0].definition.footprint, revision: 'wrong' },
  };
  await writeFile(record, JSON.stringify(altered));
  assert.throws(
    () => execFileSync('python3', publishArgs, { stdio: 'pipe' }),
    /does not match an exact generated footprint revision/,
  );
  assert.equal(await readFile(reviewedOutput, 'utf8'), publishedCatalogue);

  const devices = ['LM358DR', '1N4148-TAP'].map((partNumber) =>
    suppliedDevices.find(({ definition }) =>
      definition.packageNames.includes(partNumber),
    ),
  );
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
    assert.equal(
      footprint.definition.datasheetUrl,
      recipe.datasheetUrl ??
        recipe.documentation?.pinout ??
        recipe.landPatternSource?.url,
      entry.id,
    );
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
