import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const id = () => crypto.randomUUID();
const point = (x, y) => ({ x, y });

test('exposes incompatible SOT-23 Gate and Drain mappings and preserves the Source route', async () => {
  const SQL = await librarySqlite();
  const db = new SQL.Database(await readFile(new URL('../../bundled-footprints/starter-v1.tplib', import.meta.url)));
  let mosfet, jfet;
  try {
    const catalogue = await api.readStarterDevices(db);
    mosfet = catalogue.find(({ definition }) => definition.name.startsWith('2N7002BK'));
    jfet = catalogue.find(({ definition }) => definition.name.startsWith('MMBFJ113'));
  } finally {
    db.close();
  }
  assert.ok(mosfet && jfet);
  assert.deepEqual(mosfet.definition.footprint.pads.map(({ id, ...pad }) => pad),
    jfet.definition.footprint.pads.map(({ id, ...pad }) => pad), 'Same physical land pattern');
  assert.notDeepEqual(mosfet.definition.footprint.pads.map(({ id }) => id),
    jfet.definition.footprint.pads.map(({ id }) => id), 'Independent library pad identities');
  const unitId = id();
  const names = ['Gate', 'Source', 'Drain'];
  const component = {
    id: id(), reference: 'Q1', value: 'SOT-23 review fixture', role: 'electrical', packageHint: 'SOT-23',
    units: [{ id: unitId, sheetId: id() }],
    signals: names.map((name) => ({ id: id(), name, terminals: [{ unitId, pinId: id() }] })),
  };
  const nets = component.signals.map(({ name, terminals }) => ({ id: id(), names: [name], terminals }));
  const snapshot = {
    schemaVersion: 1, snapshotId: id(), documentId: id(), revision: 1,
    components: [component], nets, noConnects: [],
  };
  const selection = (revision) => new Map([[component.id, {
    revision, bindings: revision.definition.terminals.map(({ id: terminalId, name }) => ({
      terminalId, signalId: component.signals.find((signal) => signal.name === name).id,
    })),
  }]]);
  const empty = api.createBoard('SOT-23 map fixture', 2,
    [point(0, 0), point(30e6, 0), point(30e6, 20e6), point(0, 20e6)]);
  const install = await api.previewCircuitEco(empty, undefined, snapshot, { selectedDevices: selection(mosfet) });
  const placed = await api.placeUnplacedComponent(api.applyCircuitEco(empty, install), component.id, {
    side: 'top', positionNm: point(12e6, 10e6), rotationMicrodegree: 0,
  });
  const installed = placed.footprintDefinitions[0];
  const tracks = installed.pads.map((pad, index) => {
    const start = api.placeFootprintPoint(pad.positionNm, placed.footprints[0]);
    const end = pad.positionNm.y === 0
      ? point(start.x + 3e6, start.y)
      : point(start.x, start.y + Math.sign(pad.positionNm.y) * 3e6);
    return { id: id(), netId: nets[index].id, widthNm: 280_000, layerId: 'top', start, end };
  });
  const board = await api.decodeBoard(await api.encodeBoard({
    ...placed, tracks, requiredFeatures: [...placed.requiredFeatures, 'routed-copper'],
  }));
  const require = createRequire(import.meta.url);
  const wasm = await readFile(path.join(path.dirname(require.resolve('clipper2-wasm/package.json')), 'dist/es/clipper2z.wasm'));
  const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
  const eco = await api.previewCircuitEco(board, snapshot, { ...snapshot, revision: 2 }, {
    selectedDevices: selection(jfet), loadKernel: async () => kernel,
  });
  assert.equal(eco.unchanged, false);
  assert.deepEqual(eco.deviceChanges[0].padChanges.map(
    ({ label, changes, beforeSignal, afterSignal }) => [label, changes, beforeSignal, afterSignal]), [
    ['1', ['Signal or pad role'], 'Gate', 'Drain'],
    ['3', ['Signal or pad role'], 'Drain', 'Gate'],
  ]);
  assert.deepEqual(eco.affectedCopper.map(({ id }) => id).sort(), [tracks[0].id, tracks[2].id].sort());
  assert.deepEqual(eco.candidate.tracks.find(({ id }) => id === tracks[1].id), tracks[1]);
  assert.ok(eco.shorts.some(({ netIds }) => netIds.includes(nets[0].id) && netIds.includes(nets[2].id)));
  const diagnostic = await api.prepareCamPreview(api.applyCircuitEco(board, eco), kernel);
  assert.equal(diagnostic.report.issues.filter(({ code }) => code === 'route-review').length, 2);
  assert.ok(diagnostic.report.issues.some(({ code }) => code === 'short'));
});

test('reviews stable device mappings and keeps applied revisions portable and independent', async () => {
  const terminalId = id();
  const signalId = id();
  const pads = [
    { id: id(), label: '01', positionNm: point(0, 0) },
    { id: id(), label: '01', positionNm: point(500_000, 0) },
    { id: id(), label: 'EP', positionNm: point(0, 500_000) },
    { id: id(), label: 'A1', positionNm: point(500_000, 500_000) },
  ];
  const footprint = { id: id(), name: 'Fixture', revision: '1', pads };
  const definition = {
    format: 'tinycad-device',
    version: 1,
    id: id(),
    revision: '1',
    name: 'Reviewed fixture',
    packageNames: ['SOT-23'],
    mount: 'surface-mount',
    bodyNm: { width: 2_000_000, height: 3_000_000 },
    pitchNm: 500_000,
    source: 'Fixture drawing',
    license: 'CC0-1.0',
    review: { by: 'PCB reviewer', evidence: 'Device drawing and pinout' },
    footprint: {
      ...footprint,
      definitionDigest: await api.deviceDigest(footprint),
    },
    terminals: [{ id: terminalId, name: 'Input' }],
    assignments: [
      { padId: pads[0].id, kind: 'signal', signalId: terminalId },
      { padId: pads[1].id, kind: 'signal', signalId: terminalId },
      { padId: pads[2].id, kind: 'mechanical' },
      { padId: pads[3].id, kind: 'nc' },
    ],
  };
  const bytes = await api.writeLibraryDevice(definition);
  const library = await api.readLibraryDevice(bytes);
  assert.equal(library.digest, await api.deviceDigest(definition));
  assert.deepEqual(await api.writeLibraryDevice(library.definition), bytes);
  await assert.rejects(
    api.writeLibraryDevice({
      ...definition,
      footprint: { ...definition.footprint, name: 'Changed' },
    }),
    /Footprint contents/,
  );
  await assert.rejects(
    api.writeLibraryDevice({
      ...definition,
      assignments: definition.assignments.slice(1),
    }),
    /has no assignment/,
  );

  const nextFootprint = {
    ...footprint,
    revision: '2',
    pads: [{ ...pads[0], positionNm: point(-50_000, 0) }, ...pads.slice(1)],
  };
  const newer = await api.readLibraryDevice(
    await api.writeLibraryDevice({
      ...definition,
      revision: '2',
      footprint: {
        ...nextFootprint,
        definitionDigest: await api.deviceDigest(nextFootprint),
      },
    }),
  );
  const catalogue = [library, newer];
  assert.equal(
    api.searchLibraryDevices(catalogue, { packageHint: ' sot-23 ' }).hintStatus,
    'ambiguous',
  );
  assert.equal(
    api.searchLibraryDevices(catalogue, { packageHint: '' }).hintStatus,
    'blank',
  );
  assert.deepEqual(
    api.searchLibraryDevices(catalogue, {
      pitchNm: 500_000,
      mount: 'surface-mount',
      padCount: 4,
      maxWidthNm: 2_000_000,
    }).matches,
    catalogue,
  );
  assert.deepEqual(
    api.searchLibraryDevices(catalogue, { pitchNm: 400_000 }).matches,
    [],
  );

  const unitId = id();
  const pinId = id();
  const component = {
    id: id(),
    reference: 'Q1',
    value: 'Fixture',
    role: 'electrical',
    packageHint: 'SOT-23',
    units: [{ id: unitId, sheetId: id() }],
    signals: [
      {
        id: signalId,
        name: 'Input',
        number: '01',
        terminals: [{ unitId, pinId }],
      },
    ],
  };
  const net = { id: id(), names: ['INPUT'], terminals: [{ unitId, pinId }] };
  const circuit = {
    schemaVersion: 1,
    snapshotId: id(),
    documentId: id(),
    revision: 1,
    components: [component],
    nets: [net],
    noConnects: [],
  };
  const board = {
    ...api.createBoard('Fixture', 2, [
      point(0, 0),
      point(10_000_000, 0),
      point(10_000_000, 10_000_000),
      point(0, 10_000_000),
    ]),
    sourceCircuit: {
      documentId: circuit.documentId,
      revision: circuit.revision,
      connectivityDigest: await api.circuitConnectivityDigest(circuit),
    },
    nets: [{ id: net.id, name: net.names[0] }],
  };
  await assert.rejects(
    api.previewDeviceReview(board, circuit, component.id, library, []),
    /needs a signal/,
  );
  const bindings = [{ terminalId, signalId }];
  const review = await api.previewDeviceReview(
    board,
    circuit,
    component.id,
    library,
    bindings,
  );
  const applied = api.applyDeviceReview(board, review);
  assert.equal(applied.revision, board.revision + 1);
  assert.equal(applied.components[0].deviceId, applied.deviceDefinitions[0].id);
  assert.deepEqual(applied.components[0].signals, [
    { signalId, netId: net.id },
  ]);
  const reopened = await api.decodeBoard(await api.encodeBoard(applied));
  assert.deepEqual(reopened.deviceDefinitions, applied.deviceDefinitions);
  assert.deepEqual(reopened.footprintDefinitions, applied.footprintDefinitions);
  assert.deepEqual(
    reopened.deviceDefinitions[0].assignments
      .slice(0, 2)
      .map((assignment) => assignment.signalId),
    [signalId, signalId],
  );
  assert.equal(reopened.deviceDefinitions[0].library.digest, library.digest);

  const changed = await api.previewDeviceReview(
    reopened,
    circuit,
    component.id,
    newer,
    bindings,
  );
  assert.deepEqual(changed.padChanges, [
    { id: pads[0].id, label: '01', changes: ['Position'], before: pads[0], after: nextFootprint.pads[0] },
  ]);
  const updated = api.applyDeviceReview(reopened, changed);
  assert.equal(updated.footprintDefinitions.length, 1);
  assert.equal(updated.footprintDefinitions[0].pads[0].positionNm.x, -50_000);
  assert.equal(reopened.footprintDefinitions[0].pads[0].positionNm.x, 0);
  assert.throws(() => api.applyDeviceReview(updated, changed), /revision/i);
});
