import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { useBundledPassives } from './reference-symbols.mjs';

const [, , source, output, evidence] = process.argv;
if (!source || !output) throw new Error('Pass the source schematic and output folder.');
const api = await layoutRuntime();
const id = (n) => 'f6600001-0000-4000-8000-' + String(n).padStart(12, '0');
const nm = (value) => Math.round(value * 1e6);
const point = (x, y) => ({ x: nm(x), y: nm(y) });
const box = (left, bottom, right, top) => [
  point(left, bottom), point(right, bottom), point(right, top), point(left, top),
];
const outline = box(0, 0, 54, 37);
const antenna = box(12, 36.55, 42, 37);
const espressif = 'https://documentation.espressif.com/esp32-c3-wroom-02_datasheet_en.html';
const ti = 'https://www.ti.com/lit/ds/symlink/tmp75.pdf';

const drawing = await api.decodeDrawing(await readFile(source));
await useBundledPassives(api, drawing, { R1: 'Resistor', R2: 'Resistor', R3: 'Resistor', R4: 'Resistor', R5: 'Resistor', R6: 'Resistor', R7: 'Resistor', C1: 'Capacitor', C2: 'Capacitor', C3: 'Capacitor', C4: 'Capacitor' });
const sourceBytes = await api.encodeDrawing(drawing, 'xml');
const graph = await api.buildHierarchicalNetlist({ path: 'Sensor.dsn', drawing });
const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
  documentId: drawing.documentId, revision: 1,
});
const terminalKey = ({ unitId, pinId }) => unitId + ':' + pinId;
const terminalNames = new Map(snapshot.components.flatMap(({ reference, signals }) =>
  signals.flatMap(({ number, terminals }) => terminals.map((terminal) =>
    [terminalKey(terminal), reference + '.' + number],
  )),
));
const terminalName = (terminal) => terminalNames.get(terminalKey(terminal));
const expected = {
  '+3V3': ['C1.1', 'C2.1', 'C4.1', 'J1.1', 'R1.1', 'R2.1', 'R3.1', 'R4.1', 'R5.1', 'R6.1', 'U1.1', 'U2.8'],
  0: ['C1.2', 'C2.2', 'C3.2', 'C4.2', 'J1.2', 'U1.19', 'U1.9', 'U2.4', 'U2.5', 'U2.6', 'U2.7'],
  EN: ['C3.1', 'J2.4', 'R1.2', 'U1.2'],
  SDA: ['R5.2', 'U1.3', 'U2.1'],
  SCL: ['R6.2', 'U1.4', 'U2.2'],
  STRAP8: ['R2.2', 'U1.7'],
  BOOT: ['J2.3', 'R3.2', 'U1.8'],
  STRAP2: ['R4.2', 'U1.16'],
  RXD: ['J2.2', 'U1.11'],
  TXD_MCU: ['R7.1', 'U1.12'],
  TXD: ['J2.1', 'R7.2'],
};
assert.deepEqual(Object.fromEntries(snapshot.nets.map(({ names, terminals }) =>
  [names[0], terminals.map(terminalName).sort()],
)), expected);
assert.deepEqual(snapshot.noConnects.map(terminalName).sort(),
  ['U1.10', 'U1.13', 'U1.14', 'U1.15', 'U1.17', 'U1.18', 'U1.5', 'U1.6', 'U2.3']);

function land(idNumber, label, x, y, width, height, radius = 0) {
  return api.makeFootprintPad({
    id: id(idNumber), label, positionNm: point(x, y),
    profile: radius ? 'roundrect' : 'rectangle',
    widthNm: nm(width), heightNm: nm(height), cornerRadiusNm: nm(radius),
  });
}
const modulePads = Array.from({ length: 18 }, (_, index) => {
  const left = index < 9;
  const row = left ? index : 17 - index;
  return land(110 + index, String(index + 1), left ? -8.75 : 8.75, 2.9 - 1.5 * row, 1.5, 0.9);
});
for (let index = 0; index < 9; index++) {
  modulePads.push(land(130 + index, '19', 1.21 + (index % 3 - 1) * 1.1,
    -3.3 + (Math.floor(index / 3) - 1) * 1.1, 0.7, 0.7));
}
const sensorPads = Array.from({ length: 8 }, (_, index) => {
  const left = index < 4;
  const row = left ? index : 7 - index;
  return land(150 + index, String(index + 1), left ? -2.7 : 2.7, (1.5 - row) * 1.27, 1.55, 0.6, 0.05);
});
const authored = {
  'esp32-c3-wroom-02': {
    id: 100, name: 'ESP32-C3-WROOM-02', width: 18, height: 20,
    datasheetUrl: espressif, pads: modulePads,
    courtyard: box(-9.8, -10.3, 9.8, 3.65),
    fabrication: box(-9, -10, 9, 10),
    source: 'Espressif ESP32-C3-WROOM-02 datasheet v1.7, figure 11-1.',
    evidence: 'Side lands, pad numbering and the nine ground lands for terminal 19 follow the top-view pin table and figure 11-1. The antenna overhang is shown on the fabrication outline.',
  },
  'tmp75-soic-8': {
    id: 101, name: 'TMP75 · D0008A SOIC-8', width: 3.91, height: 4.9,
    datasheetUrl: ti, pads: sensorPads, courtyard: box(-3.8, -2.75, 3.8, 2.75),
    source: 'TI SBOS288M, table 5-1 and SOIC D0008A land drawing 4214825/C.',
    evidence: 'Pin names follow the TI top view. Lands are 1.55 × 0.60 mm on a 1.27 mm pitch, with 5.40 mm row spacing.',
  },
};

async function authoredFootprint(spec) {
  const graphic = (layer, points) => ({ kind: 'polygon', layer, points, strokeNm: 50_000, filled: false });
  return {
    format: 'tinycad-footprint', version: 1,
    definition: await api.footprintDefinition({
      id: id(spec.id), name: spec.name, revision: '1', datasheetUrl: spec.datasheetUrl,
      pads: spec.pads, assembly: { marker: { kind: 'pin-1', padId: spec.pads[0].id } },
      graphics: [
        graphic('F.CrtYd', spec.courtyard),
        ...(spec.fabrication ? [graphic('F.Fab', spec.fabrication)] : []),
      ],
    }),
    provenance: { kind: 'authored', source: spec.source },
  };
}

const placements = {
  U1: ['esp32-c3-wroom-02', 27, 33], U2: ['tmp75-soic-8', 11, 23],
  J1: ['header-1x2', 6, 34], J2: ['header-1x4', 42, 12],
  R1: ['chip-0603', 12, 29.5], R2: ['chip-0603', 21, 20],
  R3: ['chip-0603', 16, 19], R4: ['chip-0603', 41, 33],
  R5: ['chip-0603', 6, 30], R6: ['chip-0603', 6, 27],
  R7: ['chip-0603', 42, 25], C1: ['chip-0603', 11.5, 33.5, 270],
  C2: ['chip-0603', 15.5, 33.25, 270], C3: ['chip-0603', 11, 27],
  C4: ['chip-0603', 7, 18],
};
const devices = new Map();
const reviewed = new Map();
const SQL = await librarySqlite();
const library = new SQL.Database(await readFile(
  new URL('../../bundled-footprints/starter-v1.tplib', import.meta.url),
));
try {
  const entries = api.readStarterFootprints(library);
  for (const part of snapshot.components) {
    const [key] = placements[part.reference];
    const entry = entries.find(({ id: entryId }) => entryId === key);
    const spec = authored[key];
    if (!reviewed.has(key)) {
      let draft = spec ? await authoredFootprint(spec) : await api.readStarterFootprint(library, entry);
      if (!spec) {
        const { definitionDigest, ...definition } = draft.definition;
        draft = {
          ...draft,
          definition: await api.footprintDefinition({
            ...definition,
            // The starter courtyard and lands are unchanged. Use assembly markers instead of silk dots.
            graphics: definition.graphics.filter(({ kind, layer }) => kind !== 'circle' || layer !== 'F.SilkS'),
            ...(key.startsWith('header-') ? {
              assembly: { marker: { kind: 'pin-1', padId: definition.pads.find(({ label }) => label === '1').id } },
            } : {}),
          }),
        };
      }
      const [widthNm, heightNm] = spec ? [nm(spec.width), nm(spec.height)] : entry.bodyNm;
      const bytes = await api.publishFootprintDevice(draft, {
        packageName: spec?.name ?? key, widthNm, heightNm, license: 'CC0-1.0',
        reviewer: 'TinyCAD Reference F',
        evidence: spec?.evidence ?? 'Starter catalogue land geometry and physical lead numbering.',
        mappings: new Map(draft.definition.pads.map(({ id: pad, label }) =>
          [pad, { kind: 'signal', terminal: label }],
        )),
      });
      reviewed.set(key, await api.readLibraryDevice(bytes));
    }
    const revision = reviewed.get(key);
    const bindings = revision.definition.terminals.map(({ id: terminalId, name }) => {
      const signal = part.signals.find(({ number }) => name === number);
      assert.ok(signal, part.reference + '.' + name);
      return { terminalId, signalId: signal.id };
    });
    assert.equal(bindings.length, part.signals.length);
    devices.set(part.id, { revision, bindings });
  }
} finally {
  library.close();
}

const starting = {
  ...api.createBoard('Wi-Fi temperature node', 2, outline),
  boardId: id(1),
  requiredFeatures: ['straight-outline', 'fabrication-settings', 'routing-regions', 'placement-areas'],
  fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
  routingRegions: [{
    id: id(3), name: 'Antenna edge keepout', side: 'both',
    outline: antenna, exclusions: ['track', 'via', 'zone'],
  }],
  placementAreas: [
    { id: id(6), name: 'MCU and boot straps', kind: 'keep-in', side: 'top', outline: box(14, 16, 46, 36.7) },
    { id: id(7), name: 'Sensor and supply', kind: 'keep-in', side: 'top', outline: box(2, 15, 18, 36.7) },
    { id: id(8), name: 'UART service header', kind: 'keep-in', side: 'top', outline: box(36, 8, 49, 16) },
    { id: id(9), name: 'Antenna edge', kind: 'keep-out', side: 'both', outline: box(12, 36.75, 42, 37) },
  ],
};
const eco = await api.previewCircuitEco(starting, undefined, snapshot, { selectedDevices: devices });
assert.deepEqual(eco.unresolved, []);
let board = api.applyCircuitEco(starting, eco);
const anchors = new Map();
for (const component of board.components) {
  const [, x, y, rotation = 0] = placements[component.reference];
  const placement = { positionNm: point(x, y), side: 'top', rotationMicrodegree: nm(rotation) };
  board = await api.placeUnplacedComponent(board, component.id, placement);
  const device = board.deviceDefinitions.find(({ id: deviceId }) => deviceId === component.deviceId);
  const footprint = board.footprintDefinitions.find(({ id: footprintId }) => footprintId === device.footprintId);
  const count = new Map();
  for (const { label, positionNm } of footprint.pads) {
    const n = (count.get(label) ?? 0) + 1;
    count.set(label, n);
    const terminal = component.reference + '.' + label + (n === 1 ? '' : '/' + n);
    anchors.set(terminal, api.placeFootprintPoint(positionNm, placement));
  }
}
assert.equal([...anchors.keys()].filter((key) => /^U1\.19(?:\/|$)/.test(key)).length, 9);

const grid = 250_000;
const step = (value) => Math.round(value / grid) * grid;
const gridPoint = ({ x, y }) => ({ x: step(x), y: step(y) });
const wasm = await readFile(new URL('../../node_modules/clipper2-wasm/dist/es/clipper2z.wasm', import.meta.url));
const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
const trackWidth = 250_000;
const viaDiameterNm = 700_000;
const viaDrillNm = 300_000;
const rules = { minWidthNm: 250_000, clearanceNm: 270_000, edgeClearanceNm: 300_000, minViaAnnulusNm: 180_000 };
const layers = ['top', 'bottom'];
board = { ...board, requiredFeatures: [...board.requiredFeatures, 'routed-copper'], tracks: [], vias: [] };
let nextCopper = 1000;
function route(net, from, to) {
  const { id: netId } = board.nets.find(({ name }) => name === net);
  const geometry = api.boardCopperGeometry(board);
  const own = new Set(geometry.features.filter((feature) => feature.netId === netId)
    .map(({ id: feature }) => feature.slice(0, feature.lastIndexOf(':'))));
  const result = api.routeBoard(kernel, {
    id: 'sensor', netId, widthNm: trackWidth, gridNm: grid,
    start: { position: gridPoint(anchors.get(from)), layer: 'top' },
    goal: { position: gridPoint(anchors.get(to)), layer: to === 'J2.1' ? 'bottom' : 'top' },
    profile: { outer: outline, holes: [] }, layers, rules,
    obstacles: geometry.features,
    drills: geometry.drills.filter(({ id: drill }) => !own.has(drill)),
    keepouts: layers.map((side) => ({ side, copper: { outer: antenna, holes: [] } })),
    viaDiameterNm, viaDrillNm, maxVisits: 60_000,
  });
  assert.equal(result.status, 'routed', `${net} ${from} to ${to} after ${result.visited} routing visits`);
  let start = result.path[0].position;
  const conflicts = (position, other, width) =>
    Math.hypot(position.x - other.x, position.y - other.y) <= (viaDrillNm + width) / 2;
  for (let index = 1; index < result.path.length; index++) {
    const previous = result.path[index - 1];
    const next = result.path[index];
    if (previous.layer !== next.layer) {
      const existing = geometry.drills.some((drill) => own.has(drill.id) &&
        conflicts(next.position, drill.start, drill.widthNm));
      if (!existing && !board.vias.some((via) => via.netId === netId &&
        conflicts(next.position, via.positionNm, via.drillNm))) {
        board.vias.push({ id: id(nextCopper++), netId, positionNm: next.position, diameterNm: viaDiameterNm, drillNm: viaDrillNm });
      }
      start = next.position;
      continue;
    }
    const after = result.path[index + 1];
    if (after?.layer !== next.layer ||
      after.position.x - next.position.x !== next.position.x - previous.position.x ||
      after.position.y - next.position.y !== next.position.y - previous.position.y) {
      board.tracks.push({ id: id(nextCopper++), netId, layerId: next.layer, start, end: next.position, widthNm: trackWidth });
      start = next.position;
    }
  }
}
const connections = {
  EN: ['U1.2', 'R1.2', 'C3.1', 'J2.4'],
  SDA: ['U1.3', 'R5.2', 'U2.1'],
  SCL: ['U1.4', 'R6.2', 'U2.2'],
  STRAP8: ['U1.7', 'R2.2'],
  BOOT: ['U1.8', 'R3.2', 'J2.3'],
  STRAP2: ['U1.16', 'R4.2'],
  TXD_MCU: ['U1.12', 'R7.1'],
  TXD: ['R7.2', 'J2.1'],
  RXD: ['U1.11', 'J2.2'],
};
function routeSeries(name, terminals) {
  for (let index = 1; index < terminals.length; index++) route(name, terminals[index - 1], terminals[index]);
}
routeSeries('+3V3', ['U1.1', 'C2.1', 'C1.1', 'J1.1']);
routeSeries('0', ['J1.2', 'C1.2', 'C2.2']);
for (const [name, terminals] of Object.entries(connections)) routeSeries(name, terminals);
routeSeries('+3V3', ['J1.1', 'R5.1', 'R6.1', 'R1.1', 'R2.1', 'R3.1', 'C4.1', 'U2.8', 'R4.1']);
routeSeries('0', ['C2.2', 'C3.2', 'U2.4', 'C4.2', 'U2.5', 'U2.6', 'U2.7', 'U1.9', 'U1.19',
  'U1.19/2', 'U1.19/3', 'U1.19/6', 'U1.19/5', 'U1.19/4', 'U1.19/7', 'U1.19/8', 'U1.19/9']);
const ground = board.nets.find(({ name }) => name === '0').id;
function groundVia(start, x, y) {
  const end = point(x, y);
  board.tracks.push({ id: id(nextCopper++), netId: ground, layerId: 'top', start, end, widthNm: trackWidth });
  board.vias.push({ id: id(nextCopper++), netId: ground, positionNm: end, diameterNm: viaDiameterNm, drillNm: viaDrillNm });
  return end;
}
const moduleGround = groundVia(anchors.get('U1.19/8'), 28.25, 31.85);
groundVia(moduleGround, 28.25, 35);
groundVia(anchors.get('C4.2'), 8.5, 16.75);
board = await api.decodeBoard(await api.encodeBoard({
  ...board, requiredFeatures: [...board.requiredFeatures, 'copper-zones'],
  zones: [box(25, 31, 31, 36.85), box(7.5, 15.75, 11.5, 17.75)].map((outline, index) => ({
    id: id(40 + index), netId: ground, layerId: 'bottom',
    outline, priority: 1, cutouts: [],
    padConnection: 'direct', viaConnection: 'direct', spokeWidthNm: 300_000, thermalGapNm: 300_000, islands: 'remove',
  })),
}));
const preview = await api.prepareCamPreview(board, kernel);
assert.deepEqual(preview.report.issues, []);

const badSegment = {
  id: id(10), netId: ground, layerId: 'top', widthNm: trackWidth,
  start: point(26, 36.3), end: point(28, 36.7),
};
const challenged = await api.prepareCamPreview({
  ...board, tracks: [...board.tracks, badSegment],
}, kernel);
assert.ok(challenged.report.issues.some(({ code, objects }) =>
  code === 'region-exclusion' && objects.includes(badSegment.id) && objects.includes(id(3)),
));

const sensor = snapshot.components.find(({ reference }) => reference === 'U2');
const accepted = reviewed.get('tmp75-soic-8').definition;
const { definitionDigest, ...oldFootprint } = accepted.footprint;
const movedLand = land(150, '1', -0.7, 1.905, 1.55, 0.6, 0.05);
const variant = await api.footprintDefinition({
  ...oldFootprint, revision: '2',
  pads: accepted.footprint.pads.map((pad) => pad.label === '1' ? movedLand : pad),
});
const altered = await api.readLibraryDevice(await api.writeLibraryDevice({
  ...accepted, revision: '2', footprint: variant,
  review: { by: 'TinyCAD Reference F', evidence: 'Deliberately moved pin 1 for the footprint ECO exercise.' },
}));
const { snapshot: next } = await api.buildHierarchicalCircuitSnapshot(graph, {
  documentId: drawing.documentId, revision: 2, previous: snapshot.nets,
});
const replacement = await api.previewCircuitEco(board, snapshot, next, {
  selectedDevices: new Map([[sensor.id, { ...devices.get(sensor.id), revision: altered }]]),
  loadKernel: async () => kernel,
});
assert.equal(replacement.deviceChanges.length, 1);
assert.ok(replacement.deviceChanges[0].padChanges.some(({ label, changes }) =>
  label === '1' && changes.includes('Position'),
));
assert.ok(replacement.affectedCopper.length);
assert.ok(replacement.opens.some(({ netId }) => netId === board.nets.find(({ name }) => name === 'SDA').id));
assert.ok(board.tracks.every(({ reviewRequired }) => !reviewRequired));

const native = await api.encodeBoard(board);
const reopened = await api.decodeBoard(native);
assert.deepEqual(await api.encodeBoard(reopened), native);
assert.equal(reopened.components.length, 15);
assert.equal(reopened.footprintDefinitions.length, 5);
assert.equal(reopened.deviceDefinitions.length, 15);
assert.ok(reopened.modelAssets.length);

await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Sensor.dsn'), sourceBytes);
await writeFile(path.join(output, 'Sensor.svg'), api.renderCircuit(drawing.sheets[0]));
await writeFile(path.join(output, 'Sensor.dpn'), native);
await writeFile(path.join(output, 'Sensor.tcproject'), api.encodeProjectSettings({
  title: board.title, projectId: id(2), revisionId: id(5), requiredFeatures: [],
  primarySchematic: drawing.documentId, primaryBoard: board.boardId,
  entries: [
    { kind: 'schematic', id: drawing.documentId, path: 'Sensor.dsn' },
    { kind: 'board', id: board.boardId, path: 'Sensor.dpn' },
  ],
  associations: [{ schematic: drawing.documentId, board: board.boardId }],
}));
if (evidence) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const [name, content] of Object.entries(preview.files))
    await writer.add(name, new TextReader(content));
  await writer.add('manifest.json', new TextReader(JSON.stringify(preview.manifest)));
  await writeFile(evidence, await writer.close());
}
console.log(JSON.stringify({
  boardId: board.boardId, components: board.components.length, zones: board.zones.length,
  tracks: board.tracks.length, throughVias: board.vias.length,
  challengedRegion: id(3), affectedBySensorLandChange: replacement.affectedCopper.length,
}));
