import type { BoardDocument, CopperLayer } from './board';
import { boardCopperGeometry } from './boardCopperGeometry';
import type { BoardTrack } from './boardRouting';
import { capsulePolygon } from './contours';
import type { Polygon, PolygonRegion } from './contours';
import { isBoardPoint, pointInPolygon } from './geometry';
import type { BoardPoint } from './geometry';
import { bounds, closestSegmentPoint, near, pointSegmentDistance } from './regionDistances';

const rounded = ({ x, y }: BoardPoint): BoardPoint => ({ x: Math.round(x), y: Math.round(y) });

function distanceToRing(point: BoardPoint, ring: Polygon): number {
  return ring.reduce((gap, start, index) => Math.min(
    gap, pointSegmentDistance(point, start, ring[(index + 1) % ring.length]),
  ), Infinity);
}

function edgeAnchors(ring: Polygon): BoardPoint[] {
  return ring.flatMap((start, index) => {
    const end = ring[(index + 1) % ring.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const x = (start.x + end.x) / 2;
    const y = (start.y + end.y) / 2;
    return [100, -100, 1, -1].map((offset) => rounded({
      x: x - dy * offset / length, y: y + dx * offset / length,
    }));
  });
}

export interface RouteSnap {
  readonly position: BoardPoint;
  readonly netId: string;
  readonly layerId: CopperLayer['id'];
}

export function routingSnapTargets(board: BoardDocument) {
  const { features, drills } = boardCopperGeometry({ ...board, tracks: [] }, { includeApertures: false });
  const voids = drills.map(({ id, start, end, widthNm }) => {
    const outer = capsulePolygon(start, end, widthNm);
    return { id, outer, box: bounds({ outer, holes: [] }) };
  });
  const voidById = new Map(voids.map(({ id, outer }) => [id, outer]));
  function describe(id: string, region: PolygonRegion, anchor?: BoardPoint) {
    const box = bounds(region);
    const holes = [...region.holes, ...voids.filter((item) => near(box, item.box, 0)).map(({ outer }) => outer)];
    const contains = (point: BoardPoint) =>
      isBoardPoint(point) &&
      pointInPolygon(point, region.outer) === 'inside' &&
      holes.every((hole) => pointInPolygon(point, hole) === 'outside');
    const centre = rounded({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
    const fixed = [anchor, centre].find((point) => point && contains(point));
    const fallback = fixed ? [] : edgeAnchors(region.outer).filter(contains);
    const drill = voidById.get(id.slice(0, id.lastIndexOf(':')));
    return { box, region, holes, drill, contains, fixed, fallback };
  }
  function target(
    id: string,
    layerId: CopperLayer['id'],
    netId: string,
    box: ReturnType<typeof bounds>,
    outline: () => PolygonRegion,
    anchor?: BoardPoint,
    track?: BoardTrack,
  ) {
    let details: ReturnType<typeof describe> | undefined;
    return {
      id, layerId, netId, box, track,
      get details() {
        return details ??= describe(id, outline(), anchor);
      },
    };
  }
  const targets = features.filter(({ netId }) => !!netId).map(({ id, layerId, netId, region, anchor }) =>
    target(id, layerId, netId, bounds(region), () => region, anchor),
  );
  const netIds = new Set(board.nets?.map(({ id }) => id));
  for (const track of board.tracks ?? []) {
    const { id, start, end, layerId, netId, widthNm } = track;
    if (!netIds.has(netId)) continue;
    const radius = Math.ceil(widthNm / 2);
    // Enclose the rounded capsule until its exact outline is needed.
    const box = {
      minX: Math.min(start.x, end.x) - radius, minY: Math.min(start.y, end.y) - radius,
      maxX: Math.max(start.x, end.x) + radius, maxY: Math.max(start.y, end.y) + radius,
    };
    targets.push(target(id, layerId, netId, box,
      () => ({ outer: capsulePolygon(start, end, widthNm), holes: [] }), undefined, track));
  }
  return targets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Screen tolerance only controls acquisition. A selected endpoint is in board coordinates. */
export function snapRoutePoint(
  targets: ReturnType<typeof routingSnapTargets>,
  pointer: BoardPoint,
  radius: number,
  layerId: CopperLayer['id'],
  activeNet?: string,
): RouteSnap | undefined {
  const point = rounded(pointer);
  if (!isBoardPoint(point)) return;
  const box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  let best: { snap: RouteSnap; gap: number; distance: number };
  for (const target of targets) {
    if (target.layerId !== layerId || !near(target.box, box, radius)) continue;
    const { box: outlineBox, region, holes, drill, contains, fixed, fallback } = target.details;
    if (!near(outlineBox, box, radius)) continue;
    const { netId, track } = target;
    const inside = pointInPolygon(point, region.outer) !== 'outside';
    const gap = inside
      ? Math.max(0, ...holes.filter((hole) => pointInPolygon(point, hole) === 'inside')
          .map((hole) => distanceToRing(point, hole)))
      : distanceToRing(point, region.outer);
    const pickedDrill = inside && drill && pointInPolygon(point, drill) !== 'outside';
    if ((gap > radius && !pickedDrill) || (best && gap > best.gap)) continue;
    const projected = track && rounded(closestSegmentPoint(point, track.start, track.end));
    const position = projected && contains(projected)
      ? projected
      : fixed ?? fallback.reduce<BoardPoint>((closest, next) =>
          pointDistance(point, next) < pointDistance(point, closest) ? next : closest,
          fallback[0],
        );
    if (!position) continue;
    const distance = pointDistance(point, position);
    if (!best || gap < best.gap || distance < best.distance)
      best = { snap: { position, netId, layerId }, gap, distance };
  }
  if (best && (!activeNet || activeNet === best.snap.netId)) return best.snap;
}

function pointDistance(a: BoardPoint, b: BoardPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
