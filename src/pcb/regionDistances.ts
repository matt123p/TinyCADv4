import type { Polygon, PolygonRegion } from './contours';
import type { BoardDrill } from './copper';
import { segmentsMeet } from './geometry';
import type { BoardPoint } from './geometry';

export function bounds({ outer }: PolygonRegion) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < outer.length; i++) {
    const { x, y } = outer[i];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function near(
  a: ReturnType<typeof bounds>,
  b: ReturnType<typeof bounds>,
  gap: number,
) {
  return (
    a.minX - gap <= b.maxX &&
    b.minX - gap <= a.maxX &&
    a.minY - gap <= b.maxY &&
    b.minY - gap <= a.maxY
  );
}

type Bounds = ReturnType<typeof bounds>;
interface BoundedSegment {
  readonly start: BoardPoint;
  readonly end: BoardPoint;
  readonly box: Bounds;
}

export function polygonSegments(polygon: Polygon): BoundedSegment[] {
  return polygon.map((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return {
      start, end,
      box: {
        minX: Math.min(start.x, end.x), minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x), maxY: Math.max(start.y, end.y),
      },
    };
  });
}

type Bounded = { readonly box: Bounds };
type BoundsNode<T> = { box: Bounds } & (
  { entries: readonly T[] } | { children: [BoundsNode<T>, BoundsNode<T>] }
);

export function indexBounds<T extends Bounded>(entries: T[]): BoundsNode<T> {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const { box: entry } of entries) {
    box.minX = Math.min(box.minX, entry.minX);
    box.maxX = Math.max(box.maxX, entry.maxX);
    box.minY = Math.min(box.minY, entry.minY);
    box.maxY = Math.max(box.maxY, entry.maxY);
  }
  if (entries.length <= 8) return { box, entries };
  const horizontal = box.maxX - box.minX >= box.maxY - box.minY;
  const center = (entry: Bounds) => horizontal
    ? entry.minX + entry.maxX : entry.minY + entry.maxY;
  entries.sort((a, b) => center(a.box) - center(b.box));
  const middle = Math.floor(entries.length / 2);
  return {
    box, children: [indexBounds(entries.slice(0, middle)), indexBounds(entries.slice(middle))],
  };
}

export function someNearby<T extends Bounded>(
  node: BoundsNode<T>,
  box: Bounds,
  gap: number,
  predicate: (entry: T) => boolean,
  visit?: () => void,
): boolean {
  visit?.();
  if (!near(node.box, box, gap)) return false;
  if ('children' in node) {
    const [left, right] = node.children;
    return someNearby(left, box, gap, predicate, visit) ||
      someNearby(right, box, gap, predicate, visit);
  }
  for (const entry of node.entries) {
    if (near(entry.box, box, gap) && predicate(entry)) return true;
  }
  return false;
}

export function closestSegmentPoint(
  p: BoardPoint,
  a: BoardPoint,
  b: BoardPoint,
): BoardPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return a;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared),
  );
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function pointSegmentDistance(p: BoardPoint, a: BoardPoint, b: BoardPoint): number {
  const closest = closestSegmentPoint(p, a, b);
  return Math.hypot(p.x - closest.x, p.y - closest.y);
}

function indexedBoundaryDistance(
  first: readonly Polygon[],
  second: readonly Polygon[],
): number {
  const indexed = indexBounds(first.flatMap(polygonSegments));
  let distance = Infinity;
  for (const ring of second) {
    for (const edge of polygonSegments(ring)) {
      const zero = someNearby(indexed, edge.box, Math.ceil(distance), (other) => {
        if (near(edge.box, other.box, Math.ceil(distance))) {
          distance = Math.min(distance,
            pointSegmentDistance(edge.start, other.start, other.end),
            pointSegmentDistance(other.start, edge.start, edge.end),
          );
        }
        return distance === 0;
      });
      if (zero) return 0;
    }
  }
  return Math.round(distance);
}

export function boundaryDistance(a: PolygonRegion, b: PolygonRegion): number {
  const first = [a.outer, ...a.holes];
  const second = [b.outer, ...b.holes];
  const firstSize = first.reduce((sum, ring) => sum + ring.length, 0);
  const secondSize = second.reduce((sum, ring) => sum + ring.length, 0);
  if (firstSize * secondSize > 1024) {
    return firstSize <= secondSize
      ? indexedBoundaryDistance(first, second)
      : indexedBoundaryDistance(second, first);
  }
  let distance = Infinity;
  for (const ring of first)
    for (const other of second)
      for (let i = 0; i < ring.length; i++)
        for (let j = 0; j < other.length; j++)
          distance = Math.min(
            distance,
            pointSegmentDistance(
              ring[i],
              other[j],
              other[(j + 1) % other.length],
            ),
            pointSegmentDistance(
              other[j],
              ring[i],
              ring[(i + 1) % ring.length],
            ),
          );
  return Math.round(distance);
}

export function segmentDistanceNm(a: BoardPoint, b: BoardPoint, c: BoardPoint, d: BoardPoint): number {
  return segmentsMeet(a, b, c, d) ? 0 : Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

export function drillGapNm(first: BoardDrill, second: BoardDrill): number {
  return segmentDistanceNm(first.start, first.end, second.start, second.end) -
    (first.widthNm + second.widthNm) / 2;
}
