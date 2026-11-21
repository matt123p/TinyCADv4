import { writeFile } from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const output = process.argv[2];
const legendText = process.argv.includes('--legend-text');
if (!output) throw new Error('Pass an output path for the CAM .dpn fixture.');
const { createBoard, encodeBoard } = await layoutRuntime();
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const point = (x, y) => ({ x: Math.round(x * 1e6), y: Math.round(y * 1e6) });
const rectangle = (x1, y1, x2, y2) => [
  point(x1, y1),
  point(x2, y1),
  point(x2, y2),
  point(x1, y2),
];
const padFace = (width, height) => ({
  kind: 'polygon',
  vertices: rectangle(-width / 2, -height / 2, width / 2, height / 2),
});
const { outline, ...board } = createBoard(
  'CAM read-back fixture',
  2,
  rectangle(0, 0, 24, 17),
);
const definitionDigest = 'sha256:' + '0'.repeat(64);
const footprint = {
  id: id(2),
  name: 'Asymmetric CAM coupon',
  revision: '1',
  definitionDigest,
  pads: [
    {
      id: id(3),
      label: '1',
      positionNm: point(1, 0.6),
      stack: {
        copper: { top: padFace(1, 0.6) },
        mask: { top: padFace(1.2, 0.8) },
        paste: { top: padFace(0.8, 0.4) },
      },
    },
  ],
  graphics: [
    legendText
      ? {
          kind: 'text',
          layer: 'F.SilkS',
          strokeNm: 200_000,
          filled: false,
          at: point(0.1, 1.7),
          sizeNm: point(1.8, 0.3),
          visible: true,
          rotationMicrodegree: 0,
          align: ['left', 'bottom'],
          text: 'L',
        }
      : {
          kind: 'rect',
          layer: 'F.SilkS',
          strokeNm: 0,
          filled: true,
          start: point(0.1, 1.7),
          end: point(1.9, 2),
        },
  ],
};
const device = {
  id: id(4),
  footprintId: footprint.id,
  definitionDigest,
  revision: '1',
  packageSource: 'Synthetic CAM fixture',
  packageName: footprint.name,
  signalIds: [id(5)],
  assignments: [{ padId: id(3), kind: 'signal', signalId: id(5) }],
};
const first = point(20.5, 13);
const second = point(19.5, 13);
await writeFile(
  output,
  await encodeBoard({
    ...board,
    boardId: id(1),
    requiredFeatures: [
      'analytic-profile',
      'embedded-devices',
      'physical-padstacks',
      'mechanical-holes',
      'fabrication-settings',
    ],
    profile: {
      outline: outline.map((start, index) => ({
        kind: 'line',
        start,
        end: outline[(index + 1) % outline.length],
      })),
      cutouts: [
        [
          {
            kind: 'arc',
            start: first,
            end: second,
            centre: point(20, 13),
            clockwise: false,
          },
          {
            kind: 'arc',
            start: second,
            end: first,
            centre: point(20, 13),
            clockwise: false,
          },
        ],
      ],
    },
    fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
    footprintDefinitions: [footprint],
    deviceDefinitions: [device],
    components: ['U1', 'U2'].map((reference, index) => ({
      id: id(6 + index),
      deviceId: device.id,
      reference,
      role: index === 0 ? 'electrical' : 'dnp',
      signals: [{ signalId: id(5), netId: id(10 + index) }],
    })),
    footprints: [
      {
        id: id(8),
        componentId: id(6),
        side: 'top',
        positionNm: point(4, 4),
        rotationMicrodegree: 0,
      },
      {
        id: id(9),
        componentId: id(7),
        side: 'bottom',
        positionNm: point(17, 11),
        rotationMicrodegree: 90_000_000,
      },
    ].map((placement) => ({
      ...placement,
      deviceId: device.id,
      locked: false,
    })),
    nets: [
      { id: id(10), name: 'Top pad' },
      { id: id(11), name: 'Bottom pad' },
    ],
    mechanicalHoles: [
      {
        id: id(12),
        start: point(10, 4),
        end: point(12, 4),
        widthNm: 0.6e6,
        landWidthNm: 1e6,
        plated: true,
      },
      {
        id: id(13),
        start: point(6, 12),
        end: point(6, 12),
        widthNm: 1.5e6,
        plated: false,
      },
    ],
  }),
);
