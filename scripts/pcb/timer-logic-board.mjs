import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { useBundledPackageBody, useBundledPassives } from './reference-symbols.mjs';

const [schematicPath, output, camFolder] = process.argv.slice(2);
if (!schematicPath || !output)
  throw new Error('Pass the timer schematic path and the output project folder.');
const api = await layoutRuntime();
const id = (n) => 'b5550000-0000-4000-8000-' + String(n).padStart(12, '0');
const point = (x, y) => ({ x: Math.round(x * 1e6), y: Math.round(y * 1e6) });
const box = (left, bottom, right, top) => [
  point(left, bottom), point(right, bottom), point(right, top), point(left, top),
];
const drawing = await api.decodeDrawing(await readFile(schematicPath));
await useBundledPackageBody(api, drawing, {
  library: 'digital', name: 'NAND gate, 2-input', reference: 'U2',
  transform: (x, y) => [220 + y, 220 - x * 0.75],
});
await useBundledPassives(api, drawing, { C1: 'Capacitor', C2: 'Capacitor', C3: 'Capacitor' });
const schematic = await api.encodeDrawing(drawing, 'xml');
const graph = await api.buildHierarchicalNetlist({ drawing, path: 'Timer.dsn' });
const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
  documentId: drawing.documentId, revision: 1,
});

const terminalNames = new Map(snapshot.components.flatMap(({ reference, signals }) =>
  signals.flatMap(({ number, terminals }) => terminals.map(({ unitId, pinId }) => [unitId + ':' + pinId, reference + '.' + number])),
));
const nets = new Map(snapshot.nets.map((net) => [net.names.includes('0') ? '0' : net.names[0], net]));
const groups = {
  TIMER: ['U1.3', 'U2.1', 'U2.2'],
  OUTPUT: ['U2.3', 'J1.4'],
  INPUT: ['U1.2', 'U1.6', 'J1.3'],
  CONTROL: ['U1.5', 'C1.1'],
  VCC: ['J1.1', 'U1.4', 'U1.8', 'U2.14', 'C2.1', 'C3.1'],
  '0': ['J1.2', 'U1.1', 'U2.4', 'U2.5', 'U2.7', 'U2.9', 'U2.10', 'U2.12', 'U2.13',
    'C1.2', 'C2.2', 'C3.2'],
};
assert.equal(nets.size, Object.keys(groups).length);
for (const [name, members] of Object.entries(groups)) {
  const actual = new Set(nets.get(name)?.terminals.map(({ unitId, pinId }) => terminalNames.get(unitId + ':' + pinId)));
  assert.deepEqual(actual, new Set(members), name);
}
const nand = snapshot.components.filter(({ reference }) => reference === 'U2');
assert.equal(nand.length, 1);
assert.equal(new Set(nand[0].signals.flatMap(({ terminals }) => terminals.map(({ unitId }) => unitId))).size, 4);
assert.deepEqual(nand[0].signals.map(({ number }) => Number(number)).sort((a, b) => a - b),
  Array.from({ length: 14 }, (_, index) => index + 1));

const packages = {
  U1: { footprint: 'dip-8', packageName: 'TI TLC555CP · PDIP-8', x: 24, y: 24 },
  U2: { footprint: 'dip-14', packageName: 'TI SN74HC00N · PDIP-14', x: 53, y: 26 },
  J1: { footprint: 'jst-xh-4-vertical', packageName: 'JST B4B-XH-A', x: 7, y: 26, degrees: 90 },
  C1: { footprint: 'radial-250', packageName: 'Ceramic 2.50 mm', x: 34, y: 14 },
  C2: { footprint: 'radial-250', packageName: 'Ceramic 2.50 mm', x: 18, y: 34 },
  C3: { footprint: 'radial-250', packageName: 'Ceramic 2.50 mm', x: 62, y: 37 },
};
const SQL = await librarySqlite();
const db = new SQL.Database(await readFile(new URL('../../bundled-footprints/starter-v1.tplib', import.meta.url)));
const selections = new Map();
try {
  const footprints = api.readStarterFootprints(db);
  const catalogue = await api.readStarterDevices(db);
  for (const component of snapshot.components) {
    const part = packages[component.reference];
    assert.ok(part, component.reference);
    const entry = footprints.find(({ id }) => id === part.footprint);
    const draft = await api.readStarterFootprint(db, entry);
    const pinned = catalogue.find(({ definition }) => definition.name === part.packageName);
    const { definitionDigest, ...definition } = pinned?.definition.footprint ?? draft.definition;
    const artwork = await api.footprintDefinition({
      ...definition,
      graphics: definition.graphics.map((graphic) =>
        graphic.layer === 'F.SilkS' && graphic.kind === 'circle' && graphic.strokeNm < 150_000
          ? {
              ...graphic, strokeNm: 150_000,
              center: { ...graphic.center, x: graphic.center.x - 100_000 },
              end: { ...graphic.end, x: graphic.end.x - 100_000 },
            }
          : graphic),
    });
    const revision = pinned
      ? await api.readLibraryDevice(await api.writeLibraryDevice({
          ...pinned.definition, footprint: artwork,
          review: { ...pinned.definition.review, evidence: pinned.definition.review.evidence + ' Fixture pin-1 dot uses a 0.15 mm stroke and a 0.1 mm outward offset.' },
        }))
      : await api.readLibraryDevice(await api.publishFootprintDevice({ ...draft, definition: artwork }, {
      packageName: part.packageName,
      widthNm: entry.bodyNm[0],
      heightNm: entry.bodyNm[1],
      license: 'CC0-1.0',
      reviewer: 'TinyCAD timer and logic reference fixture',
      evidence: component.reference === 'U1'
        ? 'TI TLC555CP PDIP-8 pin table and package drawing, SLFS043K. Pads use the starter DIP-8 footprint.'
        : 'Fixture mapping by numbered lead to the starter footprint.',
      mappings: new Map(draft.definition.pads.map(({ id, label }) => [id, { kind: 'signal', terminal: label }])),
    }));
    const bindings = revision.definition.assignments.map(({ padId, signalId }) => {
      const { label } = revision.definition.footprint.pads.find(({ id }) => id === padId);
      const signal = component.signals.find(({ number }) => number === label);
      assert.ok(signal, component.reference + '.' + label);
      return { terminalId: signalId, signalId: signal.id };
    });
    selections.set(component.id, { revision, bindings });
  }
} finally {
  db.close();
}

const empty = {
  ...api.createBoard('Timer and logic reference', 1, [point(0, 0), point(76, 0), point(76, 48), point(0, 48)]),
  boardId: id(30),
  requiredFeatures: ['straight-outline', 'fabrication-settings'],
  fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
};
const review = await api.previewCircuitEco(empty, undefined, snapshot, { selectedDevices: selections });
let board = api.applyCircuitEco(empty, review);
const anchors = new Map();
for (const component of board.components) {
  const part = packages[component.reference];
  const placement = { positionNm: point(part.x, part.y), side: 'top', rotationMicrodegree: (part.degrees ?? 0) * 1e6 };
  board = await api.placeUnplacedComponent(board, component.id, placement);
  const device = board.deviceDefinitions.find(({ id }) => id === component.deviceId);
  const footprint = board.footprintDefinitions.find(({ id }) => id === device.footprintId);
  for (const { label, positionNm } of footprint.pads)
    anchors.set(component.reference + '.' + label, api.placeFootprintPoint(positionNm, placement));
}
const jumper = {
  id: id(40), reference: 'JP1', netId: nets.get('TIMER').id, fitted: true,
  start: point(31, 18), end: point(43, 23), landWidthNm: 1_800_000, drillNm: 900_000,
};
board = { ...board, requiredFeatures: [...board.requiredFeatures, 'wire-jumpers'], jumpers: [jumper] };
anchors.set('JP1.A', jumper.start);
anchors.set('JP1.B', jumper.end);
const wasm = await readFile(path.join(path.dirname(createRequire(import.meta.url).resolve('clipper2-wasm/package.json')),
  'dist/es/clipper2z.wasm'));
const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
const gridNm = 500_000;
const layerPoint = (position) => ({ position, layer: 'top' });
const lattice = ({ x, y }) => layerPoint({
  x: Math.round(x / gridNm) * gridNm, y: Math.round(y / gridNm) * gridNm,
});
const rules = { minWidthNm: 250_000, clearanceNm: 250_000, edgeClearanceNm: 300_000, minViaAnnulusNm: 150_000 };
function connect(name, first, second) {
  const netId = nets.get(name).id;
  const from = anchors.get(first);
  const to = anchors.get(second);
  assert.ok(from && to, first + ' to ' + second);
  const geometry = api.boardCopperGeometry(board);
  const ownOpenings = new Set(geometry.features.filter((feature) => feature.netId === netId)
    .map(({ id }) => id.slice(0, id.lastIndexOf(':'))));
  const widthNm = 400_000;
  const viaDiameterNm = 800_000;
  const viaDrillNm = 400_000;
  const clearance = api.prepareManualTrackClearance(board, { netId, widthNm }, kernel);
  const leg = (from, to) => {
    for (const bend of ['straight-first', 'diagonal-first']) {
      const points = api.manualRouteLeg(from, to, bend);
      if (points.every((p, index) => api.isCentrelineClear(clearance, index ? points[index - 1] : from, p, 'top')))
        return points;
    }
  };
  const direct = leg(from, to);
  if (direct) {
    board = api.commitManualRoute(board, {
      netId, widthNm, viaDiameterNm, viaDrillNm, path: [from, ...direct].map(layerPoint),
    }, kernel);
    return;
  }
  const routed = api.routeBoard(kernel, {
    id: 'fixture-route',
    netId, start: lattice(from), goal: lattice(to),
    profile: { outer: board.outline, holes: [] }, layers: ['top'],
    obstacles: geometry.features, drills: geometry.drills.filter(({ id }) => !ownOpenings.has(id)),
    widthNm, gridNm, viaDiameterNm, viaDrillNm, rules, maxVisits: 30_000,
  });
  assert.equal(routed.status, 'routed', `${name} ${first} to ${second}`);
  const raw = [from, ...routed.path.map(({ position }) => position), to];
  const route = [raw[0]];
  for (let start = 0; start < raw.length - 1;) {
    let end = raw.length - 1;
    let shortcut;
    while (end > start && !(shortcut = leg(raw[start], raw[end]))) end--;
    assert.ok(shortcut, `${name} ${first} to ${second} has a blocked escape`);
    route.push(...shortcut);
    start = end;
  }
  board = api.commitManualRoute(board, {
    netId, widthNm, viaDiameterNm, viaDrillNm,
    path: route.map(layerPoint),
  }, kernel);
}

connect('TIMER', 'U1.3', 'JP1.A');
connect('TIMER', 'JP1.B', 'U2.1');
connect('TIMER', 'U2.1', 'U2.2');
for (const name of ['OUTPUT', 'INPUT', 'CONTROL', 'VCC']) {
  const members = groups[name];
  for (let index = 1; index < members.length; index++) connect(name, members[index - 1], members[index]);
}
board = {
  ...board,
  requiredFeatures: [...board.requiredFeatures, 'copper-zones'],
  zones: [{
    id: id(41), netId: nets.get('0').id, layerId: 'top',
    outline: box(1, 1, 75, 47),
    // Clear the thin copper between signal features and beside the jumper lands.
    cutouts: [
      { outline: box(32, 12.8, 33.5, 13.25) },
      { outline: box(42.1, 21.55, 42.9, 22.35) },
      { outline: box(31.654, 17.114, 32.434, 17.894) },
      { outline: box(43.654, 23.106, 44.434, 23.886) },
    ],
    priority: 0, padConnection: 'direct', viaConnection: 'direct',
    thermalGapNm: 300_000, spokeWidthNm: 400_000, islands: 'remove',
  }],
};
board = await api.decodeBoard(await api.encodeBoard({
  ...board, tracks: board.tracks.map((track, index) => ({ ...track, id: id(500 + index) })),
}));
const preview = await api.prepareCamPreview(board, kernel, { state: 'resolved', snapshot, applied: board.appliedCircuit });
assert.deepEqual(preview.report.issues.map(({ code }) => code), ['bare-open-bridged'],
  JSON.stringify(preview.report.issues));
assert.deepEqual(preview.report.jumperConnectivity.bareOpenNets, [jumper.netId]);
assert.deepEqual(preview.report.jumperConnectivity.assembledOpenNets, []);
const geometry = api.boardCopperGeometry(board);
const { fills } = api.boardZoneGeometry(board, kernel, geometry);
const withoutTimerLink = geometry.assemblyLinks.map((link) =>
  link.source === jumper.id ? { ...link, fitted: false } : link);
const assembled = api.analyseCopper(kernel, [...geometry.features, ...fills], geometry.drills, withoutTimerLink);
assert.deepEqual(assembled.assembledOpens.nets.map(({ netId }) => netId), [jumper.netId]);
assert.ok(preview.files['bom.csv'].includes(jumper.reference));
assert.ok(preview.files['jumpers.csv'].includes(jumper.reference));

await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Timer.dsn'), schematic);
await writeFile(path.join(output, 'Timer.dpn'), await api.encodeBoard(board));
await writeFile(path.join(output, 'Timer.tcproject'), api.encodeProjectSettings({
  title: 'Timer and logic reference', projectId: id(31), revisionId: id(32), requiredFeatures: [],
  primarySchematic: drawing.documentId,
  entries: [
    { kind: 'schematic', id: drawing.documentId, path: 'Timer.dsn' },
    { kind: 'board', id: board.boardId, path: 'Timer.dpn' },
  ],
  associations: [{ schematic: drawing.documentId, board: board.boardId }],
}));
if (camFolder) {
  await mkdir(camFolder, { recursive: true });
  for (const [name, data] of Object.entries(preview.files)) await writeFile(path.join(camFolder, name), data);
  await writeFile(path.join(camFolder, 'manifest.json'), JSON.stringify(preview.manifest, null, 2));
}
console.log('Verified one quad NAND package, hidden power mappings, and the bare/assembled connectivity distinction.');
