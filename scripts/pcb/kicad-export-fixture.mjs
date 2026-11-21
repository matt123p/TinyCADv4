import { readFile, writeFile } from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const [source, output] = process.argv.slice(2);
if (!source || !output)
  throw new Error(
    'Pass the CAM fixture .dpn and a path for the KiCad export fixture .dpn.',
  );
const { decodeBoard, encodeBoard } = await layoutRuntime();
const board = await decodeBoard(await readFile(source));
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const p = (x, y) => ({ x: Math.round(x * 1e6), y: Math.round(y * 1e6) });
const netId = board.nets[0].id;
const bottomNetId = board.nets[1].id;
const shape = {
  kind: 'polygon',
  vertices: [p(-0.6, -0.5), p(0.6, -0.5), p(0.5, 0.4), p(0, 0.7), p(-0.6, 0.2)],
};
const definition = {
  ...board.footprintDefinitions[0],
  id: id(32),
  name: 'Custom test land',
  graphics: [],
  pads: [
    {
      ...board.footprintDefinitions[0].pads[0],
      id: id(33),
      positionNm: p(0, 0),
      stack: { copper: { top: shape }, mask: { top: shape } },
    },
  ],
};
const device = {
  ...board.deviceDefinitions[0],
  id: id(34),
  footprintId: definition.id,
  packageName: definition.name,
  assignments: [
    {
      padId: id(33),
      kind: 'signal',
      signalId: board.deviceDefinitions[0].signalIds[0],
    },
  ],
};
const customComponent = {
  id: id(35),
  reference: 'U3',
  deviceId: device.id,
  signals: [{ signalId: device.signalIds[0], netId: bottomNetId }],
  role: 'electrical',
};
const connectedZone = {
  id: id(23),
  netId: bottomNetId,
  layerId: 'bottom',
  priority: 2,
  outline: [p(14, 8), p(19, 8), p(19, 12), p(14, 12)],
  cutouts: [],
  padConnection: 'direct',
  viaConnection: 'direct',
  thermalGapNm: 300_000,
  spokeWidthNm: 250_000,
  islands: 'retain',
};
const sourceBoard = {
  ...board,
  requiredFeatures: [
    ...board.requiredFeatures,
    'routed-copper',
    'copper-zones',
  ],
  tracks: [
    {
      id: id(21),
      netId,
      widthNm: 200_000,
      layerId: 'top',
      start: p(5, 4.6),
      end: p(8, 4.6),
    },
    {
      id: id(22),
      netId,
      widthNm: 300_000,
      layerId: 'bottom',
      start: p(8, 4.6),
      end: p(8, 7),
    },
  ],
  vias: [
    {
      id: id(20),
      netId,
      positionNm: p(8, 4.6),
      diameterNm: 700_000,
      drillNm: 300_000,
    },
  ],
  zones: [
    connectedZone,
    {
      ...connectedZone,
      id: id(24),
      viaConnection: 'none',
      outline: [p(14, 2), p(18, 2), p(18, 7), p(14, 7)],
    },
  ],
  components: [...board.components, customComponent],
  footprintDefinitions: [...board.footprintDefinitions, definition],
  deviceDefinitions: [...board.deviceDefinitions, device],
  footprints: [
    ...board.footprints,
    {
      id: id(36),
      componentId: customComponent.id,
      deviceId: device.id,
      positionNm: p(15, 11),
      rotationMicrodegree: 30_000_000,
      side: 'bottom',
      locked: true,
    },
  ],
};
await writeFile(output, await encodeBoard(sourceBoard));
