import type { BoardDocument } from './board';
import type { BoardProfile, ContourEdge } from './contours';
import type { BoardPoint } from './geometry';
import { isBoardPoint, samePoint } from './geometry';

export function straightContour(points: readonly BoardPoint[]): ContourEdge[] {
  return points.map((start, i) => ({
    kind: 'line',
    start,
    end: points[(i + 1) % points.length],
  }));
}

export function editableProfile(board: BoardDocument): BoardProfile {
  return (
    board.profile ?? { outline: straightContour(board.outline), cutouts: [] }
  );
}

export function rectangleContour(
  origin: BoardPoint,
  width: number,
  height: number,
  radius = 0,
): ContourEdge[] {
  if (
    width <= 0 ||
    height <= 0 ||
    radius < 0 ||
    radius * 2 >= Math.min(width, height)
  )
    throw new Error(
      'Enter positive dimensions and a corner radius less than half the shorter side.',
    );
  const { x, y } = origin;
  const right = x + width;
  const top = y + height;
  if (!radius)
    return straightContour([
      origin,
      { x: right, y },
      { x: right, y: top },
      { x, y: top },
    ]);

  const corners = [
    { x: right - radius, y: y + radius },
    { x: right - radius, y: top - radius },
    { x: x + radius, y: top - radius },
    { x: x + radius, y: y + radius },
  ];
  const offsets = [
    { x: 0, y: -radius },
    { x: radius, y: 0 },
    { x: 0, y: radius },
    { x: -radius, y: 0 },
  ];
  const at = (centre: BoardPoint, offset: BoardPoint) => ({
    x: centre.x + offset.x,
    y: centre.y + offset.y,
  });
  return corners.flatMap((centre, i): ContourEdge[] => {
    const offset = offsets[(i + 1) % 4];
    const start = at(centre, offsets[i]);
    const end = at(centre, offset);
    return [
      { kind: 'arc', start, end, centre, clockwise: false },
      { kind: 'line', start: end, end: at(corners[(i + 1) % 4], offset) },
    ];
  });
}

export function circleContour(
  centre: BoardPoint,
  radius: number,
): ContourEdge[] {
  if (radius <= 0) throw new Error('Enter a positive circle radius.');
  const left = { x: centre.x - radius, y: centre.y };
  const right = { x: centre.x + radius, y: centre.y };
  return [
    { kind: 'arc', start: right, end: left, centre, clockwise: false },
    { kind: 'arc', start: left, end: right, centre, clockwise: false },
  ];
}

// Stored contours require exact closure. This tolerance is only for a user
// explicitly moving one straight endpoint to its neighbour.
export const PROFILE_REPAIR_TOLERANCE_NM = 1_000;

export function repairProfileJunction(
  edges: readonly ContourEdge[],
  edgeIndex: number,
): ContourEdge[] | undefined {
  if (
    edges.length < 2 ||
    !Number.isInteger(edgeIndex) ||
    edgeIndex < 0 ||
    edgeIndex >= edges.length
  )
    return undefined;
  const nextIndex = (edgeIndex + 1) % edges.length;
  const before = edges[edgeIndex];
  const after = edges[nextIndex];
  if (
    !before ||
    !after ||
    !isBoardPoint(before.end) ||
    !isBoardPoint(after.start)
  )
    return undefined;
  const gap = Math.hypot(
    before.end.x - after.start.x,
    before.end.y - after.start.y,
  );
  if (!gap || gap > PROFILE_REPAIR_TOLERANCE_NM) return undefined;
  const repaired = edges.slice();
  if (before.kind === 'line' && !samePoint(before.start, after.start))
    repaired[edgeIndex] = { ...before, end: after.start };
  else if (after.kind === 'line' && !samePoint(before.end, after.end))
    repaired[nextIndex] = { ...after, start: before.end };
  else return undefined;
  return repaired;
}
