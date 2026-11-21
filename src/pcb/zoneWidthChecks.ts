import { TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import { regionsTouch } from './copper';
import { pointInPolygon, samePoint, segmentsMeet } from './geometry';
import type { BoardPoint } from './geometry';
import { orientedPolygonRings } from './polygonKernel';
import type { PolygonKernel } from './polygonKernel';
import { near } from './regionDistances';

const widthToleranceNm = 2 * TESSELLATION_TOLERANCE_NM;
const maxEdgeComparisons = 250_000;
const maxIndexVisits = 8 * maxEdgeComparisons;

function containsCopper(point: BoardPoint, region: PolygonRegion): boolean {
  return pointInPolygon(point, region.outer) !== 'outside' &&
    region.holes.every((hole) => pointInPolygon(point, hole) !== 'inside');
}

function segmentBounds(a: BoardPoint, b: BoardPoint) {
  return {
    minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
  };
}

function boundaryEdges(region: PolygonRegion) {
  return orientedPolygonRings([region]).flatMap((ring) =>
    ring.map((a, index) => {
      const b = ring[(index + 1) % ring.length];
      return { a, b, dx: b.x - a.x, dy: b.y - a.y, ...segmentBounds(a, b) };
    }),
  );
}

type Edge = ReturnType<typeof boundaryEdges>[number];
type Bounds = ReturnType<typeof segmentBounds>;

type IndexedEdge = { edge: Edge; index: number };
type EdgeNode = { bounds: Bounds } & (
  { edges: IndexedEdge[] } | { children: [EdgeNode, EdgeNode] }
);

// The bounds prune pairs and crossing checks before exact segment tests.
function indexEdges(edges: IndexedEdge[]): EdgeNode {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const { edge } of edges) {
    bounds.minX = Math.min(bounds.minX, edge.minX);
    bounds.maxX = Math.max(bounds.maxX, edge.maxX);
    bounds.minY = Math.min(bounds.minY, edge.minY);
    bounds.maxY = Math.max(bounds.maxY, edge.maxY);
  }
  if (edges.length <= 8) return { bounds, edges };
  const horizontal = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  const center = (edge: Edge) => horizontal ? edge.minX + edge.maxX : edge.minY + edge.maxY;
  edges.sort((a, b) => center(a.edge) - center(b.edge));
  const middle = Math.floor(edges.length / 2);
  return {
    bounds, children: [indexEdges(edges.slice(0, middle)), indexEdges(edges.slice(middle))],
  };
}

function sections(first: Edge, second: Edge) {
  if (samePoint(first.b, second.a) || samePoint(first.a, second.b)) return [];
  const length = Math.hypot(first.dx, first.dy);
  const u = { x: first.dx / length, y: first.dy / length };
  const projection = (point: BoardPoint) =>
    (point.x - first.a.x) * u.x + (point.y - first.a.y) * u.y;
  const a = projection(second.a);
  const b = projection(second.b);
  // Directed rings keep copper on the left. Opposite edges face into the web.
  if (a - b < Math.hypot(second.dx, second.dy) * Math.cos(Math.PI / 6)) return [];
  const start = Math.max(0, b);
  const end = Math.min(length, a);
  if (end <= start) return [];
  const inward = (point: BoardPoint) =>
    (point.y - first.a.y) * u.x - (point.x - first.a.x) * u.y;
  // Stay away from endpoints so a corner does not look like a thin copper web.
  return [.25, .5, .75].flatMap((fraction) => {
    const x = start + (end - start) * fraction;
    const t = (x - a) / (b - a);
    const width = inward(second.a) * (1 - t) + inward(second.b) * t;
    if (width <= 0) return [];
    const startPoint = {
      x: Math.round(first.a.x + x * u.x),
      y: Math.round(first.a.y + x * u.y),
    };
    const endPoint = {
      x: Math.round(second.a.x + t * second.dx),
      y: Math.round(second.a.y + t * second.dy),
    };
    return [{
      startPoint, endPoint, width,
      location: {
        x: Math.round((startPoint.x + endPoint.x) / 2),
        y: Math.round((startPoint.y + endPoint.y) / 2),
      },
    }];
  });
}

export function measureZoneWidth(
  kernel: PolygonKernel,
  region: PolygonRegion,
  requiredNm: number,
  thermalHalos: readonly PolygonRegion[] = [],
  filledZone: PolygonRegion = region,
) {
  const limit = requiredNm - widthToleranceNm;
  const radius = Math.floor(limit / 2);
  if (radius < 1) return undefined;
  const insideThermal = (point: BoardPoint) =>
    thermalHalos.some((halo) => containsCopper(point, halo));
  const inScope = (point: BoardPoint) => !insideThermal(point) && containsCopper(point, filledZone);
  const edges = boundaryEdges(region);
  function sweepLoad(start: 'minX' | 'minY', end: 'maxX' | 'maxY') {
    let low = Infinity;
    let high = -Infinity;
    let total = 0;
    for (const edge of edges) {
      low = Math.min(low, edge[start]);
      high = Math.max(high, edge[end]);
      total += edge[end] - edge[start] + limit;
    }
    return total / Math.max(1, high - low);
  }
  const [start, otherStart] =
    sweepLoad('minX', 'maxX') <= sweepLoad('minY', 'maxY')
      ? ['minX', 'minY'] as const
      : ['minY', 'minX'] as const;
  // Keep equal-width findings deterministic regardless of how the index splits.
  edges.sort((a, b) => a[start] - b[start] || a[otherStart] - b[otherStart]);
  const boundary = indexEdges(edges.map((edge, index) => ({ edge, index })));
  let comparisons = 0;
  let indexVisits = 0;
  function count() {
    if (++comparisons > maxEdgeComparisons)
      throw new Error('Zone width checking exceeds the boundary comparison budget.');
  }
  function anyNearby(
    node: EdgeNode, box: Bounds, margin: number, predicate: (entry: IndexedEdge) => boolean,
  ): boolean {
    if (++indexVisits > maxIndexVisits)
      throw new Error('Zone width checking exceeds the boundary search budget.');
    if (!near(node.bounds, box, margin)) return false;
    if ('children' in node)
      return node.children.some((child) => anyNearby(child, box, margin, predicate));
    return node.edges.some((entry) => near(entry.edge, box, margin) && predicate(entry));
  }
  let narrowest: { measuredNm: number; location: BoardPoint } | undefined;
  for (const [index, first] of edges.entries()) {
    const candidates: IndexedEdge[] = [];
    anyNearby(boundary, first, limit, (entry) => {
      if (entry.index > index) candidates.push(entry);
      return false;
    });
    candidates.sort((a, b) => a.index - b.index);
    for (const { edge: second } of candidates) {
      count();
      for (const { startPoint, endPoint, width, location } of sections(first, second)) {
        if (width >= (narrowest?.measuredNm ?? limit)) continue;
        const crossesBoundary = anyNearby(boundary, segmentBounds(startPoint, endPoint), 0, ({ edge }) => {
          if (edge === first || edge === second) return false;
          count();
          return segmentsMeet(startPoint, endPoint, edge.a, edge.b);
        });
        if (!crossesBoundary && inScope(location) &&
            (filledZone === region || containsCopper(location, region)))
          narrowest = { measuredNm: Math.round(width), location };
      }
    }
  }
  if (narrowest) return narrowest;

  // An inset removes sub-width connectors even if their edges are not parallel.
  // The spoke test owns copper inside thermal reliefs.
  const core = kernel.offset([region], -radius);
  if (!core.length) {
    const location = region.outer.find(inScope) ?? filledZone.outer.find((point) =>
      inScope(point) && containsCopper(point, region));
    return location ? { location } : undefined;
  }
  const bulk = core.filter(({ outer }) => outer.some((point) => !insideThermal(point)));
  if (bulk.length < 2) return undefined;
  const restored = bulk.flatMap((part) => kernel.offset([part], radius));
  const removed = kernel.boolean('difference', [region], restored);
  for (const part of removed) {
    const location = part.outer.find(inScope);
    if (location && restored.filter((core) => regionsTouch(part, core)).length > 1)
      return { location };
  }
  if (filledZone === region)
    return { location: filledZone.outer.find(inScope) ?? bulk[0].outer[0] };
  return undefined;
}
