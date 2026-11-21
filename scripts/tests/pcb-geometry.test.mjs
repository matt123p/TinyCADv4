import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { Vector3 } from 'three';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { classroomBoard } from '../pcb/classroom-fixture.mjs';
import { thermalFixture } from './pcb-thermal-fixture.mjs';
import { placementFixture } from './pcb-placement-fixture.mjs';

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('clipper2-wasm/package.json'));
const compiled = await build({
  stdin: {
    contents: `
      export * from './src/pcb/contours';
      export * from './src/pcb/geometry';
      export * from './src/pcb/polygonKernel';
      export * from './src/pcb/copper';
      export * from './src/pcb/padstack';
      export * from './src/pcb/routing';
      export * from './src/pcb/routingRegions';
      export * from './src/pcb/boardProfiles';
      export * from './src/pcb/boardAnnotations';
      export * from './src/pcb/boardPlacement';
      export * from './src/pcb/manualBoardRouting';
      export * from './src/pcb/boardCopperGeometry';
      export * from './src/pcb/routingSnap';
      export * from './src/pcb/trackEdits';
      export * from './src/pcb/routeDeletion';
      export * from './src/pcb/routeCleanup';
      export * from './src/pcb/zoneFill';
      export * from './src/pcb/boardZoneGeometry';
      export * from './src/pcb/zoneWidthChecks';
      export * from './src/pcb/boardChecks';
      export * from './src/pcb/boardParity';
      export * from './src/pcb/boardRules';
      export * from './src/pcb/regionDistances';
      export * from './src/pcb/boardCam';
      export * from './src/pcb/footprintText';
      export * from './src/pcb/boardReleaseReview';
      export * from './src/pcb/homeEtchDrawing';
      export * from './src/pcb/kicadBoardExport';
      export * from './src/pcb/kicadBoardReview';
      export * from './src/pcb/boardInspection';
      export * from './src/pcb/modelPlacementMatrix';
      export * from './src/pcb/camWriter';
      export * from './src/pcb/camReadback';
      export * from './src/pcb/board';
      export * from './src/pcb/boardCodec';
      export * from './src/pcb/footprint';
      export * from './src/pcb/kicadFootprint';
      export * from './src/pcb/geometryRevision';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  write: false,
  plugins: [
    {
      name: 'node-clipper',
      setup(builder) {
        builder.onResolve({ filter: /^(clipper2-wasm|three)$/ }, ({ path }) => ({
          path: path === 'three' ? import.meta.resolve('three') : pathToFileURL(require.resolve(path)).href,
          external: true,
        }));
      },
    },
  ],
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(
    compiled.outputFiles[0].contents,
  ).toString('base64')}`
);
const binary = await readFile(
  path.join(packageRoot, 'dist/umd/clipper2z.wasm'),
);
const kernel = await api.loadPolygonKernel(
  binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
);

const point = (x, y) => ({ x, y });
const polygon = (x1, y1, x2, y2) => [
  point(x1, y1),
  point(x2, y1),
  point(x2, y2),
  point(x1, y2),
];
const edges = (points) =>
  points.map((start, i) => ({
    kind: 'line',
    start,
    end: points[(i + 1) % points.length],
  }));
const region = (outer, holes = []) => ({ outer, holes });
const area = (regions) =>
  regions.reduce(
    (total, { outer, holes }) =>
      total +
      Number(
        api.signedDoubleArea(outer) +
          holes.reduce((a, hole) => a + api.signedDoubleArea(hole), BigInt(0)),
      ) /
        2,
    0,
  );

test('lays out silkscreen strokes with defined alignment, rotation and field substitution', () => {
  const item = {
    kind: 'text', layer: 'F.SilkS', visible: true, strokeNm: 150_000, filled: false,
    at: point(2e6, 2e6), sizeNm: point(0.6e6, 1e6),
    rotationMicrodegree: 0, align: ['left', 'bottom'], text: 'L',
  };
  assert.deepEqual(api.footprintTextStrokes(item), [[point(2e6, 3e6), point(2e6, 2e6), point(2.6e6, 2e6)]]);
  assert.deepEqual(api.footprintTextStrokes({
    ...item, align: ['left', 'bottom', 'mirror'], rotationMicrodegree: 90e6,
  }), [[point(1e6, 2e6), point(2e6, 2e6), point(2e6, 1.4e6)]]);
  const imported = api.importKicadFootprint(
    '(footprint "Label" (layer "F.Cu") (property "Reference" "REF**" (at 1 2) (layer "F.SilkS")' +
    ' (effects (font (size 1 1) (thickness 0.15))))' +
    ' (pad "1" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Mask")))',
  );
  assert.equal(api.resolveFootprintText(imported.graphics[0].text, { reference: 'R17' }), 'R17');
  assert.throws(() => api.resolveFootprintText(imported.graphics[0].text, {}), /no placed reference/);
});

test('preserves an analytic outline and rejects invalid cutout topology', async () => {
  const centre = point(0, 0);
  const right = point(2_000_000, 0);
  const left = point(-2_000_000, 0);
  const outline = [
    { kind: 'arc', start: right, end: left, centre, clockwise: false },
    { kind: 'arc', start: left, end: right, centre, clockwise: false },
  ];
  const cutout = edges(polygon(-100_000, -100_000, 100_000, 100_000));
  const result = api.profileRegion({ outline, cutouts: [cutout] });
  assert.deepEqual(result.outer[0], right);
  assert(result.outer.some((vertex) => vertex.y > 1_999_900));
  assert.deepEqual(
    result.holes[0],
    cutout.map(({ start }) => start),
  );
  assert.throws(
    () => api.profileRegion({ outline, cutouts: [cutout, cutout] }),
    /cannot touch/,
  );
  assert.throws(
    () =>
      api.profileRegion({
        outline,
        cutouts: [edges(polygon(1_900_000, 0, 2_100_000, 2_000))],
      }),
    /inside/,
  );
  assert.throws(
    () =>
      api.flattenContour([{ ...outline[0], centre: point(1, 0) }, outline[1]]),
    /same radius/,
  );
  assert.throws(
    () => api.flattenContour([{ ...outline[0], end: centre }, outline[1]]),
    /gap/,
  );
  const board = api.createBoard(
    'Profile',
    2,
    polygon(-2_000_000, -2_000_000, 2_000_000, 2_000_000),
  );
  const history = new api.BoardHistory(board);
  const profile = { outline, cutouts: [cutout] };
  const resultBoard = history.apply({
    apiVersion: 1,
    boardId: board.boardId,
    expectedRevision: 0,
    operations: [{ type: 'replaceProfile', profile }],
  });
  assert.equal(resultBoard.outline, undefined);
  assert.deepEqual(
    (await api.decodeBoard(await api.encodeBoard(resultBoard))).profile,
    profile,
  );
  assert.deepEqual(history.undo(1).outline, board.outline);
});

test('uses exact winding topology at an edge and within one nanometre of it', () => {
  const shape = polygon(499_000_000, 499_000_000, 500_000_000, 500_000_000);
  assert.equal(
    api.pointInPolygon(point(500_000_000, 499_500_000), shape),
    'boundary',
  );
  assert.equal(
    api.pointInPolygon(point(499_999_999, 499_500_000), shape),
    'inside',
  );
  assert.equal(
    api.pointInPolygon(point(498_999_999, 499_500_000), shape),
    'outside',
  );
  assert.equal(
    api.pointInPolygon(point(499_000_000, 499_000_000), [...shape].reverse()),
    'boundary',
  );
});

test('clips and offsets copper using integer paths and preserves nested islands', () => {
  const outer = region(polygon(0, 0, 20_000, 20_000));
  const cutter = region(polygon(5_000, 5_000, 15_000, 15_000));
  const island = region(polygon(6_000, 6_000, 7_000, 7_000));
  const donut = kernel.boolean('difference', [outer], [cutter]);
  assert.equal(donut.length, 1);
  assert.equal(donut[0].holes.length, 1);
  assert.equal(area(donut), 300_000_000);
  const result = kernel.boolean('union', donut, [island]);
  assert.equal(result.length, 2);
  assert.equal(area(result), 301_000_000);
  assert.equal(
    area(kernel.boolean('intersection', [cutter], result)),
    1_000_000,
  );
  const offset = kernel.offset([cutter], 1_000);
  assert.equal(offset.length, 1);
  assert.equal(Math.min(...offset[0].outer.map(({ x }) => x)), 4_000);
  assert.equal(Math.max(...offset[0].outer.map(({ x }) => x)), 16_000);
  assert(kernel.memoryBytes() > 0);
});

const feature = (id, layerId, kind, outer, netId, terminalId) => ({
  id,
  layerId,
  kind,
  region: region(outer),
  netId,
  terminalId,
});

test('imports a bounded KiCad pad subset and blocks unsupported electrical geometry', () => {
  const source = `(footprint "Test" (version 20241229) (layer "F.Cu")
    (pad "01" thru_hole oval (at 1 -2 90) (size 1.4 1) (drill oval 0.8 0.5) (layers "*.Cu" "*.Mask"))
    (pad "" np_thru_hole circle (at 4 3) (size 1 1) (drill 1) (layers "*.Cu" "*.Mask"))
    (model "unresolved.step"))`;
  const { pads, issues } = api.importKicadFootprint(source);
  assert.deepEqual(
    issues.map(({ severity }) => severity),
    ['warning'],
  );
  assert.equal(pads[0].label, '01');
  assert.deepEqual(pads[0].positionNm, point(1_000_000, 2_000_000));
  assert.deepEqual(pads[0].stack.drill.end, point(0, 150_000));
  assert.equal(pads[1].stack.drill.plated, false);
  assert.deepEqual(pads[1].stack.copper, {});
  const invalid = api.importKicadFootprint(
    source.replace('thru_hole oval', 'thru_hole trapezoid'),
  );
  assert.equal(invalid.pads.length, 0);
  assert(invalid.issues.some(({ severity }) => severity === 'blocker'));
  assert.throws(
    () => api.importKicadFootprint(`${source}(foo)`),
    /Unexpected data/,
  );
});

test('binds a saved physical padstack and rejects stale board results after an edit or undo', () => {
  const [footprintId, deviceId, signalId, padId, componentId, instanceId] =
    Array.from({ length: 6 }, () => crypto.randomUUID());
  const digest = `sha256:${'2'.repeat(64)}`;
  const shape = {
    kind: 'polygon',
    vertices: polygon(-500_000, -200_000, 500_000, 200_000),
  };
  const saved = api.validateBoard({
    ...api.createBoard('Padstack', 2, polygon(0, 0, 10_000_000, 10_000_000)),
    requiredFeatures: [
      'straight-outline',
      'embedded-devices',
      'physical-padstacks',
    ],
    footprintDefinitions: [
      {
        id: footprintId,
        name: 'Part',
        revision: 'v1',
        definitionDigest: digest,
        pads: [
          {
            id: padId,
            label: '01',
            positionNm: point(0, 0),
            stack: { copper: { top: shape } },
          },
        ],
      },
    ],
    deviceDefinitions: [
      {
        id: deviceId,
        revision: 'v1',
        definitionDigest: digest,
        packageName: 'Part',
        packageSource: 'Fixture',
        footprintId,
        signalIds: [signalId],
        assignments: [{ padId, kind: 'signal', signalId }],
      },
    ],
    footprints: [
      {
        id: instanceId,
        componentId,
        deviceId,
        positionNm: point(2_000_000, 3_000_000),
        side: 'bottom',
        rotationMicrodegree: 30_000_000,
        locked: true,
      },
    ],
  });
  const placed = api.placeEmbeddedDevice(saved, instanceId, [
    { signalId, terminalId: 'J1.01', netId: 'GND' },
  ]);
  assert.equal(placed.copper[0].layerId, 'bottom');
  assert.equal(placed.copper[0].terminalId, 'J1.01');
  assert.equal(placed.copper[0].region.outer.length, 4);
  assert.throws(
    () =>
      api.validateBoard({
        ...saved,
        requiredFeatures: ['straight-outline', 'embedded-devices'],
      }),
    /physical-padstacks/,
  );
  const history = new api.BoardHistory(saved);
  const stamp = {
    boardId: saved.boardId,
    revision: saved.revision,
    inputDigest: digest,
    engine: 'test',
  };
  const apply = (board) =>
    api.isCurrentGeometryRevision(stamp, {
      ...stamp,
      revision: board.revision,
    });
  assert.equal(apply(history.board), true);
  assert.equal(
    apply(
      history.apply({
        apiVersion: 1,
        boardId: saved.boardId,
        expectedRevision: 0,
        operations: [{ type: 'rename', title: 'Updated' }],
      }),
    ),
    false,
  );
  assert.equal(apply(history.undo(1)), false);
  assert.equal(
    api.isCurrentGeometryRevision(stamp, { ...stamp, engine: 'other' }),
    false,
  );
});

test('extracts drilled annuli and plated slots with real voids and independent layers', () => {
  const centre = point(3_000_000, 4_000_000);
  const slotEnd = point(4_000_000, 4_000_000);
  const drill = {
    id: 'slot',
    start: centre,
    end: slotEnd,
    widthNm: 500_000,
    plated: true,
  };
  const pad = api.capsulePolygon(centre, slotEnd, 1_000_000);
  const a = feature('a', 'top', 'pad', pad, 'A', 'A1');
  const b = feature('b', 'bottom', 'pad', pad, 'A', 'A2');
  const insideSlot = feature(
    'ghost',
    'top',
    'pad',
    polygon(3_200_000, 3_950_000, 3_300_000, 4_050_000),
    'B',
    'B1',
  );
  const plated = api.analyseCopper(kernel, [a, b, insideSlot], [drill]);
  assert.deepEqual(plated.connectedSets, [['a/0', 'b/0']]);
  assert.deepEqual(plated.bareOpens, { nets: [], missingTerminals: ['B1'] });
  assert.equal(plated.copper[0].region.holes.length, 1);
  assert.equal(plated.copper[1].region.holes.length, 1);
  const nonPlated = api.analyseCopper(
    kernel,
    [a, b],
    [{ ...drill, plated: false }],
  );
  assert.deepEqual(nonPlated.bareOpens.nets, [
    { netId: 'A', terminalGroups: [['A1'], ['A2']] },
  ]);
  const withShort = api.analyseCopper(
    kernel,
    [a, { ...b, netId: 'B' }],
    [drill],
  );
  assert.deepEqual(
    withShort.shorts.map(({ netIds }) => netIds),
    [['A', 'B']],
  );
  const crossed = api.analyseCopper(kernel, [a, { ...b, netId: 'B' }], []);
  assert.deepEqual(crossed.connectedSets, [['a/0'], ['b/0']]);
  assert.deepEqual(crossed.shorts, []);
});

test('identifies reliance on isolated point contacts and accepts shared edges or a solid parallel path', () => {
  const a = feature('a', 'top', 'pad', polygon(0, 0, 1000, 1000), 'N', 'A');
  const b = feature('b', 'top', 'pad', polygon(1000, 1000, 2000, 2000), 'N', 'B');
  const pointContact = api.analyseCopper(kernel, [a, b], []);
  assert.deepEqual(pointContact.bareOpens.nets, []);
  assert.deepEqual(pointContact.fragileContacts, [{
    fragments: ['a/0', 'b/0'], netId: 'N', location: point(1000, 1000),
  }]);
  const sharedEdge = { ...b, region: region(polygon(0, 1000, 1000, 2000)) };
  assert.deepEqual(api.analyseCopper(kernel, [a, sharedEdge], []).fragileContacts, []);
  const bridge = feature('bridge', 'top', 'track', polygon(500, 500, 1500, 1500), 'N');
  assert.deepEqual(api.analyseCopper(kernel, [a, b, bridge], []).fragileContacts, []);
});

test('uses clipped copper islands and separates fitted jumpers and reviewed ties', () => {
  const a = feature('a', 'top', 'pad', polygon(0, 0, 1_000, 1_000), 'N', 'a');
  const b = feature(
    'b',
    'top',
    'pad',
    polygon(9_000, 0, 10_000, 1_000),
    'N',
    'b',
  );
  const track = feature(
    'track',
    'top',
    'track',
    polygon(500, 400, 9_500, 600),
    'N',
  );
  const drill = {
    id: 'npth',
    start: point(5_000, 500),
    end: point(5_000, 500),
    widthNm: 1_000,
    plated: false,
  };
  const jumper = {
    terminals: ['a', 'b'],
    kind: 'jumper',
    source: 'reviewed 0R jumper',
    fitted: true,
  };
  const split = api.analyseCopper(kernel, [a, b, track], [drill], [jumper]);
  assert.equal(
    split.copper.filter(({ feature }) => feature.id === 'track').length,
    2,
  );
  assert.equal(split.bareOpens.nets.length, 1);
  assert.deepEqual(split.assembledOpens.nets, []);
  const internal = {
    ...jumper,
    kind: 'internal-equivalence',
    source: 'Review of internally common lands',
  };
  const equivalents = api.analyseCopper(kernel, [a, b], [], [internal]);
  assert.equal(equivalents.bareOpens.nets.length, 1);
  assert.deepEqual(equivalents.assembledOpens.nets, []);
  assert.throws(
    () =>
      api.analyseCopper(kernel, [a, { ...b, netId: 'OTHER' }], [], [internal]),
    /same intended net/,
  );
  assert.equal(
    api.analyseCopper(kernel, [a, b], [], [{ ...jumper, fitted: false }])
      .assembledOpens.nets.length,
    1,
  );
  const different = { ...b, netId: 'OTHER' };
  const tie = { ...track, kind: 'tie', netId: undefined };
  const declaration = { featureId: tie.id, terminals: ['a', 'b'] };
  const tied = api.analyseCopper(
    kernel,
    [a, different, tie],
    [],
    [],
    [declaration],
  );
  assert.deepEqual(tied.invalidTies, []);
  assert.deepEqual(tied.shorts, []);
  assert.equal(tied.connectedSets.length, 1);
  const bypass = feature(
    'bypass',
    'top',
    'track',
    polygon(500, 0, 9_500, 100),
    'N',
  );
  const failed = api.analyseCopper(
    kernel,
    [a, different, tie, bypass],
    [],
    [],
    [declaration],
  );
  assert.deepEqual(failed.invalidTies, [tie.id]);
  assert.equal(failed.shorts.length, 1);
});

test('previews and commits a legal classroom route across the obstacle batches', async () => {
  const board = await api.decodeBoard(await classroomBoard());
  const netId = board.nets.find(({ name }) => name === 'U1-1').id;
  const widthNm = 250_000;
  const prepared = api.prepareManualTrackClearance(board, { netId, widthNm }, kernel);
  const start = point(5e6, 8e6);
  const end = point(8e6, 8e6);
  assert.equal(api.isCentrelineClear(prepared, start, end, 'top'), true);
  assert.equal(api.isCentrelineClear(prepared, point(3e6, 5e6), point(5e6, 5e6), 'top'), false);
  assert.equal(api.isCentrelineClear(prepared, point(93e6, 86e6), point(96e6, 86e6), 'top'), false);
  const path = [start, end].map((position) => ({ position, layer: 'top' }));
  const next = api.commitManualRoute(board, {
    netId, widthNm, path, viaDiameterNm: 650_000, viaDrillNm: 300_000,
  }, kernel);
  assert.equal(next.tracks.length, 2001);
  assert.deepEqual(next.tracks.slice(0, -1), board.tracks);
  assert.deepEqual(next.tracks.at(-1).end, end);
});

test('routes round an obstacle with a legal via and leaves the input intact', () => {
  const profile = region(polygon(0, 0, 12_000_000, 8_000_000));
  const foreign = feature(
    'blocker',
    'top',
    'pad',
    polygon(4_000_000, 2_000_000, 7_000_000, 6_000_000),
    'OTHER',
  );
  const bottomForeign = { ...foreign, id: 'bottom-blocker', layerId: 'bottom' };
  const start = { position: point(2_000_000, 4_000_000), layer: 'top' };
  const goal = { position: point(10_000_000, 4_000_000), layer: 'bottom' };
  const request = {
    id: 'route',
    netId: 'N',
    profile,
    layers: ['top', 'bottom'],
    start,
    goal,
    gridNm: 500_000,
    widthNm: 200_000,
    viaDiameterNm: 550_000,
    viaDrillNm: 250_000,
    drills: [],
    obstacles: [foreign, bottomForeign],
    rules: {
      minWidthNm: 150_000,
      clearanceNm: 250_000,
      edgeClearanceNm: 150_000,
      minViaAnnulusNm: 120_000,
    },
  };
  const snapshot = JSON.stringify(request);
  const route = api.routeBoard(kernel, request);
  assert.equal(route.status, 'routed');
  assert.equal(route.drills.length, 1);
  assert(route.tracks.length >= 3);
  const pads = [start, goal].map(({ position, layer }, i) =>
    feature(
      `p${i}`,
      layer,
      'pad',
      api.circlePolygon(position, 300_000),
      'N',
      `t${i}`,
    ),
  );
  const check = api.analyseCopper(
    kernel,
    [...pads, ...route.tracks, ...route.vias, foreign, bottomForeign],
    route.drills,
  );
  assert.deepEqual(check.shorts, []);
  assert.deepEqual(check.bareOpens.nets, []);
  assert.equal(JSON.stringify(request), snapshot);
  assert.equal(
    api.routeBoard(kernel, { ...request, maxVisits: 1 }).status,
    'budget',
  );
  assert.equal(
    api.routeBoard(kernel, { ...request, signal: AbortSignal.abort() }).status,
    'cancelled',
  );
  assert.throws(
    () => api.routeBoard(kernel, { ...request, viaDiameterNm: 400_000 }),
    /dimensions/,
  );
});

test('places an asymmetric mixed device and fills a slotted thermal around an arbitrary polygon pad', () => {
  const local = point(0, 0);
  const slotEnd = point(800_000, 0);
  const slotLand = {
    kind: 'capsule',
    start: local,
    end: slotEnd,
    widthNm: 1_300_000,
  };
  const smdLand = {
    kind: 'polygon',
    vertices: polygon(-400_000, -300_000, 400_000, 300_000),
  };
  const device = {
    id: 'hybrid',
    pads: [
      {
        id: 'A1',
        label: '01',
        positionNm: local,
        stack: {
          copper: { top: slotLand, bottom: slotLand },
          drill: { start: local, end: slotEnd, widthNm: 500_000, plated: true },
        },
      },
      {
        id: 'EP',
        label: 'EP',
        positionNm: point(2_500_000, 800_000),
        stack: {
          copper: { top: smdLand },
          mask: { top: smdLand },
          paste: { top: smdLand },
        },
      },
    ],
    assignments: [
      { padId: 'A1', kind: 'signal', signalId: 'ground' },
      { padId: 'EP', kind: 'signal', signalId: 'output' },
    ],
  };
  const positionNm = point(5_000_000, 4_000_000);
  const placed = api.placeDevice(
    'J1',
    device,
    { positionNm, rotationMicrodegree: 30_000_000, side: 'bottom' },
    ['top', 'bottom'],
    [
      { signalId: 'ground', terminalId: 'J1.01', netId: 'GND' },
      { signalId: 'output', terminalId: 'J1.EP', netId: 'OUT' },
    ],
  );
  assert.deepEqual(placed.drills[0].end, point(4_307_180, 3_600_000));
  assert(placed.copper.some(({ id }) => id === 'J1:EP:bottom'));
  assert.deepEqual(
    placed.apertures.map(({ kind, side }) => [kind, side]),
    [
      ['mask', 'bottom'],
      ['paste', 'bottom'],
    ],
  );
  const profile = region(polygon(0, 0, 12_000_000, 9_000_000), [
    polygon(9_000_000, 6_000_000, 10_000_000, 7_000_000),
  ]);
  const groundTerminal = feature(
    'test',
    'bottom',
    'pad',
    polygon(8_000_000, 2_000_000, 8_500_000, 2_500_000),
    'GND',
    'test',
  );
  const zone = api.fillZone(kernel, {
    id: 'ground',
    layerId: 'bottom',
    netId: 'GND',
    profile,
    boundary: profile,
    copper: [...placed.copper, groundTerminal],
    drills: placed.drills,
    clearanceNm: 250_000,
    edgeClearanceNm: 150_000,
    thermals: [
      {
        padId: 'J1:A1:bottom',
        anchor: positionNm,
        spokeWidthNm: 250_000,
        gapNm: 250_000,
      },
    ],
  });
  assert(zone.length > 0);
  const result = api.analyseCopper(
    kernel,
    [...placed.copper, groundTerminal, ...zone],
    placed.drills,
  );
  assert.deepEqual(result.shorts, []);
  assert.deepEqual(result.bareOpens, { nets: [], missingTerminals: [] });
  assert.equal(
    api.analyseCopper(kernel, [...placed.copper, groundTerminal], placed.drills)
      .bareOpens.nets.length,
    1,
  );
});

test('reads Gerber arcs, nested copper, and plated and non-plated drills from manufacturing bytes', () => {
  const right = point(10_000_000, 0),
    left = point(-10_000_000, 0);
  const centre = point(0, 0);
  const profile = {
    outline: [
      { kind: 'arc', start: right, end: left, centre, clockwise: false },
      { kind: 'arc', start: left, end: right, centre, clockwise: false },
    ],
    cutouts: [edges(polygon(-5_000_000, 1_000_000, -4_000_000, 2_000_000))],
  };
  const snapshot = {
    profile,
    layers: [
      {
        id: 'top',
        copper: [
          region(polygon(-3_000_000, -3_000_000, 3_000_000, 3_000_000), [
            polygon(-2_000_000, -2_000_000, 2_000_000, 2_000_000),
          ]),
          region(polygon(-1_000_000, -1_000_000, 1_000_000, 1_000_000)),
        ],
      },
      {
        id: 'bottom',
        copper: [region(polygon(-3_000_000, 4_000_000, 3_000_000, 7_000_000))],
      },
    ],
    drills: [
      {
        id: 'slotted',
        start: point(0, 4_500_000),
        end: point(-1_500_000, 4_500_000),
        widthNm: 500_000,
        plated: true,
      },
      {
        id: 'via',
        start: point(0, 0),
        end: point(0, 0),
        widthNm: 350_000,
        plated: true,
      },
      {
        id: 'mount',
        start: point(6_000_000, 0),
        end: point(6_000_000, 0),
        widthNm: 1_500_000,
        plated: false,
      },
    ],
  };
  const files = api.writeCamFiles(kernel, snapshot);
  assert.deepEqual(api.verifyCamFiles(kernel, snapshot, files), []);
  assert.equal(api.readGerber(files['profile.gbr']).contours[0][0].kind, 'arc');
  assert.equal(api.readXnc(files['plated.xnc']).drills.length, 2);
  assert.equal(api.readXnc(files['non-plated.xnc']).drills[0].plated, false);
  for (const [name, mutated] of [
    ['plated.xnc', files['plated.xnc'].replace('0.500000', '0.510000')],
    ['profile.gbr', files['profile.gbr'].replace('G03*', 'G02*')],
    ['copper-top.gbr', files['copper-top.gbr'].replace('%LPC*%', '%LPD*%')],
    ['copper-bottom.gbr', undefined],
  ]) {
    const corrupted = { ...files, [name]: mutated };
    assert(
      api
        .verifyCamFiles(kernel, snapshot, corrupted)
        .some((issue) => issue.startsWith(name)),
      name,
    );
  }
});

test('authored footprint lands and slot dimensions survive placement and CAM read-back', async () => {
  const { makeFootprintPad } = await layoutRuntime();
  const profiles = [
    'round',
    'rectangle',
    'oval',
    'roundrect',
    'polygon',
    'hole',
  ];
  const pads = profiles.map((profile, index) =>
    makeFootprintPad({
      id: profile,
      label: String(index + 1),
      positionNm: point(index * 3_000_000, 0),
      profile,
      widthNm: profile === 'round' ? 1_300_000 : 2_000_000,
      heightNm: 1_300_000,
      cornerRadiusNm: 200_000,
      polygon: [
        point(-400_000, -300_000),
        point(600_000, -300_000),
        point(300_000, 400_000),
      ],
      drillWidthNm:
        profile === 'oval' ? 700_000 : profile === 'hole' ? 1_200_000 : 0,
      drillLengthNm:
        profile === 'oval' ? 1_300_000 : profile === 'hole' ? 1_200_000 : 0,
    }),
  );
  const assignments = pads.map(({ id: padId }) =>
    padId === 'hole'
      ? { padId, kind: 'mechanical' }
      : { padId, kind: 'signal', signalId: padId },
  );
  const placed = api.placeDevice(
    'J1',
    { id: 'connector', pads, assignments },
    {
      positionNm: point(5_000_000, 18_000_000),
      rotationMicrodegree: 90_000_000,
      side: 'bottom',
    },
    ['top', 'bottom'],
    profiles
      .slice(0, -1)
      .map((signalId) => ({ signalId, terminalId: signalId, netId: signalId })),
  );
  const profile = {
    outline: edges(polygon(0, 0, 10_000_000, 20_000_000)),
    cutouts: [],
  };
  const snapshot = {
    profile,
    layers: ['top', 'bottom'].map((id) => ({
      id,
      copper: placed.copper
        .filter(({ layerId }) => layerId === id)
        .map(({ region }) => region),
    })),
    drills: placed.drills,
  };
  assert.deepEqual(
    api.analyseCopper(kernel, placed.copper, placed.drills).shorts,
    [],
  );
  assert.deepEqual(
    snapshot.layers.map(({ copper }) => copper.length),
    [1, 5],
  );
  const files = api.writeCamFiles(kernel, snapshot);
  assert.deepEqual(api.verifyCamFiles(kernel, snapshot, files), []);
  const [{ start, end, widthNm, plated }] = api.readXnc(
    files['plated.xnc'],
  ).drills;
  assert.deepEqual(
    { start, end, widthNm, plated },
    {
      start: point(5_000_000, 12_300_000),
      end: point(5_000_000, 11_700_000),
      widthNm: 700_000,
      plated: true,
    },
  );
  const [hole] = api.readXnc(files['non-plated.xnc']).drills;
  assert.deepEqual(hole.start, point(5_000_000, 3_000_000));
  assert.deepEqual(hole.end, hole.start);
  assert.equal(hole.widthNm, 1_200_000);
  assert.equal(hole.plated, false);
});

test('reopens a copied XML board offline with shared definitions, connectivity and STEP data', async (t) => {
  const id = () => crypto.randomUUID();
  const footprintId = id(),
    deviceId = id(),
    signalId = id(),
    padId = id(),
    ncPadId = id();
  const netId = id();
  const origin = point(0, 0);
  const shape = {
    kind: 'capsule',
    start: origin,
    end: origin,
    widthNm: 800_000,
  };
  const stack = {
    copper: { top: shape, bottom: shape },
    mask: { top: shape },
    paste: {},
    drill: {
      start: point(-100_000, 0),
      end: point(100_000, 0),
      widthNm: 300_000,
      plated: true,
    },
  };
  const digest = 'sha256:' + 'a'.repeat(64);
  const part21 = new TextEncoder().encode(
    [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('TinyCAD fixture'),'2;1');",
      "FILE_NAME('fixture.step','2026-01-01T00:00:00',('TinyCAD'),('TinyCAD'),'TinyCAD','TinyCAD','');",
      "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
      'ENDSEC;',
      'DATA;',
      "#1=CARTESIAN_POINT('',(0.,0.,0.));",
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n'),
  );
  const modelAsset = await api.createBoardModelAsset(
    part21,
    'Fixture Ω',
    'CC0-1.0',
  );
  const profile = {
    outline: edges(polygon(0, 0, 15_000_000, 12_000_000)),
    cutouts: [edges(polygon(7_000_000, 7_000_000, 8_000_000, 8_000_000))],
  };
  const { outline, ...board } = api.createBoard(
    'Offline Ω & <layout>',
    2,
    polygon(0, 0, 15_000_000, 12_000_000),
  );
  const components = ['U01', 'U02'].map((reference, index) => ({
    id: id(),
    logicalId: id(),
    reference,
    value: 'Fixture Ω',
    role: index ? 'dnp' : 'electrical',
    units: [{ id: id(), sheetId: id() }],
    signals: [{ signalId, netId }],
  }));
  const original = api.validateBoard({
    ...board,
    profile,
    components,
    requiredFeatures: [
      'analytic-profile',
      'embedded-devices',
      'physical-padstacks',
    ],
    sourceCircuit: {
      documentId: id(),
      revision: 2,
      connectivityDigest: digest,
    },
    graphicLayers: [{ id: id(), role: 'silk', side: 'top', name: 'F. Silk' }],
    nets: [{ id: netId, name: '3V3', aliases: ['VCC'] }],
    rules: {
      minWidthNm: 200_000,
      clearanceNm: 180_000,
      edgeClearanceNm: 250_000,
      minViaAnnulusNm: 100_000,
    },
    footprintDefinitions: [
      {
        id: footprintId,
        revision: 'r1',
        definitionDigest: digest,
        name: 'Asymmetric & model',
        pads: [
          {
            id: padId,
            label: '01',
            positionNm: point(100_000, 200_000),
            stack,
            vendor: { text: 'preserve' },
          },
          { id: ncPadId, label: 'A1', positionNm: point(1_300_000, 0), stack },
        ],
        graphics: [
          {
            kind: 'line', layer: 'F.SilkS', strokeNm: 120_000, filled: false,
            start: point(0, 200_000), end: point(650_000, 200_000),
          },
          {
            kind: 'line', layer: 'F.SilkS', strokeNm: 0, filled: false,
            start: point(0, 300_000), end: point(650_000, 300_000),
          },
          {
            kind: 'rect', layer: 'F.CrtYd', strokeNm: 100_000, filled: false,
            start: point(-1e6, -3e6), end: point(2e6, 3e6),
          },
          {
            kind: 'text',
            layer: 'F.SilkS',
            strokeNm: 100_000,
            filled: false,
            at: point(200_000, 400_000),
            text: '<A> Ω\nβ',
            sizeNm: point(600_000, 500_000),
            rotationMicrodegree: 90_000_000,
            visible: true,
            align: ['left'],
          },
        ],
        models: [
          {
            assetId: modelAsset.id,
            kind: 'step',
            source: 'fixture.step',
            quality: 'generated-envelope',
            offsetNm: [100_000, 200_000, 300_000],
            rotationMicrodegree: [0, 0, 90_000_000],
            scale: [1, 0.75, 1.25],
          },
        ],
      },
    ],
    deviceDefinitions: [
      {
        id: deviceId,
        footprintId,
        revision: 'r1',
        definitionDigest: digest,
        packageName: 'X2',
        packageSource: 'Fixture',
        signalIds: [signalId],
        assignments: [
          { padId, kind: 'signal', signalId },
          { padId: ncPadId, kind: 'nc' },
        ],
      },
    ],
    footprints: components.map(({ id: componentId }, index) => ({
      id: id(),
      componentId,
      deviceId,
      side: index ? 'bottom' : 'top',
      positionNm: point(2_000_000 + index * 5_000_000, 3_000_000),
      rotationMicrodegree: 90_000_000,
      locked: index === 1,
    })),
    modelAssets: [modelAsset],
  });
  const bytes = await api.encodeBoard(original);
  const xml = new TextDecoder().decode(bytes);
  assert.match(
    xml,
    /^<\?xml version="1.0" encoding="UTF-8"\?>\s+<TinyCADPCB version="1">/,
  );
  assert.equal((xml.match(/<PADSTACKDEF /g) ?? []).length, 1);
  assert.equal((xml.match(/<FOOTPRINTDEF /g) ?? []).length, 1);
  assert.equal((xml.match(/<DEVICEDEF /g) ?? []).length, 1);
  assert.equal((xml.match(/<MODELASSET /g) ?? []).length, 1);
  assert.equal((xml.match(/<FOOTPRINT /g) ?? []).length, 2);
  assert.match(xml, /label="01"/);
  const directory = await mkdtemp(path.join(tmpdir(), 'tinycad-dpn-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'copied.dpn');
  await writeFile(filename, bytes);
  const boardCopy = await api.decodeBoard(await readFile(filename));
  assert.deepEqual(boardCopy, original);
  assert.deepEqual(await api.encodeBoard(boardCopy), bytes);
  assert.deepEqual(
    await api.readBoardModelAsset(boardCopy.modelAssets[0]),
    part21,
  );
  const [x, y] = boardCopy.footprintDefinitions[0].models[0].offsetNm;
  assert.deepEqual(
    api.placeFootprintPoint(point(x, y), boardCopy.footprints[1]),
    point(6_800_000, 2_900_000),
  );

  function cam(board) {
    const placed = board.footprints.map((instance) => {
      const component = board.components.find(
        ({ id }) => id === instance.componentId,
      );
      const bindings = component.signals.map((signal) => ({
        ...signal,
        terminalId: component.reference + '.01',
      }));
      return api.placeEmbeddedDevice(board, instance.id, bindings);
    });
    const copper = placed.flatMap(({ copper }) => copper);
    const drills = placed.flatMap(({ drills }) => drills);
    const analysis = api.analyseCopper(kernel, copper, drills);
    assert.equal(analysis.bareOpens.nets.length, 1);
    const snapshot = {
      profile: board.profile,
      layers: board.copperLayers.map(({ id }) => ({
        id,
        copper: copper
          .filter(({ layerId }) => layerId === id)
          .map(({ region }) => region),
      })),
      drills,
    };
    const files = api.writeCamFiles(kernel, snapshot);
    assert.deepEqual(api.verifyCamFiles(kernel, snapshot, files), []);
    return files;
  }
  assert.deepEqual(cam(boardCopy), cam(original));
  const preview = await api.prepareCamPreview(boardCopy, kernel);
  for (const side of ['top', 'bottom']) {
    assert.match(preview.files[`mask-${side}.gbr`], /TF.FilePolarity,Negative/);
    assert.ok(preview.artwork.find((face) => face.kind === 'mask' && face.side === side).regions.length);
  }
  assert.match(preview.files['silk-top.gbr'], /TF.FileFunction,Legend,Top/);
  assert.match(preview.files['silk-bottom.gbr'], /TF.FileFunction,Legend,Bot/);
  assert.ok(preview.report.issues.some(({ code }) => code === 'silk-mask'));
  assert.ok(!preview.report.issues.some(({ code }) => code === 'silk-text'));
  assert.equal(preview.report.issues.filter(({ code }) => code === 'silk-geometry').length, 2);
  const [definition] = boardCopy.footprintDefinitions;
  const [text] = definition.graphics.filter(({ kind }) => kind === 'text');
  const fieldText = '$' + '{REFERENCE}';
  const supported = { ...definition, graphics: [{ ...text, text: fieldText }] };
  const currentLabels = { ...boardCopy, footprintDefinitions: [supported] };
  const referenceCam = await api.prepareCamPreview(currentLabels, kernel);
  const updatedLabels = {
    ...currentLabels,
    components: currentLabels.components.map((part) => ({ ...part, reference: 'R17' })),
  };
  const renamedCam = await api.prepareCamPreview(updatedLabels, kernel);
  assert.notEqual(referenceCam.files['silk-top.gbr'], renamedCam.files['silk-top.gbr']);
  assert.notEqual(referenceCam.files['silk-bottom.gbr'], renamedCam.files['silk-bottom.gbr']);
  const unsupported = await api.prepareCamPreview({
    ...boardCopy, footprintDefinitions: [{
      ...definition, graphics: [
        { ...text, text: '漢' },
        { ...text, visible: false, text: '二' },
      ],
    }],
  }, kernel);
  assert.equal(unsupported.report.issues.filter(({ code }) => code === 'silk-text').length, 2);
  assert.match(unsupported.report.issues.find(({ code }) => code === 'silk-text').message, /glyph "漢"/);
  assert.equal(unsupported.files['silk-top.gbr'], undefined);
  assert.equal(unsupported.files['silk-bottom.gbr'], undefined);

  assert.ok(!preview.report.issues.some(({ code }) => code === 'courtyard-overlap'));
  const sameSide = {
    ...boardCopy,
    footprints: boardCopy.footprints.map((placement) => ({ ...placement, side: 'top' })),
  };
  const collision = await api.checkBoard(sameSide, kernel);
  assert.ok(collision.issues.some(({ code }) => code === 'courtyard-overlap'));
  assert.match(preview.files['placement.csv'], /"U01",.*"Fitted","2","3","top","90"/);
  assert.doesNotMatch(preview.files['placement.csv'], /"U02"/);
  assert.match(preview.files['assembly.csv'], /"U02",.*"DNP","7","3","bottom","90"/);
  assert.match(preview.files['bom.csv'], /"U02","1",.*"DNP"/);
  assert.match(preview.files['assembly-top.svg'], /U01/);
  assert.doesNotMatch(preview.files['assembly-top.svg'], /U02/);
  assert.match(preview.files['assembly-bottom.svg'], /Bottom view \(mirrored\)/);
  assert.match(preview.files['assembly-bottom.svg'], /U02 \(DNP\)/);
  assert.match(preview.files['assembly-bottom.svg'], /10 mm/);
  assert.match(preview.manifest.files['assembly.csv'], /^[0-9a-f]{64}$/);
  const interchange = await api.exportKicadBoard(boardCopy);
  assert.match(interchange.pcb, /^\(kicad_pcb \(version 20241229\)\s+\(generator "tinycad"\)/);
  assert.match(interchange.pcb, /\(layer "B\.Cu"\)/);
  assert.equal(interchange.report.counts.footprints, 2);
  assert.equal(interchange.report.notes.filter(({ code }) => code === 'step-model').length, 2);
  assert.ok(interchange.report.notes.some(({ code }) => code === 'schematic-link'));
  assert.ok(interchange.report.notes.some(({ code }) => code === 'text-font'));
  assert.equal(interchange.report.source.boardId, boardCopy.boardId);
  assert.deepEqual(interchange, await api.exportKicadBoard(boardCopy));


  const history = new api.BoardHistory(boardCopy);
  const changedProfile = { ...profile, cutouts: [] };
  const edited = history.apply({
    apiVersion: 1,
    boardId: boardCopy.boardId,
    expectedRevision: boardCopy.revision,
    operations: [{ type: 'replaceProfile', profile: changedProfile }],
  });
  const editedCopy = await api.decodeBoard(await api.encodeBoard(edited));
  assert.deepEqual(editedCopy.profile, changedProfile);
  assert.deepEqual(editedCopy.modelAssets, boardCopy.modelAssets);

  const parse = (text) => api.decodeBoard(new TextEncoder().encode(text));
  await assert.rejects(
    parse(xml.replace('padstack_id="1"', 'padstack_id="9"')),
    /Missing PCB padstack/,
  );
  await assert.rejects(
    parse(xml.replace(modelAsset.base64, btoa('other STEP bytes'))),
    /SHA-256/,
  );
  await assert.rejects(
    parse(
      xml.replace(
        `asset_id="${modelAsset.id}"`,
        `asset_id="${'f'.repeat(64)}"`,
      ),
    ),
    /missing embedded STEP asset/,
  );
  await assert.rejects(parse(xml.replace(deviceId, id())), /component binding/);
});

test('preserves optional XML records through a board edit and rejects unsupported requirements', async () => {
  const encode = (text) => new TextEncoder().encode(text);
  const text = (bytes) => new TextDecoder().decode(bytes);
  const board = api.createBoard(
    'One layer Ω',
    1,
    polygon(0, 0, 4_000_000, 3_000_000),
  );
  const xml = text(await api.encodeBoard(board));
  const extension = '<VENDOR version="2"><PARAM name="Ω"/>free text</VENDOR>';
  const input = xml
    .replace(
      '<TinyCADPCB version="1">',
      '<TinyCADPCB version="1" vendor="AC &amp; DC">',
    )
    .replace('</TinyCADPCB>', extension + '</TinyCADPCB>')
    .replace('<POINT x="0" y="0"/>', '<POINT x="0" y="0" annotation="datum"/>')
    .replace('<DPNIDENTITY ', '<DPNIDENTITY vendor_title="Revision metadata" ');
  const loaded = await api.decodeBoard(encode(input));
  const history = new api.BoardHistory(loaded);
  const edited = history.apply({
    apiVersion: 1,
    boardId: loaded.boardId,
    expectedRevision: loaded.revision,
    operations: [{ type: 'rename', title: 'Updated' }],
  });
  const saved = await api.encodeBoard(edited);
  assert(text(saved).includes(extension));
  assert.match(text(saved), /vendor="AC &amp; DC"/);
  assert.match(text(saved), /annotation="datum"/);
  assert.match(text(saved), /vendor_title="Revision metadata"/);
  assert.deepEqual(await api.encodeBoard(await api.decodeBoard(saved)), saved);
  assert.equal((await api.decodeBoard(saved)).title, 'Updated');

  await assert.rejects(
    api.decodeBoard(encode(JSON.stringify(board))),
    /TinyCADPCB XML/,
  );
  await assert.rejects(
    api.decodeBoard(
      encode(
        xml.replace('<TinyCADPCB version="1">', '<TinyCADPCB version="9">'),
      ),
    ),
    /version/,
  );
  await assert.rejects(
    api.decodeBoard(encode(xml.replace('straight-outline', 'future-outline'))),
    /feature requirements/,
  );
  await assert.rejects(
    api.decodeBoard(
      encode(
        xml.replace('</TinyCADPCB>', '<VENDOR required="true"/></TinyCADPCB>'),
      ),
    ),
    /Unsupported required/,
  );
  await assert.rejects(
    api.decodeBoard(
      encode(
        xml.replace(
          '<TinyCADPCB',
          '<!DOCTYPE pcb SYSTEM "file:///tmp/pcb"><TinyCADPCB',
        ),
      ),
    ),
    /Invalid PCB XML/,
  );
  await assert.rejects(
    api.decodeBoard(encode(xml.replace('x="4000000"', 'x="4.5"'))),
    /integer value/,
  );
});

test('manual routing validates drills, foreign copper and through-vias before committing', async () => {
  const board = api.createBoard(
    'Workshop board',
    2,
    polygon(0, 0, 10_000_000, 10_000_000),
  );
  const signal = crypto.randomUUID();
  const other = crypto.randomUUID();
  const fixture = api.validateBoard({
    ...board,
    requiredFeatures: [
      ...board.requiredFeatures,
      'routed-copper',
      'mechanical-holes',
    ],
    nets: [
      { id: signal, name: 'Signal' },
      { id: other, name: 'Other' },
    ],
    tracks: [
      {
        id: crypto.randomUUID(),
        netId: other,
        layerId: 'top',
        widthNm: 250_000,
        start: point(3_000_000, 1_000_000),
        end: point(3_000_000, 5_000_000),
      },
    ],
    mechanicalHoles: [
      {
        id: crypto.randomUUID(),
        widthNm: 400_000,
        plated: false,
        clearanceNm: 200_000,
        start: point(7_000_000, 3_000_000),
        end: point(7_000_000, 4_000_000),
      },
    ],
  });
  const at = (x, y, layer = 'top') => ({ position: point(x, y), layer });
  const route = (path) =>
    api.commitManualRoute(
      fixture,
      {
        netId: signal,
        widthNm: 250_000,
        path,
        viaDiameterNm: 650_000,
        viaDrillNm: 300_000,
      },
      kernel,
    );
  assert.throws(
    () => route([at(1_000_000, 2_000_000), at(5_000_000, 2_000_000)]),
    /Track blocked/,
  );
  const crossing = {
    id: crypto.randomUUID(), netId: signal, layerId: 'top', widthNm: 250_000,
    start: point(1_000_000, 2_000_000), end: point(5_000_000, 2_000_000),
  };
  const imported = await api.decodeBoard(await api.encodeBoard({
    ...fixture, tracks: [...fixture.tracks, crossing],
  }));
  const report = await api.checkBoard(imported, kernel);
  assert.ok(report.issues.some(({ code, objects }) =>
    code === 'short' && [fixture.tracks[0], crossing].every(({ id }) => objects.includes(id + '/0')),
  ));
  assert.throws(
    () => route([at(6_000_000, 3_500_000), at(8_000_000, 3_500_000)]),
    /Track blocked/,
  );
  const candidate = route([
    at(1_000_000, 2_000_000),
    at(2_000_000, 2_000_000),
    at(2_000_000, 2_000_000, 'bottom'),
    at(5_000_000, 2_000_000, 'bottom'),
  ]);
  assert.equal(candidate.tracks.length, 3);
  assert.equal(candidate.vias.length, 1);
  const history = new api.BoardHistory(fixture);
  const edited = history.commit(candidate);
  const reopened = await api.decodeBoard(await api.encodeBoard(edited));
  assert.deepEqual(reopened, edited);
  assert.equal(history.undo(edited.revision).tracks.length, 1);
});

test('moves, rotates, aligns and distributes placed components atomically', async () => {
  const board = placementFixture(api);
  const ids = board.components.map(({ id }) => id);
  const positions = (result) => result.footprints.map(({ positionNm }) =>
    [positionNm.x / 1e6, positionNm.y / 1e6]);
  const translated = api.movePlacedGroup(board, ids, { kind: 'translate', delta: point(2e6, -1e6) });
  assert.deepEqual(positions(translated), [[12, 9], [17, 12], [24, 15]]);
  assert.equal(translated.revision, board.revision + 1);
  const rotated = api.movePlacedGroup(board, ids, { kind: 'rotate', angle: 90e6 });
  assert.deepEqual(positions(rotated), [[10, 10], [7, 15], [4, 22]]);
  assert.deepEqual(rotated.footprints.map(({ rotationMicrodegree }) => rotationMicrodegree), [90e6, 120e6, 150e6]);
  assert.deepEqual(rotated.footprints.map(({ side }) => side), ['top', 'bottom', 'top']);
  const aligned = api.movePlacedGroup(board, [ids[2], ids[0], ids[1]], { kind: 'align', axis: 'x' });
  assert.deepEqual(positions(aligned), [[22, 10], [22, 13], [22, 16]]);
  const distributed = api.movePlacedGroup(board, ids, { kind: 'distribute', axis: 'x' });
  assert.deepEqual(positions(distributed), [[10, 10], [16, 13], [22, 16]]);
  assert.throws(() => api.movePlacedGroup(board, ids.slice(0, 2), { kind: 'distribute', axis: 'x' }), /at least 3/);
  assert.throws(() => api.movePlacedGroup(board, ids, { kind: 'translate', delta: point(20e6, 0) }), /inside the board/);
  const profile = api.editableProfile(board);
  const withCutout = new api.BoardHistory(board).apply({
    apiVersion: 1, boardId: board.boardId, expectedRevision: board.revision,
    operations: [{ type: 'replaceProfile', profile: {
      ...profile, cutouts: [api.straightContour(polygon(11e6, 9e6, 13e6, 11e6))],
    } }],
  });
  assert.throws(() => api.movePlacedGroup(withCutout, ids, { kind: 'translate', delta: point(2e6, 0) }), /outside its cutouts/);
  const locked = { ...board, footprints: board.footprints.map((part, index) => ({ ...part, locked: index === 1 })) };
  assert.throws(() => api.movePlacedGroup(locked, ids, { kind: 'align', axis: 'y' }), /Unlock/);
  assert.equal(api.movePlacedGroup(board, ids, { kind: 'translate', delta: point(0, 0) }), board);
  const history = new api.BoardHistory(board);
  const moved = history.commit(translated);
  assert.deepEqual(positions(history.undo(moved.revision)), positions(board));
  assert.deepEqual(positions(history.redo(history.board.revision)), positions(translated));
  assert.deepEqual((await api.decodeBoard(await api.encodeBoard(moved))).footprints, moved.footprints);
});

test('enforces independent footprint locks and keeps them in the native board', async () => {
  const fixture = placementFixture(api);
  const board = {
    ...fixture,
    footprints: fixture.footprints.map((item, index) => ({
      ...item,
      ...(index === 0 ? { positionLocked: true } : { rotationLocked: true }),
    })),
  };
  const [anchor, part] = board.footprints;
  const ids = [anchor.componentId, part.componentId];
  assert.throws(
    () => api.movePlacedComponent(board, anchor.componentId, {
      ...anchor, positionNm: point(11e6, 10e6),
    }),
    /Unlock the component position/,
  );
  const rotated = api.movePlacedComponent(board, anchor.componentId, {
    positionNm: anchor.positionNm, rotationMicrodegree: 90e6, side: anchor.side,
  });
  assert.equal(rotated.footprints[0].rotationMicrodegree, 90e6);
  assert.throws(
    () => api.movePlacedComponent(board, part.componentId, { ...part, rotationMicrodegree: 90e6 }),
    /Unlock the component rotation/,
  );
  const aligned = api.movePlacedGroup(board, ids, { kind: 'align', axis: 'y' });
  assert.equal(aligned.footprints[1].positionNm.y, anchor.positionNm.y);
  assert.equal(aligned.footprints[1].rotationMicrodegree, part.rotationMicrodegree);
  assert.throws(
    () => api.movePlacedGroup(board, ids, { kind: 'rotate', angle: 90e6 }),
    /Unlock the component rotation/,
  );
  assert.throws(
    () => api.movePlacedGroup(board, ids, { kind: 'translate', delta: point(1e6, 0) }),
    /Unlock the component position/,
  );
  const fullLock = { ...board, footprints: [{ ...anchor, locked: true }, part] };
  assert.throws(
    () => api.movePlacedComponent(fullLock, anchor.componentId, {
      ...anchor, side: 'bottom',
    }),
    /Unlock the component before/,
  );
  const reopened = await api.decodeBoard(await api.encodeBoard(aligned));
  assert.deepEqual(reopened.footprints, aligned.footprints);
  const { pcb, report } = await api.exportKicadBoard(fullLock);
  assert.match(pcb, /\(locked yes\)/);
  assert.ok(report.notes.some(({ code }) => code === 'partial-placement-lock'));
});

test('models wire jumpers as drilled lands and explicit assembly bridges', async () => {
  const fixture = placementFixture(api);
  const base = api.createBoard('Jumper fixture', 1, fixture.outline);
  const netId = crypto.randomUUID();
  const signalId = crypto.randomUUID();
  const [device] = fixture.deviceDefinitions;
  const [footprint] = fixture.footprintDefinitions;
  const jumper = {
    id: crypto.randomUUID(), reference: 'JP1', netId, fitted: true,
    start: point(12e6, 10e6), end: point(17e6, 13e6), landWidthNm: 2e6, drillNm: 0.8e6,
  };
  const track = (start, end) => ({
    id: crypto.randomUUID(), netId, layerId: 'top', widthNm: 0.5e6, start, end,
  });
  const editable = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'embedded-devices', 'physical-padstacks', 'routed-copper'],
    nets: [{ id: netId, name: 'Signal' }],
    components: fixture.components.slice(0, 2).map((part) => ({
      ...part, role: 'electrical', signals: [{ signalId, netId }],
    })),
    deviceDefinitions: [{
      ...device, signalIds: [signalId],
      assignments: [{ kind: 'signal', padId: footprint.pads[0].id, signalId }],
    }],
    footprintDefinitions: [footprint],
    footprints: fixture.footprints.slice(0, 2).map((part) => ({ ...part, side: 'top' })),
    tracks: [track(fixture.footprints[0].positionNm, jumper.start), track(fixture.footprints[1].positionNm, jumper.end)],
  };
  const history = new api.BoardHistory(editable);
  const update = (jumper) => history.apply({
    apiVersion: 1, boardId: base.boardId, expectedRevision: history.board.revision,
    operations: [{ type: 'setWireJumper', jumper }],
  });
  assert.throws(() => update({ ...jumper, end: jumper.start }), /lands must be separate/);
  assert.throws(() => update({ ...jumper, start: point(0, 0) }), /inside the board/);
  const fitted = update(jumper);
  const decoded = await api.decodeBoard(await api.encodeBoard(fitted));
  assert.deepEqual(decoded.jumpers, [jumper]);
  const preview = await api.prepareCamPreview(decoded, kernel);
  assert.deepEqual(preview.report.jumperConnectivity, {
    bareOpenNets: [netId], assembledOpenNets: [],
  });
  assert.ok(preview.report.issues.some(({ code }) => code === 'bare-open-bridged'));
  assert.ok(!preview.report.issues.some(({ code }) => code === 'open' || code === 'short'));
  assert.ok(!api.manufacturingReadiness(decoded, preview).some(({ code }) => code === 'bare-open-bridged'));
  assert.deepEqual(preview.drills.map(({ plated }) => plated), [false, false]);
  assert.match(preview.files['bom.csv'], /"JP1","1","Wire jumper","Hand fitted","Fitted"/);
  assert.match(preview.files['bom-fitted.csv'], /"JP1","1","Wire jumper","Hand fitted","Fitted"/);
  assert.match(preview.files['jumpers.csv'], /"JP1","Signal","Fitted","12","10","17","13"/);
  assert.doesNotMatch(preview.files['placement.csv'], /JP1/);
  const review = await api.prepareBoardReleaseReview(decoded, preview, { reviewedFiles: [] });
  assert.ok(review.files['jumpers.csv']);
  assert.match(preview.files['assembly-bottom.svg'], /JP1 \(wire\)/);
  const dnp = update({ ...jumper, fitted: false });
  const dnpPreview = await api.prepareCamPreview(dnp, kernel);
  assert.deepEqual(dnpPreview.report.jumperConnectivity, {
    bareOpenNets: [netId], assembledOpenNets: [netId],
  });
  assert.equal(dnpPreview.files['copper-top.gbr'], preview.files['copper-top.gbr']);
  assert.match(dnpPreview.files['jumpers.csv'], /"DNP"/);
  assert.doesNotMatch(dnpPreview.files['bom-fitted.csv'], /"JP1"/);
  assert.deepEqual(history.undo(dnp.revision).jumpers, [jumper]);
});

test('prints matching single-sided home-etch artwork and drill templates at 1:1', async () => {
  const base = api.createBoard('Etch & fit', 1, polygon(0, 0, 30e6, 20e6));
  const netId = crypto.randomUUID();
  const board = new api.BoardHistory({
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: netId, name: 'Teaching net' }],
    tracks: [{
      id: crypto.randomUUID(), netId, layerId: 'top', widthNm: 500_000,
      start: point(3e6, 11e6), end: point(8e6, 11e6),
    }],
  }).apply({
    apiVersion: 1, boardId: base.boardId, expectedRevision: base.revision,
    operations: [
      { type: 'addMechanicalHole', hole: {
        id: crypto.randomUUID(), start: point(3e6, 7e6), end: point(3e6, 7e6),
        widthNm: 800_000, plated: false,
      } },
      { type: 'addMechanicalHole', hole: {
        id: crypto.randomUUID(), start: point(8e6, 3e6), end: point(12e6, 3e6),
        widthNm: 900_000, plated: false,
      } },
    ],
  });
  const preview = await api.prepareCamPreview(board, kernel);
  const normal = api.homeEtchDrawings(board, preview, 'unmirrored');
  const mirror = api.homeEtchDrawings(board, preview, 'mirrored');
  for (const [key, drawing] of Object.entries(normal)) {
    assert.match(drawing, /width="128mm" height="51mm" viewBox="-5 -20 128 51"/);
    assert.match(drawing, /Etch &amp; fit/);
    assert.match(drawing, /data-calibration-mm="10" d="M0,26 H10"/);
    assert.match(drawing, /UNMIRRORED · Board top view/);
    assert.match(mirror[key], /MIRRORED · X reflected/);
    assert.match(drawing, /No hole plating/);
  }
  assert.match(normal.drill, /data-drill-mm="0.8" cx="3" cy="13" r="0.4"/);
  assert.match(mirror.drill, /data-drill-mm="0.8" cx="27" cy="13" r="0.4"/);
  assert.match(normal.drill, /data-slot-mm="0.9" d="M8,17 L12,17"/);
  assert.match(mirror.drill, /data-slot-mm="0.9" d="M22,17 L18,17"/);
  assert.match(normal.copper, /data-copper="true"/);
  assert.notEqual(normal.copper, mirror.copper);
  assert.doesNotMatch(normal.copper, /data-centre/);
  assert.throws(() => api.homeEtchDrawings({ ...board, revision: board.revision + 1 }, preview, 'mirrored'), /current read-back/);
});

test('checks placed courtyards against same-side keep-outs and the union of keep-ins', async () => {
  const fixture = placementFixture(api);
  const [footprint] = fixture.footprintDefinitions;
  const board = {
    ...fixture,
    footprintDefinitions: [{
      ...footprint,
      graphics: [{
        kind: 'rect', layer: 'F.CrtYd', strokeNm: 50_000, filled: false,
        start: point(-1e6, -1e6), end: point(1e6, 1e6),
      }],
    }],
  };
  const make = (name, kind, outline) => ({
    id: crypto.randomUUID(), name, kind, outline, side: 'top',
  });
  const areas = [
    make('Left', 'keep-in', polygon(0, 0, 9.5e6, 20e6)),
    make('Right', 'keep-in', polygon(9.4e6, 0, 11e6, 20e6)),
    make('Antenna', 'keep-out', polygon(10.8e6, 9.5e6, 12e6, 10.5e6)),
    make('Top only', 'keep-out', polygon(14e6, 12e6, 16e6, 14e6)),
  ];
  const history = new api.BoardHistory(board);
  const withAreas = history.apply({
    apiVersion: 1, boardId: board.boardId, expectedRevision: board.revision,
    operations: areas.map((area) => ({ type: 'setPlacementArea', area })),
  });
  const reopened = await api.decodeBoard(await api.encodeBoard(withAreas));
  assert.deepEqual(reopened.placementAreas, withAreas.placementAreas);
  const report = await api.checkBoard(reopened, kernel);
  const areaFindings = report.issues.filter(({ code }) => code.startsWith('placement-keep-'));
  assert.deepEqual(areaFindings.map(({ code, objects }) => [code, objects[0]]), [
    ['placement-keep-out', board.components[0].id],
    ['placement-keep-in', board.components[2].id],
  ]);
  assert.match(areaFindings[0].message, /courtyard.*Antenna/);
  const fallback = await api.checkBoard({ ...reopened, footprintDefinitions: [footprint] }, kernel);
  assert.ok(!fallback.issues.some(({ code }) => code === 'placement-keep-out'));
  assert.equal(fallback.coverage.find(({ check }) => check.startsWith('Placement keep-in')).status, 'limited');
  const exported = await api.exportKicadBoard(reopened);
  assert.equal(exported.report.notes.filter(({ code }) => code === 'placement-area').length, areas.length);
  assert.equal(history.undo(withAreas.revision).placementAreas, undefined);
});

test('measures a clipped thermal spoke and identifies a missing spoke on connected copper', async () => {
  const { board, clipped } = thermalFixture(api);
  const clean = await api.checkBoard(board, kernel);
  assert.ok(!clean.issues.some(({ code }) => code.startsWith('thermal')));
  const stricter = await api.checkBoard({
    ...board, rules: { ...api.resolveBoardRules(board), minWidthNm: 350_000 },
  }, kernel);
  const allNarrow = stricter.issues.filter(({ code }) => code === 'thermal-spoke-width');
  assert.equal(allNarrow.length, 4);
  assert.ok(allNarrow.every(({ requiredNm, measuredNm }) =>
    requiredNm === 350_000 && Math.abs(measuredNm - 300_000) <= 200));
  const report = await api.checkBoard(clipped, kernel);
  const narrowed = report.issues.find(({ code }) => code === 'thermal-spoke-width');
  assert.match(narrowed.message, /^East/);
  assert.equal(narrowed.requiredNm, 300_000);
  assert.ok(Math.abs(narrowed.measuredNm - 180_000) <= 200, narrowed.measuredNm);
  const missing = report.issues.find(({ code }) => code === 'thermal-spoke-missing');
  assert.match(missing.message, /^North/);
  assert.equal(missing.measuredNm, 0);
  assert.ok(!report.issues.some(({ code }) => code === 'thermal-disconnected'));
  const fast = api.boardZoneGeometry(clipped, kernel);
  const verified = api.boardZoneGeometry(clipped, kernel, undefined, true);
  assert.deepEqual(verified.fills, fast.fills);
  const checksWithCachedFill = await api.checkBoard(clipped, kernel, { zones: fast });
  assert.deepEqual(checksWithCachedFill.issues, report.issues);
  const preview = await api.prepareCamPreview(clipped, kernel);
  assert.deepEqual(preview.report.issues.filter(({ code }) => code.startsWith('thermal')),
    report.issues.filter(({ code }) => code.startsWith('thermal')));
});

test('checks zone webs against the effective net width and the copper covering the web', async () => {
  const base = api.createBoard('Zone web', 2, polygon(0, 0, 20e6, 15e6));
  const id = () => crypto.randomUUID();
  const ground = id();
  const zone = {
    id: id(), netId: ground, layerId: 'bottom', priority: 1,
    outline: polygon(1e6, 1e6, 19e6, 14e6),
    cutouts: [
      { outline: polygon(5e6, 4e6, 7e6, 10e6) },
      { outline: polygon(7.1e6, 4e6, 10e6, 10e6) },
    ],
    padConnection: 'direct', viaConnection: 'direct', islands: 'retain',
    spokeWidthNm: 300_000, thermalGapNm: 300_000,
  };
  const board = {
    ...base, requiredFeatures: [...base.requiredFeatures, 'copper-zones'],
    nets: [{ id: ground, name: 'Ground', routingRules: { minWidthNm: 240_000 } }],
    zones: [zone],
  };
  const cachedFill = api.boardZoneGeometry(board, kernel);
  assert.equal(cachedFill.issues.length, 0);
  const widthIssues = (report) => report.issues.filter(({ code }) => code === 'zone-minimum-width');
  const report = await api.checkBoard(board, kernel, { zones: cachedFill });
  const [web] = widthIssues(report);
  assert.equal(widthIssues(report).length, 1);
  assert.equal(web.location.x, 7_050_000);
  assert.ok(web.location.y > 4e6 && web.location.y < 10e6);
  assert.deepEqual([web.measuredNm, web.requiredNm], [100_000, 240_000]);
  assert.ok(api.manufacturingReadiness(board, await api.prepareCamPreview(board, kernel))
    .some(({ code }) => code === 'zone-minimum-width'));

  const restored = {
    ...board, requiredFeatures: [...board.requiredFeatures, 'routed-copper'],
    tracks: [{
      id: id(), netId: ground, layerId: 'bottom', widthNm: 300_000,
      start: point(7.05e6, 3.5e6), end: point(7.05e6, 10.5e6),
    }],
  };
  const reread = await api.decodeBoard(await api.encodeBoard(restored));
  assert.deepEqual(widthIssues(await api.checkBoard(reread, kernel)), []);

  const incompleteKernel = {
    ...kernel,
    offset(regions, delta) {
      if (delta === -119_900) throw new Error('Width check limit');
      return kernel.offset(regions, delta);
    },
  };
  const incomplete = await api.prepareCamPreview(reread, incompleteKernel);
  assert.ok(incomplete.report.issues.some(({ code }) => code === 'zone-width-unverified'));
  assert.equal(incomplete.report.coverage.find(({ check }) => check === 'Thermal and zone integrity').status, 'limited');
  assert.ok(api.manufacturingReadiness(reread, incomplete).some(({ code }) => code === 'zone-width-unverified'));
});

test('keeps minimum-width boundaries and detects nonparallel necks', () => {
  const limit = 180_000;
  assert.equal(api.measureZoneWidth(kernel, region(polygon(0, 0, 8e6, limit)), limit), undefined);
  const angled = region([
    point(0, 0), point(2e6, 0), point(4e6, 2e6), point(6e6, 0), point(8e6, 0),
    point(8e6, 4e6), point(6e6, 4e6), point(4e6, 2.07e6), point(2e6, 4e6), point(0, 4e6),
  ]);
  assert.ok(api.measureZoneWidth(kernel, angled, limit)?.location);
  const rotated = region(angled.outer.map(({ x, y }) => point(y, -x)));
  assert.ok(api.measureZoneWidth(kernel, rotated, limit)?.location);
});

test('stores zone source geometry and deterministically rebuilds clearances and cutouts', async () => {
  const base = api.createBoard('Zone tests', 2, polygon(0, 0, 20e6, 15e6));
  const ground = crypto.randomUUID();
  const supply = crypto.randomUUID();
  const history = new api.BoardHistory({
    ...base,
    nets: [{ id: ground, name: 'Ground' }, { id: supply, name: 'Supply' }],
  });
  const zone = {
    id: crypto.randomUUID(), netId: ground, layerId: 'top', priority: 20,
    outline: polygon(1e6, 1e6, 14e6, 14e6),
    cutouts: [{ outline: polygon(3e6, 3e6, 4e6, 4e6) }],
    clearanceNm: 500_000,
    padConnection: 'direct', viaConnection: 'direct',
    spokeWidthNm: 220_000, thermalGapNm: 250_000, islands: 'retain',
  };
  const lower = {
    ...zone, id: crypto.randomUUID(), netId: supply, priority: 1,
    outline: polygon(8e6, 1e6, 18e6, 14e6), cutouts: [], clearanceNm: 200_000,
  };
  const authored = history.apply({
    apiVersion: 1, boardId: base.boardId, expectedRevision: 0,
    operations: [{ type: 'setZone', zone: lower }, { type: 'setZone', zone }],
  });
  const reopened = await api.decodeBoard(await api.encodeBoard(authored));
  assert.deepEqual(reopened.zones, authored.zones);
  const result = api.boardZoneGeometry(reopened, kernel);
  const reversed = api.boardZoneGeometry({ ...reopened, zones: [zone, lower] }, kernel);
  assert.deepEqual(reversed, result);
  assert.equal(result.fills.length, 2);
  assert.equal(result.fills[0].netId, ground);
  assert.equal(result.fills[0].region.holes.length, 1);
  const required = kernel.offset([result.fills[0].region], 500_000);
  assert.ok(!kernel.boolean('intersection', required, [result.fills[1].region]).length);
  const removed = api.boardZoneGeometry({
    ...reopened, zones: [{ ...zone, islands: 'remove' }],
  }, kernel);
  assert.equal(removed.fills.length, 0);
  const flagged = api.boardZoneGeometry({
    ...reopened, zones: [{ ...zone, islands: 'flag' }],
  }, kernel);
  assert.equal(flagged.issues[0].code, 'island');
  assert.equal(flagged.fills.length, 1);
  const orphan = api.boardZoneGeometry({ ...reopened, nets: [] }, kernel);
  assert.equal(orphan.fills.length, 0);
  assert.ok(orphan.issues.every(({ code }) => code === 'missing-net'));
  assert.equal(history.undo(authored.revision).zones, undefined);
});

test('checks actual PCB copper and reports unavailable checks explicitly', async () => {
  const base = api.createBoard('DRC', 2, polygon(0, 0, 20e6, 15e6));
  const ground = crypto.randomUUID();
  const supply = crypto.randomUUID();
  const track = (netId, y, widthNm) => ({
    id: crypto.randomUUID(), netId, layerId: 'top',
    start: point(1e6, y), end: point(5e6, y), widthNm,
  });
  const board = api.validateBoard({
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: ground, name: 'Ground' }, { id: supply, name: 'Supply' }],
    tracks: [track(ground, 1e6, 140_000), track(supply, 1_300_000, 200_000)],
  });
  const report = await api.checkBoard(board, kernel);
  assert.equal(report.boardId, board.boardId);
  assert.equal(report.revision, board.revision);
  assert.match(report.inputDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.issues.find(({ code }) => code === 'track-width').measuredNm, 140_000);
  const clearance = report.issues.find(({ code }) => code === 'copper-clearance');
  assert.equal(clearance.requiredNm, 200_000);
  assert.equal(clearance.measuredNm, 130_000);
  assert.ok(report.issues.some(({ code }) => code === 'floating-copper'));
  assert.ok(!report.issues.some(({ code }) => code === 'short'));
  assert.ok(report.coverage.some(({ status }) => status === 'unavailable'));
});

test('creates a CAM preview from the exported bytes and fingerprints that revision', async () => {
  const base = api.createBoard('Preview', 2, polygon(0, 0, 20e6, 15e6));
  const ground = crypto.randomUUID();
  const history = new api.BoardHistory({ ...base, nets: [{ id: ground, name: 'Ground' }] });
  const board = history.apply({
    apiVersion: 1, boardId: base.boardId, expectedRevision: 0,
    operations: [
      { type: 'addMechanicalHole', hole: {
        id: crypto.randomUUID(), start: point(8e6, 4e6), end: point(12e6, 4e6),
        widthNm: 1e6, plated: true, landWidthNm: 1.5e6,
      } },
      { type: 'setZone', zone: {
        id: crypto.randomUUID(), netId: ground, layerId: 'top', priority: 1,
        outline: polygon(1e6, 1e6, 19e6, 14e6), cutouts: [],
        padConnection: 'direct', viaConnection: 'direct', spokeWidthNm: 220_000,
        thermalGapNm: 250_000, islands: 'retain',
      } },
    ],
  });
  const preview = await api.prepareCamPreview(board, kernel);
  assert.deepEqual(Object.keys(preview.manifest.files).sort(), Object.keys(preview.files).sort());
  assert.equal(preview.files['checks.json'], JSON.stringify(preview.report, null, 2));
  assert.match(preview.files['assembly-top.svg'], /width="32mm" height="32mm" viewBox="-6 -21 32 32"/);
  assert.match(preview.files['assembly-bottom.svg'], /width="32mm" height="32mm" viewBox="-6 -21 32 32"/);
  assert.equal(preview.manifest.revision, board.revision);
  assert.equal(preview.manifest.inputDigest, preview.report.inputDigest);
  assert.equal(preview.drills.length, 1);
  assert.equal(preview.drills[0].plated, true);
  assert.ok(preview.layers[0].copper.some(({ holes }) => holes.length));
  assert.ok(preview.report.coverage.some(({ status }) => status === 'unavailable'));
});

test('freezes a traceable manufacturing review and rejects stale or altered preview inputs', async () => {
  const board = api.createBoard('Review', 2, polygon(0, 0, 20e6, 15e6));
  const preview = await api.prepareCamPreview(board, kernel);
  const options = {
    deterministic: true,
    projectId: crypto.randomUUID(),
    reviewedFiles: ['profile.gbr', 'copper-top.gbr', 'profile.gbr'],
  };
  const frozen = await api.prepareBoardReleaseReview(board, preview, options);
  assert.equal(frozen.manifest.status, 'NOT RELEASED');
  assert.equal(frozen.manifest.projectId, options.projectId);
  assert.deepEqual(frozen.manifest.cam.reviewedFiles, ['copper-top.gbr', 'profile.gbr']);
  assert.ok(frozen.manifest.checks.readiness.some(({ code }) => code === 'profile-required'));
  assert.ok(frozen.manifest.checks.readiness.some(({ code }) => code === 'copper-empty'));
  assert.equal(frozen.manifest.checks.coverage.find(({ check }) => check === 'Drills and slots').status, 'not applicable');
  assert.equal(frozen.manifest.checks.coverage.find(({ check }) => check === 'Thermal and zone integrity').status, 'not applicable');
  assert.ok(!frozen.manifest.checks.readiness.some(({ detail }) => /Thermal and zone integrity|Drills and slots/.test(detail)));
  assert.equal((await api.decodeBoard(frozen.files['board.dpn'])).boardId, board.boardId);
  assert.equal(frozen.manifest.nativeBoardSha256, frozen.manifest.outputs.find(({ filename }) => filename === 'board.dpn').sha256);
  assert.equal(frozen.manifest.outputs.length, Object.keys(frozen.files).length);
  assert.equal(frozen.manifest.timestampMode, 'normalized');

  const report = { ...preview.report, generatedAt: '2030-02-01T03:04:05Z' };
  const modifiedAt = JSON.stringify(report, null, 2);
  const { createHash } = await import('node:crypto');
  const another = {
    ...preview,
    report,
    files: { ...preview.files, 'checks.json': modifiedAt },
    manifest: {
      ...preview.manifest,
      generatedAt: report.generatedAt,
      files: { ...preview.manifest.files, 'checks.json': createHash('sha256').update(modifiedAt).digest('hex') },
    },
  };
  const rebuilt = await api.prepareBoardReleaseReview(board, another, options);
  assert.equal(frozen.manifest.reviewId, rebuilt.manifest.reviewId);
  assert.deepEqual(await api.archiveBoardReleaseReview(frozen), await api.archiveBoardReleaseReview(rebuilt));
  await assert.rejects(
    api.prepareBoardManufacturingRelease(board, preview, another, options),
    /Resolve the manufacturing blockers/,
  );
  await assert.rejects(
    api.prepareBoardManufacturingRelease(board, preview, {
      ...another, files: { ...another.files, 'copper-top.gbr': 'changed' },
    }, options),
    /changed after the CAM review/,
  );
  await assert.rejects(
    api.prepareBoardReleaseReview({ ...board, title: 'Altered at the same revision' }, preview, options),
    /changed after the CAM preview/,
  );
  await assert.rejects(
    api.prepareBoardReleaseReview(board, { ...preview, files: { ...preview.files, 'profile.gbr': 'corrupted' } }, options),
    /hash or file role/,
  );
  await assert.rejects(
    api.prepareBoardReleaseReview(board, preview, { ...options, reviewedFiles: ['board.dpn'] }),
    /must come from the current CAM preview/,
  );
  const changed = { ...frozen, files: { ...frozen.files, 'board.dpn': new Uint8Array([1, 2, 3]) } };
  await assert.rejects(api.archiveBoardReleaseReview(changed), /frozen review payload has changed/);
});

test('ties a waiver to the affected geometry and rules through save and reload', async () => {
  const base = api.createBoard('Waiver tests', 1, polygon(0, 0, 15e6, 15e6));
  const netId = crypto.randomUUID();
  const track = {
    id: crypto.randomUUID(), netId, layerId: 'top', widthNm: 200_000,
    start: point(2e6, 2e6), end: point(5e6, 2e6),
  };
  const history = new api.BoardHistory({
    ...base, requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: netId, name: 'Test copper' }], tracks: [track],
  });
  const finding = (await api.checkBoard(history.board, kernel)).issues.find(({ code }) => code === 'floating-copper');
  const waiver = { id: crypto.randomUUID(), code: finding.code, fingerprint: finding.advisory.fingerprint, reason: 'Fixture test copper' };
  const annotated = history.apply({
    apiVersion: 1, boardId: base.boardId, expectedRevision: 0, operations: [{ type: 'addWaiver', waiver }],
  });
  const reopened = await api.decodeBoard(await api.encodeBoard(annotated));
  const report = await api.checkBoard({ ...reopened, title: 'Renamed' }, kernel);
  assert.equal(report.issues.find(({ code }) => code === finding.code).advisory.waiver.reason, waiver.reason);
  assert.deepEqual(report.inactiveWaivers, []);
  const moved = { ...reopened, tracks: [{ ...track, end: point(5e6, 3e6) }] };
  const updated = await api.checkBoard(moved, kernel);
  assert.equal(updated.issues.find(({ code }) => code === finding.code).advisory.waiver, undefined);
  assert.equal(updated.inactiveWaivers[0].id, waiver.id);
});

test('aligns asymmetric STEP coordinates on top and bottom and keeps cutouts and slots in 3D', () => {
  const imported = api.importKicadFootprint(`(footprint "Fixture"
    (layer "F.Cu")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste"))
    (model "asymmetric.step" (offset (xyz 4 5 6)) (scale (xyz 2 3 1)) (rotate (xyz -90 0 0))))`);
  assert.deepEqual(imported.models[0].rotationMicrodegree, [90e6, 0, 0]);
  const model = api.modelLocalMatrix(imported.models[0]);
  const placement = { positionNm: point(10e6, 20e6), rotationMicrodegree: 90e6 };
  const top = api.boardMountMatrix({ ...placement, side: 'top' }, 1.6).multiply(model);
  const bottom = api.boardMountMatrix({ ...placement, side: 'bottom' }, 1.6).multiply(model);
  const rounded = (vector) => vector.toArray().map((value) => Math.round(value * 1000) / 1000);
  assert.deepEqual(rounded(new Vector3(1, 2, 3).applyMatrix4(top)), [8, 26, 12.8]);
  assert.deepEqual(rounded(new Vector3(1, 2, 3).applyMatrix4(bottom)), [8, 14, -12.8]);
  assert.ok(top.determinant() > 0 && bottom.determinant() > 0);

  const base = api.createBoard('Inspection', 2, polygon(0, 0, 20e6, 15e6));
  const history = new api.BoardHistory(base);
  const board = history.apply({
    apiVersion: 1, boardId: base.boardId, expectedRevision: 0,
    operations: [
      { type: 'replaceProfile', profile: {
        outline: edges(base.outline), cutouts: [edges(polygon(2e6, 2e6, 3e6, 3e6))],
      } },
      { type: 'addMechanicalHole', hole: {
        id: crypto.randomUUID(), start: point(8e6, 4e6), end: point(12e6, 4e6),
        widthNm: 1e6, plated: false,
      } },
    ],
  });
  const surface = api.boardInspectionSurface(board, kernel);
  assert.equal(surface.thicknessMm, 1.6);
  assert.equal(surface.substrate[0].holes.length, 2);
});

test('reads back solder mask and paste independently and rejects incorrect layer roles or polarity', () => {
  const profile = { outline: edges(polygon(0, 0, 10e6, 10e6)), cutouts: [] };
  const pads = [region(polygon(1e6, 1e6, 2e6, 2e6))];
  const snapshot = {
    profile, drills: [], layers: [{ id: 'top', copper: pads }],
    artwork: [
      { side: 'bottom', kind: 'mask', regions: pads },
      { side: 'top', kind: 'paste', regions: pads },
    ],
  };
  const files = api.writeCamFiles(kernel, snapshot);
  assert.deepEqual(api.verifyCamFiles(kernel, snapshot, files), []);
  assert.equal(api.readGerber(files['paste-top.gbr']).fileFunction, 'Paste,Top');
  assert.equal(api.readGerber(files['mask-bottom.gbr']).polarity, 'Negative');
  const altered = { ...files,
    'mask-bottom.gbr': files['mask-bottom.gbr'].replace('FilePolarity,Negative', 'FilePolarity,Positive'),
    'paste-top.gbr': files['paste-top.gbr'].replace('Paste,Top', 'Paste,Bot'),
  };
  assert.equal(api.verifyCamFiles(kernel, snapshot, altered).length, 2);
});

test('preserves unsupported KiCad via expressions and keeps the report outside production', async () => {
  const fixture = await readFile(new URL('./fixtures/kicad-via-review.kicad_pcb', import.meta.url));
  const report = await api.reviewKicadBoard(fixture, 'mixed.kicad_pcb');
  assert.equal(report.productionExportAllowed, false);
  assert.equal(report.viaCount, 4);
  assert.deepEqual(report.source.copperLayers, ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
  assert.equal(report.source.sha256.length, 64);
  assert.deepEqual(report.unsupportedVias.map(({ kind, layers, positionMm, validSpan }) =>
    [kind, layers, positionMm, validSpan]), [
    ['blind', ['F.Cu', 'In1.Cu'], [8, 5], true],
    ['buried', ['In1.Cu', 'In2.Cu'], [12, 5], true],
    ['microvia', ['In2.Cu', 'B.Cu'], [16, 5], true],
  ]);
  assert.match(report.unsupportedVias[0].expression, /\(size 0\.60\) \(drill 0\.30\)/);
  assert.match(report.unsupportedVias[0].expression, /\n    \(tenting front\)/);
  assert.ok(report.unsupportedVias.every(({ expression }) => fixture.includes(expression)));
  const unreadable = fixture.toString('utf8').replace('"In1.Cu" "In2.Cu"', '"In1.Cu" "Missing.Cu"');
  const modified = await api.reviewKicadBoard(new TextEncoder().encode(unreadable), 'invalid-span.kicad_pcb');
  assert.equal(modified.unsupportedVias[1].kind, 'unknown');
  assert.equal(modified.unsupportedVias[1].validSpan, false);
  const encoder = new TextEncoder();
  await assert.rejects(api.reviewKicadBoard(encoder.encode('(footprint "Example")'), 'part.kicad_mod'), /Expected a KiCad board/);
  await assert.rejects(api.reviewKicadBoard(encoder.encode(unreadable + '(extra)'), 'invalid.kicad_pcb'), /Unexpected data/);
  await assert.rejects(api.decodeBoard(encoder.encode(JSON.stringify(report))), /TinyCADPCB XML/);
});

test('keeps via tenting consistent across native saves, CAM, inspection and KiCad export', async () => {
  const base = api.createBoard('Via tenting', 2, polygon(0, 0, 24e6, 10e6));
  const netId = crypto.randomUUID();
  const board = {
    ...base, requiredFeatures: [...base.requiredFeatures, 'routed-copper', 'fabrication-settings'],
    fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
    nets: [{ id: netId, name: 'Signal' }],
    vias: [undefined, 'both', 'top', 'bottom', 'none'].map((tenting, index) => ({
      id: crypto.randomUUID(), netId, positionNm: point((4 + index * 4) * 1e6, 5e6),
      diameterNm: 800_000, drillNm: 400_000,
      ...(tenting === undefined ? {} : { tenting }),
    })),
  };
  const saved = await api.encodeBoard(board);
  const reopened = await api.decodeBoard(saved);
  assert.deepEqual(reopened.vias, board.vias);
  assert.deepEqual(await api.encodeBoard(reopened), saved);
  await assert.rejects(api.encodeBoard({
    ...board, vias: [{ ...board.vias[0], tenting: 'invalid' }],
  }), /Invalid through-via solder mask tenting/);

  const contains = (region, sample) =>
    api.pointInPolygon(sample, region.outer) === 'inside' &&
    region.holes.every((hole) => api.pointInPolygon(sample, hole) === 'outside');
  const preview = await api.prepareCamPreview(reopened, kernel);
  const inspection = api.boardInspectionSurface(reopened, kernel);
  for (const [side, exposed] of [['top', [3, 4]], ['bottom', [2, 4]]]) {
    const artwork = api.readGerber(preview.files['mask-' + side + '.gbr']);
    assert.equal(artwork.polarity, 'Negative');
    const hasOpening = (sample) => artwork.paints.some(({ polygon }) => contains(polygon, sample));
    const face = inspection.faces.find((face) => face.side === side);
    for (const [index, { positionNm }] of reopened.vias.entries()) {
      assert.equal(hasOpening(positionNm), exposed.includes(index));
      assert.equal(face.mask.some((region) => contains(region, positionNm)), !exposed.includes(index));
      assert.equal(inspection.substrate.some((region) => contains(region, positionNm)), false);
    }
    assert.equal(preview.files['paste-' + side + '.gbr'], undefined);
  }
  const drillFile = api.readXnc(preview.files['plated.xnc']);
  assert.deepEqual(drillFile.drills.map(({ start, widthNm }) => [start, widthNm]),
    reopened.vias.map(({ positionNm, drillNm }) => [positionNm, drillNm]));
  const { pcb } = await api.exportKicadBoard(reopened);
  assert.deepEqual([...pcb.matchAll(/\(via [^\n]*/g)].map(([via]) =>
    /\(tenting ([^)]+)\)/.exec(via)?.[1]), [undefined, 'front back', 'front', 'back', 'none']);
  const explicitTents = await api.prepareCamPreview({ ...reopened, vias: [reopened.vias[1]] }, kernel);
  for (const side of ['top', 'bottom'])
    assert.deepEqual(api.readGerber(explicitTents.files['mask-' + side + '.gbr']).paints, []);
  const implicitTent = await api.prepareCamPreview({ ...reopened, vias: [reopened.vias[0]] }, kernel);
  for (const side of ['top', 'bottom'])
    assert.deepEqual(api.readGerber(implicitTent.files['mask-' + side + '.gbr']).paints, []);
  const closeVias = [
    { ...reopened.vias[2], positionNm: point(5e6, 5e6) },
    { ...reopened.vias[3], positionNm: point(5.9e6, 5e6), tenting: 'top' },
  ];
  const checks = await api.checkBoard({ ...reopened, vias: closeVias }, kernel);
  const web = checks.issues.filter(({ code }) => code === 'fabrication-mask-web');
  assert.deepEqual(web.map(({ objects }) => objects),
    [closeVias.map(({ id }) => id + ':mask:bottom')]);
});

test('reports component and signal divergence from the embedded circuit', () => {
  const id = () => crypto.randomUUID();
  const base = api.createBoard('Parity', 1, polygon(0, 0, 20e6, 15e6));
  const partId = id();
  const missingId = id();
  const signalId = id();
  const netId = id();
  const terminal = { unitId: id(), pinId: id() };
  const circuit = {
    schemaVersion: 1, snapshotId: id(), documentId: id(), revision: 1,
    noConnects: [],
    nets: [{ id: netId, names: ['Signal'], terminals: [terminal] }],
    components: [
      { id: partId, reference: 'R1', value: '1k', role: 'electrical',
        units: [{ id: terminal.unitId, sheetId: id() }],
        signals: [{ id: signalId, name: 'Pin 1', terminals: [terminal] }],
      },
      { id: missingId, reference: 'R2', value: '1k', role: 'electrical',
        units: [{ id: id(), sheetId: id() }], signals: [],
      },
    ],
  };
  const actual = {
    ...base, appliedCircuit: circuit,
    components: [
      { id: id(), logicalId: partId, reference: 'R3', value: '10k', role: 'electrical',
        signals: [{ signalId, netId: id() }],
      },
      { id: id(), reference: 'MH1', role: 'pcb-only' },
    ],
  };
  const codes = api.checkAppliedCircuit(actual).map(({ code }) => code);
  assert.deepEqual(codes, [
    'reference-divergence', 'component-divergence', 'net-divergence', 'missing-component',
  ]);
});


test('reports the extra KiCad copper layer when exporting a single-layer board', async () => {
  const board = api.createBoard('Single-sided', 1, polygon(0, 0, 20e6, 15e6));
  const result = await api.exportKicadBoard(board);
  assert.match(result.pcb, /\(2 "B\.Cu" signal\)/);
  assert.deepEqual(result.report.notes.map(({ code }) => code), ['single-layer', 'board-thickness']);
  assert.equal(result.report.counts.profileEdges, 4);
});

test('compares standalone and project revisions and carries schematic evidence into CAM', async () => {
  const base = api.createBoard('Project parity', 1, polygon(0, 0, 20e6, 15e6));
  const documentId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const component = {
    id, role: 'electrical', value: '22k', reference: 'R1',
    units: [{ id: crypto.randomUUID(), sheetId: crypto.randomUUID() }],
    signals: [],
  };
  const applied = {
    schemaVersion: 1, documentId, snapshotId: crypto.randomUUID(), revision: 1,
    noConnects: [], nets: [], components: [component],
  };
  const board = {
    ...base, appliedCircuit: applied,
    components: [{ id, role: component.role, value: component.value, reference: component.reference }],
  };
  const updatedMetadata = { ...applied, revision: 2, snapshotId: crypto.randomUUID() };
  const standalone = await api.checkBoard(board, kernel);
  assert.equal(standalone.schematic, undefined);
  assert.equal(standalone.coverage.find(({ check }) => check === 'Schematic parity').status, 'limited');
  const current = await api.checkBoard(board, kernel, {
    projectCircuit: { state: 'resolved', snapshot: updatedMetadata },
  });
  assert.equal(current.schematic.state, 'current');
  const proposal = {
    state: 'resolved',
    snapshot: { ...updatedMetadata, components: [{ ...component, reference: 'R2' }] },
  };
  const pending = await api.checkBoard(board, kernel, { projectCircuit: proposal });
  assert.equal(pending.schematic.state, 'pending');
  assert.notEqual(pending.schematic.digest, current.schematic.digest);
  assert.equal(pending.inputDigest, current.inputDigest);
  assert.ok(pending.issues.some(({ code }) => code === 'schematic-update-pending'));
  assert.ok(pending.issues.some(({ code }) => code === 'reference-divergence'));
  const missing = await api.checkBoard(board, kernel, {
    projectCircuit: { state: 'unavailable', detail: 'Source schematic is missing.' },
  });
  assert.equal(missing.schematic.state, 'unavailable');
  assert.equal(missing.coverage.find(({ check }) => check === 'Schematic parity').status, 'limited');
  assert.ok(missing.issues.some(({ code }) => code === 'schematic-unavailable'));
  const preview = await api.prepareCamPreview(board, kernel, proposal);
  assert.deepEqual(preview.manifest.schematic, pending.schematic);
  assert.deepEqual(JSON.parse(preview.files['checks.json']).schematic, pending.schematic);
});

test('snaps to an existing via annulus and changes layers through its plated barrel', () => {
  const base = api.createBoard('Plated route snap', 2, polygon(0, 0, 20e6, 15e6));
  const netId = crypto.randomUUID();
  const positionNm = point(10_100_000, 7_350_000);
  const via = { id: crypto.randomUUID(), netId, positionNm, diameterNm: 800_000, drillNm: 400_000 };
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: netId, name: 'Signal' }],
    vias: [via],
  };
  const targets = api.routingSnapTargets(board);
  const top = api.snapRoutePoint(targets, positionNm, 20_000, 'top', netId);
  const bottom = api.snapRoutePoint(targets, positionNm, 500_000, 'bottom', netId);
  assert.deepEqual(top.position, bottom.position);
  assert.equal(api.snapRoutePoint(targets, positionNm, 20_000, 'top', 'other-net'), undefined);
  const distance = Math.hypot(top.position.x - positionNm.x, top.position.y - positionNm.y);
  assert.ok(distance > via.drillNm / 2 && distance < via.diameterNm / 2);
  const routed = api.commitManualRoute(board, {
    netId, widthNm: 300_000,
    viaDiameterNm: via.diameterNm, viaDrillNm: via.drillNm,
    path: [
      { position: point(5e6, 7e6), layer: 'top' },
      { position: top.position, layer: 'top' },
      { position: bottom.position, layer: 'bottom' },
      { position: point(15e6, 7e6), layer: 'bottom' },
    ],
  }, kernel);
  assert.deepEqual(routed.vias, [via]);
  const geometry = api.boardCopperGeometry(routed);
  const topology = api.analyseCopper(kernel, geometry.features, geometry.drills);
  const [first, second] = routed.tracks;
  assert.ok(topology.connectedSets.some(
    (island) => island.includes(first.id + '/0') && island.includes(second.id + '/0'),
  ));
});

test('shares scoped width and symmetric clearance between routing, zone fills and DRC', async () => {
  const base = api.createBoard('Scoped rules', 2, polygon(0, 0, 24e6, 16e6));
  const [power, signal, classId] = Array.from({ length: 3 }, () => crypto.randomUUID());
  const strong = {
    id: crypto.randomUUID(), netId: power, layerId: 'top', widthNm: 400_000,
    start: point(6e6, 7e6), end: point(17e6, 7e6),
  };
  const normal = {
    id: crypto.randomUUID(), netId: signal, layerId: 'top', widthNm: 250_000,
    start: point(8e6, 7.9e6), end: point(15e6, 7.9e6),
  };
  const classRules = { minWidthNm: 350_000, preferredWidthNm: 450_000, maxWidthNm: 600_000,
    clearanceNm: 700_000, edgeClearanceNm: 420_000, minViaAnnulusNm: 220_000 };
  const source = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper', 'copper-zones'],
    netClasses: [{ id: classId, name: 'Power', rules: classRules }],
    nets: [
      { id: power, name: 'Supply', classId, routingRules: { preferredWidthNm: 500_000, clearanceNm: 500_000 } },
      { id: signal, name: 'Signal' },
    ],
    tracks: [strong, normal],
    zones: [{
      id: crypto.randomUUID(), netId: signal, layerId: 'top', outline: polygon(3e6, 4e6, 20e6, 12e6),
      cutouts: [], priority: 0, padConnection: 'direct', viaConnection: 'direct',
      thermalGapNm: 300_000, spokeWidthNm: 250_000, islands: 'retain',
    }],
  };
  const board = await api.decodeBoard(await api.encodeBoard(source));
  assert.deepEqual(board.netClasses, source.netClasses);
  assert.deepEqual(board.nets, source.nets);
  const rules = api.boardRuleResolver(board);
  assert.deepEqual(rules.net(power), { ...classRules, preferredWidthNm: 500_000 });
  assert.equal(rules.clearance(power, signal), 700_000);
  assert.equal(rules.clearance(signal, power), 700_000);
  const attempt = (track) => api.commitManualRoute(board, {
    netId: track.netId, widthNm: track.widthNm, viaDiameterNm: 900_000, viaDrillNm: 400_000,
    path: [track.start, track.end].map((position) => ({ position, layer: 'top' })),
  }, kernel);
  assert.throws(() => attempt({ ...strong, widthNm: 300_000 }), /width is below/);
  assert.throws(() => attempt(strong), /Track blocked/);
  assert.throws(() => attempt(normal), /Track blocked/);
  assert.doesNotThrow(() => attempt({ ...normal, start: point(8e6, 9e6), end: point(15e6, 9e6) }));

  const geometry = api.boardCopperGeometry(board);
  const zones = api.boardZoneGeometry(board, kernel, geometry);
  assert.ok(zones.fills.length > 0);
  const obstacle = geometry.features.find(({ id }) => id === strong.id);
  assert.ok(zones.fills.every(({ region }) => !api.regionsTouch(region, obstacle.region) &&
    api.boundaryDistance(region, obstacle.region) >= 700_000));
  const report = await api.checkBoard(board, kernel, { geometry, zones });
  assert.ok(report.issues.some(({ code, requiredNm, objects }) =>
    code === 'copper-clearance' && requiredNm === 700_000 && objects.includes(strong.id) && objects.includes(normal.id),
  ));
  assert.throws(() => api.validateBoard({ ...board, netClasses: [] }), /unknown net class/);
  assert.throws(() => api.validateBoard({
    ...board, nets: [{ ...board.nets[0], routingRules: { maxWidthNm: 200_000 } }, board.nets[1]],
  }), /Maximum track width/);
  const kicad = await api.exportKicadBoard(board);
  assert.ok(kicad.report.notes.some(({ code }) => code === 'net-routing-rules'));
  const preview = await api.prepareCamPreview(board, kernel);
  const review = await api.prepareBoardReleaseReview(board, preview, { reviewedFiles: [] });
  assert.deepEqual(review.manifest.rules.netClasses, board.netClasses);
  assert.deepEqual(review.manifest.rules.nets[0].effective, rules.net(power));
});

test('applies symmetric class and copper-object pair rules across routing, zones and DRC', async () => {
  const [power, signal, powerClass, signalClass, classPair, viaPair, zonePair] =
    Array.from({ length: 7 }, () => crypto.randomUUID());
  const base = api.createBoard('Pair clearance', 2, polygon(0, 0, 24e6, 16e6));
  const rules = [
    { id: classPair, name: 'Power to Signal', firstClass: powerClass, secondClass: signalClass, clearanceNm: 900_000 },
    { id: viaPair, name: 'Track to via', firstKind: 'track', secondKind: 'via', clearanceNm: 1_400_000 },
    { id: zonePair, name: 'Zone to track', firstKind: 'zone', secondKind: 'track', clearanceNm: 1_200_000 },
  ];
  const obstacle = {
    id: crypto.randomUUID(), netId: power, layerId: 'top', widthNm: 400_000,
    start: point(6e6, 7e6), end: point(17e6, 7e6),
  };
  const board = await api.decodeBoard(await api.encodeBoard({
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper', 'copper-zones'],
    netClasses: [
      { id: powerClass, name: 'Power', rules: { clearanceNm: 700_000 } },
      { id: signalClass, name: 'Signal', rules: {} },
    ],
    nets: [{ id: power, name: 'VCC', classId: powerClass }, { id: signal, name: 'Data', classId: signalClass }],
    clearanceRules: rules,
    tracks: [obstacle],
    zones: [{
      id: crypto.randomUUID(), netId: signal, layerId: 'top', outline: polygon(3e6, 4e6, 20e6, 12e6),
      cutouts: [], priority: 0, padConnection: 'direct', viaConnection: 'direct',
      thermalGapNm: 300_000, spokeWidthNm: 250_000, islands: 'retain',
    }],
  }));
  assert.deepEqual(board.clearanceRules, rules);
  const resolver = api.boardRuleResolver(board);
  const track = { netId: power, kind: 'track' };
  for (const [kind, minimum] of [['track', 900_000], ['via', 1_400_000], ['zone', 1_200_000]]) {
    const object = { netId: signal, kind };
    assert.equal(resolver.copperClearance(track, object), minimum);
    assert.equal(resolver.copperClearance(object, track), minimum);
  }
  const branch = (y, via = false) => {
    const position = point(11e6, y);
    return api.commitManualRoute(board, {
      netId: signal, widthNm: 250_000, viaDiameterNm: 800_000, viaDrillNm: 400_000,
      path: [
        { position: point(8e6, y), layer: 'top' },
        { position, layer: 'top' },
        ...(via ? [{ position, layer: 'bottom' }] : []),
      ],
    }, kernel);
  };
  assert.throws(() => branch(8.15e6), /Track blocked/);
  assert.doesNotThrow(() => branch(8.7e6));
  assert.throws(() => branch(8.7e6, true), /Via blocked/);
  assert.equal(branch(9.3e6, true).vias.length, 1);

  const geometry = api.boardCopperGeometry(board);
  const zones = api.boardZoneGeometry(board, kernel, geometry);
  assert.ok(zones.fills.length > 0);
  assert.ok(zones.fills.every(({ region }) =>
    api.boundaryDistance(region, geometry.features[0].region) >= 1_200_000));
  const forcedVia = {
    id: crypto.randomUUID(), netId: signal, positionNm: point(11e6, 8.7e6),
    diameterNm: 800_000, drillNm: 400_000,
  };
  const readback = await api.decodeBoard(await api.encodeBoard({ ...board, vias: [forcedVia] }));
  const report = await api.checkBoard(readback, kernel);
  const finding = report.issues.find(({ code, objects }) =>
    code === 'copper-clearance' && objects.includes(forcedVia.id + ':top') && objects.includes(obstacle.id));
  assert.equal(finding.requiredNm, 1_400_000);
  assert.deepEqual(finding.clearanceRules.map(({ id }) => id), [classPair, viaPair]);
  const preview = await api.prepareCamPreview(readback, kernel);
  const review = await api.prepareBoardReleaseReview(readback, preview, { reviewedFiles: [] });
  assert.deepEqual(review.manifest.rules.clearances, rules);
  assert.ok((await api.exportKicadBoard(board)).report.notes.some(({ code }) => code === 'pair-clearance-rules'));
  const reversed = { ...rules[0], id: crypto.randomUUID(), firstClass: signalClass, secondClass: powerClass };
  assert.throws(() => api.validateBoard({ ...board, clearanceRules: [...rules, reversed] }), /already covers this pair/);
  const history = new api.BoardHistory(board);
  const edited = history.apply({
    apiVersion: 1, boardId: board.boardId, expectedRevision: board.revision,
    operations: [{ type: 'removeNetClass', id: powerClass }],
  });
  assert.deepEqual(edited.clearanceRules.map(({ id }) => id), [viaPair, zonePair]);
  assert.equal(edited.nets.find(({ id }) => id === power).classId, undefined);
  assert.deepEqual(history.undo(edited.revision).clearanceRules, rules);
});

test('enforces regional track widths and layer exclusions in routing, fills and design checks', async () => {
  const [netId, other, classId, widthId, keepoutId, trackId, viaId, zoneId] =
    Array.from({ length: 8 }, () => crypto.randomUUID());
  const base = api.createBoard('Routing regions', 2, polygon(0, 0, 24e6, 16e6));
  const width = {
    id: widthId, name: 'Power corridor', side: 'top', classId,
    outline: polygon(7e6, 5e6, 10e6, 10e6), exclusions: [],
    minWidthNm: 400_000, maxWidthNm: 600_000,
  };
  const keepout = {
    id: keepoutId, name: 'Bottom antenna', side: 'bottom',
    outline: polygon(14e6, 5e6, 20e6, 12e6), exclusions: ['via', 'zone'],
  };
  const source = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routing-regions', 'copper-zones'],
    netClasses: [{ id: classId, name: 'Power', rules: {} }],
    nets: [{ id: netId, name: 'Power', classId }, { id: other, name: 'Signal' }],
    routingRegions: [width, keepout],
    zones: [{
      id: zoneId, netId: other, layerId: 'bottom', outline: polygon(4e6, 3e6, 22e6, 14e6),
      cutouts: [], priority: 0, padConnection: 'direct', viaConnection: 'direct',
      thermalGapNm: 300_000, spokeWidthNm: 250_000, islands: 'retain',
    }],
  };
  const board = await api.decodeBoard(await api.encodeBoard(source));
  assert.deepEqual(board.routingRegions, source.routingRegions);
  const start = point(4e6, 7e6);
  const end = point(12e6, 7e6);
  const plan = (net, layer, widthNm, begin = start, finish = end, changeLayer = false) => ({
    netId: net, widthNm, viaDiameterNm: 800_000, viaDrillNm: 400_000,
    path: [
      { position: begin, layer }, { position: finish, layer },
      ...(changeLayer ? [{ position: finish, layer: 'bottom' }] : []),
    ],
  });
  assert.equal(api.isCentrelineClear(api.prepareManualTrackClearance(board, plan(netId, 'top', 250_000), kernel), start, end, 'top'), false);
  assert.throws(() => api.commitManualRoute(board, plan(netId, 'top', 250_000), kernel), /Track blocked/);
  assert.throws(() => api.commitManualRoute(board, plan(netId, 'top', 700_000), kernel), /Track blocked/);
  assert.doesNotThrow(() => api.commitManualRoute(board, plan(netId, 'top', 500_000), kernel));
  assert.doesNotThrow(() => api.commitManualRoute(board, plan(other, 'top', 250_000), kernel));
  assert.doesNotThrow(() => api.commitManualRoute(board, plan(netId, 'bottom', 250_000), kernel));
  assert.throws(() => api.commitManualRoute(board,
    plan(netId, 'top', 250_000, point(12e6, 8e6), point(17e6, 8e6), true), kernel), /Via blocked/);
  assert.doesNotThrow(() => api.commitManualRoute(board,
    plan(netId, 'top', 250_000, point(12e6, 8e6), point(17e6, 8e6)), kernel));

  const fills = api.boardZoneGeometry(board, kernel).fills;
  assert.ok(fills.length > 0);
  assert.ok(fills.every(({ region }) => !api.regionsTouch(region, api.routingRegionPolygon(keepout))));
  const imported = await api.decodeBoard(await api.encodeBoard({
    ...board,
    requiredFeatures: [...board.requiredFeatures, 'routed-copper'],
    tracks: [{ id: trackId, netId, layerId: 'top', widthNm: 250_000, start, end }],
    vias: [{ id: viaId, netId, positionNm: point(17e6, 8e6), diameterNm: 800_000, drillNm: 400_000 }],
  }));
  const findings = (await api.checkBoard(imported, kernel)).issues;
  assert.ok(findings.some(({ code, objects, requiredNm, measuredNm }) => code === 'region-track-minimum' &&
    objects.includes(widthId) && objects.includes(trackId) && requiredNm === 400_000 && measuredNm === 250_000));
  assert.deepEqual(findings.filter(({ code }) => code === 'region-exclusion').map(({ objects }) => objects),
    [[keepoutId, viaId + ':bottom']]);
  const preview = await api.prepareCamPreview(imported, kernel);
  const review = await api.prepareBoardReleaseReview(imported, preview, { reviewedFiles: [] });
  assert.deepEqual(review.manifest.rules.routingRegions, board.routingRegions);
  assert.ok((await api.exportKicadBoard(board)).report.notes.some(({ code }) => code === 'routing-region'));

  assert.throws(() => api.validateBoard({
    ...board,
    routingRegions: [...board.routingRegions, {
      ...width, id: crypto.randomUUID(), name: 'Conflicting corridor', minWidthNm: undefined, maxWidthNm: 300_000,
    }],
  }), /Overlapping routing regions/);
});

test('applies regional clearance only to the in-region portion of either copper object', async () => {
  const [power, signal, powerClass, ruleId, trackId, otherId] =
    Array.from({ length: 6 }, () => crypto.randomUUID());
  const base = api.createBoard('Regional clearance', 2, polygon(0, 0, 24e6, 16e6));
  const rule = {
    id: ruleId, name: 'Power spacing', side: 'top', classId: powerClass,
    outline: polygon(5e6, 5e6, 11e6, 8.1e6), exclusions: [], clearanceNm: 900_000,
  };
  const source = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper', 'routing-regions'],
    netClasses: [{ id: powerClass, name: 'Power', rules: {} }],
    nets: [{ id: power, name: 'Power', classId: powerClass }, { id: signal, name: 'Signal' }],
    routingRegions: [rule],
  };
  const copper = (id, netId, y, layerId = 'top') => ({
    id, netId, layerId, widthNm: 250_000,
    start: point(4e6, y), end: point(21e6, y),
  });
  const inRegion = copper(trackId, power, 8e6);
  const outOfRegion = copper(otherId, signal, 8.7e6);
  const readback = async (tracks) => api.decodeBoard(await api.encodeBoard({ ...source, tracks }));
  const plan = (netId, y, layer, x1, x2) => ({
    netId, widthNm: 250_000, viaDiameterNm: 800_000, viaDrillNm: 400_000,
    path: [x1, x2].map((x) => ({ position: point(x, y), layer })),
  });
  const powerBoard = await readback([outOfRegion]);
  const signalBoard = await readback([inRegion]);
  assert.deepEqual(powerBoard.routingRegions, [rule]);
  for (const [board, netId, y] of [[powerBoard, power, 8e6], [signalBoard, signal, 8.7e6]]) {
    const path = plan(netId, y, 'top', 6e6, 9e6);
    const geometry = api.prepareManualTrackClearance(board, path, kernel);
    assert.equal(api.isCentrelineClear(geometry, path.path[0].position, path.path[1].position, 'top'), false);
    assert.throws(() => api.commitManualRoute(board, path, kernel), /routing region/);
    assert.doesNotThrow(() => api.commitManualRoute(board, plan(netId, y, 'top', 15e6, 20e6), kernel));
    assert.doesNotThrow(() => api.commitManualRoute(board, plan(netId, y, 'bottom', 6e6, 9e6), kernel));
  }
  const crossing = plan(power, 7.5e6, 'top', 4e6, 8e6);
  assert.doesNotThrow(() => api.commitManualRoute(powerBoard, crossing, kernel));
  assert.throws(() => api.commitManualRoute(powerBoard, {
    ...crossing, path: [...crossing.path, { position: crossing.path[1].position, layer: 'bottom' }],
  }, kernel), /Via blocked/);

  const zoneBoard = {
    ...powerBoard,
    requiredFeatures: [...powerBoard.requiredFeatures, 'copper-zones'],
    zones: [{
      id: crypto.randomUUID(), netId: power, layerId: 'top',
      outline: polygon(3e6, 4e6, 22e6, 8.25e6), cutouts: [], priority: 0,
      padConnection: 'direct', viaConnection: 'direct',
      thermalGapNm: 300_000, spokeWidthNm: 250_000, islands: 'retain',
    }],
  };
  const fills = api.boardZoneGeometry(zoneBoard, kernel).fills.map(({ region }) => region);
  assert.ok(fills.length > 0);
  const sample = (x) => ({ outer: polygon(x, 7.94e6, x + 500_000, 8.04e6), holes: [] });
  assert.equal(kernel.boolean('intersection', fills, [sample(7e6)]).length, 0);
  assert.ok(kernel.boolean('intersection', fills, [sample(16e6)]).length > 0);
  assert.ok(!(await api.checkBoard(zoneBoard, kernel)).issues.some(({ code }) => code === 'region-copper-clearance'));

  for (const tracks of [[inRegion, outOfRegion], [outOfRegion, inRegion]]) {
    const report = await api.checkBoard(await readback(tracks), kernel);
    const regional = report.issues.filter(({ code }) => code === 'region-copper-clearance');
    assert.equal(regional.length, 1);
    assert.deepEqual(regional[0].objects, [ruleId, ...[trackId, otherId].sort()]);
    assert.equal(regional[0].requiredNm, 900_000);
    assert.equal(regional[0].measuredNm, 475_000);
    assert.ok(!report.issues.some(({ code }) => code === 'copper-clearance'));
  }
});

test('preserves board width limits in PCB rules, design checks and KiCad export', async () => {
  const base = api.createBoard('Width limits', 1, polygon(0, 0, 20e6, 15e6));
  const netId = crypto.randomUUID();
  const track = {
    id: crypto.randomUUID(), netId, layerId: 'top', widthNm: 500_000,
    start: point(5e6, 7e6), end: point(15e6, 7e6),
  };
  const board = await api.decodeBoard(await api.encodeBoard({
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'fabrication-settings', 'routed-copper'],
    fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
    rules: { ...api.starterRoutingRules, preferredWidthNm: 400_000, maxWidthNm: 450_000 },
    nets: [{ id: netId, name: 'Signal' }],
    tracks: [track],
  }));
  assert.equal(api.beginnerRouteDefaults(board).widthNm, 400_000);
  const report = await api.checkBoard(board, kernel);
  const issue = report.issues.find(({ code }) => code === 'track-width-maximum');
  assert.deepEqual(issue.objects, [track.id]);
  assert.deepEqual([issue.measuredNm, issue.requiredNm], [500_000, 450_000]);
  const exported = await api.exportKicadBoard(board);
  assert.match(exported.designRules, /\(constraint track_width \(min 0\.25mm\) \(opt 0\.4mm\) \(max 0\.45mm\)\)/);
  assert.match(exported.designRules, /\(constraint clearance \(min 0\.25mm\)\)/);
  for (const [rules, message] of [
    [{ ...board.rules, maxWidthNm: 200_000 }, /below the effective minimum/],
    [{ ...board.rules, clearanceNm: '0.25mm' }, /Invalid board routing rules/],
  ]) {
    const invalid = { ...board, rules };
    assert.throws(() => api.validateBoard(invalid), message);
    await assert.rejects(api.checkBoard(invalid, kernel), message);
    await assert.rejects(api.prepareCamPreview(invalid, kernel), message);
  }
  const xml = new TextDecoder().decode(await api.encodeBoard(board));
  const mismatched = xml.replace('length_unit="nm"', 'length_unit="mm"');
  assert.notEqual(mismatched, xml);
  await assert.rejects(
    api.decodeBoard(new TextEncoder().encode(mismatched)),
    /Unsupported TinyCAD PCB format, version, or coordinate frame/,
  );
});

test('saves partial stackups and rejects layer dimensions that conflict with the board', async () => {
  const base = api.createBoard('Stackup', 2, polygon(0, 0, 20e6, 15e6));
  const fabrication = {
    thicknessNm: 1_600_000,
    stackup: { substrateMaterial: 'FR-4 & glass', topCopperThicknessNm: 35_000,
      bottomCopperThicknessNm: 28_000, lossTangent: 0 },
  };
  const history = new api.BoardHistory(base);
  const apply = (operations, expectedRevision) =>
    history.apply({ apiVersion: 1, boardId: base.boardId, expectedRevision, operations });
  const board = apply([{ type: 'setFabrication', fabrication }], base.revision);
  const bytes = await api.encodeBoard(board);
  const reopened = await api.decodeBoard(bytes);
  assert.deepEqual(reopened.fabrication, fabrication);
  assert.deepEqual(await api.encodeBoard(reopened), bytes);
  assert.equal(reopened.fabrication.stackup.relativePermittivity, undefined);
  assert.deepEqual((await api.prepareCamPreview(reopened, kernel)).manifest.fabrication.stackup,
    fabrication.stackup);
  assert.ok((await api.exportKicadBoard(reopened)).report.notes.some(({ code }) => code === 'stackup-properties'));
  for (const [values, error] of [
    [{ dielectricThicknessNm: 1_600_000 }, /layer thicknesses exceed the board thickness/],
    [{ topCopperThicknessNm: 0 }, /positive whole nanometres/],
    [{ relativePermittivity: 0.5 }, /permittivity must be at least 1/],
    [{ lossTangent: -0.01 }, /loss tangent must be non-negative/],
  ]) assert.throws(() => api.validateBoard({
    ...board, fabrication: { ...fabrication, stackup: { ...fabrication.stackup, ...values } },
  }), error);
  assert.throws(() => apply([{ type: 'setCopperLayers', count: 1 }], board.revision),
    /Clear the bottom copper thickness/);
  const { bottomCopperThicknessNm, ...oneSide } = fabrication.stackup;
  const single = apply([
    { type: 'setFabrication', fabrication: { ...fabrication, stackup: oneSide } },
    { type: 'setCopperLayers', count: 1 },
  ], board.revision);
  assert.equal(single.copperLayers.length, 1);
  assert.deepEqual(history.undo(single.revision).fabrication, fabrication);
});

test('applies saved fabrication profile limits to routing, drills, mask and inspection', async () => {
  const base = api.createBoard('Fabrication', 2, polygon(0, 0, 20e6, 15e6));
  assert.deepEqual(api.beginnerRouteDefaults(base), {
    widthNm: 500_000, viaDrillNm: 400_000, viaDiameterNm: 800_000,
  });
  assert.deepEqual(api.beginnerRouteDefaults({
    ...base,
    rules: { ...api.resolveBoardRules(base), minWidthNm: 650_000, minViaAnnulusNm: 275_000 },
  }), { widthNm: 650_000, viaDrillNm: 400_000, viaDiameterNm: 950_000 });
  const netId = crypto.randomUUID();
  const history = new api.BoardHistory({
    ...base, nets: [{ id: netId, name: 'Ground' }],
  });
  const openings = [5e6, 5.65e6].map((x) => ({
    id: crypto.randomUUID(), start: point(x, 9e6), end: point(x, 9e6), plated: false, widthNm: 300_000,
  }));
  const fixture = history.apply({
    apiVersion: 1, expectedRevision: 0, boardId: base.boardId,
    operations: [
      ...openings.map((hole) => ({ type: 'addMechanicalHole', hole })),
      { type: 'setFabrication', fabrication: { thicknessNm: 1_200_000, profileId: 'classroom-v1' } },
      { type: 'setRules', rules: { minWidthNm: 180_000, clearanceNm: 400_000, edgeClearanceNm: 250_000, minViaAnnulusNm: 130_000 } },
    ],
  });
  const board = await api.decodeBoard(await api.encodeBoard(fixture));
  assert.deepEqual(board.fabrication, fixture.fabrication);
  assert.equal(api.boardInspectionSurface(board, kernel).thicknessMm, 1.2);
  assert.deepEqual(api.resolveBoardRules(board), {
    minWidthNm: 250_000, clearanceNm: 400_000, edgeClearanceNm: 300_000, minViaAnnulusNm: 150_000,
  });
  const first = { position: point(2e6, 2e6), layer: 'top' };
  const second = { position: point(3e6, 2e6), layer: 'top' };
  const via = { position: second.position, layer: 'bottom' };
  const route = { netId, widthNm: 200_000, viaDiameterNm: 650_000, viaDrillNm: 200_000, path: [first, second, via] };
  assert.throws(() => api.commitManualRoute(board, route, kernel), /Track width/);
  assert.throws(() => api.commitManualRoute(board, { ...route, widthNm: 250_000 }, kernel), /Via drill/);
  assert.doesNotThrow(() => api.commitManualRoute(board, { ...route, widthNm: 250_000, viaDrillNm: 300_000 }, kernel));

  const apertures = [
    { id: 'mask1', kind: 'mask', side: 'top', polygon: polygon(1e6, 1e6, 2e6, 2e6) },
    { id: 'mask2', kind: 'mask', side: 'top', polygon: polygon(2.08e6, 1e6, 3e6, 2e6) },
    { id: 'paste1', kind: 'paste', side: 'top', polygon: polygon(6e6, 5e6, 6.2e6, 6e6) },
  ];
  const report = await api.checkBoard(board, kernel, {
    geometry: { features: [], drills: openings, apertures, owners: new Map() },
  });
  assert.equal(report.fabrication.profileId, 'classroom-v1');
  assert.equal(report.issues.filter(({ code }) => code === 'fabrication-drill-width').length, 2);
  assert.equal(report.issues.find(({ code }) => code === 'fabrication-hole-spacing').measuredNm, 350_000);
  assert.equal(report.issues.find(({ code }) => code === 'fabrication-mask-web').measuredNm, 80_000);
  assert.ok(report.issues.some(({ code }) => code === 'fabrication-paste-aperture'));
  assert.ok(report.issues.some(({ code }) => code === 'fabrication-applicability'));
});

test('checks the actual mask and paste against their land after an asymmetric bottom placement', async () => {
  const fixture = placementFixture(api);
  const [definition] = fixture.footprintDefinitions;
  const [pad] = definition.pads;
  const placement = { ...fixture.footprints[1], rotationMicrodegree: 90e6 };
  const face = (x1, y1, x2, y2) => ({ kind: 'polygon', vertices: polygon(x1, y1, x2, y2) });
  const copper = face(-600_000, -500_000, 400_000, 500_000);
  const build = async (mask, paste) => api.decodeBoard(await api.encodeBoard({
    ...fixture,
    requiredFeatures: [...fixture.requiredFeatures, 'fabrication-settings'],
    fabrication: { thicknessNm: 1_600_000, profileId: 'two-layer-smt-v1' },
    components: fixture.components.filter(({ id }) => id === placement.componentId),
    footprints: [placement],
    footprintDefinitions: [{ ...definition, pads: [{ ...pad, stack: {
      copper: { top: copper }, mask: { top: mask }, paste: { top: paste },
    } }] }],
  }));
  const valid = await build(copper, face(-600_000, -500_000, -100_000, 500_000));
  const invalid = await build(face(-500_000, -500_000, 500_000, 500_000),
    face(100_000, -500_000, 600_000, 500_000));
  const related = ({ code }) => ['fabrication-mask-expansion', 'fabrication-paste-coverage'].includes(code);
  const accepted = await api.checkBoard(valid, kernel);
  assert.deepEqual(accepted.issues.filter(related), []);
  assert.equal(accepted.coverage.find(({ check }) => check === 'Mask and paste').status, 'checked');
  const preview = await api.prepareCamPreview(invalid, kernel);
  const findings = preview.report.issues.filter(related);
  assert.deepEqual(findings.map(({ code }) => code), ['fabrication-mask-expansion', 'fabrication-paste-coverage']);
  const suffix = placement.id + ':' + pad.id;
  assert.deepEqual(findings[0].objects, [suffix + ':mask:bottom', suffix + ':bottom']);
  assert.deepEqual(findings[1].objects, [suffix + ':paste:bottom', suffix + ':bottom']);
  assert.match(findings[1].message, /covers 30%.*requires at least 50%/);
  assert.deepEqual(api.manufacturingReadiness(invalid, preview).filter(related).map(({ code }) => code),
    findings.map(({ code }) => code));
  assert.equal(preview.artwork.find(({ kind }) => kind === 'mask').side, 'bottom');
  assert.equal(preview.artwork.find(({ kind }) => kind === 'paste').side, 'bottom');
});

test('keeps routing, zone copper and component bodies clear of a mounting screw head', async () => {
  const fixture = placementFixture(api);
  const [footprint] = fixture.footprintDefinitions;
  const [first, second, third] = fixture.footprints;
  const netId = crypto.randomUUID();
  const source = {
    ...fixture,
    nets: [{ id: netId, name: 'Signal' }],
    footprintDefinitions: [{
      ...footprint,
      graphics: [{
        kind: 'rect', layer: 'F.CrtYd', strokeNm: 50_000, filled: false,
        start: point(-500_000, -500_000), end: point(500_000, 500_000),
      }],
    }],
    footprints: [
      { ...first, positionNm: point(20.2e6, 20e6) },
      { ...second, positionNm: point(20.2e6, 20e6) },
      third,
    ],
  };
  const hole = {
    id: crypto.randomUUID(),
    start: point(15e6, 20e6), end: point(15e6, 20e6),
    widthNm: 3.2e6, plated: false, clearanceNm: 250_000,
    screwHeadDiameterNm: 8e6, screwHeadSide: 'top', bodyClearanceNm: 1e6,
  };
  const history = new api.BoardHistory(source);
  const add = (hole) => history.apply({
    apiVersion: 1, boardId: source.boardId, expectedRevision: history.board.revision,
    operations: [{ type: 'addMechanicalHole', hole }],
  });
  assert.throws(() => add({ ...hole, screwHeadDiameterNm: 3e6 }), /screw-head keep-out/);
  assert.throws(() => add({ ...hole, end: point(16e6, 20e6) }), /round hole/);
  assert.throws(() => add({ ...hole, bodyClearanceNm: 1e9 }), /screw-head keep-out/);
  const board = await api.decodeBoard(await api.encodeBoard(add(hole)));
  assert.deepEqual(board.mechanicalHoles, [hole]);

  const route = (layer, y) => ({
    netId, widthNm: 500_000, viaDiameterNm: 800_000, viaDrillNm: 400_000,
    path: [point(8e6, y), point(22e6, y)].map((position) => ({ position, layer })),
  });
  assert.throws(() => api.commitManualRoute(board, route('top', 23e6), kernel), /Track blocked/);
  assert.equal(api.commitManualRoute(board, route('bottom', 23e6), kernel).tracks.length, 1);
  assert.equal(api.commitManualRoute(board, route('top', 24.5e6), kernel).tracks.length, 1);
  assert.throws(() => api.commitManualRoute(board, {
    ...route('bottom', 23e6),
    path: ['bottom', 'top'].map((layer) => ({ layer, position: point(15e6, 23e6) })),
  }, kernel), /Via blocked/);

  const plated = {
    ...board,
    mechanicalHoles: [{ ...hole, plated: true, landWidthNm: 4e6 }],
  };
  assert.ok(!(await api.checkBoard(plated, kernel)).issues.some(({ code }) => code === 'mounting-screw-copper'));

  const injected = {
    ...board,
    requiredFeatures: [...board.requiredFeatures, 'routed-copper'],
    tracks: ['top', 'bottom'].map((layerId) => ({
      id: crypto.randomUUID(), layerId, netId, widthNm: 500_000,
      start: point(8e6, 23e6), end: point(22e6, 23e6),
    })),
  };
  const report = await api.checkBoard(injected, kernel);
  const copper = report.issues.filter(({ code }) => code === 'mounting-screw-copper');
  assert.deepEqual(copper.map(({ objects }) => objects), [[hole.id, injected.tracks[0].id]]);
  const bodies = report.issues.filter(({ code, message }) =>
    code === 'placement-keep-out' && message.includes('mounting screw'));
  assert.deepEqual(bodies.map(({ objects }) => objects), [[first.componentId, hole.id]]);
  assert.match(bodies[0].message, /courtyard.*top/);

  const withZones = {
    ...board,
    requiredFeatures: [...board.requiredFeatures, 'copper-zones'],
    zones: ['top', 'bottom'].map((layerId) => ({
      id: crypto.randomUUID(), netId, layerId, priority: 0, cutouts: [],
      outline: polygon(4e6, 4e6, 34e6, 34e6),
      padConnection: 'direct', viaConnection: 'direct', islands: 'retain',
    })),
  };
  const fills = api.boardZoneGeometry(withZones, kernel).fills;
  const contains = (layerId, probe) => fills.some((fill) =>
    fill.layerId === layerId && api.pointInPolygon(probe, fill.region.outer) === 'inside' &&
    fill.region.holes.every((hole) => api.pointInPolygon(probe, hole) === 'outside'));
  assert.equal(contains('top', point(15e6, 23e6)), false);
  assert.equal(contains('bottom', point(15e6, 23e6)), true);
  assert.equal(contains('top', point(15e6, 24.5e6)), true);

  const preview = await api.prepareCamPreview(injected, kernel);
  assert.equal(preview.drills.length, 1);
  assert.equal(preview.drills[0].plated, false);
  assert.ok(api.manufacturingReadiness(injected, preview).some(({ code }) => code === 'mounting-screw-copper'));
  const kicad = await api.exportKicadBoard(board);
  assert.ok(kicad.report.notes.some(({ code }) => code === 'mechanical-clearance'));
});

test('stores exact drafting coordinates and dimensions independently of the board profile', async () => {
  const board = api.createBoard('Drawing annotations', 2, polygon(0, 0, 25e6, 20e6));
  const datum = { x: api.annotationLengthNm('100 mil'), y: api.annotationLengthNm('0.0025 mm') };
  assert.deepEqual(datum, point(2_540_000, 2_500));
  assert.equal(api.annotationLengthNm('-100 nm'), -100);
  assert.throws(() => api.annotationLengthNm('0.000001 mil'), /whole nanometre/);
  assert.throws(() => api.annotationLengthNm('100 cm'), /mm, mil or nm/);

  const start = point(2_540_001, 2_503);
  const end = point(5_540_001, 4_002_503);
  const draft = {
    id: crypto.randomUUID(), start, end, kind: 'aligned',
    offsetNm: 2_000_000, label: 'Connector spacing', unit: 'mm',
  };
  assert.equal(api.dimensionText(draft), 'Connector spacing · 5 mm');
  assert.deepEqual(api.dimensionGeometry(draft), {
    start: point(940_001, 1_202_503), end: point(3_940_001, 5_202_503), lengthNm: 5_000_000,
  });
  assert.deepEqual(api.dimensionGeometry({ ...draft, kind: 'horizontal' }), {
    start: point(start.x, 2_002_503), end: point(end.x, 2_002_503), lengthNm: 3_000_000,
  });
  assert.deepEqual(api.dimensionGeometry({ ...draft, kind: 'vertical' }), {
    start: point(4_540_001, start.y), end: point(4_540_001, end.y), lengthNm: 4_000_000,
  });
  assert.equal(api.snapMeasurementPoint(point(2_539_000, 2_530), [start, end], 50_000), start);
  assert.equal(api.snapMeasurementPoint(point(2_539_000, 2_530), [start, end], 100), undefined);

  const history = new api.BoardHistory(board);
  const set = (annotations) => history.apply({
    apiVersion: 1, boardId: board.boardId, expectedRevision: history.board.revision,
    operations: [{ type: 'setAnnotations', annotations }],
  });
  assert.throws(() => set({ dimensions: [{ ...draft, end: start }] }), /distinct measured points/);
  assert.throws(() => set({ dimensions: [{ ...draft, offsetNm: 900e6 }] }), /coordinate range/);
  assert.throws(() => set({ dimensions: [draft, draft] }), /dimension settings/);
  const placed = set({ datum, dimensions: [draft] });
  const labelled = set({ datum, dimensions: [{ ...draft, label: 'Revised <datum>' }] });
  const bytes = await api.encodeBoard(labelled);
  const reopened = await api.decodeBoard(bytes);
  assert.deepEqual(reopened.annotations, labelled.annotations);
  assert.deepEqual(await api.encodeBoard(reopened), bytes);
  assert.deepEqual(reopened.outline, board.outline);
  assert.deepEqual(history.undo(labelled.revision).annotations, placed.annotations);
  assert.deepEqual(history.redo(history.board.revision).annotations, labelled.annotations);
  const cleared = set(undefined);
  assert.equal(cleared.annotations, undefined);
  assert.ok(!cleared.requiredFeatures.includes('board-annotations'));

  const before = await api.prepareCamPreview(board, kernel);
  const after = await api.prepareCamPreview(reopened, kernel);
  assert.deepEqual(after.profile, before.profile);
  const unchangedFiles = Object.keys(before.files).filter((name) => /\.(gbr|drl)$/.test(name));
  assert.ok(unchangedFiles.length > 0);
  for (const name of unchangedFiles) assert.deepEqual(after.files[name], before.files[name]);
  const { report } = await api.exportKicadBoard(reopened);
  assert.ok(report.notes.some(({ code }) => code === 'board-dimension'));
  assert.ok(report.notes.some(({ code }) => code === 'measurement-datum'));
});

test('authored line and arc profiles locate topology faults and repair only small straight endpoint gaps', async () => {
  const [a, b, c, d] = polygon(0, 0, 40e6, 30e6);
  const outline = api.straightContour([a, b, c, d]);
  const centre = point(40e6, 15e6);
  outline[1] = { ...outline[1], kind: 'arc', centre, clockwise: false };
  const draft = outline.map((edge, index) => index === 0
    ? { ...edge, end: point(39_999_500, 0) } : edge);
  assert.throws(() => api.profileRegion({ outline: draft, cutouts: [] }), (failure) => {
    assert.match(failure.message, /gap/);
    assert.equal(failure.edgeIndex, 0);
    assert.equal(failure.otherEdgeIndex, 1);
    assert.deepEqual(failure.location, draft[0].end);
    return true;
  });
  const repaired = api.repairProfileJunction(draft, 0);
  assert.deepEqual(repaired, outline);
  assert.deepEqual(draft[0].end, point(39_999_500, 0));
  assert.equal(repaired[1], draft[1]);
  assert.equal(api.repairProfileJunction([{ ...outline[0], end: point(39_998_999, 0) }, ...outline.slice(1)], 0), undefined);
  const circle = api.circleContour(point(10e6, 10e6), 2e6);
  assert.equal(api.repairProfileJunction([{ ...circle[0], end: point(8_000_001, 10e6) }, circle[1]], 0), undefined);

  const crossing = api.straightContour([a, c, b, d]);
  assert.throws(() => api.profileRegion({ outline: crossing, cutouts: [] }), (failure) => {
    assert.match(failure.message, /intersects itself/);
    assert.deepEqual(failure.location, point(20e6, 15e6));
    assert.deepEqual([failure.edgeIndex, failure.otherEdgeIndex].sort(), [0, 2]);
    return true;
  });
  const zero = [outline[0], { kind: 'line', start: b, end: b }, ...outline.slice(1)];
  assert.throws(() => api.profileRegion({ outline: zero, cutouts: [] }),
    (failure) => /zero length/.test(failure.message) && failure.edgeIndex === 1);
  const duplicates = api.straightContour([a, b, a, d]);
  assert.throws(() => api.profileRegion({ outline: duplicates, cutouts: [] }),
    (failure) => /duplicate edges/.test(failure.message) && failure.edgeIndex === 1);
  assert.throws(() => api.profileRegion({ outline, cutouts: [circle, api.circleContour(point(11e6, 10e6), 2e6)] }),
    (failure) => /cannot touch, intersect/.test(failure.message) && failure.cutoutIndex === 1 && !!failure.location);
  assert.throws(() => api.profileRegion({
    outline: [outline[0], { ...outline[1], centre: point(40e6, 16e6) }, ...outline.slice(2)], cutouts: [],
  }), (failure) => /same radius/.test(failure.message) && failure.edgeIndex === 1);

  const board = api.createBoard('Custom profile', 2, [a, b, c, d]);
  const history = new api.BoardHistory(board);
  const replace = (profile) => history.apply({
    apiVersion: 1, boardId: board.boardId, expectedRevision: history.board.revision,
    operations: [{ type: 'replaceProfile', profile }],
  });
  assert.throws(() => replace({ outline: draft, cutouts: [] }), /gap/);
  assert.equal(history.board.revision, board.revision);
  const saved = await api.decodeBoard(await api.encodeBoard(replace({ outline: repaired, cutouts: [circle] })));
  assert.deepEqual(saved.profile, { outline, cutouts: [circle] });
  const preview = await api.prepareCamPreview(saved, kernel);
  const maximumX = Math.max(...preview.profile.outer.map(({ x }) => x));
  assert.ok(Math.abs(maximumX - 55e6) <= api.TESSELLATION_TOLERANCE_NM);
  assert.deepEqual(api.readGerber(preview.files['profile.gbr']).contours[0].filter(({ kind }) => kind === 'arc'), [outline[1]]);
  assert.equal(preview.profile.holes.length, 1);
  assert.equal(history.undo(saved.revision).profile, undefined);
});

test('moves tracks and corners transactionally while protecting physical branch and via contacts', async () => {
  const base = api.createBoard('Track editing', 2, polygon(0, 0, 40e6, 30e6));
  const signal = crypto.randomUUID();
  const other = crypto.randomUUID();
  const track = (start, end, netId = signal, widthNm = 500_000, layerId = 'top') =>
    ({ id: crypto.randomUUID(), start, end, netId, widthNm, layerId });
  const a = track(point(5e6, 5e6), point(20e6, 5e6));
  const b = track(point(20e6, 5e6), point(20e6, 15e6), signal, 600_000);
  const branch = track(point(12.5e6, 5e6), point(12.5e6, 9e6));
  const obstacle = track(point(8e6, 12e6), point(15e6, 12e6), other);
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: signal, name: 'Signal' }, { id: other, name: 'Other' }],
    tracks: [a, b, branch, obstacle],
  };
  const drag = (target) => ({ kind: 'drag', trackId: a.id, target });
  const moved = api.editManualTracks(board, drag(point(12.5e6, 8e6)), kernel);
  assert.equal(moved.revision, board.revision);
  assert.deepEqual(moved.tracks.find(({ id }) => id === a.id),
    { ...a, start: point(5e6, 8e6), end: point(20e6, 8e6) });
  assert.deepEqual(moved.tracks.find(({ id }) => id === branch.id), branch);
  assert.deepEqual(moved.tracks.find(({ id }) => id === obstacle.id), obstacle);
  assert.equal(moved.tracks.length, 6);
  assert.throws(() => api.editManualTracks(board, drag(point(12.5e6, 12e6)), kernel), /Track blocked/);
  assert.throws(() => api.editManualTracks(board, drag(point(12.5e6, 2e6)), kernel), /disconnect an attached/);
  assert.throws(() => api.commitManualRoute(board, {
    netId: signal, widthNm: a.widthNm, viaDiameterNm: 800_000, viaDrillNm: 400_000,
    replaceTrack: a.id,
    path: [a.start, point(5e6, 2e6), point(20e6, 2e6), a.end]
      .map((position) => ({ position, layer: 'top' })),
  }, kernel), /disconnect an attached/);
  assert.deepEqual(board.tracks, [a, b, branch, obstacle]);

  const corner = (target) => ({ kind: 'corner', trackId: a.id, endpoint: 'end', target });
  const pair = { ...board, tracks: [a, b, obstacle] };
  const adjusted = api.editManualTracks(pair, corner(point(16e6, 7e6)), kernel);
  assert.deepEqual(adjusted.tracks.find(({ id }) => id === a.id), { ...a, end: point(16e6, 7e6) });
  assert.deepEqual(adjusted.tracks.find(({ id }) => id === b.id), { ...b, start: point(16e6, 7e6) });
  assert.throws(() => api.editManualTracks(pair, corner(b.end), kernel), /distinct endpoints/);
  const third = track(a.end, point(24e6, 4e6));
  assert.throws(() => api.editManualTracks({ ...pair, tracks: [...pair.tracks, third] },
    corner(point(16e6, 7e6)), kernel), /exactly two tracks/);
  const via = { id: crypto.randomUUID(), netId: signal, positionNm: a.end, diameterNm: 800_000, drillNm: 400_000 };
  const lower = track(a.end, point(20e6, 10e6), signal, 500_000, 'bottom');
  assert.throws(() => api.editManualTracks({ ...pair, tracks: [...pair.tracks, lower], vias: [via] },
    corner(point(16e6, 7e6)), kernel), /disconnect an attached/);

  assert.deepEqual(api.trackBranchPoint(a), branch.start);
  assert.deepEqual(api.trackBranchPoint(track(point(0, 0), point(1, 2))), point(0, 0));
  const history = new api.BoardHistory(board);
  const applied = history.commit(moved);
  assert.deepEqual((await api.decodeBoard(await api.encodeBoard(applied))).tracks, applied.tracks);
  assert.deepEqual(history.undo(applied.revision).tracks, board.tracks);
});

test('previews exact copper deletion scopes and preserves adjacent branches as one undoable edit', async () => {
  const fixture = placementFixture(api);
  const boardBase = api.createBoard('Scoped deletion', 2, fixture.outline);
  const signal = crypto.randomUUID();
  const another = crypto.randomUUID();
  const track = (start, end, netId = signal, layerId = 'top') =>
    ({ id: crypto.randomUUID(), start, end, netId, layerId, widthNm: 500_000 });
  const spine = track(point(2e6, 5e6), point(22e6, 5e6));
  const branch = track(point(12e6, 5e6), point(12e6, 12e6));
  const tail = track(spine.end, point(25e6, 7e6));
  const lower = track(tail.end, point(30e6, 7e6), signal, 'bottom');
  const separate = track(point(13e6, 10e6), point(17e6, 10e6), signal, 'bottom');
  const foreign = track(point(14e6, 13e6), point(18e6, 13e6), another);
  const via = { id: crypto.randomUUID(), netId: signal, positionNm: tail.end, diameterNm: 800_000, drillNm: 400_000 };
  const board = {
    ...boardBase, requiredFeatures: [...boardBase.requiredFeatures, 'routed-copper'],
    nets: [{ id: signal, name: 'Signal' }, { id: another, name: 'Unrelated' }],
    tracks: [spine, branch, tail, lower, separate, foreign], vias: [via],
  };
  const plan = (scope) => api.planRouteDeletion(board, scope);
  assert.deepEqual(plan({ kind: 'item', id: via.id }).vias, [via]);
  assert.deepEqual(plan({ kind: 'net', netId: signal }).tracks, [spine, branch, tail, lower, separate]);

  const left = plan({ kind: 'connection', trackId: spine.id, picked: point(8e6, 5.1e6) });
  assert.deepEqual(left.tracks, [{ ...spine, end: branch.start }]);
  assert.deepEqual(left.vias, []);
  const candidate = api.applyRouteDeletion(board, left);
  assert.deepEqual(candidate.tracks, [{ ...spine, start: branch.start }, branch, tail, lower, separate, foreign]);
  assert.deepEqual(board.tracks, [spine, branch, tail, lower, separate, foreign]);
  assert.throws(() => api.applyRouteDeletion({ ...board, revision: board.revision + 1 }, left), /Preview the deletion again/);

  const right = plan({ kind: 'connection', trackId: spine.id, picked: point(18e6, 5e6) });
  assert.deepEqual(right.tracks, [{ ...spine, start: branch.start }, tail, lower]);
  assert.deepEqual(right.vias, [via]);
  const sideBranch = track(via.positionNm, point(24e6, 11e6), signal, 'bottom');
  const branchingVia = api.planRouteDeletion({ ...board, tracks: [...board.tracks, sideBranch] },
    { kind: 'connection', trackId: tail.id });
  assert.deepEqual(branchingVia.tracks, [{ ...spine, start: branch.start }, tail]);
  assert.deepEqual(branchingVia.vias, []);

  const region = { kind: 'region', start: point(26e6, 14e6), end: point(11e6, 3e6), layer: 'top' };
  const box = plan(region);
  assert.deepEqual(box.tracks, [branch, tail, foreign]);
  assert.deepEqual(box.vias, [via]);
  assert.deepEqual(plan({ ...region, layer: 'all' }).tracks, [branch, tail, separate, foreign]);
  assert.deepEqual(plan({ ...region, start: point(25.1e6, 14e6) }).vias, []);
  assert.throws(() => plan({ ...region, end: region.start }), /opposite corners/);
  assert.throws(() => api.applyRouteDeletion(board, plan({ ...region, start: point(36e6, 36e6), end: point(38e6, 38e6) })),
    /No routed copper/);

  const [component] = fixture.components;
  const [device] = fixture.deviceDefinitions;
  const [definition] = fixture.footprintDefinitions;
  const padSignal = crypto.randomUUID();
  const joined = track(spine.end, point(22e6, 15e6));
  const terminated = {
    ...board, requiredFeatures: [...board.requiredFeatures, 'embedded-devices', 'physical-padstacks'],
    tracks: [spine, joined], vias: [],
    components: [{ ...component, role: 'electrical', signals: [{ signalId: padSignal, netId: signal }] }],
    deviceDefinitions: [{ ...device, signalIds: [padSignal],
      assignments: [{ padId: definition.pads[0].id, kind: 'signal', signalId: padSignal }] }],
    footprintDefinitions: [definition],
    footprints: [{ ...fixture.footprints[0], positionNm: spine.end }],
  };
  assert.deepEqual(api.planRouteDeletion(terminated, { kind: 'connection', trackId: spine.id }).tracks, [spine]);

  const history = new api.BoardHistory(board);
  const applied = history.commit(candidate);
  assert.deepEqual((await api.decodeBoard(await api.encodeBoard(applied))).tracks, applied.tracks);
  assert.deepEqual(history.undo(applied.revision).tracks, board.tracks);
});

test('cleans redundant routing while retaining locked tracks, pad contacts and undo history', async () => {
  const fixture = placementFixture(api);
  const base = api.createBoard('Cleanup', 2, fixture.outline);
  const signal = crypto.randomUUID();
  const other = crypto.randomUUID();
  const track = (start, end, properties = {}) => ({
    id: crypto.randomUUID(), start, end, layerId: 'top', netId: signal, widthNm: 500_000, ...properties,
  });
  const a = track(point(5e6, 5e6), point(10e6, 5e6));
  const b = track(a.end, point(15e6, 5e6));
  const duplicate = track(b.end, b.start);
  const climb = track(a.start, point(7e6, 17e6));
  const returnTrack = track(climb.end, b.end);
  const left = track(point(2e6, 5e6), a.start, { locked: true });
  const right = track(b.end, point(20e6, 5e6), { locked: true });
  const review = track(point(24e6, 10e6), point(24e6, 15e6), { reviewRequired: true });
  const unrelated = track(point(22e6, 12e6), point(27e6, 12e6), { netId: other, layerId: 'bottom' });
  const lockedVia = { id: crypto.randomUUID(), netId: signal, locked: true,
    positionNm: right.end, diameterNm: 800_000, drillNm: 400_000 };
  const board = {
    ...base, requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: signal, name: 'Signal' }, { id: other, name: 'Other' }],
    tracks: [a, b, duplicate, climb, returnTrack, left, right, review, unrelated], vias: [lockedVia],
  };
  const result = api.prepareRouteCleanup(board, signal, kernel);
  assert.equal(result.merged, 1);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(new Set(result.loops.map(({ id }) => id)), new Set([climb.id, returnTrack.id]));
  assert.deepEqual(result.board.tracks, [{ ...a, end: b.end }, left, right, review, unrelated]);
  assert.deepEqual(result.board.vias, [lockedVia]);
  assert.equal(board.tracks.length, 9);
  assert.equal(api.prepareRouteCleanup(result.board, signal, kernel).board, result.board);
  assert.deepEqual(api.planRouteDeletion(board, { kind: 'net', netId: signal }).vias, []);
  assert.ok(!api.planRouteDeletion(board, { kind: 'net', netId: signal }).tracks.some(({ locked }) => locked));
  assert.throws(() => api.editManualTracks(board, { kind: 'drag', trackId: left.id, target: point(3.5e6, 8e6) }, kernel), /Unlock this track/);

  const [component] = fixture.components;
  const [device] = fixture.deviceDefinitions;
  const [definition] = fixture.footprintDefinitions;
  const signalId = crypto.randomUUID();
  const withPad = {
    ...board, requiredFeatures: [...board.requiredFeatures, 'embedded-devices', 'physical-padstacks'],
    components: [{ ...component, role: 'electrical', signals: [{ signalId, netId: signal }] }],
    footprintDefinitions: [definition],
    deviceDefinitions: [{ ...device, signalIds: [signalId],
      assignments: [{ padId: definition.pads[0].id, kind: 'signal', signalId }] }],
    footprints: [{ ...fixture.footprints[0], positionNm: climb.end }],
  };
  const preserved = api.prepareRouteCleanup(withPad, signal, kernel);
  assert.deepEqual(preserved.loops, [returnTrack]);
  assert.ok(preserved.board.tracks.some(({ id }) => id === climb.id));

  const top = (position) => ({ layer: 'top', position });
  const bottom = (position) => ({ layer: 'bottom', position });
  assert.deepEqual(api.simplifyRoutePath([top(a.start), top(a.start), top(a.end), top(b.end), bottom(b.end)]),
    [top(a.start), top(b.end), bottom(b.end)]);
  const history = new api.BoardHistory(board);
  const applied = history.commit(result.board);
  const reopened = await api.decodeBoard(await api.encodeBoard(applied));
  assert.deepEqual(reopened.tracks, applied.tracks);
  assert.deepEqual(reopened.vias, [lockedVia]);
  assert.deepEqual(history.undo(applied.revision).tracks, board.tracks);
  const exported = await api.exportKicadBoard(reopened);
  assert.equal(exported.report.notes.filter(({ code }) => code === 'routing-lock').length, 3);
});
