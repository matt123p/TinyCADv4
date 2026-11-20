import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents: `
      export * from './src/pcb/board';
      export * from './src/pcb/geometry';
      export * from './src/pcb/footprint';
      export * from './src/pcb/connectivity';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});
const {
  analyseRoundCopper,
  BOARD_COORDINATE_LIMIT_NM,
  BoardHistory,
  BoardRevisionConflict,
  createBoard,
  lengthInNanometres,
  parseBoard,
  placeFootprintPoint,
  serializeBoard,
  validateOutline,
  validatePadMap,
} = await import(
  `data:text/javascript;base64,${Buffer.from(
    compiled.outputFiles[0].contents,
  ).toString('base64')}`
);

const points = (pairs) => pairs.map(([x, y]) => ({ x, y }));
const rectangle = points([
  [0, 0],
  [50_000_000, 0],
  [50_000_000, 30_000_000],
  [0, 30_000_000],
]);
const triangle = points([
  [0, 0],
  [20_000_000, 0],
  [0, 10_000_000],
]);

test('round trips an embedded device and preserves optional fields across edits', () => {
  const board = createBoard('Embedded device', 2, rectangle);
  const [
    documentId,
    layerId,
    footprintId,
    deviceId,
    signalId,
    padId,
    instanceId,
    componentId,
  ] = Array.from({ length: 8 }, () => crypto.randomUUID());
  const digest = `sha256:${'a'.repeat(64)}`;
  const input = {
    ...board,
    requiredFeatures: ['straight-outline', 'embedded-devices'],
    sourceCircuit: { documentId, revision: 3, connectivityDigest: digest },
    graphicLayers: [
      { id: layerId, role: 'silk', side: 'top', name: 'F.Silkscreen' },
    ],
    footprintDefinitions: [
      {
        id: footprintId,
        revision: 'r1',
        definitionDigest: digest,
        name: 'SOT-23',
        pads: [
          {
            id: padId,
            label: '01',
            positionNm: { x: 500, y: 600 },
            vendorInfo: { text: 'keep me' },
          },
        ],
      },
    ],
    deviceDefinitions: [
      {
        id: deviceId,
        revision: 'r1',
        definitionDigest: digest,
        packageName: 'SOT-23',
        packageSource: 'example package drawing',
        footprintId,
        signalIds: [signalId],
        assignments: [{ padId, kind: 'signal', signalId }],
      },
    ],
    footprints: [
      {
        id: instanceId,
        deviceId,
        componentId,
        side: 'top',
        locked: false,
        positionNm: { x: 12, y: 34 },
        rotationMicrodegree: 45_000_000,
      },
    ],
    vendorInfo: { list: ['a', 'b'], origin: 'test' },
  };
  const loaded = parseBoard(JSON.stringify(input));
  assert.equal(loaded.sourceCircuit.documentId, documentId);
  assert.equal(loaded.graphicLayers[0].role, 'silk');
  assert.equal(loaded.footprintDefinitions[0].pads[0].label, '01');
  const history = new BoardHistory(loaded);
  const edited = history.apply({
    apiVersion: 1,
    boardId: board.boardId,
    expectedRevision: 0,
    operations: [{ type: 'rename', title: 'Edited' }],
  });
  const restored = parseBoard(serializeBoard(edited));
  assert.deepEqual(restored.vendorInfo, input.vendorInfo);
  assert.deepEqual(restored.footprintDefinitions, input.footprintDefinitions);
  assert.deepEqual(restored.deviceDefinitions, input.deviceDefinitions);
  assert.deepEqual(restored.footprints, input.footprints);
  assert.throws(
    () =>
      parseBoard(
        JSON.stringify({ ...input, requiredFeatures: ['straight-outline'] }),
      ),
    /embedded-devices/,
  );
  assert.throws(
    () =>
      parseBoard(
        JSON.stringify({
          ...input,
          graphicLayers: [{ ...input.graphicLayers[0], role: 'copper' }],
        }),
      ),
    /graphic layer/,
  );
  assert.throws(
    () =>
      parseBoard(
        JSON.stringify({
          ...input,
          footprints: [
            { ...input.footprints[0], deviceId: crypto.randomUUID() },
          ],
        }),
      ),
    /component binding/,
  );
  assert.throws(
    () =>
      parseBoard(
        JSON.stringify({
          ...input,
          deviceDefinitions: [
            { ...input.deviceDefinitions[0], assignments: [] },
          ],
        }),
      ),
    /device mapping/,
  );
});

test('converts decimal dimensions exactly at nanometre resolution', () => {
  assert.equal(lengthInNanometres('1', 'mil'), 25_400);
  assert.equal(lengthInNanometres(' -0.000001 ', 'mm'), -1);
  assert.equal(lengthInNanometres('0.005', 'mil'), 127);
  assert.equal(lengthInNanometres('-0', 'nm'), 0);
  assert.throws(() => lengthInNanometres('0.01', 'nm'), /whole nanometre/);
  assert.throws(
    () => lengthInNanometres('9007199254740993', 'nm'),
    /out of range/,
  );
  assert.throws(() => lengthInNanometres('25', 'inch'), /supported unit/);
});

test('distinguishes concavity, a redundant collinear point, and invalid outline topology', () => {
  validateOutline(
    points([
      [0, 0],
      [10, 0],
      [20, 0],
      [20, 20],
      [8, 8],
      [0, 20],
    ]),
  );
  assert.throws(
    () =>
      validateOutline(
        points([
          [0, 0],
          [20, 20],
          [0, 20],
          [20, 0],
        ]),
      ),
    /intersects/,
  );
  assert.throws(
    () =>
      validateOutline(
        points([
          [0, 0],
          [20, 0],
          [10, 0],
          [0, 20],
        ]),
      ),
    /overlap/,
  );
  assert.throws(
    () =>
      validateOutline(
        points([
          [0, 0],
          [20, 0],
          [20, 0],
          [0, 20],
        ]),
      ),
    /zero-length/,
  );
  assert.throws(
    () =>
      validateOutline(
        points([
          [0, 0],
          [20, 0],
          [20, 20],
          [10, 0],
          [0, 20],
        ]),
      ),
    /intersects/,
  );
  assert.throws(
    () =>
      validateOutline(
        points([
          [0, 0],
          [20, 0],
          [0, BOARD_COORDINATE_LIMIT_NM + 1],
        ]),
      ),
    /coordinate range/,
  );
});

test('accepts a one-square-nanometre cross product near the coordinate limit', () => {
  const limit = BOARD_COORDINATE_LIMIT_NM;
  validateOutline(
    points([
      [-limit, -limit],
      [limit - 1, limit - 2],
      [limit, limit - 1],
    ]),
  );
});

test('round trips a deterministic two-layer board without changing identity', () => {
  const board = createBoard('Example Ω', 2, rectangle);
  const encoded = serializeBoard(board);
  assert.equal(serializeBoard(parseBoard(encoded)), encoded);
  assert.equal(parseBoard(encoded).boardId, board.boardId);
  assert.deepEqual(board.copperLayers, [
    { id: 'top', order: 0 },
    { id: 'bottom', order: 1 },
  ]);
  assert.deepEqual(createBoard('One layer', 1, rectangle).copperLayers, [
    { id: 'top', order: 0 },
  ]);
  assert.throws(
    () => parseBoard(JSON.stringify({ ...board, schemaVersion: 2 })),
    /version/,
  );
  assert.throws(
    () =>
      parseBoard(
        JSON.stringify({
          ...board,
          requiredFeatures: ['straight-outline', 'arcs'],
        }),
      ),
    /feature/,
  );
  assert.throws(
    () =>
      parseBoard(
        JSON.stringify({
          ...board,
          copperLayers: [...board.copperLayers].reverse(),
        }),
      ),
    /layer order/,
  );
});

test('applies a batch atomically and restores geometry with monotonic revisions', () => {
  const board = createBoard('Original', 2, rectangle);
  const history = new BoardHistory(board);
  const command = {
    apiVersion: 1,
    boardId: board.boardId,
    expectedRevision: 0,
  };
  const rename = { type: 'rename', title: 'Edited' };
  assert.throws(() =>
    history.apply({
      ...command,
      operations: [rename, { type: 'replaceOutline', outline: [] }],
    }),
  );
  assert.deepEqual(history.board, board);
  history.apply({
    ...command,
    operations: [rename, { type: 'replaceOutline', outline: triangle }],
  });
  assert.deepEqual(history.board.outline, triangle);
  assert.equal(history.board.title, 'Edited');
  assert.throws(
    () => history.apply({ ...command, operations: [rename] }),
    BoardRevisionConflict,
  );
  assert.deepEqual(history.undo(1), { ...board, revision: 2 });
  assert.throws(() => history.redo(1), BoardRevisionConflict);
  assert.deepEqual(history.redo(2).outline, triangle);
  history.undo(3);
  history.apply({ ...command, expectedRevision: 4, operations: [rename] });
  assert.equal(history.redo(5).revision, 5);
  assert.deepEqual(history.board.outline, rectangle);
});

test('copies and freezes source geometry', () => {
  const input = structuredClone(rectangle);
  const board = createBoard('Immutable', 1, input);
  input[0].x = 100;
  assert.equal(board.outline[0].x, 0);
  assert.throws(() => {
    board.outline[0].x = 200;
  }, TypeError);
});

test('assigns duplicate numbered lands individually and preserves string labels', () => {
  const pads = ['A1', 'EP', 'EP', '01', ''].map((label, i) => ({
    id: `pad-${i}`,
    label,
    positionNm: { x: i * 100_000, y: i * 200_000 },
  }));
  const assignments = [
    { padId: 'pad-0', kind: 'signal', signalId: 'input' },
    { padId: 'pad-1', kind: 'signal', signalId: 'ground' },
    { padId: 'pad-2', kind: 'signal', signalId: 'ground' },
    { padId: 'pad-3', kind: 'nc' },
    { padId: 'pad-4', kind: 'mechanical' },
  ];
  assert.deepEqual(validatePadMap(['input', 'ground'], pads, assignments), []);
  assert.deepEqual(
    pads.map((pad) => pad.label),
    ['A1', 'EP', 'EP', '01', ''],
  );
  assert.deepEqual(
    validatePadMap(['input', 'ground', 'power'], pads, [
      ...assignments.slice(0, 4),
      { padId: 'pad-2', kind: 'signal', signalId: 'input' },
      { padId: 'EP', kind: 'signal', signalId: 'unrecognised' },
    ]),
    [
      'Pad pad-2 has multiple assignments.',
      'Assignment refers to unknown pad EP.',
      'Pad EP refers to unknown signal unrecognised.',
      'Pad pad-4 has no assignment.',
      'Required signal power has no pad.',
    ],
  );
});

test('places the same asymmetric pad on either side using exact integer transforms', () => {
  const point = { x: 2_000_000, y: 1_000_000 };
  const positionNm = { x: 20_000_000, y: 30_000_000 };
  const placement = {
    rotationMicrodegree: 90_000_000,
    positionNm,
    side: 'top',
  };
  assert.deepEqual(placeFootprintPoint(point, placement), {
    x: 19_000_000,
    y: 32_000_000,
  });
  assert.deepEqual(
    placeFootprintPoint(point, { ...placement, side: 'bottom' }),
    { x: 19_000_000, y: 28_000_000 },
  );
  assert.deepEqual(
    placeFootprintPoint(point, {
      ...placement,
      rotationMicrodegree: -270_000_000,
    }),
    { x: 19_000_000, y: 32_000_000 },
  );
  assert.throws(
    () =>
      placeFootprintPoint(point, {
        ...placement,
        rotationMicrodegree: 45_000_000,
      }),
    /90 degrees/,
  );
});

test('round copper detects a seeded open, a plated connection, and a short at an exact contact', () => {
  const land = (id, layerId, x, terminalNetId) => ({
    id,
    layerId,
    centre: { x, y: 0 },
    radiusNm: 500_000,
    terminalNetId,
  });
  const lands = [
    land('signal-top', 'top', -800_000, 'signal'),
    land('signal-bottom', 'bottom', 800_000, 'signal'),
    land('via-top', 'top', 0),
    land('via-bottom', 'bottom', 0),
  ];
  const barrel = { landIds: ['via-top', 'via-bottom'], plating: 'plated' };
  const open = analyseRoundCopper(lands, [
    { ...barrel, plating: 'non-plated' },
  ]);
  assert.deepEqual(open.opens, [
    { netId: 'signal', terminalGroups: [['signal-bottom'], ['signal-top']] },
  ]);
  const connected = analyseRoundCopper(lands, [barrel]);
  assert.equal(connected.connectedSets.length, 1);
  assert.deepEqual(connected.opens, []);
  assert.deepEqual(
    analyseRoundCopper([...lands].reverse(), [barrel]),
    connected,
  );
  const near = land('other', 'top', -1_800_001, 'ground');
  assert.deepEqual(analyseRoundCopper([...lands, near], [barrel]).shorts, []);
  const touching = { ...near, centre: { x: -1_800_000, y: 0 } };
  const short = analyseRoundCopper([...lands, touching], [barrel]);
  assert.deepEqual(short.pointContacts, [['other', 'signal-top']]);
  assert.deepEqual(
    short.shorts.map(({ netIds }) => netIds),
    [['ground', 'signal']],
  );
});
