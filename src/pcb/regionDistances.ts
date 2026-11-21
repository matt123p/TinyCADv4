import type { PolygonRegion } from './contours';
import type { BoardDrill } from './copper';
import { segmentsMeet } from './geometry';
import type { BoardPoint } from './geometry';

export function bounds({ outer }: PolygonRegion) {
  return outer.reduce(
    (area, { x, y }) => ({
      minX: Math.min(area.minX, x),
      minY: Math.min(area.minY, y),
      maxX: Math.max(area.maxX, x),
      maxY: Math.max(area.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
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

export function boundaryDistance(a: PolygonRegion, b: PolygonRegion): number {
  let distance = Infinity;
  for (const ring of [a.outer, ...a.holes])
    for (const other of [b.outer, ...b.holes])
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

export function drillGapNm(first: BoardDrill, second: BoardDrill): number {
  const distance = segmentsMeet(
    first.start,
    first.end,
    second.start,
    second.end,
  )
    ? 0
    : Math.min(
        pointSegmentDistance(first.start, second.start, second.end),
        pointSegmentDistance(first.end, second.start, second.end),
        pointSegmentDistance(second.start, first.start, first.end),
        pointSegmentDistance(second.end, first.start, first.end),
      );
  return distance - (first.widthNm + second.widthNm) / 2;
}
