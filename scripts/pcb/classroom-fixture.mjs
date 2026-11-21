import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

export async function classroomBoard() {
  const { createBoard, encodeBoard } = await layoutRuntime();
  let sequence = 0;
  const id = () =>
    '00000000-0000-4000-8000-' + (++sequence).toString(16).padStart(12, '0');
  const nm = (mm) => Math.round(mm * 1e6);
  const point = (x, y) => ({ x: nm(x), y: nm(y) });
  const rectangle = (left, bottom, right, top) => [
    point(left, bottom),
    point(right, bottom),
    point(right, top),
    point(left, top),
  ];
  const definitionDigest = 'sha256:' + '0'.repeat(64);
  const board = createBoard(
    'Synthetic classroom layout',
    2,
    rectangle(0, 0, 105, 92),
  );
  const signalIds = Array.from({ length: 5 }, id);
  const footprint = {
    id: id(),
    name: 'Five-pad qualification fixture',
    revision: '1',
    definitionDigest,
    pads: signalIds.map((_, index) => {
      const copper = {
        kind: 'capsule',
        widthNm: 550_000,
        start: point(0, -0.1),
        end: point(0, 0.1),
      };
      return {
        id: id(),
        label: String(index + 1),
        positionNm: point(index * 1.05, 0),
        stack: {
          copper: { top: copper },
          mask: { top: copper },
          paste: { top: copper },
        },
      };
    }),
  };
  const device = {
    id: id(),
    footprintId: footprint.id,
    definitionDigest,
    revision: '1',
    packageName: footprint.name,
    packageSource: 'Synthetic qualification fixture',
    signalIds,
    assignments: footprint.pads.map(({ id }, index) => ({
      padId: id,
      kind: 'signal',
      signalId: signalIds[index],
    })),
  };
  const components = [];
  const footprints = [];
  const nets = [];
  const tracks = [];
  const vias = [];
  const zones = [];
  for (let n = 0; n < 100; n++) {
    const componentId = id();
    const reference = 'U' + (n + 1);
    const x = 3 + (n % 10) * 10;
    const y = 3 + Math.floor(n / 10) * 9;
    const signals = signalIds.map((signalId, index) => {
      const netId = id();
      nets.push({ id: netId, name: reference + '-' + (index + 1) });
      const padX = x + index * 1.05;
      for (let segment = 0; segment < 4; segment++) {
        tracks.push({
          id: id(),
          netId,
          layerId: 'top',
          widthNm: 200_000,
          start: point(padX, y + segment * 0.75),
          end: point(padX, y + (segment + 1) * 0.75),
        });
      }
      if (index === 0 && n % 2 === 0) {
        vias.push({
          id: id(),
          netId,
          positionNm: point(padX, y + 3),
          diameterNm: 650_000,
          drillNm: 300_000,
        });
        if (n < 8)
          zones.push({
            id: id(),
            netId,
            layerId: 'bottom',
            priority: 1,
            outline: rectangle(padX - 1, y + 2, padX + 1, y + 4),
            cutouts: [],
            padConnection: 'direct',
            viaConnection: 'direct',
            spokeWidthNm: 250_000,
            thermalGapNm: 250_000,
            islands: 'remove',
          });
      }
      return { signalId, netId };
    });
    components.push({
      id: componentId,
      deviceId: device.id,
      reference,
      role: 'electrical',
      signals,
    });
    footprints.push({
      id: id(),
      componentId,
      deviceId: device.id,
      side: 'top',
      positionNm: point(x, y),
      rotationMicrodegree: 0,
      locked: false,
    });
  }
  return encodeBoard({
    ...board,
    boardId: id(),
    requiredFeatures: [
      ...board.requiredFeatures,
      'embedded-devices',
      'physical-padstacks',
      'routed-copper',
      'copper-zones',
    ],
    nets,
    components,
    tracks,
    vias,
    zones,
    footprints,
    footprintDefinitions: [footprint],
    deviceDefinitions: [device],
  });
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  if (!process.argv[2])
    throw new Error('Pass an output path for the classroom .dpn fixture.');
  await writeFile(process.argv[2], await classroomBoard());
}
