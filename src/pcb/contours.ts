import {
  BOARD_COORDINATE_LIMIT_NM,
  isBoardPoint,
  pointInPolygon,
  samePoint,
  segmentsMeet,
  validateOutline,
} from './geometry';
import type { BoardPoint } from './geometry';

export type Polygon = readonly BoardPoint[];

export interface PolygonRegion {
  readonly outer: Polygon;
  readonly holes: readonly Polygon[];
}

export type ContourEdge =
  | {
      readonly kind: 'line';
      readonly start: BoardPoint;
      readonly end: BoardPoint;
    }
  | {
      readonly kind: 'arc';
      readonly start: BoardPoint;
      readonly end: BoardPoint;
      readonly centre: BoardPoint;
      readonly clockwise: boolean;
    };

export interface BoardProfile {
  readonly outline: readonly ContourEdge[];
  readonly cutouts: readonly (readonly ContourEdge[])[];
}

export const TESSELLATION_TOLERANCE_NM = 100;
export const MAX_CONTOUR_VERTICES = 8_192;

function squaredRadius(centre: BoardPoint, point: BoardPoint): bigint {
  const dx = BigInt(point.x - centre.x);
  const dy = BigInt(point.y - centre.y);
  return dx * dx + dy * dy;
}

/** Coordinates are rounded only after reserving 1 nm for the rounding error. */
export function arcVertices(
  centre: BoardPoint,
  radius: number,
  start: number,
  sweep: number,
  toleranceNm: number,
): BoardPoint[] {
  if (
    !Number.isInteger(toleranceNm) ||
    toleranceNm < 2 ||
    toleranceNm > TESSELLATION_TOLERANCE_NM
  ) {
    throw new Error('Curve tolerance must be an integer between 2 and 100 nm.');
  }
  const maxStep = Math.min(
    Math.PI / 2,
    4 * Math.asin(Math.sqrt(Math.min(1, (toleranceNm - 1) / (2 * radius)))),
  );
  const steps = Math.ceil(Math.abs(sweep) / maxStep);
  if (steps > MAX_CONTOUR_VERTICES)
    throw new Error('Curve exceeds the tessellation vertex budget.');
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = start + (i * sweep) / steps;
    return {
      x: Math.round(centre.x + radius * Math.cos(angle)),
      y: Math.round(centre.y + radius * Math.sin(angle)),
    };
  });
}

export function circlePolygon(
  centre: BoardPoint,
  radiusNm: number,
  toleranceNm = TESSELLATION_TOLERANCE_NM,
): Polygon {
  if (
    !isBoardPoint(centre) ||
    !Number.isInteger(radiusNm) ||
    radiusNm <= 0 ||
    radiusNm > 500_000_000
  ) {
    throw new Error('Invalid circle centre or radius.');
  }
  if (
    Math.max(Math.abs(centre.x), Math.abs(centre.y)) + radiusNm >
    BOARD_COORDINATE_LIMIT_NM
  ) {
    throw new Error('Circle exceeds the board coordinate range.');
  }
  const points = arcVertices(
    centre,
    radiusNm,
    0,
    2 * Math.PI,
    toleranceNm,
  ).slice(0, -1);
  if (!points.every(isBoardPoint))
    throw new Error('Circle exceeds the board coordinate range.');
  return points;
}

export function capsulePolygon(
  start: BoardPoint,
  end: BoardPoint,
  widthNm: number,
): Polygon {
  if (
    !isBoardPoint(start) ||
    !isBoardPoint(end) ||
    !Number.isSafeInteger(widthNm) ||
    widthNm < 2 ||
    widthNm > 1_000_000_000
  ) {
    throw new Error('Invalid capsule endpoints or width.');
  }
  const radius = widthNm / 2;
  if (samePoint(start, end)) {
    const points = arcVertices(
      start,
      radius,
      0,
      Math.PI * 2,
      TESSELLATION_TOLERANCE_NM,
    ).slice(0, -1);
    if (!points.every(isBoardPoint))
      throw new Error('Capsule exceeds the board coordinate range.');
    return points;
  }
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const points = [
    ...arcVertices(
      end,
      radius,
      angle - Math.PI / 2,
      Math.PI,
      TESSELLATION_TOLERANCE_NM,
    ),
    ...arcVertices(
      start,
      radius,
      angle + Math.PI / 2,
      Math.PI,
      TESSELLATION_TOLERANCE_NM,
    ),
  ];
  if (!points.every(isBoardPoint))
    throw new Error('Capsule exceeds the board coordinate range.');
  return points;
}

export function flattenContour(
  edges: readonly ContourEdge[],
  toleranceNm = TESSELLATION_TOLERANCE_NM,
): Polygon {
  if (!Array.isArray(edges) || edges.length < 2 || edges.length > 1_024)
    throw new Error('Invalid profile edge count.');
  const points: BoardPoint[] = [];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const { start, end } = edge;
    if (
      !isBoardPoint(start) ||
      !isBoardPoint(end) ||
      !samePoint(end, edges[(i + 1) % edges.length].start)
    ) {
      throw new Error(
        'A profile contour has a gap or an out-of-range endpoint.',
      );
    }
    if (samePoint(start, end))
      throw new Error('A profile edge has zero length.');
    points.push(start);
    if (edge.kind === 'arc') {
      if (
        !isBoardPoint(edge.centre) ||
        typeof edge.clockwise !== 'boolean' ||
        squaredRadius(edge.centre, start) !== squaredRadius(edge.centre, end)
      ) {
        throw new Error(
          'Arc endpoints must have the same radius around a valid centre.',
        );
      }
      const angle = (p: BoardPoint) =>
        Math.atan2(p.y - edge.centre.y, p.x - edge.centre.x);
      const startAngle = angle(start);
      let sweep = angle(end) - startAngle;
      if (edge.clockwise && sweep >= 0) sweep -= 2 * Math.PI;
      if (!edge.clockwise && sweep <= 0) sweep += 2 * Math.PI;
      const radius = Math.hypot(
        start.x - edge.centre.x,
        start.y - edge.centre.y,
      );
      const from = Math.min(startAngle, startAngle + sweep);
      const to = Math.max(startAngle, startAngle + sweep);
      const quadrant = Math.PI / 2;
      const availableRadius = [
        BOARD_COORDINATE_LIMIT_NM - edge.centre.x,
        BOARD_COORDINATE_LIMIT_NM - edge.centre.y,
        BOARD_COORDINATE_LIMIT_NM + edge.centre.x,
        BOARD_COORDINATE_LIMIT_NM + edge.centre.y,
      ];
      const radiusSquared = squaredRadius(edge.centre, start);
      for (
        let q = Math.ceil(from / quadrant);
        q <= Math.floor(to / quadrant);
        q++
      ) {
        const bound = BigInt(availableRadius[((q % 4) + 4) % 4]);
        if (radiusSquared > bound * bound)
          throw new Error('Arc exceeds the board coordinate range.');
      }
      const vertices = arcVertices(
        edge.centre,
        radius,
        startAngle,
        sweep,
        toleranceNm,
      );
      for (const point of vertices.slice(1, -1)) {
        if (
          !samePoint(point, points[points.length - 1]) &&
          !samePoint(point, end)
        )
          points.push(point);
      }
    } else if (edge.kind !== 'line') {
      throw new Error('Unsupported profile edge.');
    }
    if (points.length > MAX_CONTOUR_VERTICES)
      throw new Error('Profile exceeds the tessellation vertex budget.');
  }
  validateOutline(points, MAX_CONTOUR_VERTICES);
  return points;
}

function withinDistance(
  a: BoardPoint,
  b: BoardPoint,
  p: BoardPoint,
  distance: number,
): boolean {
  const dx = BigInt(b.x - a.x),
    dy = BigInt(b.y - a.y);
  const px = BigInt(p.x - a.x),
    py = BigInt(p.y - a.y);
  const length = dx * dx + dy * dy;
  const projection = px * dx + py * dy;
  const threshold = BigInt(distance) * BigInt(distance);
  if (projection <= BigInt(0)) return px * px + py * py <= threshold;
  if (projection >= length) return squaredRadius(b, p) <= threshold;
  const cross = dx * py - dy * px;
  return cross * cross <= threshold * length;
}

export function polygonBoundariesMeet(
  a: Polygon,
  b: Polygon,
  marginNm = 0,
): boolean {
  return a.some((start, i) => {
    const end = a[(i + 1) % a.length];
    return b.some((other, j) => {
      const otherEnd = b[(j + 1) % b.length];
      if (segmentsMeet(start, end, other, otherEnd)) return true;
      if (
        !marginNm ||
        Math.max(start.x, end.x) + marginNm < Math.min(other.x, otherEnd.x) ||
        Math.max(other.x, otherEnd.x) + marginNm < Math.min(start.x, end.x) ||
        Math.max(start.y, end.y) + marginNm < Math.min(other.y, otherEnd.y) ||
        Math.max(other.y, otherEnd.y) + marginNm < Math.min(start.y, end.y)
      )
        return false;
      return (
        withinDistance(start, end, other, marginNm) ||
        withinDistance(start, end, otherEnd, marginNm) ||
        withinDistance(other, otherEnd, start, marginNm) ||
        withinDistance(other, otherEnd, end, marginNm)
      );
    });
  });
}

export function profileRegion(profile: BoardProfile): PolygonRegion {
  if (!Array.isArray(profile.cutouts) || profile.cutouts.length > 64)
    throw new Error('Invalid profile cutout count.');
  const outer = flattenContour(profile.outline);
  const containsArc = (contour: readonly ContourEdge[]) =>
    contour.some(({ kind }) => kind === 'arc');
  const outerArc = containsArc(profile.outline);
  const holes: { polygon: Polygon; arc: boolean }[] = [];
  let vertices = outer.length;
  for (const contour of profile.cutouts) {
    const hole = flattenContour(contour);
    vertices += hole.length;
    if (vertices > 16_384)
      throw new Error('Profile exceeds the total vertex budget.');
    const arc = containsArc(contour);
    const margin = (a: boolean, b: boolean) =>
      (Number(a) + Number(b)) * TESSELLATION_TOLERANCE_NM;
    if (
      pointInPolygon(hole[0], outer) !== 'inside' ||
      polygonBoundariesMeet(outer, hole, margin(outerArc, arc))
    ) {
      throw new Error(
        'A cutout must sit strictly inside the outer profile with a gap greater than the curve uncertainty.',
      );
    }
    if (
      holes.some(
        (other) =>
          polygonBoundariesMeet(other.polygon, hole, margin(other.arc, arc)) ||
          pointInPolygon(other.polygon[0], hole) !== 'outside' ||
          pointInPolygon(hole[0], other.polygon) !== 'outside',
      )
    ) {
      throw new Error(
        'Profile cutouts cannot touch, intersect or contain one another.',
      );
    }
    holes.push({ polygon: hole, arc });
  }
  return { outer, holes: holes.map(({ polygon }) => polygon) };
}
