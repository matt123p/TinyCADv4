import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const id = () => crypto.randomUUID();
const point = (x, y) => ({ x, y });

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
    { id: pads[0].id, label: '01', changes: ['Position'] },
  ]);
  const updated = api.applyDeviceReview(reopened, changed);
  assert.equal(updated.footprintDefinitions.length, 1);
  assert.equal(updated.footprintDefinitions[0].pads[0].positionNm.x, -50_000);
  assert.equal(reopened.footprintDefinitions[0].pads[0].positionNm.x, 0);
  assert.throws(() => api.applyDeviceReview(updated, changed), /revision/i);
});
