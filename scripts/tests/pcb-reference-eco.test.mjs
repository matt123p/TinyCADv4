import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();

test('back annotation exchanges repeated references without modifying shared child sources', async () => {
  const drawings = new Map();
  const path = 'src/Circuit.dsn';
  for (const name of [path, 'Blocks/Child.dsn', 'Blocks/Leaf.dsn']) {
    drawings.set(
      name,
      await api.decodeDrawing(
        await readFile(
          new URL('./fixtures/pcb-hierarchy/' + name, import.meta.url),
        ),
      ),
    );
  }
  const drawing = drawings.get(path);
  const compile = async (root) => {
    const graph = await api.buildHierarchicalNetlist(
      { path, drawing: root },
      async (parent, link) => {
        const path = api.childPath(link, parent.path);
        return { path, drawing: drawings.get(path) };
      },
    );
    const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
      revision: 1,
      documentId: drawing.documentId,
    });
    return snapshot;
  };
  const original = await compile(drawing);
  const first = original.components.find(
    ({ reference }) => reference === 'H1_H1_R1',
  );
  const other = original.components.find(
    ({ reference }) => reference === 'H2_H1_R1',
  );
  const digest = await api.circuitConnectivityDigest(original);
  const board = {
    ...api.createBoard('Reference test', 2, [
      { x: 0, y: 0 },
      { x: 10_000_000, y: 0 },
      { x: 0, y: 10_000_000 },
    ]),
    sourceCircuit: {
      documentId: original.documentId,
      connectivityDigest: digest,
      revision: original.revision,
    },
    components: [first, other].map(({ id, reference }) => ({
      id,
      reference,
      role: 'electrical',
    })),
  };
  assert.throws(
    () =>
      api.editBoardReferences(board, new Map([[first.id, other.reference]])),
    /Duplicate PCB reference/,
  );
  const edited = api.editBoardReferences(
    board,
    new Map([
      [first.id, other.reference],
      [other.id, first.reference],
    ]),
  );
  const preview = api.previewBackAnnotation(
    drawing,
    edited,
    original,
    original,
  );
  assert.equal(preview.canApply, true);
  assert.equal(preview.changes.length, 2);
  const annotated = api.applyBackAnnotation(
    drawing,
    edited,
    original,
    original,
  );
  assert.equal(drawing.instanceReferences, undefined);
  assert.equal(annotated.drawing.instanceReferences.length, 2);
  assert.equal(annotated.board.sourceCircuit.connectivityDigest, digest);
  for (const encoding of ['xml', 'zip-v1']) {
    const reopened = await api.decodeDrawing(
      await api.encodeDrawing(annotated.drawing, encoding),
    );
    assert.deepEqual(
      reopened.instanceReferences,
      annotated.drawing.instanceReferences,
    );
    const recompiled = await compile(reopened);
    assert.equal(await api.circuitConnectivityDigest(recompiled), digest);
    assert.equal(
      recompiled.components.find(({ id }) => id === first.id).reference,
      other.reference,
    );
    assert.equal(
      recompiled.components.find(({ id }) => id === other.id).reference,
      first.reference,
    );
    const source = original.sources[first.units[0].id];
    const shown = await api.referencesForInstance(
      reopened,
      drawings.get(source.documentPath),
      source.instancePath,
    );
    assert.equal(shown[source.unitId], other.reference);
    assert.equal(
      api.previewBackAnnotation(
        reopened,
        annotated.board,
        annotated.board.appliedCircuit,
        recompiled,
      ).changes.length,
      0,
    );
  }
  const amended = {
    ...original,
    components: original.components.map((part) =>
      part.id === first.id ? { ...part, reference: 'C888' } : part,
    ),
  };
  assert.equal(
    api.previewBackAnnotation(drawing, edited, original, amended).canApply,
    false,
  );
  assert.equal(
    api.previewBackAnnotation(
      drawing,
      edited,
      original,
      amended,
      new Map([[first.id, 'schematic']]),
    ).canApply,
    true,
  );
});

test('AT-31 round trips a local capacitor reference and keeps its placement and copper', async () => {
  const drawPath = 'Leaf.dsn';
  const drawing = await api.decodeDrawing(
    await readFile(
      new URL('./fixtures/pcb-hierarchy/Blocks/Leaf.dsn', import.meta.url),
    ),
  );
  const symbol = (document) =>
    document.sheets
      .flatMap(({ items }) => items)
      .find(({ NodeName }) => NodeName === 'symbol');
  const reference = (document) =>
    symbol(document).text.find(({ description }) => description === 'Ref');
  reference(drawing).value = 'C7';
  async function compile(document, previous) {
    const graph = await api.buildHierarchicalNetlist(
      { path: drawPath, drawing: document },
      async () => assert.fail('This source has no child drawings'),
    );
    return (
      await api.buildHierarchicalCircuitSnapshot(graph, {
        documentId: document.documentId,
        revision: (previous?.revision ?? 0) + 1,
        previous: previous?.nets,
      })
    ).snapshot;
  }

  const initial = await compile(drawing);
  const component = initial.components[0];
  const pad = api.makeFootprintPad({
    id: crypto.randomUUID(),
    label: '01',
    positionNm: { x: 0, y: 0 },
    profile: 'round',
    widthNm: 800_000,
    heightNm: 800_000,
  });
  const definition = await api.footprintDefinition({
    id: crypto.randomUUID(),
    name: 'Test capacitor land',
    revision: '1',
    pads: [pad],
  });
  const terminalId = crypto.randomUUID();
  const device = await api.readLibraryDevice(
    await api.writeLibraryDevice({
      format: 'tinycad-device',
      version: 1,
      id: crypto.randomUUID(),
      revision: '1',
      name: 'Test capacitor',
      packageNames: ['Terminal fixture'],
      mount: 'surface-mount',
      bodyNm: { width: 800_000, height: 800_000 },
      source: 'Project fixture',
      license: 'CC0-1.0',
      review: { by: 'Test', evidence: 'Fixture terminal' },
      footprint: definition,
      terminals: [{ id: terminalId, name: 'Terminal' }],
      assignments: [{ padId: pad.id, kind: 'signal', signalId: terminalId }],
    }),
  );
  const board = api.createBoard('AT-31', 2, [
    { x: 0, y: 0 },
    { x: 10_000_000, y: 0 },
    { x: 10_000_000, y: 10_000_000 },
    { x: 0, y: 10_000_000 },
  ]);
  const review = await api.previewCircuitEco(board, undefined, initial, {
    selectedDevices: new Map([
      [
        component.id,
        {
          revision: device,
          bindings: [{ terminalId, signalId: component.signals[0].id }],
        },
      ],
    ]),
  });
  const placed = await api.placeUnplacedComponent(
    api.applyCircuitEco(board, review),
    component.id,
    {
      positionNm: { x: 2_000_000, y: 2_000_000 },
      rotationMicrodegree: 90_000_000,
      side: 'top',
    },
  );
  const routed = await api.decodeBoard(
    await api.encodeBoard({
      ...placed,
      requiredFeatures: [...placed.requiredFeatures, 'routed-copper'],
      tracks: [
        {
          id: crypto.randomUUID(),
          layerId: 'top',
          netId: initial.nets[0].id,
          widthNm: 250_000,
          start: placed.footprints[0].positionNm,
          end: { x: 4_000_000, y: 2_000_000 },
        },
      ],
    }),
  );
  const edited = api.editBoardReferences(
    routed,
    new Map([[component.id, 'C12']]),
  );
  const back = api.applyBackAnnotation(drawing, edited, initial, initial);
  const reopenedSchematic = await api.decodeDrawing(
    await api.encodeDrawing(back.drawing, 'zip-v1'),
  );
  const reopenedBoard = await api.decodeBoard(
    await api.encodeBoard(back.board),
  );
  assert.equal(reference(reopenedSchematic).value, 'C12');
  assert.equal(
    api.boardPadSources(reopenedBoard, reopenedBoard.appliedCircuit)[0]
      .reference,
    'C12',
  );
  assert.equal(
    api.previewBackAnnotation(
      reopenedSchematic,
      reopenedBoard,
      reopenedBoard.appliedCircuit,
      await compile(reopenedSchematic, reopenedBoard.appliedCircuit),
    ).changes.length,
    0,
  );
  reference(reopenedSchematic).value = 'C21';
  const forward = await api.previewCircuitEco(
    reopenedBoard,
    reopenedBoard.appliedCircuit,
    await compile(reopenedSchematic, reopenedBoard.appliedCircuit),
  );
  const final = api.applyCircuitEco(reopenedBoard, forward);
  assert.equal(
    api.boardPadSources(final, final.appliedCircuit)[0].reference,
    'C21',
  );
  assert.deepEqual(final.footprints, routed.footprints);
  assert.deepEqual(final.tracks, routed.tracks);
  assert.deepEqual(
    final.nets.map(({ id }) => id),
    routed.nets.map(({ id }) => id),
  );
  assert.deepEqual(final.deviceDefinitions, routed.deviceDefinitions);
  assert.equal(
    final.sourceCircuit.connectivityDigest,
    routed.sourceCircuit.connectivityDigest,
  );
  assert.equal(
    (
      await api.previewCircuitEco(
        final,
        final.appliedCircuit,
        await compile(reopenedSchematic, final.appliedCircuit),
      )
    ).unchanged,
    true,
  );
});
