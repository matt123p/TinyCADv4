import type { CopperLayer } from './board';
import { capsulePolygon, TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import type { BoardDrill, CopperFeature } from './copper';
import {
  isBoardPoint,
  pointInPolygon,
  samePoint,
  segmentsMeet,
} from './geometry';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

type Side = CopperLayer['id'];
interface LayerPoint {
  readonly position: BoardPoint;
  readonly layer: Side;
}

export interface RouteRules {
  readonly minWidthNm: number;
  readonly clearanceNm: number;
  readonly edgeClearanceNm: number;
  readonly minViaAnnulusNm: number;
}

export interface RouteRequest {
  readonly id: string;
  readonly netId: string;
  readonly start: LayerPoint;
  readonly goal: LayerPoint;
  readonly profile: PolygonRegion;
  readonly layers: readonly Side[];
  readonly obstacles: readonly CopperFeature[];
  readonly drills: readonly BoardDrill[];
  readonly widthNm: number;
  readonly gridNm: number;
  readonly viaDiameterNm: number;
  readonly viaDrillNm: number;
  readonly rules: RouteRules;
  readonly maxVisits?: number;
  readonly signal?: AbortSignal;
}

interface SearchNode extends LayerPoint {
  cost: number;
  priority: number;
  parent?: SearchNode;
}

interface RouteResult {
  status: 'routed' | 'blocked' | 'budget' | 'cancelled';
  visited: number;
  tracks: CopperFeature[];
  vias: CopperFeature[];
  drills: BoardDrill[];
}

const directions = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];
const sideFeature = (
  id: string,
  node: LayerPoint,
  end: BoardPoint,
  width: number,
  netId: string,
  kind: 'track' | 'pad',
): CopperFeature => ({
  id,
  kind,
  netId,
  layerId: node.layer,
  region: { outer: capsulePolygon(node.position, end, width), holes: [] },
});

function alongBoundary(
  a: BoardPoint,
  b: BoardPoint,
  region: PolygonRegion,
): boolean {
  return [region.outer, ...region.holes].some((polygon) =>
    polygon.some((start, i) =>
      segmentsMeet(a, b, start, polygon[(i + 1) % polygon.length]),
    ),
  );
}

function inside(point: BoardPoint, region: PolygonRegion): boolean {
  return (
    pointInPolygon(point, region.outer) === 'inside' &&
    region.holes.every((hole) => pointInPolygon(point, hole) === 'outside')
  );
}

function hits(a: BoardPoint, b: BoardPoint, region: PolygonRegion): boolean {
  return inside(a, region) || alongBoundary(a, b, region);
}

function add(queue: SearchNode[], node: SearchNode): void {
  let index = queue.length;
  queue.push(node);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (queue[parent].priority <= node.priority) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = node;
}

function take(queue: SearchNode[]): SearchNode {
  const node = queue[0];
  const last = queue.pop();
  if (!queue.length) return node;
  let index = 0;
  for (;;) {
    const left = index * 2 + 1;
    if (left >= queue.length) break;
    const right = left + 1;
    const child =
      right < queue.length && queue[right].priority < queue[left].priority
        ? right
        : left;
    if (queue[child].priority >= last.priority) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = last;
  return node;
}

/** Bounded H/V/45° grid search with explicit through-via transitions. */
export function routeBoard(
  kernel: PolygonKernel,
  request: RouteRequest,
): RouteResult {
  const {
    id,
    start,
    goal,
    profile,
    rules,
    layers,
    gridNm,
    widthNm,
    viaDiameterNm,
    viaDrillNm,
    netId,
    signal,
  } = request;
  const maxVisits = request.maxVisits ?? 10_000;
  const dimensions = [
    gridNm,
    widthNm,
    viaDiameterNm,
    viaDrillNm,
    rules.minWidthNm,
    rules.clearanceNm,
    rules.edgeClearanceNm,
    rules.minViaAnnulusNm,
  ];
  if (
    !id ||
    id.includes('/') ||
    !netId ||
    !isBoardPoint(start.position) ||
    !isBoardPoint(goal.position) ||
    !layers.includes(start.layer) ||
    !layers.includes(goal.layer) ||
    layers.length > 2 ||
    new Set(layers).size !== layers.length ||
    layers.some((side) => side !== 'top' && side !== 'bottom') ||
    !dimensions.every(
      (value) =>
        Number.isSafeInteger(value) && value >= 0 && value <= 500_000_000,
    ) ||
    gridNm < 2 ||
    widthNm < Math.max(2, rules.minWidthNm) ||
    viaDrillNm < 2 ||
    viaDiameterNm < viaDrillNm + 2 * Math.max(1, rules.minViaAnnulusNm) ||
    (goal.position.x - start.position.x) % gridNm ||
    (goal.position.y - start.position.y) % gridNm ||
    !Number.isSafeInteger(maxVisits) ||
    maxVisits < 1 ||
    maxVisits > 100_000
  )
    throw new Error('Invalid routing grid, endpoint, stack or dimensions.');
  const empty = (
    status: 'blocked' | 'budget' | 'cancelled',
    visited = 0,
  ): RouteResult => ({ status, visited, tracks: [], vias: [], drills: [] });
  if (signal?.aborted) return empty('cancelled');

  const marginNm = 2 * TESSELLATION_TOLERANCE_NM;
  const foreign = request.obstacles.filter(
    (obstacle) => obstacle.netId !== netId,
  );
  const allDrills = request.drills.map(
    (drill): PolygonRegion => ({
      outer: capsulePolygon(drill.start, drill.end, drill.widthNm),
      holes: [],
    }),
  );
  const prepare = (radius: number) => {
    const area = kernel.offset(
      [profile],
      -(radius + rules.edgeClearanceNm + marginNm),
    );
    const holes = kernel.offset(
      allDrills,
      radius + rules.clearanceNm + marginNm,
    );
    const byLayer = new Map(
      layers.map((layer) => [
        layer,
        kernel.offset(
          foreign
            .filter((obstacle) => obstacle.layerId === layer)
            .map((obstacle) => obstacle.region),
          radius + rules.clearanceNm + marginNm,
        ),
      ]),
    );
    return (a: BoardPoint, b: BoardPoint, layer: Side) =>
      area.some(
        (region) =>
          inside(a, region) &&
          inside(b, region) &&
          !alongBoundary(a, b, region),
      ) &&
      !holes.some((region) => hits(a, b, region)) &&
      !byLayer.get(layer).some((region) => hits(a, b, region));
  };
  const clear = prepare(Math.ceil(widthNm / 2));
  const viaClear =
    layers.length === 2 ? prepare(Math.ceil(viaDiameterNm / 2)) : null;
  if (
    !clear(start.position, start.position, start.layer) ||
    !clear(goal.position, goal.position, goal.layer)
  )
    return empty('blocked');

  const queue: SearchNode[] = [];
  const best = new Map<string, number>();
  const key = ({ position, layer }: LayerPoint) =>
    `${position.x},${position.y}:${layer}`;
  const viaCost = 4 * gridNm;
  const offer = (point: LayerPoint, cost: number, parent?: SearchNode) => {
    const id = key(point);
    if (cost >= (best.get(id) ?? Infinity)) return;
    best.set(id, cost);
    const distance = Math.hypot(
      point.position.x - goal.position.x,
      point.position.y - goal.position.y,
    );
    add(queue, {
      ...point,
      cost,
      priority: cost + distance + (point.layer === goal.layer ? 0 : viaCost),
      parent,
    });
  };
  offer(start, 0);
  let visited = 0;
  while (queue.length) {
    if (signal?.aborted) return empty('cancelled', visited);
    const node = take(queue);
    if (node.cost !== best.get(key(node))) continue;
    if (visited === maxVisits) return empty('budget', visited);
    visited++;
    if (samePoint(node.position, goal.position) && node.layer === goal.layer) {
      const path: SearchNode[] = [];
      for (let step = node; step; step = step.parent) path.push(step);
      path.reverse();
      const tracks: CopperFeature[] = [],
        vias: CopperFeature[] = [],
        drills: BoardDrill[] = [];
      let begin = path[0];
      for (let i = 1; i < path.length; i++) {
        const before = path[i - 1];
        const after = path[i];
        if (after.layer !== before.layer) {
          if (begin !== before)
            tracks.push(
              sideFeature(
                `${id}-track-${i}`,
                begin,
                before.position,
                widthNm,
                netId,
                'track',
              ),
            );
          for (const layer of layers)
            vias.push(
              sideFeature(
                `${id}-via-${i}-${layer}`,
                { position: after.position, layer },
                after.position,
                viaDiameterNm,
                netId,
                'pad',
              ),
            );
          drills.push({
            id: `${id}-via-${i}`,
            start: after.position,
            end: after.position,
            widthNm: viaDrillNm,
            plated: true,
          });
          begin = after;
          continue;
        }
        const next = path[i + 1];
        if (
          !next ||
          next.layer !== after.layer ||
          next.position.x - after.position.x !==
            after.position.x - before.position.x ||
          next.position.y - after.position.y !==
            after.position.y - before.position.y
        ) {
          tracks.push(
            sideFeature(
              `${id}-track-${i}`,
              begin,
              after.position,
              widthNm,
              netId,
              'track',
            ),
          );
          begin = after;
        }
      }
      return { status: 'routed', visited, tracks, vias, drills };
    }
    for (const [dx, dy] of directions) {
      const position = {
        x: node.position.x + dx * gridNm,
        y: node.position.y + dy * gridNm,
      };
      if (
        isBoardPoint(position) &&
        clear(node.position, position, node.layer)
      ) {
        offer(
          { position, layer: node.layer },
          node.cost + gridNm * Math.hypot(dx, dy),
          node,
        );
      }
    }
    if (
      viaClear &&
      layers.every((layer) => viaClear(node.position, node.position, layer))
    ) {
      offer(
        {
          position: node.position,
          layer: layers.find((layer) => layer !== node.layer),
        },
        node.cost + viaCost,
        node,
      );
    }
  }
  return empty('blocked', visited);
}
