import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import occt from 'occt-import-js';
import { Vector3 } from 'three';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const [output, camFolder] = process.argv.slice(2);
if (!output) throw new Error('Pass the output project folder for the connector reference.');
const api = await layoutRuntime();
const require = createRequire(import.meta.url);
const id = (n) => 'e5550000-0000-4000-8000-' + String(n).padStart(12, '0');
const point = (x, y) => ({ x: Math.round(x * 1e6), y: Math.round(y * 1e6) });
const SQL = await librarySqlite();
const db = new SQL.Database(await readFile(new URL('../../bundled-footprints/starter-v1.tplib', import.meta.url)));
let catalogueDevice;
try {
  catalogueDevice = (await api.readStarterDevices(db)).find(({ definition }) =>
    definition.packageNames.includes('PJ-102A'));
} finally {
  db.close();
}
assert.ok(catalogueDevice, 'Reviewed PJ-102A device');
const { definition: reviewed } = catalogueDevice;
const { definitionDigest: oldFootprintDigest, ...sourceFootprint } = reviewed.footprint;
const localFootprint = await api.footprintDefinition({
  ...sourceFootprint,
  id: id(20),
  assembly: { marker: { kind: 'pin-1', padId: reviewed.footprint.pads.find(({ label }) => label === '1').id } },
});
const { definition, digest } = await api.readLibraryDevice(await api.writeLibraryDevice({
  ...reviewed, id: id(21), footprint: localFootprint,
  review: { ...reviewed.review, evidence: reviewed.review.evidence + ' The fixture assembly drawing identifies contact 1.' },
}));
const { footprint } = definition;
const signals = definition.terminals.map(({ id: signalId }, index) => ({ signalId, netId: id(10 + index) }));
const device = {
  id: definition.id,
  revision: definition.revision,
  packageName: definition.packageNames[0],
  packageSource: definition.source,
  footprintId: footprint.id,
  signalIds: signals.map(({ signalId }) => signalId),
  assignments: definition.assignments,
  library: {
    id: definition.id,
    digest,
    footprintId: footprint.id,
    evidence: definition.review.evidence,
    reviewer: definition.review.by,
    license: definition.license,
    bindings: signals.map(({ signalId }) => ({ terminalId: signalId, signalId })),
  },
};
const placement = {
  id: id(3), componentId: id(2), deviceId: device.id, locked: false,
  positionNm: point(26, 17), side: 'bottom', rotationMicrodegree: 90_000_000,
};
const board = await api.decodeBoard(await api.encodeBoard({
  ...api.createBoard('Connector reference', 2, [point(0, 0), point(44, 0), point(44, 32), point(0, 32)]),
  boardId: id(1),
  requiredFeatures: ['straight-outline', 'embedded-devices', 'physical-padstacks',
    'mechanical-holes', 'fabrication-settings'],
  fabrication: { thicknessNm: 1_600_000 },
  components: [{
    id: placement.componentId, reference: 'J1', deviceId: device.id,
    procurement: { manufacturer: 'Same Sky', mpn: 'PJ-102A' },
    role: 'pcb-only', signals,
  }],
  footprintDefinitions: [footprint],
  deviceDefinitions: [{ ...device, definitionDigest: await api.deviceDigest(device) }],
  modelAssets: definition.models,
  footprints: [placement],
  nets: definition.terminals.map(({ name }, index) => ({ id: id(10 + index), name })),
  mechanicalHoles: [point(5, 5), point(39, 27)].map((centre, index) => ({
    id: id(5 + index), start: centre, end: centre, widthNm: 3_200_000, plated: false,
    screwHeadDiameterNm: 6_000_000, screwHeadSide: 'bottom', bodyClearanceNm: 500_000,
  })),
}));

const wasm = await readFile(path.join(path.dirname(require.resolve('clipper2-wasm/package.json')),
  'dist/es/clipper2z.wasm'));
const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
const axes = [
  [[25.7, 10.5], [26.3, 10.5]],
  [[25.7, 16.5], [26.3, 16.5]],
  [[30.7, 13.2], [30.7, 13.8]],
];
const features = api.boardCopperGeometry(board);
assert.deepEqual(features.drills.filter(({ plated }) => plated).map((drill) =>
  [drill.start, drill.end].sort((a, b) => a.x - b.x || a.y - b.y)
    .map(({ x, y }) => [x / 1e6, y / 1e6])).sort(), axes);
assert.ok(features.drills.filter(({ plated }) => plated).every(({ widthNm }) => widthNm === 1e6));
const { courtyards, silk, issues } = api.boardArtwork(board, kernel);
assert.deepEqual(issues, []);
assert.deepEqual(courtyards.map(({ side }) => side), ['bottom']);
assert.deepEqual(silk.map(({ side }) => side), ['bottom']);
const corners = courtyards[0].regions.flatMap(({ outer }) => outer);
const xs = corners.map(({ x }) => x / 1e6);
const ys = corners.map(({ y }) => y / 1e6);
assert.deepEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  [19.875, 9.075, 32.125, 24.925]);
assert.deepEqual(api.mountingKeepouts(board).map(({ side, location }) => ({ side, location })), [
  { side: 'bottom', location: point(5, 5) }, { side: 'bottom', location: point(39, 27) },
]);

// Read the embedded STEP and measure the tessellated lead geometry in board coordinates.
const model = footprint.models[0];
const step = await api.readBoardModelAsset(board.modelAssets.find(({ id }) => id === model.assetId));
const engine = await occt({ wasmBinary: await readFile(require.resolve('occt-import-js/dist/occt-import-js.wasm')) });
const result = engine.ReadStepFile(step, {
  linearUnit: 'millimeter', linearDeflectionType: 'absolute_value',
  linearDeflection: 0.025, angularDeflection: 0.35,
});
assert.equal(result.success, true, 'Embedded STEP parses');
const { boardMountMatrix, modelLocalMatrix } = await api.loadModelPlacementMatrix();
const mount = boardMountMatrix(board.footprints[0], 1.6).multiply(modelLocalMatrix(model));
const round = (value) => Number(value.toFixed(4));
const bounds = result.meshes.map(({ attributes }) => {
  const values = attributes.position.array;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let offset = 0; offset < values.length; offset += 3) {
    const vertex = new Vector3().fromArray(values, offset).applyMatrix4(mount);
    min.min(vertex);
    max.max(vertex);
  }
  return { min, max };
});
const body = bounds.filter(({ max }) => max.z <= -0.8 + 1e-8);
assert.deepEqual(body.map(({ min, max }) => [min.toArray().map(round), max.toArray().map(round)]),
  [[[21.3, 9.8, -11.8], [30.7, 24.2, -0.8]]]);
const leads = bounds.filter(({ max }) => max.z > 0.8);
assert.deepEqual(leads.map(({ min, max }) => [
  round((min.x + max.x) / 2), round((min.y + max.y) / 2),
]).sort(), [[26, 10.5], [26, 16.5], [30.7, 13.5]]);
assert.equal(body.length + leads.length, bounds.length);

const preview = await api.prepareCamPreview(board, kernel);
assert.deepEqual(preview.report.issues, []);
const classroom = await api.prepareCamPreview({
  ...board, fabrication: { ...board.fabrication, profileId: 'classroom-v1' },
}, kernel);
assert.equal(classroom.report.issues.filter(({ code }) => code === 'fabrication-slot-length').length, 3);

await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Connector.dpn'), await api.encodeBoard(board));
await writeFile(path.join(output, 'Connector.tcproject'), api.encodeProjectSettings({
  title: board.title, projectId: id(8), revisionId: id(9), requiredFeatures: [],
  primaryBoard: board.boardId,
  entries: [{ kind: 'board', id: board.boardId, path: 'Connector.dpn' }], associations: [],
}));
if (camFolder) {
  await mkdir(camFolder, { recursive: true });
  for (const [name, data] of Object.entries(preview.files)) await writeFile(path.join(camFolder, name), data);
  await writeFile(path.join(camFolder, 'manifest.json'), JSON.stringify(preview.manifest, null, 2));
}
console.log('Verified PCB geometry, bottom courtyard, keep-outs, and tessellated STEP body and leads.');
