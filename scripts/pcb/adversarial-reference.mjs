import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const [output] = process.argv.slice(2);
if (!output) throw new Error('Pass an output folder for the geometry reference.');
const api = await layoutRuntime();
const id = (n) => 'ad520000-0000-4000-8000-' + String(n).padStart(12, '0');
const scale = 1e6;
function fixture(originX, originY) {
  const pt = (x, y) => ({ x: originX + Math.round(x * scale), y: originY + Math.round(y * scale) });
  const rectangle = (left, bottom, right, top) => [
    pt(left, bottom), pt(right, bottom), pt(right, top), pt(left, top),
  ];
  const outline = rectangle(0, 0, 30, 20);
  const outlineEdges = api.straightContour(outline);
  const cutouts = [api.circleContour(pt(24, 14), scale)];
  const base = api.createBoard('Adversarial geometry', 2, outline);
  const { outline: unused, ...board } = base;
  const tracks = [4, 4.200001, 7, 7.2, 10, 10.199999].map((y, index) => ({
    id: id(20 + index), netId: id(10 + index), layerId: 'top', widthNm: 200_000,
    start: pt(3, y), end: pt(11, y),
  }));
  for (const [index, from, to] of [
    [0, [3, 12], [6, 12]],
    [1, [6.2, 12], [9.2, 12]],
    [2, [3, 14], [7, 14]],
    [3, [3, 14.2], [7, 14.2]],
  ]) {
    tracks.push({
      id: id(40 + index), netId: id(index < 2 ? 17 : 18), layerId: 'top', widthNm: 200_000,
      start: pt(...from), end: pt(...to),
    });
  }
  const outlineTeeth = Array.from({ length: 2049 }, (_, index) =>
    pt(18 - 16 * index / 2048, 15 - (index % 2) * .006));
  const centre = pt(24, 5);
  return {
    pt, outlineEdges,
    board: {
      ...board, boardId: id(1),
      requiredFeatures: ['analytic-profile', 'routed-copper', 'copper-zones', 'mechanical-holes'],
      profile: { outline: outlineEdges, cutouts },
      nets: [
        ...['Gap A', 'Gap B', 'Tangent A', 'Tangent B', 'Overlap A', 'Overlap B']
          .map((name, index) => ({ id: id(10 + index), name })),
        { id: id(16), name: 'Zone' },
        { id: id(17), name: 'Point contact' }, { id: id(18), name: 'Shared edge' },
      ],
      tracks,
      zones: [{
        id: id(30), netId: id(16), layerId: 'bottom', priority: 1,
        outline: [pt(2, 2), pt(18, 2), ...outlineTeeth],
        cutouts: [
          { outline: rectangle(6, 6, 7, 8) },
          { outline: rectangle(7.001, 6, 9, 8) },
        ],
        padConnection: 'direct', viaConnection: 'direct', islands: 'retain',
        thermalGapNm: 300_000, spokeWidthNm: 300_000,
      }],
      mechanicalHoles: [{
        id: id(31), start: centre, end: centre, plated: false, widthNm: 800_000,
      }],
    },
  };
}

const offsetX = 468 * scale;
const offsetY = 477 * scale;
const large = fixture(offsetX, offsetY);
const local = fixture(0, 0);

const edges = large.outlineEdges;
const gap = [{ ...edges[0], end: { ...edges[0].end, x: edges[0].end.x - 1 } }, ...edges.slice(1)];
assert.throws(() => api.flattenContour(gap), (error) =>
  /gap/.test(error.message) && error.edgeIndex === 0 && error.otherEdgeIndex === 1);
assert.deepEqual(api.repairProfileJunction(gap, 0), edges);

// The analytic circle's leftmost point is exactly at x = radius + gap - radius.
for (const gapNm of [0, 100]) {
  const hole = api.circleContour(large.pt(1 + gapNm / scale, 12), scale);
  assert.throws(() => api.profileRegion({ outline: edges, cutouts: [hole] }),
    (error) => error.cutoutIndex === 0 && /curve uncertainty/.test(error.message));
}
const separated = api.circleContour(large.pt(1.000101, 12), scale);
assert.equal(api.profileRegion({ outline: edges, cutouts: [separated] }).holes.length, 1);

const wasm = await readFile(new URL('../../node_modules/clipper2-wasm/dist/es/clipper2z.wasm', import.meta.url));
const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
const overloaded = {
  ...large.board,
  zones: [{
    ...large.board.zones[0],
    outline: Array.from({ length: 8193 }, (_, i) => large.pt(2 + i / 1000, 4)),
  }],
};
await assert.rejects(api.encodeBoard(overloaded), /8,192 vertices/);
const source = await api.encodeBoard(large.board);
const opened = await api.decodeBoard(source);
assert.deepEqual(await api.encodeBoard(opened), source);

async function exercise(board) {
  const start = performance.now();
  const geometry = api.boardCopperGeometry(board);
  const zone = api.boardZoneGeometry(board, kernel, geometry);
  assert.equal(zone.fills.length, 1);
  const filled = zone.fills[0].region;
  assert.ok(filled.outer.length >= 2048, filled.outer.length);
  assert.equal(filled.holes.length, 2);
  const topology = api.analyseCopper(kernel, [...geometry.features, ...zone.fills], geometry.drills);
  const shorts = topology.shorts.map(({ netIds }) => netIds).sort();
  assert.deepEqual(shorts, [[id(12), id(13)], [id(14), id(15)]]);
  const preview = await api.prepareCamPreview(board, kernel);
  assert.equal(preview.report.issues.filter(({ code }) => code === 'short').length, 2);
  const clearance = preview.report.issues.filter(({ code }) => code === 'copper-clearance');
  assert.deepEqual(clearance.map(({ measuredNm }) => measuredNm), [1, 0, 0]);
  const pointContacts = preview.report.issues.filter(({ code }) => code === 'copper-point-contact');
  assert.deepEqual(pointContacts.map(({ objects, measuredNm, requiredNm }) => [objects, measuredNm, requiredNm]),
    [[[id(40) + '/0', id(41) + '/0'], 0, 180_000]]);
  const web = preview.report.issues.filter(({ code }) => code === 'zone-minimum-width');
  assert.deepEqual(web.map(({ measuredNm, requiredNm }) => [measuredNm, requiredNm]),
    [[1_000, 180_000]]);
  assert.equal(web[0].location.x, board.profile.outline[0].start.x + 7_000_500);
  assert.equal(preview.report.coverage.find(({ check }) => check === 'Physical connectivity').status, 'checked');
  return { preview, filled, shorts, elapsedMs: performance.now() - start };
}
const reference = await exercise(local.board);
const stressed = await exercise(opened);
assert.deepEqual(stressed.shorts, reference.shorts);
const signature = (report) => report.issues.map(({ code, objects, measuredNm }) =>
  [code, objects, measuredNm]);
assert.deepEqual(signature(stressed.preview.report), signature(reference.preview.report));

// Compare the exact filled geometry after normalising the absolute board origin.
function ringKey(ring, offsetX, offsetY) {
  const first = ring.reduce((least, point, i) => {
    const other = ring[least];
    return point.x < other.x || (point.x === other.x && point.y < other.y) ? i : least;
  }, 0);
  return [...ring.slice(first), ...ring.slice(0, first)]
    .map(({ x, y }) => [x - offsetX, y - offsetY].join(',')).join(';');
}
assert.equal(ringKey(stressed.filled.outer, offsetX, offsetY), ringKey(reference.filled.outer, 0, 0));
assert.deepEqual(
  stressed.filled.holes.map((ring) => ringKey(ring, offsetX, offsetY)).sort(),
  reference.filled.holes.map((ring) => ringKey(ring, 0, 0)).sort(),
);
const repeat = await api.prepareCamPreview(await api.decodeBoard(source), kernel);
for (const [name, contents] of Object.entries(repeat.files)) {
  if (name !== 'checks.json') assert.equal(contents, stressed.preview.files[name], name);
}

await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Geometry.dpn'), source);
await writeFile(path.join(output, 'Geometry.tcproject'), api.encodeProjectSettings({
  title: opened.title, projectId: id(2), revisionId: id(3), requiredFeatures: [],
  primaryBoard: opened.boardId,
  entries: [{ kind: 'board', id: opened.boardId, path: 'Geometry.dpn' }], associations: [],
}));
console.log(JSON.stringify({
  nearOriginMs: Math.round(reference.elapsedMs),
  translatedMs: Math.round(stressed.elapsedMs),
  vertices: stressed.filled.outer.length,
  wasmBytes: kernel.memoryBytes(),
}));
