import { parseSexpr } from '../io/kicad/kicadSexprParser';
import type { SExprList } from '../io/kicad/kicadSexprParser';
import { arcVertices, polygonBoundariesMeet, TESSELLATION_TOLERANCE_NM } from './contours';
import { placeFootprintPoint } from './footprint';
import {
  isBoardPoint,
  lengthInNanometres,
  pointInPolygon,
  validateOutline,
} from './geometry';
import type { BoardPoint } from './geometry';
import { footprintGraphicLayers, validateFootprintDetails } from './footprintDetails';
import type { FootprintGraphic, FootprintGraphicLayer, FootprintModelTransform } from './footprintDetails';
import { validatePadStack } from './padstack';
import type { PadShape, PadStack, PhysicalPad } from './padstack';

const origin = { x: 0, y: 0 };
const child = (node: SExprList, tag: string) =>
  node?.children.find((entry) => entry.tag === tag);
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

function standardLand(shape: unknown, width: number, height: number, radiusRatio = 0): PadShape {
  if (width <= 0 || height <= 0) throw new Error('Invalid KiCad land size.');
  if (shape === 'oval' || (shape === 'circle' && width === height)) return oval(width, height);
  if (shape === 'rect') return { kind: 'polygon', vertices: rectangle(width, height) };
  if (shape !== 'roundrect') throw new Error(`Unsupported pad shape ${shape}.`);
  const corners = rectangle(width, height);
  const radius = Math.round(Math.min(width, height) * radiusRatio);
  if (!radius) return { kind: 'polygon', vertices: corners };
  const vertices = corners.flatMap(({ x, y }, index) => arcVertices(
    { x: x - Math.sign(x) * radius, y: y - Math.sign(y) * radius },
    radius, Math.PI + index * Math.PI / 2, Math.PI / 2, TESSELLATION_TOLERANCE_NM,
  ));
  const unique = vertices.filter((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    return vertex.x !== previous.x || vertex.y !== previous.y;
  });
  return { kind: 'polygon', vertices: unique };
}

function readPad(pad: SExprList, index: number, footprint: SExprList): PhysicalPad {
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
    'roundrect_rratio',
    'solder_mask_margin',
    'solder_paste_margin',
    'solder_paste_margin_ratio',
    'pinfunction',
    'pintype',
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
  const ratio = child(pad, 'roundrect_rratio')?.values[0] ?? 0;
  if (typeof ratio !== 'number' || ratio < 0 || ratio > 0.5 || (ratio && shape !== 'roundrect')) throw new Error('Invalid round-rectangle corner ratio.');
  const rotateLand = (land: PadShape): PadShape => land.kind === 'polygon'
    ? { ...land, vertices: land.vertices.map(rotate) }
    : { ...land, start: rotate(land.start), end: rotate(land.end) };
  let land: PadShape;
  if (shape === 'custom' && type === 'smd') {
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
  } else land = rotateLand(standardLand(shape, width, height, ratio));
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
      drillNode.children.some(({ tag }) => tag !== 'offset') || drillNode.children.length > 1
    )
      throw new Error('Unsupported or absent KiCad drill dimensions.');
    const dx = dimension(values[isOval ? 1 : 0]);
    const dy = isOval ? dimension(values[2]) : dx;
    const offset = child(drillNode, 'offset');
    const shift = offset ? point(offset.values) : origin;
    if (dx < 2 || dy < 2 || dx + 2 * Math.abs(shift.x) > width || dy + 2 * Math.abs(shift.y) > height)
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
      start: rotate({ x: path.start.x + shift.x, y: path.start.y + shift.y }),
      end: rotate({ x: path.end.x + shift.x, y: path.end.y + shift.y }),
      widthNm: path.widthNm,
      plated: type === 'thru_hole',
    };
  } else if (drillNode) throw new Error('An SMD pad cannot have a drill.');

  const copper: Record<string, PadShape> = {},
    mask: Record<string, PadShape> = {},
    paste: Record<string, PadShape> = {};
  const layers = child(pad, 'layers')?.values;
  if (!layers?.length) throw new Error('A KiCad pad must declare layers.');
  const option = (tag: string) => child(pad, tag)?.values[0] ?? child(footprint, tag)?.values[0] ?? 0;
  const maskMargin = dimension(option('solder_mask_margin'));
  const pasteMargin = dimension(option('solder_paste_margin'));
  const pasteRatio = option('solder_paste_margin_ratio');
  if (typeof pasteRatio !== 'number') throw new Error('Invalid solder paste margin ratio.');
  const aperture = (margin: number, multiplier: number): PadShape | undefined => {
    if (!margin && !multiplier) return land;
    if (shape === 'custom') throw new Error('Solder aperture offsets on custom pads require review.');
    const w = Math.round((width * (1 + multiplier) + 2 * margin) / 2) * 2;
    const h = Math.round((height * (1 + multiplier) + 2 * margin) / 2) * 2;
    return w > 0 && h > 0 ? rotateLand(standardLand(shape, w, h, ratio)) : undefined;
  };
  for (const layer of layers) {
    const match = /^(F|B|\*)\.(Cu|Mask|Paste)$/.exec(String(layer));
    if (!match) throw new Error(`Unsupported pad layer ${layer}.`);
    const [, side, role] = match;
    const output = { Cu: copper, Mask: mask, Paste: paste }[role];
    if (role === 'Cu' && type === 'np_thru_hole') continue;
    const layerLand = role === 'Cu' ? land : role === 'Mask' ? aperture(maskMargin, 0) : aperture(pasteMargin, pasteRatio);
    if (!layerLand) continue;
    if (side !== 'B') output.top = layerLand;
    if (side !== 'F') output.bottom = layerLand;
  }
  if (type === 'smd' && (copper.top && copper.bottom || (!copper.top && !copper.bottom && (number || !Object.keys(mask).length && !Object.keys(paste).length))))
    throw new Error('Only single-face copper SMD pads are supported.');
  if (type === 'thru_hole' && (!copper.top || !copper.bottom))
    throw new Error('A through-hole pad must have both copper lands.');
  const stack = { copper, mask, paste, ...(drill ? { drill } : {}) };
  validatePadStack(stack);
  return {
    id: `pad-${index + 1}`,
    label: number,
    positionNm,
    stack,
  };
}

export interface KicadModelReference extends FootprintModelTransform { source: string }

function readModel(node: SExprList): KicadModelReference {
  const source = node.values[0];
  if (typeof source !== 'string' || !source.trim() || source.length > 4096 || node.children.some(({ tag }) => !['at', 'offset', 'scale', 'rotate'].includes(tag))) throw new Error('Unsupported KiCad model reference.');
  const vector = (tag: string, fallback: number): [number, number, number] => {
    const value = child(node, tag);
    const xyz = child(value, 'xyz')?.values ?? (value ? [] : [fallback, fallback, fallback]);
    if (xyz.length !== 3 || !xyz.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) throw new Error(`Invalid KiCad model ${tag}.`);
    return xyz as [number, number, number];
  };
  if (child(node, 'at') && child(node, 'offset')) throw new Error('Ambiguous KiCad model position.');
  const legacy = !!child(node, 'at');
  const offset = vector(legacy ? 'at' : 'offset', 0);
  const scale = vector('scale', 1);
  if (scale.some((n) => n <= 0)) throw new Error('A model scale must be positive on every axis.');
  return { source, scale, offsetNm: offset.map((n) => Math.round(n * (legacy ? 25_400_000 : 1_000_000))) as [number, number, number], rotationMicrodegree: vector('rotate', 0).map(dimension) as [number, number, number] };
}

function readGraphic(node: SExprList, layer: FootprintGraphicLayer): FootprintGraphic {
  const width = child(child(node, 'stroke'), 'width') ?? child(node, 'width');
  const stroke = child(node, 'stroke');
  const strokeType = child(stroke, 'type')?.values[0];
  if (strokeType && strokeType !== 'default' && strokeType !== 'solid') throw new Error(`Unsupported stroke type ${strokeType}.`);
  const fill = child(node, 'fill')?.values[0] ?? 'none';
  if (!['none', 'no', 'yes', 'solid'].includes(String(fill))) throw new Error('Unsupported graphic fill.');
  const style = { layer, strokeNm: width ? dimension(width.values[0]) : 0, filled: fill === 'solid' || fill === 'yes' };
  const position = (tag: string) => point(child(node, tag)?.values);
  switch (node.tag) {
    case 'fp_line': return { ...style, kind: 'line', start: position('start'), end: position('end') };
    case 'fp_rect': return { ...style, kind: 'rect', start: position('start'), end: position('end') };
    case 'fp_arc': return { ...style, kind: 'arc', start: position('start'), mid: position('mid'), end: position('end') };
    case 'fp_circle': return { ...style, kind: 'circle', center: position('center'), end: position('end') };
    case 'fp_poly': {
      const points = child(node, 'pts')?.children;
      if (!points?.length || points.some(({ tag }) => tag !== 'xy')) throw new Error('Unsupported footprint polygon points.');
      return { ...style, kind: 'polygon', points: points.map(({ values }) => point(values)) };
    }
    case 'property':
    case 'fp_text': {
      const at = child(node, 'at')?.values;
      const effects = child(node, 'effects');
      const font = child(effects, 'font');
      if (font?.children.some(({ tag }) => !['size', 'thickness'].includes(tag)) || font?.values.length) throw new Error('Unsupported text font override.');
      const size = child(font, 'size')?.values;
      const thickness = child(font, 'thickness');
      const text = node.values[1];
      if (typeof text !== 'string') throw new Error('Missing footprint text.');
      const visible = ![node, effects].some((part) => part?.values.includes('hide') || child(part, 'hide')?.values[0] === 'yes');
      return { ...style, kind: 'text', text, at: point(at), sizeNm: { x: dimension(size?.[0]), y: dimension(size?.[1]) },
        strokeNm: thickness ? dimension(thickness.values[0]) : 0, rotationMicrodegree: typeof at[2] === 'number' ? dimension(at[2]) : 0,
        visible, align: child(effects, 'justify')?.values.map(String) ?? [] };
    }
    default: throw new Error(`Unsupported footprint graphic ${node.tag}.`);
  }
}

/** Candidate .kicad_mod subset. Electrical losses prevent use of a partial footprint. */
export function importKicadFootprint(source: string): {
  name: string;
  sourceVersion?: string;
  pads: PhysicalPad[];
  graphics: FootprintGraphic[];
  models: KicadModelReference[];
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
  const graphics: FootprintGraphic[] = [];
  const models: KicadModelReference[] = [];
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
      pads.push(readPad(node, index, root));
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
        'tedit',
        'solder_mask_margin',
        'solder_paste_margin',
        'solder_paste_margin_ratio',
      ].includes(node.tag)
    )
      continue;
    const graphicLayer = child(node, 'layer')?.values[0];
    if (node.tag === 'property' && graphicLayer === undefined && !child(node, 'at')) continue;
    if (node.tag === 'embedded_fonts' && node.values[0] === 'no') continue;
    if (node.tag === 'model' || footprintGraphicLayers.includes(graphicLayer as FootprintGraphicLayer)) {
      try {
        if (node.tag === 'model') {
          const model = readModel(node);
          models.push(model);
          issues.push({ severity: 'warning', location: 'model', message: `Select a local STEP file for ${model.source}.` });
        } else {
          const graphic = readGraphic(node, graphicLayer as FootprintGraphicLayer);
          validateFootprintDetails([graphic]);
          graphics.push(graphic);
        }
      } catch (error) {
        issues.push({ severity: /\.SilkS$/.test(String(graphicLayer)) ? 'blocker' : 'warning', location: node.tag, message: String(error) });
      }
      continue;
    }
    issues.push({
      severity: 'blocker',
      location: node.tag,
      message: 'Object is outside the supported footprint import subset.',
    });
  }
  return {
    name: root.values[0],
    sourceVersion:
      sourceVersion === undefined ? undefined : String(sourceVersion),
    pads: issues.some(({ severity }) => severity === 'blocker') ? [] : pads,
    graphics,
    models,
    issues,
  };
}
