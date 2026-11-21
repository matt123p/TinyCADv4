import type { BoardDocument } from './board';
import { svgEscape, svgRegionPath, wrapDrawingLine } from './boardOutputDrawing';
import { readGerber, readXnc } from './camReadback';
import { capsulePolygon, profileRegion } from './contours';
import { fabricationProfileFor, stackupThicknessFields } from './fabricationProfiles';
import type { BoardPoint } from './geometry';
import { samePoint } from './geometry';
import { bounds } from './regionDistances';

const mm = (nm: number) => String(nm / 1e6);
const topView = ({ x, y }: BoardPoint) => ({ x: x / 1e6, y: -y / 1e6 });
const toolId = (number: number) => 'T' + String(number).padStart(2, '0');
const csv = (header: string, rows: readonly (readonly (string | number)[])[]) =>
  [header, ...rows.map((row) => row.join(',')), ''].join('\r\n');

export function fabricationDocumentation(
  board: BoardDocument,
  files: Readonly<Record<string, string>>,
) {
  const [outline, ...cutouts] = readGerber(files['profile.gbr']).contours;
  const profile = profileRegion({ outline, cutouts });
  const drilling = ['plated.xnc', 'non-plated.xnc'].flatMap((source) =>
    readXnc(files[source]).drills.map((hole) => ({
      ...hole,
      source,
      slot: !samePoint(hole.start, hole.end),
    })),
  );
  const tools = new Map<
    string,
    {
      source: string;
      tool: string;
      plated: string;
      width: string;
      holes: number;
      slots: number;
    }
  >();
  const drillRows = drilling.map(
    ({ source, tool, plated, widthNm, start, end, slot }) => {
      const key = source + ':' + tool;
      const group = tools.get(key) ?? {
        source,
        tool: toolId(tool),
        plated: plated ? 'PTH' : 'NPTH',
        width: mm(widthNm),
        holes: 0,
        slots: 0,
      };
      if (slot) group.slots++;
      else group.holes++;
      tools.set(key, group);
      return [
        source,
        group.tool,
        group.plated,
        slot ? 'Slot' : 'Round',
        group.width,
        mm(start.x),
        mm(start.y),
        mm(end.x),
        mm(end.y),
      ];
    },
  );
  const toolRows = [...tools.values()].map(
    ({ source, tool, plated, width, holes, slots }) => [
      source,
      tool,
      plated,
      width,
      holes,
      slots,
    ],
  );

  const { minX, minY, maxX, maxY } = bounds(profile);
  const boardWidth = (maxX - minX) / 1e6;
  const boardHeight = (maxY - minY) / 1e6;
  const specs = board.fabrication;
  const tolerance = (value?: number) => value === undefined ? 'unspecified' : '±' + mm(value) + ' mm';
  const stackup = specs?.stackup;
  const drawingDetails = specs && (specs.surfaceFinish || specs.notes || specs.thicknessToleranceNm ||
    specs.outlineToleranceNm || specs.platedOpeningToleranceNm || specs.nonPlatedOpeningToleranceNm)
    ? [
        `Surface finish · ${specs.surfaceFinish ?? 'Unspecified'}`,
        `Thickness tolerance · ${tolerance(specs.thicknessToleranceNm)}`,
        `Outline and cutouts · ${tolerance(specs.outlineToleranceNm)}`,
        `Finished plated holes and slots · ${tolerance(specs.platedOpeningToleranceNm)}`,
        `Finished non-plated holes and slots · ${tolerance(specs.nonPlatedOpeningToleranceNm)}`,
        ...(specs.notes ? ['Fabrication notes', ...specs.notes.split('\n')] : []),
      ]
    : ['Surface finish and finished-board tolerances · Unspecified'];
  const lines = [
    ...(stackup ? [
      `Substrate material · ${stackup.substrateMaterial ?? 'Unknown'}`,
      ...stackupThicknessFields.filter(([id]) =>
        id !== 'bottomCopperThicknessNm' || board.copperLayers.length === 2).map(([id, label]) =>
        `${label} · ${stackup[id] === undefined ? 'Unknown' : mm(stackup[id]) + ' mm'}`),
      `Relative permittivity · ${stackup.relativePermittivity ?? 'Unknown'}`,
      `Dielectric loss tangent · ${stackup.lossTangent ?? 'Unknown'}`,
    ] : []),
    ...drawingDetails,
  ].flatMap((text) => wrapDrawingLine(text));
  const extraHeight = (lines.length - 1) * 3;
  const left = minX / 1e6 - 5;
  const top = -maxY / 1e6 - 15 - extraHeight;
  const width = Math.max(92, boardWidth + 10);
  const height = boardHeight + 29 + extraHeight;
  const process = fabricationProfileFor(board);
  const title = svgEscape(board.title);
  const label = (y: number, value: string, size = 1.6) =>
    '<text x="' +
    (left + 1) +
    '" y="' +
    y +
    '" font-size="' +
    size +
    '">' +
    svgEscape(value) +
    '</text>';
  const segment = (x: number, y: number) =>
    '<path d="M' +
    x +
    ',' +
    y +
    ' H' +
    (x + 10) +
    '" stroke="#333" stroke-width="0.2"/>';
  const fabrication = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      width +
      'mm" height="' +
      height +
      'mm" viewBox="' +
      [left, top, width, height].join(' ') +
      '" font-family="sans-serif">',
    '<title>' + title + ' · Fabrication overview</title>',
    label(
      top + 3,
      'Fabrication overview · Revision ' +
        board.revision +
        ' · Top view at 1:1',
      1.8,
    ),
    label(
      top + 6,
      'Board bounds ' +
        boardWidth +
        ' × ' +
        boardHeight +
        ' mm · ' +
        board.copperLayers.map(({ id, order }) => 'L' + (order + 1) + ' ' + id).join(' / ') +
        ' · ' +
        (board.fabrication
          ? mm(board.fabrication.thicknessNm) + ' mm thick'
          : 'Thickness unspecified'),
    ),
    label(
      top + 9,
      'Stack assumptions · ' + (process?.process ?? 'Unspecified'),
    ),
    ...lines.map((text, i) => label(top + 12 + i * 3, text)),
    '<path d="' +
      svgRegionPath(profile, topView) +
      '" fill="#f2f4f0" fill-rule="evenodd" stroke="#333" stroke-width="0.15"/>',
    ...drilling.map(
      ({ source, tool, start, end, widthNm, plated }) =>
        '<path data-source="' +
        source +
        '" data-tool="' +
        toolId(tool) +
        '" fill="' +
        (plated ? '#a75a32' : '#718593') +
        '" d="' +
        svgRegionPath(
          { outer: capsulePolygon(start, end, widthNm), holes: [] },
          topView,
        ) +
        '"/>',
    ),
    label(
      top + height - 8,
      'Brown · plated openings. Blue-grey · non-plated openings.',
    ),
    label(
      top + height - 5,
      'Openings and tool numbers use the finished dimensions in the XNC files.',
    ),
    segment(left + 1, top + height - 2),
    '<text x="' +
      (left + 12) +
      '" y="' +
      (top + height - 1.4) +
      '" font-size="1.6">10 mm</text>',
    '</svg>',
    '',
  ].join('\n');
  return {
    'fabrication.svg': fabrication,
    'drill-tools.csv': csv(
      'XNC file,Tool,Plating,Finished width (mm),Round holes,Slots',
      toolRows,
    ),
    'drill-openings.csv': csv(
      'XNC file,Tool,Plating,Shape,Finished width (mm),Start X (mm),Start Y (mm),End X (mm),End Y (mm)',
      drillRows,
    ),
  };
}
