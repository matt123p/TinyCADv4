import { flattenContour, MAX_CONTOUR_VERTICES, TESSELLATION_TOLERANCE_NM } from './contours';
import type { Polygon } from './contours';
import { circleContour, rectangleContour, straightContour } from './boardProfiles';
import { isBoardPoint, samePoint } from './geometry';
import type { BoardPoint } from './geometry';

export type BoardBoundsShape = {
  readonly start: BoardPoint;
  readonly end: BoardPoint;
} & ({ readonly kind: 'rectangle'; readonly radiusNm: number } | { readonly kind: 'ellipse' });

export type BoardPolygonPoint = BoardPoint & { readonly control?: true };
export type BoardPolygonShape = { readonly kind: 'polygon'; readonly vertices: readonly BoardPolygonPoint[] };
export type BoardAreaShape = BoardBoundsShape | BoardPolygonShape;
export type BoardAreaGeometry = BoardAreaShape;

export function boundedArea(kind: BoardBoundsShape['kind'], first: BoardPoint, last: BoardPoint, radiusNm = 0): BoardBoundsShape {
  const start = { x: Math.min(first.x, last.x), y: Math.min(first.y, last.y) };
  const end = { x: Math.max(first.x, last.x), y: Math.max(first.y, last.y) };
  return kind === 'rectangle' ? { kind, start, end, radiusNm } : { kind, start, end };
}

export function areaContour(shape: BoardAreaGeometry) {
  if (shape.kind === 'polygon') return straightContour(polygonOutline(shape));
  const { start, end } = shape;
  if (!isBoardPoint(start) || !isBoardPoint(end) || end.x <= start.x || end.y <= start.y)
    throw new Error('The shape needs positive dimensions within the board coordinate range.');
  const width = end.x - start.x;
  const height = end.y - start.y;
  if (shape.kind === 'rectangle') {
    if (!Number.isSafeInteger(shape.radiusNm)) throw new Error('Invalid corner radius.');
    return rectangleContour(start, width, height, shape.radiusNm);
  }
  if (shape.kind !== 'ellipse') throw new Error('Invalid board area shape.');
  const rx = width / 2;
  const ry = height / 2;
  const centre = { x: start.x + rx, y: start.y + ry };
  if (rx === ry && Number.isInteger(rx)) return circleContour(centre, rx);
  const step = 4 * Math.asin(Math.sqrt(Math.min(1, (TESSELLATION_TOLERANCE_NM - 1) / Math.max(width, height))));
  const count = Math.max(8, Math.ceil(2 * Math.PI / step / 4) * 4);
  if (count > MAX_CONTOUR_VERTICES) throw new Error('Ellipse exceeds the tessellation vertex budget.');
  const points: BoardPoint[] = [];
  for (let index = 0; index < count; index++) {
    const angle = index * 2 * Math.PI / count;
    const point = { x: Math.round(centre.x + rx * Math.cos(angle)), y: Math.round(centre.y + ry * Math.sin(angle)) };
    if (!points.length || !samePoint(points.at(-1), point)) points.push(point);
  }
  if (samePoint(points[0], points.at(-1))) points.pop();
  return straightContour(points);
}

export function areaOutline(shape: BoardAreaGeometry): Polygon {
  return shape.kind === 'polygon' ? polygonOutline(shape) : flattenContour(areaContour(shape));
}

export function validateAreaShape(shape: BoardAreaShape | undefined, outline: Polygon) {
  if (shape === undefined) return;
  if (shape?.kind !== 'rectangle' && shape?.kind !== 'ellipse' && shape?.kind !== 'polygon') throw new Error('Invalid board area shape.');
  const derived = areaOutline(shape);
  if (derived.length !== outline.length || derived.some((point, index) => !samePoint(point, outline[index])))
    throw new Error('The stored shape and outline disagree.');
}

function polygonOutline({ vertices }: BoardPolygonShape): Polygon {
  if (!Array.isArray(vertices) || vertices.length > 1024 || vertices[0]?.control ||
    vertices.some((point: BoardPolygonPoint) => !isBoardPoint(point) || point.control !== undefined && point.control !== true) ||
    vertices.filter((point) => !point.control).length < 3) throw new Error('Invalid PCB polygon points.');
  if (!vertices.some((point) => point.control)) return vertices;
  const outline: BoardPoint[] = [];
  const append = (point: BoardPoint) => {
    const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
    if (!outline.length || !samePoint(outline.at(-1), rounded)) outline.push(rounded);
    if (outline.length > MAX_CONTOUR_VERTICES + 1) throw new Error('Polygon curves exceed the tessellation vertex budget.');
  };
  const mid = (a: BoardPoint, b: BoardPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function flatten(points: BoardPoint[]) {
    const start = points[0], end = points.at(-1);
    if (points.slice(1, -1).every((point, index) => {
      const ratio = (index + 1) / (points.length - 1);
      return Math.hypot(point.x - (start.x + ratio * (end.x - start.x)),
        point.y - (start.y + ratio * (end.y - start.y))) <= TESSELLATION_TOLERANCE_NM - 1;
    })) { append(end); return; }
    const left = [start], right = [end];
    while (points.length > 1) {
      points = points.slice(1).map((point, index) => mid(points[index], point));
      left.push(points[0]);
      right.unshift(points.at(-1));
    }
    flatten(left);
    flatten(right);
  }
  append(vertices[0]);
  let segment: BoardPoint[] = [vertices[0]];
  for (const point of [...vertices.slice(1), vertices[0]]) {
    segment.push(point);
    if (!point.control) {
      if (segment.length > 4) throw new Error('A polygon segment accepts at most two curve controls.');
      flatten(segment);
      segment = [point];
    }
  }
  outline.pop();
  return outline;
}
