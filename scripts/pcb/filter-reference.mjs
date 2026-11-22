import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { useBundledPackageBody, useBundledPassives } from './reference-symbols.mjs';
import { ngspiceAvailable, runNgspice } from '../tests/ngspice-runner.mjs';

const [source, output] = process.argv.slice(2);
if (!source || !output)
  throw new Error('Pass the reference filter schematic and the output folder.');

const api = await layoutRuntime();
const id = (n) => 'c2200000-0000-4000-8000-' + String(n).padStart(12, '0');
const point = (x, y) => ({ x: Math.round(x * 1e6), y: Math.round(y * 1e6) });
const box = (left, bottom, right, top) => [
  point(left, bottom), point(right, bottom), point(right, top), point(left, top),
];
const drawing = await api.decodeDrawing(await readFile(source));
if (!drawing.sheets.some(({ kind }) => kind === 'simulation')) {
  const simulation = api.createSimulationSheet(drawing.sheets[0], 'Low-pass AC response');
  simulation.id = id(3);
  const setup = simulation.simulation;
  setup.analysis = { ...setup.analysis, kind: 'ac', startFrequency: '10Hz', stopFrequency: '10kHz' };
  setup.signals = ['in', 'rc', 'out'];
  setup.traces = [{ name: 'OUT / IN', operation: 'divide', left: 'out', right: 'in' }];
  setup.measurements = [
    { id: 'cutoff-gain', name: 'Gain at RC corner', kind: 'gain', source: 'out', reference: 'in', at: '159.154943Hz' },
    { id: 'cutoff-phase', name: 'Phase at RC corner', kind: 'phase', source: 'out', reference: 'in', at: '159.154943Hz' },
  ];
  setup.instructions =
    'Run AC analysis. Compare IN, RC and OUT around 159 Hz. The RC network sets the cutoff, and a small-signal op-amp model buffers the output. J1 represents an external AC generator and split supply in this simulation.';
  drawing.sheets.push(simulation);
}

await useBundledPackageBody(api, drawing, {
  library: 'spice', name: '741 op-amp', reference: 'U1',
  transform: (x, y) => [135 + (x - 240) * 0.75, 105 - (y - 270)],
});
await useBundledPassives(api, drawing, { R1: 'Resistor', C1: 'Capacitor', C2: 'Capacitor', C3: 'Capacitor' });
const bytes = await api.encodeDrawing(drawing);
const final = await api.decodeDrawing(bytes);
const graph = await api.buildHierarchicalNetlist({ drawing: final, path: 'Filter.dzn' });
const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
  documentId: final.documentId, revision: 1,
});
const terminalNames = new Map(snapshot.components.flatMap(({ reference, signals }) =>
  signals.flatMap(({ number, terminals }) =>
    terminals.map(({ unitId, pinId }) => [unitId + ':' + pinId, reference + '.' + number]))));
const pinName = ({ unitId, pinId }) => terminalNames.get(unitId + ':' + pinId);
const membership = new Map(snapshot.nets.map(({ names, terminals }) =>
  [names[0], terminals.map(pinName).sort()]));
const expected = new Map(Object.entries({
  IN: ['J1.1', 'R1.1'],
  RC: ['C1.1', 'R1.2', 'U1.3'],
  OUT: ['J1.2', 'U1.2', 'U1.6'],
  '+12V': ['C2.1', 'J1.3', 'U1.7'],
  '-12V': ['C3.1', 'J1.4', 'U1.4'],
  0: ['C1.2', 'C2.2', 'C3.2', 'J1.5'],
}));
assert.deepEqual(membership, expected);
assert.deepEqual(snapshot.noConnects.map(pinName).sort(), ['U1.1', 'U1.5', 'U1.8']);

const footprints = {
  U1: { key: 'dip-8', title: 'LM741CN · PDIP-8', x: 25, y: 22 },
  R1: { key: 'axial-762', title: 'Axial 7.62 mm', x: 10, y: 22 },
  C1: { key: 'radial-250', title: 'Ceramic 2.50 mm', x: 13, y: 15 },
  C2: { key: 'radial-250', title: 'Ceramic 2.50 mm', x: 37, y: 27 },
  C3: { key: 'radial-250', title: 'Ceramic 2.50 mm', x: 15, y: 9 },
  J1: { key: 'header-1x5', title: 'Header 1×05 2.54 mm', x: 24, y: 5 },
};
const headerPads = Array.from({ length: 5 }, (_, i) => api.makeFootprintPad({
  id: id(300 + i), label: String(i + 1), positionNm: point((i - 2) * 2.54, 0),
  profile: i === 0 ? 'roundrect' : 'round', widthNm: 1_800_000, heightNm: 1_800_000,
  cornerRadiusNm: 70_000, drillWidthNm: 1_050_000,
}));
const header = {
  format: 'tinycad-footprint', version: 1,
  definition: await api.footprintDefinition({
    id: id(299), name: 'Header 1×05 2.54 mm', revision: '1', pads: headerPads,
    graphics: [{
      kind: 'polygon', layer: 'F.CrtYd', points: box(-6.6, -1.55, 6.6, 1.55),
      strokeNm: 50_000, filled: false,
    }],
    assembly: { marker: { kind: 'pin-1', padId: headerPads[0].id } },
  }),
  provenance: { kind: 'authored', source: 'Generic square-pin 2.54 mm reference header, sized for a 0.64 mm square post.' },
};
const SQL = await librarySqlite();
const db = new SQL.Database(await readFile(new URL('../../bundled-footprints/starter-v1.tplib', import.meta.url)));
const selectedDevices = new Map();
const revisions = new Map();
try {
  const entries = api.readStarterFootprints(db);
  for (const part of snapshot.components) {
    const { key, title } = footprints[part.reference];
    const entry = entries.find(({ id }) => key === id);
    let revision = revisions.get(key);
    if (!revision) {
      const draft = entry ? await api.readStarterFootprint(db, entry) : header;
      const { definitionDigest, ...source } = draft.definition;
      const definition = part.reference === 'U1' ? await api.footprintDefinition({
        ...source, datasheetUrl: 'https://www.ti.com/lit/ds/symlink/lm741.pdf',
        // The pin-1 assembly marker avoids a silk dot next to the pad.
        graphics: source.graphics.filter(({ kind, layer }) => kind !== 'circle' || layer !== 'F.SilkS'),
        assembly: { marker: { kind: 'pin-1', padId: source.pads.find(({ label }) => label === '1').id } },
      }) : draft.definition;
      const [widthNm, heightNm] = entry?.bodyNm ?? [12_700_000, 2_540_000];
      revision = await api.readLibraryDevice(await api.publishFootprintDevice({ ...draft, definition }, {
        packageName: title, widthNm, heightNm, license: 'CC0-1.0',
        reviewer: 'TinyCAD op-amp reference fixture',
        evidence: part.reference === 'U1'
          ? 'TI SNOSC25D PDIP pin table. Offset-null leads 1 and 5 are unused in the fixture, and pin 8 is NC.'
          : 'Fixture terminal map follows the physical lead numbers.',
        mappings: new Map(definition.pads.map(({ id, label }) => [id, { kind: 'signal', terminal: label }])),
      }));
      revisions.set(key, revision);
    }
    const bindings = revision.definition.assignments.map(({ padId, signalId }) => {
      const label = revision.definition.footprint.pads.find(({ id }) => id === padId).label;
      const signal = part.signals.find(({ number }) => number === label);
      assert.ok(signal, part.reference + '.' + label);
      return { terminalId: signalId, signalId: signal.id };
    });
    selectedDevices.set(part.id, { revision, bindings });
  }
} finally {
  db.close();
}

const empty = {
  ...api.createBoard('Buffered RC filter', 2, box(0, 0, 46, 38)),
  boardId: id(200), requiredFeatures: ['straight-outline', 'fabrication-settings'],
  fabrication: { thicknessNm: 1_600_000, profileId: 'classroom-v1' },
};
const eco = await api.previewCircuitEco(empty, undefined, snapshot, { selectedDevices });
assert.deepEqual(eco.unresolved, []);
let board = api.applyCircuitEco(empty, eco);
const anchors = new Map();
for (const component of board.components) {
  const { x, y } = footprints[component.reference];
  const placement = { positionNm: point(x, y), side: 'top', rotationMicrodegree: 0 };
  board = await api.placeUnplacedComponent(board, component.id, placement);
  const device = board.deviceDefinitions.find(({ id }) => id === component.deviceId);
  const footprint = board.footprintDefinitions.find(({ id }) => id === device.footprintId);
  for (const { label, positionNm } of footprint.pads)
    anchors.set(component.reference + '.' + label, api.placeFootprintPoint(positionNm, placement));
}

const netId = (name) => board.nets.find((net) => net.name === name).id;
let nextTrack = 400;
function track(name, layerId, ...waypoints) {
  const positions = waypoints.map((position) => typeof position === 'string'
    ? anchors.get(position) : point(...position));
  return positions.slice(1).map((end, index) => ({
    id: id(nextTrack++), netId: netId(name), layerId, start: positions[index], end, widthNm: 400_000,
  }));
}
board = await api.decodeBoard(await api.encodeBoard({
  ...board, requiredFeatures: [...board.requiredFeatures, 'routed-copper', 'copper-zones'],
  footprints: board.footprints.map((placement, index) => ({ ...placement, id: id(210 + index) })),
  tracks: [
    ...track('IN', 'top', 'J1.1', [6.19, 5], 'R1.1'),
    ...track('RC', 'top', 'R1.2', 'U1.3'),
    ...track('RC', 'top', 'R1.2', 'C1.1'),
    ...track('OUT', 'bottom', 'J1.2', [21.46, 8], [18, 8], [18, 23.27], 'U1.2'),
    ...track('OUT', 'bottom', 'U1.2', 'U1.6'),
    ...track('+12V', 'top', 'U1.7', 'C2.1'),
    ...track('+12V', 'bottom', 'J1.3', [24, 9], [35.75, 9], 'C2.1'),
    ...track('-12V', 'top', 'J1.4', [26.54, 15], 'U1.4'),
    ...track('-12V', 'top', 'U1.4', 'C3.1'),
  ],
  zones: [{
    id: id(220), netId: netId('0'), layerId: 'bottom', outline: box(1, 1, 45, 37),
    // Remove the thin copper webs between the five header pads.
    priority: 1, cutouts: [{ outline: box(18.92, 4.5, 29.08, 5.5) }],
    padConnection: 'direct', viaConnection: 'direct',
    spokeWidthNm: 300_000, thermalGapNm: 300_000, islands: 'remove',
  }],
}));

const rcPins = expected.get('RC');
const padSources = await api.boardPadSources(board, board.appliedCircuit);
const rcPads = padSources.filter(({ reference, padLabel }) => rcPins.includes(reference + '.' + padLabel));
assert.deepEqual(rcPads.map(({ source }) => pinName(source)).sort(), rcPins);
assert.ok(rcPads.every(({ source }) => source.documentPath === 'Filter.dzn'));
const wasm = await readFile(new URL('../../node_modules/clipper2-wasm/dist/es/clipper2z.wasm', import.meta.url));
const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
const preview = await api.prepareCamPreview(board, kernel);
assert.deepEqual(preview.report.issues, []);

const sheet = final.sheets.find(({ kind }) => kind !== 'simulation');
const setup = final.sheets.find(({ kind }) => kind === 'simulation').simulation;
const netlist = new api.NetlistWorkerState().init({ ...final, sheets: [sheet] });
assert.deepEqual(api.checkSpiceComponents(netlist, setup), []);
const deck = api.buildDeck(netlist, setup);
for (const expected of [
  /^R1 IN RC 10k$/im, /^C1 RC 0 100n$/im,
  /^XU1 RC OUT OUT \+12V -12V ReferenceOpAmp$/im,
  /^Vsig IN 0 AC 1$/im, /^Vpos \+12V 0 DC 12$/im, /^Vneg -12V 0 DC -12$/im,
]) assert.match(deck, expected);

assert.ok(ngspiceAvailable, 'Build the bundled native ngspice engine before qualification.');
const directory = await mkdtemp(path.join(tmpdir(), 'tinycad-filter-'));
try {
  const filename = path.join(directory, 'filter.cir');
  await writeFile(filename, deck);
  const result = runNgspice(filename);
  assert.equal(result.status, 0, result.log);
  assert.ok(result.events, 'Use the bundled native engine for complex sample verification.');
  const normalize = (name) => name.toLowerCase().replace(/^v\((.+)\)$/, '$1');
  const vectors = result.events.find(({ type }) => type === 'vectors').names.map(normalize);
  const columns = ['frequency', 'in', 'rc', 'out'].map((name) => vectors.indexOf(name));
  assert.ok(columns.every((index) => index >= 0), String(vectors));
  const [frequency, input, rc, out] = columns;
  const target = 1 / (2 * Math.PI * 10_000 * 100e-9);
  const samples = result.events.filter(({ type }) => type === 'data').flatMap(({ rows, imaginary }) =>
    rows.map((row, i) => ({ row, imaginary: imaginary[i] })));
  const nearest = samples.reduce((a, b) => Math.abs(a.row[frequency] - target) <
    Math.abs(b.row[frequency] - target) ? a : b);
  const magnitude = ({ row, imaginary }, index) => Math.hypot(row[index], imaginary[index]);
  const ratio = (sample, index) => magnitude(sample, index) / magnitude(sample, input);
  const measured = ratio(nearest, out);
  const phaseDegrees = (Math.atan2(nearest.imaginary[out], nearest.row[out]) -
    Math.atan2(nearest.imaginary[input], nearest.row[input])) * 180 / Math.PI;
  assert.ok(Math.abs(measured - Math.SQRT1_2) < .005, measured);
  assert.ok(Math.abs(phaseDegrees + 45) < .3, phaseDegrees);
  assert.ok(Math.abs(measured - ratio(nearest, rc)) < .001);
  assert.ok(ratio(samples[0], out) > .99);
  assert.ok(ratio(samples.at(-1), out) < .02);
  console.log(JSON.stringify({
    frequencyHz: nearest.row[frequency], gainDb: 20 * Math.log10(measured), phaseDegrees,
  }));
} finally {
  await rm(directory, { recursive: true, force: true });
}

await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Filter.dzn'), bytes);
await writeFile(path.join(output, 'Filter.svg'), api.renderCircuit(sheet));
await writeFile(path.join(output, 'Filter.dpn'), await api.encodeBoard(board));
await writeFile(path.join(output, 'Filter.tcproject'), api.encodeProjectSettings({
  title: board.title, projectId: id(201), revisionId: id(202), requiredFeatures: [],
  primarySchematic: final.documentId, primaryBoard: board.boardId,
  entries: [
    { kind: 'schematic', id: final.documentId, path: 'Filter.dzn' },
    { kind: 'board', id: board.boardId, path: 'Filter.dpn' },
  ],
  associations: [{ schematic: final.documentId, board: board.boardId }],
}));
