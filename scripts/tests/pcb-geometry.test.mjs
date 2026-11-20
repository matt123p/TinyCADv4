import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

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
      export * from './src/pcb/zoneFill';
      export * from './src/pcb/camWriter';
      export * from './src/pcb/camReadback';
      export * from './src/pcb/board';
      export * from './src/pcb/kicadFootprint';
      export * from './src/pcb/geometryRevision';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  plugins: [
    {
      name: 'node-clipper',
      setup(builder) {
        builder.onResolve({ filter: /^clipper2-wasm$/ }, () => ({
          path: pathToFileURL(require.resolve('clipper2-wasm')).href,
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

test('preserves an analytic outline and rejects invalid cutout topology', () => {
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
    api.parseBoard(api.serializeBoard(resultBoard)).profile,
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
  const saved = api.parseBoard(
    JSON.stringify({
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
    }),
  );
  const placed = api.placeEmbeddedDevice(
    api.parseBoard(api.serializeBoard(saved)),
    instanceId,
    [{ signalId, terminalId: 'J1.01', netId: 'GND' }],
  );
  assert.equal(placed.copper[0].layerId, 'bottom');
  assert.equal(placed.copper[0].terminalId, 'J1.01');
  assert.equal(placed.copper[0].region.outer.length, 4);
  assert.throws(
    () =>
      api.parseBoard(
        JSON.stringify({
          ...saved,
          requiredFeatures: ['straight-outline', 'embedded-devices'],
        }),
      ),
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
