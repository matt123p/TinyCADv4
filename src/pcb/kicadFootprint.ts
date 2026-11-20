import { parseSexpr } from '../io/kicad/kicadSexprParser';
import type { SExprList } from '../io/kicad/kicadSexprParser';
import { polygonBoundariesMeet } from './contours';
import { placeFootprintPoint } from './footprint';
import {
  isBoardPoint,
  lengthInNanometres,
  pointInPolygon,
  validateOutline,
} from './geometry';
import type { BoardPoint } from './geometry';
import type { PadShape, PadStack, PhysicalPad } from './padstack';

const origin = { x: 0, y: 0 };
const child = (node: SExprList, tag: string) =>
  node.children.find((entry) => entry.tag === tag);
const dimension = (atom: unknown) => {
  if (typeof atom !== 'number')
    throw new Error('Expected a numeric KiCad dimension.');
  return lengthInNanometres(String(atom), 'mm');
};
const point = (values: readonly unknown[]): BoardPoint => {
  const position = { x: dimension(values?.[0]), y: -dimension(values?.[1]) };
  if (!isBoardPoint(position))
    throw new Error(
      'KiCad position is outside the supported coordinate range.',
    );
  return position;
};

function rectangle(width: number, height: number): BoardPoint[] {
  const x = width / 2,
    y = height / 2;
  if (!Number.isInteger(x) || !Number.isInteger(y))
    throw new Error('Pad dimensions need integer-nanometre half sizes.');
  return [
    { x: -x, y: -y },
    { x, y: -y },
    { x, y },
    { x: -x, y },
  ];
}

function oval(width: number, height: number) {
  const half = (width - height) / 2;
  if (!Number.isInteger(half))
    throw new Error('Oval dimensions need integer-nanometre centreline ends.');
  return {
    kind: 'capsule' as const,
    start: { x: -Math.max(0, half), y: Math.min(0, half) },
    end: { x: Math.max(0, half), y: -Math.min(0, half) },
    widthNm: Math.min(width, height),
  };
}

function readPad(pad: SExprList, index: number): PhysicalPad {
  const [number, type, shape] = pad.values;
  if (typeof number !== 'string')
    throw new Error('Pad numbers must be quoted strings.');
  if (type !== 'smd' && type !== 'thru_hole' && type !== 'np_thru_hole')
    throw new Error(`Unsupported pad type ${type}.`);
  const supported = [
    'at',
    'size',
    'layers',
    'drill',
    'options',
    'primitives',
    'uuid',
    'tstamp',
  ];
  const other = pad.children.find(({ tag }) => !supported.includes(tag));
  if (other) throw new Error(`Unsupported pad option ${other.tag}.`);
  const at = child(pad, 'at')?.values;
  const positionNm = point(at);
  const rotationMicrodegree = at.length === 3 ? dimension(at[2]) : 0;
  const rotate = (p: BoardPoint) =>
    placeFootprintPoint(p, {
      positionNm: origin,
      side: 'top',
      rotationMicrodegree,
    });
  const size = child(pad, 'size')?.values;
  const width = dimension(size?.[0]),
    height = dimension(size?.[1]);
  if (width <= 0 || height <= 0) throw new Error('Invalid KiCad pad size.');
  let land: PadShape;
  if (shape === 'rect')
    land = { kind: 'polygon', vertices: rectangle(width, height).map(rotate) };
  else if (shape === 'oval' || (shape === 'circle' && width === height)) {
    const capsule = oval(width, height);
    land = {
      ...capsule,
      start: rotate(capsule.start),
      end: rotate(capsule.end),
    };
  } else if (shape === 'custom' && type === 'smd') {
    const options = child(pad, 'options');
    const anchor = child(options, 'anchor')?.values[0];
    const primitive = child(pad, 'primitives')?.children;
    if (
      anchor !== 'rect' ||
      primitive?.length !== 1 ||
      primitive[0].tag !== 'gr_poly' ||
      child(primitive[0], 'fill')?.values[0] !== 'yes' ||
      dimension(child(primitive[0], 'width')?.values[0]) !== 0
    ) {
      throw new Error(
        'Only a single zero-stroke filled custom polygon with a rectangular anchor is supported.',
      );
    }
    const points = child(primitive[0], 'pts')?.children;
    if (!points?.length || points.some(({ tag }) => tag !== 'xy'))
      throw new Error('Invalid custom polygon points.');
    const polygon = points.map(({ values }) => point(values));
    validateOutline(polygon);
    const anchorShape = rectangle(width, height);
    if (
      pointInPolygon(anchorShape[0], polygon) !== 'inside' ||
      polygonBoundariesMeet(anchorShape, polygon)
    ) {
      throw new Error(
        'The custom pad anchor must be fully enclosed in the polygon.',
      );
    }
    land = { kind: 'polygon', vertices: polygon.map(rotate) };
  } else throw new Error(`Unsupported pad shape ${shape}.`);
  if (
    shape !== 'custom' &&
    pad.children.some(({ tag }) => tag === 'primitives' || tag === 'options')
  ) {
    throw new Error('Unexpected custom primitives on a standard pad.');
  }

  const drillNode = child(pad, 'drill');
  let drill: PadStack['drill'];
  if (type !== 'smd') {
    const values = drillNode?.values;
    const isOval = values?.[0] === 'oval';
    if (
      !values ||
      values.length !== (isOval ? 3 : 1) ||
      drillNode.children.length
    )
      throw new Error('Unsupported or absent KiCad drill dimensions.');
    const dx = dimension(values[isOval ? 1 : 0]);
    const dy = isOval ? dimension(values[2]) : dx;
    if (dx < 2 || dy < 2 || dx > width || dy > height)
      throw new Error('Drill size does not fit the pad.');
    if (
      type === 'np_thru_hole' &&
      (width !== dx ||
        height !== dy ||
        (shape !== 'oval' && shape !== 'circle'))
    ) {
      throw new Error('Non-plated pads with copper require review.');
    }
    const path = oval(dx, dy);
    drill = {
      start: rotate(path.start),
      end: rotate(path.end),
      widthNm: path.widthNm,
      plated: type === 'thru_hole',
    };
  } else if (drillNode) throw new Error('An SMD pad cannot have a drill.');

  const copper: Record<string, PadShape> = {},
    mask: Record<string, PadShape> = {},
    paste: Record<string, PadShape> = {};
  const layers = child(pad, 'layers')?.values;
  if (!layers?.length) throw new Error('A KiCad pad must declare layers.');
  for (const layer of layers) {
    const match = /^(F|B|\*)\.(Cu|Mask|Paste)$/.exec(String(layer));
    if (!match) throw new Error(`Unsupported pad layer ${layer}.`);
    const [, side, role] = match;
    const output = { Cu: copper, Mask: mask, Paste: paste }[role];
    if (role === 'Cu' && type === 'np_thru_hole') continue;
    if (side !== 'B') output.top = land;
    if (side !== 'F') output.bottom = land;
  }
  if (type === 'smd' && Number(!!copper.top) + Number(!!copper.bottom) !== 1)
    throw new Error('Only single-face copper SMD pads are supported.');
  if (type === 'thru_hole' && (!copper.top || !copper.bottom))
    throw new Error('A through-hole pad must have both copper lands.');
  return {
    id: `pad-${index + 1}`,
    label: number,
    positionNm,
    stack: { copper, mask, paste, drill },
  };
}

/** Candidate .kicad_mod subset. Electrical losses prevent use of a partial footprint. */
export function importKicadFootprint(source: string): {
  name: string;
  sourceVersion?: string;
  pads: PhysicalPad[];
  issues: {
    severity: 'blocker' | 'warning';
    location: string;
    message: string;
  }[];
} {
  if (typeof source !== 'string' || source.length > 256_000)
    throw new Error('KiCad footprint exceeds the input size limit.');
  const root = parseSexpr(source, { maxDepth: 24, singleRoot: true });
  if (root.tag !== 'footprint' || typeof root.values[0] !== 'string')
    throw new Error('Expected one named KiCad footprint.');
  const issues: ReturnType<typeof importKicadFootprint>['issues'] = [];
  const pads: PhysicalPad[] = [];
  const padNodes = root.children.filter(({ tag }) => tag === 'pad');
  const sourceVersion = child(root, 'version')?.values[0];
  if (!padNodes.length || padNodes.length > 512)
    throw new Error('Invalid footprint pad count.');
  if (child(root, 'layer')?.values[0] !== 'F.Cu')
    issues.push({
      severity: 'blocker',
      location: 'footprint',
      message: 'Only front-authored footprint libraries are supported.',
    });
  padNodes.forEach((node, index) => {
    try {
      pads.push(readPad(node, index));
    } catch (error) {
      issues.push({
        severity: 'blocker',
        location: `pad ${index + 1}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  for (const node of root.children) {
    if (
      [
        'version',
        'generator',
        'generator_version',
        'layer',
        'descr',
        'tags',
        'attr',
        'uuid',
        'tstamp',
        'pad',
      ].includes(node.tag)
    )
      continue;
    const graphicLayer = child(node, 'layer')?.values[0];
    const optional =
      node.tag === 'model' ||
      ([
        'fp_line',
        'fp_rect',
        'fp_arc',
        'fp_text',
        'property',
        'fp_poly',
      ].includes(node.tag) &&
        typeof graphicLayer === 'string' &&
        /\.(SilkS|Fab|CrtYd)$/.test(graphicLayer));
    issues.push({
      severity: optional ? 'warning' : 'blocker',
      location: node.tag,
      message: 'Object is outside the G0 import subset.',
    });
  }
  return {
    name: root.values[0],
    sourceVersion:
      sourceVersion === undefined ? undefined : String(sourceVersion),
    pads: issues.some(({ severity }) => severity === 'blocker') ? [] : pads,
    issues,
  };
}
