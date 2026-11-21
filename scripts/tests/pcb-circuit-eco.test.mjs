import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const id = () => crypto.randomUUID();

test('previews and atomically applies a forward reference and value update', async () => {
  const documentId = id();
  const sheetId = id();
  const unitId = id();
  const pinId = id();
  const signalId = id();
  const secondSignalId = id();
  const secondPinId = id();
  const secondPadId = id();
  const componentId = id();
  const netId = id();
  const deviceId = id();
  const footprintId = id();
  const padId = id();
  const positionNm = { x: 900_000, y: 1_100_000 };
  const routeId = id();
  const otherRouteId = id();
  const land = {
    kind: 'capsule',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    widthNm: 800_000,
  };
  const digest = 'sha256:' + 'a'.repeat(64);
  const component = {
    id: componentId,
    reference: 'C7',
    value: '1µF',
    role: 'electrical',
    units: [{ id: unitId, sheetId }],
    signals: [
      { id: signalId, name: 'A', number: '01', terminals: [{ unitId, pinId }] },
      {
        id: secondSignalId,
        name: 'B',
        number: '02',
        terminals: [{ unitId, pinId: secondPinId }],
      },
    ],
  };
  const previous = {
    schemaVersion: 1,
    documentId,
    snapshotId: id(),
    revision: 1,
    components: [component],
    nets: [
      {
        id: netId,
        names: ['Power'],
        terminals: [
          { unitId, pinId },
          { unitId, pinId: secondPinId },
        ],
      },
    ],
    noConnects: [],
    sources: {
      [unitId]: {
        documentId,
        documentPath: 'Main.dzn',
        sheetId,
        unitId,
        instancePath: [],
      },
    },
  };
  const board = {
    ...api.createBoard('Fixture', 2, [
      { x: 0, y: 0 },
      { x: 10_000_000, y: 0 },
      { x: 10_000_000, y: 10_000_000 },
      { x: 0, y: 10_000_000 },
    ]),
    requiredFeatures: [
      'straight-outline',
      'embedded-devices',
      'physical-padstacks',
      'routed-copper',
    ],
    sourceCircuit: {
      documentId,
      revision: 1,
      connectivityDigest: await api.circuitConnectivityDigest(previous),
    },
    components: [
      {
        id: componentId,
        logicalId: componentId,
        deviceId,
        reference: 'C7',
        value: '1µF',
        role: 'electrical',
        units: component.units,
        signals: [
          { signalId, netId },
          { signalId: secondSignalId, netId },
        ],
      },
    ],
    nets: [{ id: netId, name: 'Power' }],
    tracks: [
      {
        id: routeId,
        netId,
        layerId: 'bottom',
        widthNm: 250_000,
        start: positionNm,
        end: { x: 2_000_000, y: 1_100_000 },
      },
      {
        id: otherRouteId,
        layerId: 'bottom',
        widthNm: 250_000,
        start: { x: 5_000_000, y: 5_000_000 },
        end: { x: 6_000_000, y: 5_000_000 },
      },
    ],
    footprintDefinitions: [
      {
        id: footprintId,
        revision: '1',
        definitionDigest: digest,
        name: 'Fixture',
        pads: [
          {
            id: padId,
            label: '01',
            positionNm: { x: 0, y: 0 },
            stack: { copper: { top: land } },
          },
          {
            id: secondPadId,
            label: '02',
            positionNm: { x: 0, y: -1_100_000 },
            stack: { copper: { top: land } },
          },
        ],
      },
    ],
    deviceDefinitions: [
      {
        id: deviceId,
        revision: '1',
        definitionDigest: digest,
        footprintId,
        packageName: 'Fixture',
        packageSource: 'Test',
        signalIds: [signalId, secondSignalId],
        assignments: [
          { padId, kind: 'signal', signalId },
          { padId: secondPadId, kind: 'signal', signalId: secondSignalId },
        ],
      },
    ],
    footprints: [
      {
        id: id(),
        deviceId,
        componentId,
        positionNm,
        side: 'bottom',
        rotationMicrodegree: 90_000_000,
        locked: true,
      },
    ],
  };
  const proposed = {
    ...previous,
    snapshotId: id(),
    revision: 2,
    components: [{ ...component, reference: 'C12', value: '2µF' }],
    nets: [{ ...previous.nets[0], names: ['Supply'] }],
  };
  const review = await api.previewCircuitEco(board, previous, proposed);
  assert.deepEqual(review.changes, [
    {
      id: componentId,
      kind: 'update',
      reference: 'C12',
      fields: ['Reference designator', 'Value'],
      lostPads: [],
    },
  ]);
  assert.equal(review.netReview.nets[0].retainedId, netId);
  assert.deepEqual(review.renamedNets, [{ id: netId, before: 'Power', after: 'Supply' }]);
  assert.deepEqual(review.unresolved, []);
  assert.equal(board.components[0].reference, 'C7');
  const applied = api.applyCircuitEco(board, review);
  assert.equal(applied.components[0].reference, 'C12');
  assert.deepEqual(applied.footprints, board.footprints);
  assert.deepEqual(applied.tracks, board.tracks);
  assert.deepEqual(review.affectedCopper, []);
  assert.deepEqual(applied.deviceDefinitions, board.deviceDefinitions);
  assert.equal(
    applied.sourceCircuit.connectivityDigest,
    board.sourceCircuit.connectivityDigest,
  );

  const bytes = await api.encodeBoard(applied);
  const reopened = await api.decodeBoard(bytes);
  assert.deepEqual(reopened.appliedCircuit, applied.appliedCircuit);
  assert.deepEqual(
    (await api.boardPadSources(reopened, reopened.appliedCircuit))[0].source
      .pinId,
    pinId,
  );
  assert.throws(
    () => api.applyCircuitEco(reopened, review),
    /revision conflict/i,
  );
  const repeated = await api.previewCircuitEco(
    reopened,
    reopened.appliedCircuit,
    {
      ...proposed,
      snapshotId: id(),
      revision: 3,
    },
  );
  assert.equal(repeated.unchanged, true);
  assert.equal(api.applyCircuitEco(reopened, repeated), reopened);
  await assert.rejects(
    api.encodeBoard({
      ...reopened,
      sourceCircuit: { ...reopened.sourceCircuit, connectivityDigest: digest },
    }),
    /embedded circuit connectivity/i,
  );

  const binary = new Uint8Array(
    await readFile(
      new URL(
        '../../node_modules/clipper2-wasm/dist/umd/clipper2z.wasm',
        import.meta.url,
      ),
    ),
  ).buffer;
  const removedNet = await api.previewCircuitEco(
    reopened,
    reopened.appliedCircuit,
    {
      ...proposed,
      snapshotId: id(),
      revision: 3,
      nets: [],
      noConnects: [
        { unitId, pinId },
        { unitId, pinId: secondPinId },
      ],
    },
    { loadKernel: () => api.loadPolygonKernel(binary) },
  );
  assert.deepEqual(removedNet.affectedCopper, [
    { id: routeId, unassigned: true },
  ]);
  const unassigned = api.applyCircuitEco(reopened, removedNet);
  const { netId: previousNet, ...geometry } = board.tracks[0];
  assert.deepEqual(unassigned.tracks, [
    { ...geometry, reviewRequired: true },
    board.tracks[1],
  ]);
  assert.deepEqual(
    (await api.decodeBoard(await api.encodeBoard(unassigned))).tracks,
    unassigned.tracks,
  );

  const splitIds = [id(), id()];
  const split = await api.previewCircuitEco(
    reopened,
    reopened.appliedCircuit,
    {
      ...proposed,
      snapshotId: id(),
      revision: 3,
      nets: [
        { id: splitIds[0], names: ['Power'], terminals: [{ unitId, pinId }] },
        {
          id: splitIds[1],
          names: ['Separate'],
          terminals: [{ unitId, pinId: secondPinId }],
        },
      ],
    },
    { loadKernel: () => api.loadPolygonKernel(binary) },
  );
  assert.deepEqual(
    split.netReview.nets.map(({ affectedPreviousIds }) => affectedPreviousIds),
    [[netId], [netId]],
  );
  assert.deepEqual(
    split.shorts.map(({ netIds }) => netIds),
    [[...splitIds].sort()],
  );
  assert.deepEqual(
    api.applyCircuitEco(reopened, split).tracks,
    unassigned.tracks,
  );
  assert.deepEqual(split.opens, []);

  const splitBoard = api.applyCircuitEco(reopened, split);
  const shortened = {
    ...splitBoard,
    tracks: [
      { ...splitBoard.tracks[0], end: { x: 1_300_000, y: 1_100_000 } },
      splitBoard.tracks[1],
    ],
  };
  const merge = await api.previewCircuitEco(
    shortened,
    shortened.appliedCircuit,
    {
      ...proposed,
      snapshotId: id(),
      revision: 4,
      nets: [{ ...proposed.nets[0], names: ['Joined'] }],
    },
    { loadKernel: () => api.loadPolygonKernel(binary) },
  );
  assert.deepEqual(merge.netReview.nets[0].affectedPreviousIds, [...splitIds].sort());
  assert.deepEqual(merge.opens, [{
    netId: merge.candidate.nets.find(({ name }) => name === 'Joined').id,
    terminalGroups: [[`${componentId}:${signalId}`], [`${componentId}:${secondSignalId}`]],
  }]);
  assert.deepEqual(merge.shorts, []);
  assert.deepEqual(merge.affectedCopper, [{ id: routeId, unassigned: false }]);
  const merged = await api.decodeBoard(await api.encodeBoard(api.applyCircuitEco(shortened, merge)));
  assert.deepEqual(merged.tracks, shortened.tracks);

  const deletion = {
    ...proposed,
    snapshotId: id(),
    revision: 3,
    components: [],
    sources: {},
    nets: [],
  };
  const keepPart = await api.previewCircuitEco(
    reopened,
    reopened.appliedCircuit,
    deletion,
    {
      loadKernel: () => api.loadPolygonKernel(binary),
      retainedMechanical: new Set([componentId]),
    },
  );
  assert.equal(keepPart.changes[0].kind, 'retain-mechanical');
  const kept = api.applyCircuitEco(reopened, keepPart);
  assert.equal(kept.components[0].role, 'pcb-only');
  assert.equal(kept.components[0].logicalId, undefined);
  assert.deepEqual(kept.components[0].signals, []);
  assert.deepEqual(kept.footprints, reopened.footprints);
  assert.deepEqual(kept.tracks, unassigned.tracks);

  const divergentBoard = {
    ...board,
    components: [{ ...board.components[0], reference: 'C14' }],
  };
  const boardOnly = await api.previewCircuitEco(divergentBoard, previous, {
    ...previous,
    snapshotId: id(),
    revision: 2,
  });
  assert.equal(boardOnly.unchanged, true);
  assert.deepEqual(boardOnly.pendingBackAnnotations, [
    { id: componentId, schematic: 'C7', board: 'C14' },
  ]);
  const divergent = await api.previewCircuitEco(
    divergentBoard,
    previous,
    proposed,
  );
  assert.deepEqual(divergent.conflicts, [
    { id: componentId, schematic: 'C12', board: 'C14' },
  ]);
  assert.throws(
    () => api.applyCircuitEco(divergentBoard, divergent),
    /reference designator conflicts/i,
  );
});

test('blocks unresolved additions during initial circuit review', async () => {
  const board = api.createBoard('Fixture', 1, [
    { x: 0, y: 0 },
    { x: 10_000_000, y: 0 },
    { x: 0, y: 10_000_000 },
  ]);
  const unitId = id();
  const componentId = id();
  const proposed = {
    schemaVersion: 1,
    documentId: id(),
    snapshotId: id(),
    revision: 1,
    nets: [],
    noConnects: [],
    components: [
      {
        id: componentId,
        reference: 'C7',
        value: '1µF',
        role: 'electrical',
        units: [{ id: unitId, sheetId: id() }],
        signals: [
          { id: id(), name: 'A', terminals: [{ unitId, pinId: id() }] },
        ],
      },
    ],
  };
  const review = await api.previewCircuitEco(board, undefined, proposed);
  assert.deepEqual(
    review.unresolved.map(({ id }) => id),
    [componentId],
  );
  assert.throws(() => api.applyCircuitEco(board, review), /device mappings/i);
  assert.equal(board.revision, 0);
});

test('transfers a nested project circuit, places a component and applies a child change without moving it', async () => {
  const root = 'src/Circuit.dsn';
  const drawings = new Map();
  for (const name of [root, 'Blocks/Child.dsn', 'Blocks/Leaf.dsn']) {
    drawings.set(
      name,
      await api.decodeDrawing(
        await readFile(
          new URL('./fixtures/pcb-hierarchy/' + name, import.meta.url),
        ),
      ),
    );
  }
  async function compile(previous) {
    const graph = await api.buildHierarchicalNetlist(
      { path: root, drawing: drawings.get(root) },
      async (parent, link) => {
        const path = api.childPath(link, parent.path);
        return { path, drawing: drawings.get(path) };
      },
    );
    return (
      await api.buildHierarchicalCircuitSnapshot(graph, {
        documentId: drawings.get(root).documentId,
        revision: (previous?.revision ?? 0) + 1,
        previous: previous?.nets,
      })
    ).snapshot;
  }
  const snapshot = await compile();
  assert.equal(snapshot.components.length, 14);
  assert.equal(snapshot.nets.length, 6);
  const board = api.createBoard('Nested', 2, [
    { x: 0, y: 0 },
    { x: 10_000_000, y: 0 },
    { x: 10_000_000, y: 10_000_000 },
    { x: 0, y: 10_000_000 },
  ]);
  const pad = api.makeFootprintPad({
    id: id(),
    label: '01',
    positionNm: { x: 0, y: 0 },
    profile: 'round',
    widthNm: 700_000,
    heightNm: 700_000,
  });
  const footprint = await api.footprintDefinition({
    id: id(),
    revision: '1',
    name: 'Fixture terminal',
    pads: [pad],
  });
  const terminalId = id();
  const device = await api.readLibraryDevice(
    await api.writeLibraryDevice({
      format: 'tinycad-device',
      version: 1,
      id: id(),
      revision: '1',
      name: 'Fixture terminal',
      packageNames: ['Fixture terminal'],
      mount: 'surface-mount',
      bodyNm: { width: 700_000, height: 700_000 },
      source: 'Project fixture',
      license: 'CC0-1.0',
      review: { by: 'Fixture', evidence: 'One-signal fixture device' },
      footprint,
      terminals: [{ id: terminalId, name: 'Terminal' }],
      assignments: [{ padId: pad.id, kind: 'signal', signalId: terminalId }],
    }),
  );
  const selectedDevices = new Map(
    snapshot.components.map((component) => {
      assert.equal(component.signals.length, 1, component.reference);
      return [
        component.id,
        {
          revision: device,
          bindings: [{ terminalId, signalId: component.signals[0].id }],
        },
      ];
    }),
  );
  const first = await api.previewCircuitEco(board, undefined, snapshot, {
    selectedDevices,
  });
  assert.equal(first.changes.length, snapshot.components.length);
  assert.deepEqual(first.unresolved, []);
  const transferred = api.applyCircuitEco(board, first);
  assert.equal(transferred.footprints.length, 0);
  const target = transferred.components.find(
    ({ reference }) => reference === 'H1_H1_R1',
  );
  const placed = await api.placeUnplacedComponent(transferred, target.id, {
    positionNm: { x: 2_000_000, y: 2_000_000 },
    rotationMicrodegree: 90_000_000,
    side: 'top',
  });
  await assert.rejects(
    api.placeUnplacedComponent(placed, target.id, placed.footprints[0]),
    /already placed/,
  );
  const applied = await api.decodeBoard(await api.encodeBoard(placed));
  const child = drawings.get('Blocks/Leaf.dsn');
  const reference = child.sheets
    .flatMap(({ items }) => items)
    .find(
      ({ unitId }) =>
        unitId ===
        snapshot.sources[
          snapshot.components.find(({ id }) => id === target.id).units[0].id
        ].unitId,
    )
    .text.find(({ description }) => description === 'Ref');
  reference.value = 'R21';
  const next = await compile(applied.appliedCircuit);
  assert.equal(
    applied.components.find(({ id }) => id === target.id).reference,
    'H1_H1_R1',
  );
  const review = await api.previewCircuitEco(
    applied,
    applied.appliedCircuit,
    next,
  );
  assert(
    review.changes.some(
      ({ id, reference }) => id === target.id && reference === 'H1_H1_R21',
    ),
  );
  const updated = api.applyCircuitEco(applied, review);
  assert.deepEqual(updated.footprints, applied.footprints);
  assert.equal(
    updated.sourceCircuit.connectivityDigest,
    applied.sourceCircuit.connectivityDigest,
  );
  assert.equal(
    updated.components.find(({ id }) => id === target.id).reference,
    'H1_H1_R21',
  );
  assert.equal(
    (
      await api.previewCircuitEco(
        updated,
        updated.appliedCircuit,
        await compile(updated.appliedCircuit),
      )
    ).unchanged,
    true,
  );
});
