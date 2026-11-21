import { capsulePolygon } from './contours';
import type { Polygon } from './contours';
import type { BoardDrill } from './copper';
import { pointInPolygon, samePoint } from './geometry';
import type { BoardPoint } from './geometry';
import type { PadShape } from './padstack';

export const kicadString = (value: string) => JSON.stringify(value);
export const mm = (nm: number) =>
  (Math.round(nm) / 1e6).toFixed(6).replace(/\.?0+$/, '');
export const xy = ({ x, y }: BoardPoint) => mm(x) + ' ' + mm(-y);
export const xyList = (points: Polygon) =>
  points.map((point) => '(xy ' + xy(point) + ')').join(' ');
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (angle: number) => (angle * 180) / Math.PI;

type Shape = {
  kind: 'circle' | 'oval' | 'rect' | 'custom';
  center: BoardPoint;
  angle: number;
  width: number;
  height: number;
  primitive?: Polygon;
};

export function shapePolygon(
  shape: PadShape,
  project: (point: BoardPoint) => BoardPoint,
) {
  return shape.kind === 'polygon'
    ? shape.vertices.map(project)
    : capsulePolygon(project(shape.start), project(shape.end), shape.widthNm);
}

function oblong(start: BoardPoint, end: BoardPoint, width: number): Shape {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    kind: dx || dy ? 'oval' : 'circle',
    center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    angle: degrees(Math.atan2(dy, dx)),
    width: width + Math.hypot(dx, dy),
    height: width,
  };
}

function rectangle(vertices: Polygon): Shape | undefined {
  if (vertices.length !== 4) return;
  const x = vertices.map((point) => point.x);
  const y = vertices.map((point) => point.y);
  const left = Math.min(...x);
  const right = Math.max(...x);
  const bottom = Math.min(...y);
  const top = Math.max(...y);
  if (
    !vertices.every(
      ({ x, y }) => (x === left || x === right) && (y === bottom || y === top),
    )
  )
    return;
  return {
    kind: 'rect',
    center: { x: (left + right) / 2, y: (bottom + top) / 2 },
    angle: 0,
    width: right - left,
    height: top - bottom,
  };
}

function insideAnchor(p: BoardPoint, polygon: Polygon) {
  return [
    [0, 0],
    [0, 2],
    [0, -2],
    [2, 0],
    [-2, 0],
  ].every(
    ([dx, dy]) =>
      pointInPolygon(
        { x: Math.round(p.x) + dx, y: Math.round(p.y) + dy },
        polygon,
      ) === 'inside',
  );
}

function interiorPoint(polygon: Polygon) {
  // Each scanline lies strictly between consecutive vertex heights. Try the
  // widest interval first so the custom pad's anchor fits inside its shape.
  const heights = [...new Set(polygon.map(({ y }) => y))].sort((a, b) => a - b);
  let center: BoardPoint | undefined;
  let best = 0;
  const step = Math.max(1, Math.floor(heights.length / 32));
  for (let i = 1; i < heights.length; i += step) {
    const y = Math.round((heights[i - 1] + heights[i]) / 2);
    if (y === heights[i]) continue;
    const crossings: number[] = [];
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j];
      const b = polygon[(j + 1) % polygon.length];
      if (a.y > y !== b.y > y)
        crossings.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
    }
    crossings.sort((a, b) => a - b);
    for (let j = 0; j + 1 < crossings.length; j += 2) {
      const span = crossings[j + 1] - crossings[j];
      if (span <= best) continue;
      const point = { x: Math.round((crossings[j + 1] + crossings[j]) / 2), y };
      if (insideAnchor(point, polygon)) {
        center = point;
        best = span;
      }
    }
    if (center) return center;
  }
}

export function kicadPad(
  label: string,
  shape: PadShape | undefined,
  hole: Omit<BoardDrill, 'id'> | undefined,
  project: (point: BoardPoint) => BoardPoint,
  rotation: number,
  layers: readonly string[],
  net: string,
) {
  const drill =
    hole && oblong(project(hole.start), project(hole.end), hole.widthNm);
  const polygon = () => shapePolygon(shape, project);
  let land =
    shape?.kind === 'capsule'
      ? oblong(project(shape.start), project(shape.end), shape.widthNm)
      : shape
      ? rectangle(shape.vertices.map(project))
      : drill;
  const sameSlotAxis =
    drill &&
    land &&
    (drill.kind === 'circle' ||
      Math.abs((land.angle - drill.angle) % 180) < 1e-7 ||
      Math.abs((land.angle - drill.angle) % 180) > 180 - 1e-7);
  if (
    shape &&
    (!land ||
      (drill && (!samePoint(land.center, drill.center) || !sameSlotAxis)))
  ) {
    const outline = polygon();
    const preferred = drill?.center ?? project({ x: 0, y: 0 });
    const center = insideAnchor(preferred, outline)
      ? preferred
      : drill
      ? undefined
      : interiorPoint(outline);
    if (!center)
      throw new Error(
        'The pad lands need an interior anchor at the drill centre.',
      );
    const angle = drill?.angle ?? 0;
    const cos = Math.cos(radians(angle));
    const sin = Math.sin(radians(angle));
    land = {
      kind: 'custom',
      center,
      angle,
      width: 4,
      height: 4,
      primitive: outline.map((p) => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
      }),
    };
  }
  if (!land) throw new Error('The pad has no representable shape.');
  const type = hole ? (hole.plated ? 'thru_hole' : 'np_thru_hole') : 'smd';
  const drilling = !drill
    ? ''
    : drill.kind === 'circle'
    ? ' (drill ' + mm(drill.width) + ')'
    : ' (drill oval ' + mm(drill.width) + ' ' + mm(drill.height) + ')';
  const custom = land.primitive
    ? ' (options (clearance outline) (anchor circle)) (primitives (gr_poly (pts ' +
      xyList(land.primitive) +
      ') (width 0) (fill yes)))'
    : '';
  return (
    '(pad ' +
    kicadString(label) +
    ' ' +
    type +
    ' ' +
    land.kind +
    ' (at ' +
    xy(land.center) +
    ' ' +
    mm((rotation + land.angle) * 1e6) +
    ') (size ' +
    mm(land.width) +
    ' ' +
    mm(land.height) +
    ')' +
    drilling +
    ' (layers ' +
    layers.map(kicadString).join(' ') +
    ')' +
    net +
    custom +
    ')'
  );
}
