import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const [output, evidence] = process.argv.slice(2);
if (!output) throw new Error('Pass the output project folder for the regulator reference.');
const api = await layoutRuntime();
const id = (n) => 'd4400000-0000-4000-8000-' + String(n).padStart(12, '0');
const nm = (mm) => Math.round(mm * 1e6);
const pt = (x, y) => ({ x: nm(x), y: nm(y) });
const box = (left, bottom, right, top) => [
  pt(left, bottom), pt(right, bottom), pt(right, top), pt(left, top),
];
const datasheets = {
  ap2112: 'https://www.diodes.com/datasheet/download/AP2112.pdf',
  tps7a7002: 'https://www.ti.com/lit/ds/symlink/tps7a7002.pdf',
};
const net = {
  ground: id(11), inputA: id(12), inputB: id(13),
  outputA: id(14), outputB: id(15), feedback: id(16),
};

async function makePart(spec) {
  const pads = spec.pins.map(([label, , , x, y, w, h], i) =>
    api.makeFootprintPad({
      id: id(spec.key + 2 + i), label, positionNm: pt(x, y),
      profile: label === '9' ? 'rectangle' : 'roundrect',
      widthNm: nm(w), heightNm: nm(h), cornerRadiusNm: nm(0.05),
    }),
  );
  const [width, height] = spec.body;
  const courtyard = box(-spec.courtyard[0], -spec.courtyard[1],
    spec.courtyard[0], spec.courtyard[1]);
  const footprint = await api.footprintDefinition({
    id: id(spec.key), name: spec.package, revision: '1', pads,
    datasheetUrl: spec.datasheet,
    graphics: [{ kind: 'polygon', layer: 'F.CrtYd', points: courtyard, strokeNm: 50_000, filled: false }],
    assembly: { marker: { kind: 'pin-1', padId: pads[0].id } },
  });
  const { definition, digest } = await api.readLibraryDevice(await api.publishFootprintDevice({
    format: 'tinycad-footprint', version: 1, definition: footprint,
    provenance: { kind: 'authored', source: spec.source },
  }, {
    packageName: spec.package, widthNm: nm(width), heightNm: nm(height),
    license: 'CC0-1.0', reviewer: 'TinyCAD reference fixture',
    evidence: spec.review,
    mappings: new Map(pads.map(({ id }, i) => {
      const [, terminal] = spec.pins[i];
      return [id, terminal ? { kind: 'signal', terminal } : { kind: 'nc' }];
    })),
  }));
  const nets = new Map(spec.pins.map(([, terminal, netId]) => [terminal, netId]));
  const signals = definition.terminals.map(({ id: signalId, name }) => ({ signalId, netId: nets.get(name) }));
  const device = {
    id: definition.id, revision: definition.revision,
    packageName: definition.packageNames[0], packageSource: definition.source,
    footprintId: footprint.id, signalIds: signals.map(({ signalId }) => signalId),
    assignments: definition.assignments,
    library: {
      id: definition.id, digest, footprintId: footprint.id,
      reviewer: definition.review.by, evidence: definition.review.evidence,
      license: definition.license,
      bindings: signals.map(({ signalId }) => ({ terminalId: signalId, signalId })),
    },
  };
  const component = {
    id: id(spec.key + 12), reference: spec.reference, value: spec.model, deviceId: device.id,
    procurement: { manufacturer: spec.manufacturer, mpn: spec.model },
    role: 'pcb-only', signals,
  };
  return {
    footprint, component,
    device: { ...device, definitionDigest: await api.deviceDigest(device) },
    placement: {
      id: id(spec.key + 13), componentId: component.id, deviceId: device.id,
      positionNm: spec.position, side: 'top', rotationMicrodegree: 0, locked: false,
    },
  };
}

const a = await makePart({
  key: 100, reference: 'U1', model: 'AP2112K-3.3TRG1', package: 'AP2112K · SOT25',
  manufacturer: 'Diodes Incorporated',
  datasheet: datasheets.ap2112, body: [1.6, 3], courtyard: [1.9, 1.8], position: pt(10, 12),
  source: 'Diodes Incorporated DS39724 Rev. 2-2, SOT25 suggested pad layout.',
  review: 'SOT25 top view and pin table. Land sizes and 0.95 mm pitch follow page 14.',
  pins: [
    ['1', 'VIN', net.inputA, -1.2, 0.95, 0.8, 0.55],
    ['2', 'GND', net.ground, -1.2, 0, 0.8, 0.55],
    ['3', 'EN', net.inputA, -1.2, -0.95, 0.8, 0.55],
    ['4', null, null, 1.2, -0.95, 0.8, 0.55],
    ['5', 'VOUT', net.outputA, 1.2, 0.95, 0.8, 0.55],
  ],
});
const b = await makePart({
  key: 120, reference: 'U2', model: 'TPS7A7002DDA', package: 'TPS7A7002 · DDA0008B',
  manufacturer: 'Texas Instruments',
  datasheet: datasheets.tps7a7002, body: [3.9, 4.9], courtyard: [3.8, 2.75], position: pt(28, 12),
  source: 'TI SBVS209D and DDA0008B package drawing 4214849/B, example PCB and stencil.',
  review: 'DDA pin table and top view. Pad 9 PowerPAD has its own terminal and connects to ground.',
  pins: [
    ...[
      [null, null], ['EN', net.inputB], ['IN', net.inputB], [null, null],
      [null, null], ['OUT', net.outputB], ['FB', net.feedback], ['GND', net.ground],
    ].map(([name, netId], i) => [
      String(i + 1), name, netId, i < 4 ? -2.7 : 2.7,
      (i < 4 ? 1.5 - i : i - 5.5) * 1.27, 1.55, 0.6,
    ]),
    ['9', 'PowerPAD', net.ground, 0, 0, 2.71, 3.4],
  ],
});

let nextTrack = 30;
function route(netId, width, ...points) {
  return points.slice(1).map(([x, y], index) => ({
    id: id(nextTrack++), netId, widthNm: nm(width), layerId: 'top',
    start: pt(...points[index]), end: pt(x, y),
  }));
}
const zone = {
  id: id(20), netId: net.ground, layerId: 'bottom',
  outline: box(2, 2, 38, 22), cutouts: [], priority: 1,
  padConnection: 'direct', viaConnection: 'thermal',
  spokeWidthNm: nm(0.30), thermalGapNm: nm(0.30), islands: 'retain',
};
const base = {
  ...api.createBoard('Regulator copper reference', 2, box(0, 0, 40, 24)),
  boardId: id(1),
  requiredFeatures: ['straight-outline', 'embedded-devices', 'physical-padstacks', 'routed-copper',
    'copper-zones', 'fabrication-settings'],
  fabrication: { profileId: 'classroom-v1', thicknessNm: nm(1.6) },
  footprints: [a.placement, b.placement],
  footprintDefinitions: [a.footprint, b.footprint],
  deviceDefinitions: [a.device, b.device],
  components: [a.component, b.component],
  nets: [
    { id: net.ground, name: 'GND' },
    { id: net.inputA, name: 'AP2112 VIN' }, { id: net.inputB, name: 'TPS7A7002 IN' },
    { id: net.outputA, name: 'AP2112 VOUT' }, { id: net.outputB, name: 'TPS7A7002 OUT' },
    { id: net.feedback, name: 'TPS7A7002 FB' },
  ],
  tracks: [
    ...route(net.inputA, 0.30, [8.8, 12.95], [4.8, 12.95], [4.8, 11.05], [8.8, 11.05]),
    ...route(net.ground, 0.30, [8.8, 12], [6.5, 12]),
    ...route(net.outputA, 0.50, [11.2, 12.95], [15, 12.95]),
    ...route(net.inputB, 0.45, [25.3, 12.635], [22, 12.635], [22, 11.365], [25.3, 11.365]),
    ...route(net.ground, 0.50, [30.7, 13.905], [34, 13.905]),
    ...route(net.ground, 0.65, [28, 12], [28, 8]),
    ...route(net.outputB, 0.55, [30.7, 11.365], [35, 11.365]),
    ...route(net.feedback, 0.25, [30.7, 12.635], [33, 12.635]),
  ],
  vias: [pt(6.5, 12), pt(34, 13.905), pt(28, 8)].map((positionNm, i) => ({
    id: id(21 + i), netId: net.ground, positionNm,
    diameterNm: nm(1), drillNm: nm(0.30),
  })),
  zones: [zone],
};
const faulty = {
  ...base, revision: 1,
  zones: [{ ...zone, cutouts: [
    { outline: box(28.58, 8.03, 28.72, 8.29) },
    { outline: box(27.7, 8.58, 28.3, 8.72) },
  ] }],
};

const wasm = await readFile(new URL('../../node_modules/clipper2-wasm/dist/es/clipper2z.wasm', import.meta.url));
const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
const bytes = await api.encodeBoard(base);
const board = await api.decodeBoard(bytes);
assert.deepEqual(await api.encodeBoard(board), bytes);
const mapping = (reference) => {
  const component = board.components.find((item) => item.reference === reference);
  const device = board.deviceDefinitions.find(({ id }) => id === component.deviceId);
  const footprint = board.footprintDefinitions.find(({ id }) => id === device.footprintId);
  const part = reference === 'U1' ? a : b;
  const observed = new Map();
  for (const { padId, kind, signalId } of device.assignments) {
    const { label } = footprint.pads.find(({ id }) => id === padId);
    const signal = component.signals.find((item) => item.signalId === signalId);
    observed.set(label, kind === 'nc' ? 'NC' : board.nets.find(({ id }) => id === signal?.netId).name);
  }
  assert.equal(device.library.digest, part.device.library.digest);
  assert.equal(footprint.datasheetUrl, part.footprint.datasheetUrl);
  return [...observed].sort(([a], [b]) => Number(a) - Number(b)).map(([, name]) => name);
};
assert.deepEqual(mapping('U1'), ['AP2112 VIN', 'GND', 'AP2112 VIN', 'NC', 'AP2112 VOUT']);
assert.deepEqual(mapping('U2'), [
  'NC', 'TPS7A7002 IN', 'TPS7A7002 IN', 'NC', 'NC', 'TPS7A7002 OUT', 'TPS7A7002 FB', 'GND', 'GND',
]);
const preview = await api.prepareCamPreview(board, kernel);
assert.deepEqual(preview.report.issues, []);
const bad = await api.prepareCamPreview(await api.decodeBoard(await api.encodeBoard(faulty)), kernel);
const issues = bad.report.issues;
assert.deepEqual(issues.map(({ code }) => code).sort(), ['thermal-spoke-missing', 'thermal-spoke-width']);
assert.match(issues.find(({ code }) => code === 'thermal-spoke-missing').message, /^North/);
assert.match(issues.find(({ code }) => code === 'thermal-spoke-width').message, /^East/);

await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Regulators.dpn'), bytes);
await writeFile(path.join(output, 'Regulators.tcproject'), api.encodeProjectSettings({
  title: board.title, projectId: id(2), revisionId: id(3), requiredFeatures: [],
  primaryBoard: board.boardId, entries: [{ kind: 'board', id: board.boardId, path: 'Regulators.dpn' }],
  associations: [],
}));
if (evidence) {
  await mkdir(evidence, { recursive: true });
  for (const [name, result] of [['baseline', preview], ['clipped', bad]]) {
    const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
    for (const [filename, data] of Object.entries({
      ...result.files, 'manifest.json': JSON.stringify(result.manifest, null, 2),
    })) await writer.add(filename, new TextReader(data), { level: 0 });
    await writeFile(path.join(evidence, name + '.zip'), await writer.close());
  }
}
console.log('Verified both regulator packages, copper connectivity and the clipped thermal diagnostic.');
