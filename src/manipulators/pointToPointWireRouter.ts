import { dsnSheet } from '../model/dsnDrawing';
import { Coordinate, DocItem, DocItemTypes, dsnWire } from '../model/dsnItem';
import { updateAPFactory, updateFactory } from './updateFactory';

interface ObstacleRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  gridLeft: number;
  gridTop: number;
  gridRight: number;
  gridBottom: number;
  blockedRight: number;
  blockedBottom: number;
}

interface ConnectionProfile {
  point: Coordinate;
  kind: 'symbol' | 'wire' | 'generic';
  primaryDirections: number[];
  fallbackDirections: number[];
}

interface RouterWorkspace {
  grid: number;
  obstacles: ObstacleRect[];
  bounds: GridBounds | null;
  obstacleIndex: ObstacleIndex;
  wireIndex: WireIndex;
  activePointDirections: PointDirectionLookup;
}

interface SearchState {
  key: number;
  g: number;
  f: number;
}

interface GridBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface ObstacleIndex {
  rowBuckets: number[][];
  columnBuckets: number[][];
}

interface SearchContext {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  blockedNodes: Uint8Array;
}

interface RouteSearchCache {
  searchContext: SearchContext;
  portalStepLimit: number;
  startPortals: Array<Coordinate | null | undefined>;
  endPortals: Array<Coordinate | null | undefined>;
  routes: Map<number, Map<number, Coordinate[] | null>>;
}

interface WireSpan {
  start: number;
  end: number;
}

interface WireIndex {
  horizontal: Map<number, WireSpan[]>;
  vertical: Map<number, WireSpan[]>;
}

type PointDirectionLookup = Map<number, Map<number, number>>;

interface RouteCandidate {
  points: Coordinate[];
  cost: number;
}

class MinPriorityQueue<T extends { f: number; g: number }> {
  private items: T[] = [];

  push(item: T) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }

    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return top;
  }

  get length() {
    return this.items.length;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[parent], this.items[index]) <= 0) {
        break;
      }

      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.items.length;
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = index * 2 + 2;

      if (left < length && this.compare(this.items[smallest], this.items[left]) > 0) {
        smallest = left;
      }
      if (right < length && this.compare(this.items[smallest], this.items[right]) > 0) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }

      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }

  private compare(a: T, b: T) {
    return a.f - b.f || a.g - b.g;
  }
}

const SEARCH_MARGIN = 20;
const BASE_MAX_ITERATIONS = 200000;
const MAX_ITERATIONS_HARD_CAP = 2000000;
const BASE_MAX_PORTAL_STEPS = 80;
const MAX_NEARBY_WIRE_SEARCH_STEPS = 24;
const REUSE_DISTANCE = 30;
const ALL_DIRECTIONS = [0, 1, 2, 3];
const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

export class PointToPointWireRouter {
  private workspace: RouterWorkspace;

  constructor(private sheet: dsnSheet, workspace?: RouterWorkspace) {
    const grid = Math.max(this.sheet.details.grid || 10, 1);
    this.workspace = workspace ?? this.buildWorkspace(this.sheet.items, grid);
  }

  getWorkspace() {
    return this.workspace;
  }

  route(start: Coordinate, end: Coordinate, previousRoute?: Coordinate[] | null): Coordinate[] {
    if (this.samePoint(start, end)) {
      return [[start[0], start[1]], [end[0], end[1]]];
    }

    const { grid, obstacles } = this.workspace;
    const portalStepLimit = this.getPortalStepLimit(start, end, grid);
    const routeCache: RouteSearchCache = {
      searchContext: this.createSearchContext(start, end, grid, portalStepLimit),
      portalStepLimit,
      startPortals: new Array(DIRECTIONS.length),
      endPortals: new Array(DIRECTIONS.length),
      routes: new Map(),
    };

    const reusedRoute = this.tryReusePreviousRoute(start, end, previousRoute, obstacles);
    if (reusedRoute) {
      return reusedRoute;
    }

    const startProfile = this.resolveConnectionProfile(start, end);
    const endProfile = this.resolveConnectionProfile(end, start);

    const primaryRoute = this.findRouteForProfiles(startProfile, endProfile, obstacles, grid, false, routeCache);
    if (primaryRoute) return primaryRoute;

    const fallbackRoute = this.findRouteForProfiles(startProfile, endProfile, obstacles, grid, true, routeCache);
    if (fallbackRoute) return fallbackRoute;

    const relaxedRoute = this.findRouteForProfiles(
      { ...startProfile, primaryDirections: ALL_DIRECTIONS, fallbackDirections: ALL_DIRECTIONS },
      { ...endProfile, primaryDirections: ALL_DIRECTIONS, fallbackDirections: ALL_DIRECTIONS },
      obstacles,
      grid,
      true,
      routeCache,
    );
    if (relaxedRoute) return relaxedRoute;

    if (endProfile.kind === 'wire') {
      const nearbyWireRoute = this.findNearbyWireRoute(startProfile, end, obstacles, grid, routeCache);
      if (nearbyWireRoute) return nearbyWireRoute;
    }

    if (startProfile.kind === 'wire') {
      const nearbyWireStartRoute = this.findNearbyWireStartRoute(start, endProfile, obstacles, grid, routeCache);
      if (nearbyWireStartRoute) return nearbyWireStartRoute;
    }

    const direct = this.normalizePoints([
      [start[0], start[1]],
      [start[0], end[1]],
      [end[0], end[1]],
    ]);
    if (this.isPolylineClear(direct, obstacles)) {
      return direct;
    }

    return [[start[0], start[1]], [end[0], end[1]]];
  }

  private findRouteForProfiles(
    startProfile: ConnectionProfile,
    endProfile: ConnectionProfile,
    obstacles: ObstacleRect[],
    grid: number,
    allowFallbackDirections: boolean,
    routeCache: RouteSearchCache,
  ): Coordinate[] | null {
    const startDirections = allowFallbackDirections ? startProfile.fallbackDirections : startProfile.primaryDirections;
    const endDirections = allowFallbackDirections ? endProfile.fallbackDirections : endProfile.primaryDirections;

    let bestCandidate: RouteCandidate | null = null;

    for (const startDir of startDirections) {
      const startPortal = this.getCachedPortal(
        startProfile.point,
        startDir,
        routeCache.startPortals,
        obstacles,
        grid,
        routeCache.portalStepLimit,
      );
      if (!startPortal) continue;

      for (const endDir of endDirections) {
        const endPortal = this.getCachedPortal(
          endProfile.point,
          endDir,
          routeCache.endPortals,
          obstacles,
          grid,
          routeCache.portalStepLimit,
        );
        if (!endPortal) continue;

        const middle = this.samePoint(startPortal, endPortal)
          ? [[startPortal[0], startPortal[1]] as Coordinate]
          : this.getCachedGridRoute(startPortal, endPortal, grid, routeCache);
          
        if (!middle) continue;

        const points = this.normalizePoints([
          [startProfile.point[0], startProfile.point[1]],
          ...middle,
          [endProfile.point[0], endProfile.point[1]],
        ]);

        const cost =
          this.pathLength(points) +
          this.turnCount(points) * grid * 2 +
          this.directionPenalty(startDir, startProfile, allowFallbackDirections) +
          this.directionPenalty(endDir, endProfile, allowFallbackDirections);

        if (!bestCandidate || cost < bestCandidate.cost) {
          bestCandidate = { points, cost };
        }
      }
    }

    return bestCandidate?.points ?? null;
  }

  private findNearbyWireRoute(
    startProfile: ConnectionProfile,
    targetWirePoint: Coordinate,
    obstacles: ObstacleRect[],
    grid: number,
    routeCache: RouteSearchCache,
  ): Coordinate[] | null {
    const candidates = this.getNearbyWireConnectionPoints(targetWirePoint, grid);

    for (const candidatePoint of candidates) {
      const endProfile = this.resolveConnectionProfile(candidatePoint, startProfile.point);
      const candidateCache: RouteSearchCache = {
        searchContext: routeCache.searchContext,
        portalStepLimit: routeCache.portalStepLimit,
        startPortals: routeCache.startPortals,
        endPortals: new Array(DIRECTIONS.length),
        routes: new Map(),
      };

      const primaryRoute = this.findRouteForProfiles(startProfile, endProfile, obstacles, grid, false, candidateCache);
      if (primaryRoute) return primaryRoute;

      const fallbackRoute = this.findRouteForProfiles(startProfile, endProfile, obstacles, grid, true, candidateCache);
      if (fallbackRoute) return fallbackRoute;

      const relaxedRoute = this.findRouteForProfiles(
        { ...startProfile, primaryDirections: ALL_DIRECTIONS, fallbackDirections: ALL_DIRECTIONS },
        { ...endProfile, primaryDirections: ALL_DIRECTIONS, fallbackDirections: ALL_DIRECTIONS },
        obstacles,
        grid,
        true,
        candidateCache,
      );
      if (relaxedRoute) return relaxedRoute;
    }

    return null;
  }

  private findNearbyWireStartRoute(
    targetWirePoint: Coordinate,
    endProfile: ConnectionProfile,
    obstacles: ObstacleRect[],
    grid: number,
    routeCache: RouteSearchCache,
  ): Coordinate[] | null {
    const candidates = this.getNearbyWireConnectionPoints(targetWirePoint, grid);

    for (const candidatePoint of candidates) {
      const startProfile = this.resolveConnectionProfile(candidatePoint, endProfile.point);
      const candidateCache: RouteSearchCache = {
        searchContext: routeCache.searchContext,
        portalStepLimit: routeCache.portalStepLimit,
        startPortals: new Array(DIRECTIONS.length),
        endPortals: routeCache.endPortals,
        routes: new Map(),
      };

      const primaryRoute = this.findRouteForProfiles(startProfile, endProfile, obstacles, grid, false, candidateCache);
      if (primaryRoute) return primaryRoute;

      const fallbackRoute = this.findRouteForProfiles(startProfile, endProfile, obstacles, grid, true, candidateCache);
      if (fallbackRoute) return fallbackRoute;

      const relaxedRoute = this.findRouteForProfiles(
        { ...startProfile, primaryDirections: ALL_DIRECTIONS, fallbackDirections: ALL_DIRECTIONS },
        { ...endProfile, primaryDirections: ALL_DIRECTIONS, fallbackDirections: ALL_DIRECTIONS },
        obstacles,
        grid,
        true,
        candidateCache,
      );
      if (relaxedRoute) return relaxedRoute;
    }

    return null;
  }

  private tryReusePreviousRoute(
    start: Coordinate,
    end: Coordinate,
    previousRoute: Coordinate[] | null | undefined,
    obstacles: ObstacleRect[],
  ): Coordinate[] | null {
    if (!previousRoute || previousRoute.length < 2) return null;
    if (!this.samePoint(previousRoute[0], start)) return null;

    const previousEnd = previousRoute[previousRoute.length - 1];
    const movement = Math.abs(previousEnd[0] - end[0]) + Math.abs(previousEnd[1] - end[1]);
    if (movement > REUSE_DISTANCE) return null;

    const normalizedPreviousRoute = this.normalizePoints(previousRoute);
    for (let anchorIndex = normalizedPreviousRoute.length - 2; anchorIndex >= 0; --anchorIndex) {
      const anchor = normalizedPreviousRoute[anchorIndex];
      if (anchor[0] === end[0] || anchor[1] === end[1]) {
        if (this.isSegmentClear(anchor, end, obstacles)) {
          return this.buildReusedRoute(normalizedPreviousRoute, anchorIndex, [[end[0], end[1]]]);
        }
        continue;
      }

      const viaHorizontal: Coordinate = [anchor[0], end[1]];
      if (
        this.isSegmentClear(anchor, viaHorizontal, obstacles) &&
        this.isSegmentClear(viaHorizontal, end, obstacles)
      ) {
        return this.buildReusedRoute(normalizedPreviousRoute, anchorIndex, [viaHorizontal, [end[0], end[1]]]);
      }

      const viaVertical: Coordinate = [end[0], anchor[1]];
      if (
        this.isSegmentClear(anchor, viaVertical, obstacles) &&
        this.isSegmentClear(viaVertical, end, obstacles)
      ) {
        return this.buildReusedRoute(normalizedPreviousRoute, anchorIndex, [viaVertical, [end[0], end[1]]]);
      }
    }

    return null;
  }

  private resolveConnectionProfile(point: Coordinate, referencePoint: Coordinate): ConnectionProfile {
    const wireDirections = this.getWireDirections(point, referencePoint);
    if (wireDirections.primaryDirections.length > 0) {
      return {
        point,
        kind: 'wire',
        primaryDirections: wireDirections.primaryDirections,
        fallbackDirections: wireDirections.fallbackDirections,
      };
    }

    const symbolDirections = this.getActivePointDirections(point);
    if (symbolDirections.length > 0) {
      return { point, kind: 'symbol', primaryDirections: symbolDirections, fallbackDirections: symbolDirections };
    }

    return { point, kind: 'generic', primaryDirections: ALL_DIRECTIONS, fallbackDirections: ALL_DIRECTIONS };
  }

  private getWireDirections(
    point: Coordinate,
    referencePoint: Coordinate,
  ): { primaryDirections: number[]; fallbackDirections: number[] } {
    const mask = this.getWireDirectionMask(point);
    const fallbackDirections = this.sortDirectionsByReference(this.maskToDirections(mask), point, referencePoint);

    const hasHorizontal = (mask & (this.directionMask(0) | this.directionMask(1))) !== 0;
    const hasVertical = (mask & (this.directionMask(2) | this.directionMask(3))) !== 0;

    if (!hasHorizontal || !hasVertical) {
      return { primaryDirections: fallbackDirections, fallbackDirections };
    }

    const dx = referencePoint[0] - point[0];
    const dy = referencePoint[1] - point[1];
    const preferredAxis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
    const primaryDirections = fallbackDirections.filter((direction: number) =>
      preferredAxis === 'horizontal'
        ? direction === 0 || direction === 1
        : direction === 2 || direction === 3,
    );

    return {
      primaryDirections: primaryDirections.length > 0 ? primaryDirections : fallbackDirections,
      fallbackDirections,
    };
  }

  private getActivePointDirections(point: Coordinate): number[] {
    return this.maskToDirections(this.getPointDirectionMask(this.workspace.activePointDirections, point[0], point[1]));
  }

  private createPortal(
    point: Coordinate,
    directionIndex: number,
    obstacles: ObstacleRect[],
    grid: number,
    portalStepLimit: number,
  ): Coordinate | null {
    const direction = DIRECTIONS[directionIndex];
    const ignoredArray = this.getObstaclesAtPoint(point, obstacles);
    const ignoredSet = new Set(ignoredArray);

    for (let step = 1; step <= portalStepLimit; ++step) {
      const candidate: Coordinate = [
        point[0] + direction.dx * step * grid,
        point[1] + direction.dy * step * grid,
      ];

      if (this.pointBlockedByIgnored(candidate, obstacles, ignoredArray)) continue;
      if (this.pointBlocked(candidate, obstacles, ignoredSet)) continue;
      if (!this.isSegmentClear(point, candidate, obstacles, ignoredSet)) continue;

      return candidate;
    }

    return null;
  }

  private findGridRoute(
    start: Coordinate,
    end: Coordinate,
    grid: number,
    searchContext: SearchContext,
  ): Coordinate[] | null {
    const startX = Math.round(start[0] / grid);
    const startY = Math.round(start[1] / grid);
    const endX = Math.round(end[0] / grid);
    const endY = Math.round(end[1] / grid);
    const { minX, maxX, minY, maxY, height, width, blockedNodes } = searchContext;
    const startCell = this.toCellIndex(startX, startY, searchContext);
    const endCell = this.toCellIndex(endX, endY, searchContext);

    const open = new MinPriorityQueue<SearchState>();
    const stateCount = width * height * 5;
    const iterationLimit = this.getIterationLimit(stateCount);
    const bestCost = new Int32Array(stateCount);
    const previous = new Int32Array(stateCount);
    bestCost.fill(-1);
    previous.fill(-1);

    const encodeKey = (cellIndex: number, dir: number) => cellIndex * 5 + (dir + 1);

    const startKey = encodeKey(startCell, -1);
    open.push({
      key: startKey,
      g: 0,
      f: this.manhattan(startX, startY, endX, endY),
    });
    
    bestCost[startKey] = 0;

    let iterations = 0;
    while (open.length > 0 && iterations < iterationLimit) {
      ++iterations;
      const current = open.pop()!;
      if (bestCost[current.key] !== current.g) continue;
      
      const currentDir = (current.key % 5) - 1;
      const currentXY = Math.floor(current.key / 5);
      const currentY = (currentXY % height) + minY;
      const currentX = Math.floor(currentXY / height) + minX;

      if (currentXY === endCell) {
        return this.rebuildRoute(current.key, previous, searchContext, grid);
      }

      for (let directionIndex = 0; directionIndex < DIRECTIONS.length; ++directionIndex) {
        const direction = DIRECTIONS[directionIndex];
        const nextX = currentX + direction.dx;
        const nextY = currentY + direction.dy;
        const nextPoint: Coordinate = [nextX * grid, nextY * grid];

        if (nextX < minX || nextX > maxX || nextY < minY || nextY > maxY) continue;
        const nextCell = this.toCellIndex(nextX, nextY, searchContext);
        if (blockedNodes[nextCell] === 1 && nextCell !== endCell) continue;
        if (this.segmentTouchesParallelWire([currentX * grid, currentY * grid], nextPoint)) continue;

        const turnPenalty = currentDir === -1 || currentDir === directionIndex ? 0 : 1;
        const nextG = current.g + 1 + turnPenalty;
        const nextKey = encodeKey(nextCell, directionIndex);
        
        const best = bestCost[nextKey];
        if (best !== -1 && best <= nextG) continue;

        bestCost[nextKey] = nextG;
        previous[nextKey] = current.key;
        
        open.push({
          key: nextKey,
          g: nextG,
          f: nextG + this.manhattan(nextX, nextY, endX, endY),
        });
      }
    }

    return null;
  }

  private rebuildRoute(
    endKey: number,
    previous: Int32Array,
    searchContext: SearchContext,
    grid: number,
  ): Coordinate[] {
    const points: Coordinate[] = [];
    let cursor = endKey;

    while (cursor !== -1) {
      const xy = Math.floor(cursor / 5);
      const y = (xy % searchContext.height) + searchContext.minY;
      const x = Math.floor(xy / searchContext.height) + searchContext.minX;
      
      points.push([x * grid, y * grid]);
      cursor = previous[cursor];
    }

    points.reverse();
    return this.normalizePoints(points);
  }

  private buildWorkspace(items: DocItem[], grid: number): RouterWorkspace {
    const obstacles = this.buildObstacles(items, grid);
    const bounds = obstacles.length > 0 ? this.computeObstacleBounds(obstacles) : null;

    return {
      grid,
      obstacles,
      bounds,
      obstacleIndex: this.buildObstacleIndex(obstacles, bounds),
      wireIndex: this.buildWireIndex(items),
      activePointDirections: this.buildActivePointDirections(items),
    };
  }

  private buildObstacles(items: DocItem[], grid: number): ObstacleRect[] {
    const obstacles: ObstacleRect[] = [];
    const clearance = this.clearance(grid);
    for (const item of items) {
      obstacles.push(...this.buildItemObstacles(item, grid, clearance));
    }
    return obstacles;
  }

  private buildItemObstacles(item: DocItem, grid: number, clearance: number): ObstacleRect[] {
    const obstacles: ObstacleRect[] = [];

    switch (item.NodeName) {
      case DocItemTypes.Wire:
        obstacles.push(...this.getWirePointObstacles(item, grid, clearance));
        break;
      case DocItemTypes.Symbol:
      case DocItemTypes.Power:
      case DocItemTypes.Label:
      case DocItemTypes.BusLabel: {
        const rect = this.getBoundingRect(item);
        if (rect) obstacles.push(this.createObstacleRect(rect, 0, grid));
        break;
      }
      case DocItemTypes.NoConnect:
      case DocItemTypes.Pin:
      case DocItemTypes.Junction:
      case DocItemTypes.BusSlash: {
        const rect = this.getBoundingRect(item);
        if (rect) obstacles.push(this.expandRect(rect, clearance, grid));
        break;
      }
    }

    const activePointProvider = updateAPFactory(item);
    const activePoints = activePointProvider?.active_points?.() ?? [];
    for (const point of activePoints) {
      obstacles.push(this.expandPoint(point, clearance, grid));
    }

    return obstacles;
  }

  private getWirePointObstacles(wire: dsnWire, grid: number, clearance: number): ObstacleRect[] {
    const obstacles: ObstacleRect[] = [];

    for (const point of wire.d_points) {
      obstacles.push(this.expandPoint(point, clearance, grid));
    }

    return obstacles;
  }

  private getBoundingRect(item: DocItem): ObstacleRect | null {
    const updater = updateFactory(item) as any;
    const rect = updater?.getBoundingRect?.();
    if (!rect) return null;

    return {
      left: Math.min(rect.x1, rect.x2),
      top: Math.min(rect.y1, rect.y2),
      right: Math.max(rect.x1, rect.x2),
      bottom: Math.max(rect.y1, rect.y2),
      gridLeft: 0,
      gridTop: 0,
      gridRight: 0,
      gridBottom: 0,
      blockedRight: 0,
      blockedBottom: 0,
    };
  }

  private expandRect(rect: ObstacleRect, clearance: number, grid: number): ObstacleRect {
    const left = Math.floor((rect.left - clearance) / grid) * grid;
    const top = Math.floor((rect.top - clearance) / grid) * grid;
    const right = Math.ceil((rect.right + clearance) / grid) * grid;
    const bottom = Math.ceil((rect.bottom + clearance) / grid) * grid;

    return this.createObstacleRect(
      {
        ...rect,
        left,
        top,
        right,
        bottom,
      },
      0,
      grid,
    );
  }

  private createObstacleRect(rect: ObstacleRect, clearance: number, grid: number): ObstacleRect {
    const left = Math.floor((rect.left - clearance) / grid) * grid;
    const top = Math.floor((rect.top - clearance) / grid) * grid;
    const right = rect.right + clearance;
    const bottom = rect.bottom + clearance;
    const gridLeft = Math.floor((rect.left - clearance) / grid);
    const gridTop = Math.floor((rect.top - clearance) / grid);
    const gridRight = Math.floor(right / grid);
    const gridBottom = Math.floor(bottom / grid);

    return {
      left: rect.left - clearance,
      top: rect.top - clearance,
      right,
      bottom,
      gridLeft,
      gridTop,
      gridRight,
      gridBottom,
      blockedRight: Math.max(gridLeft, Math.floor((right - 0.001) / grid)),
      blockedBottom: Math.max(gridTop, Math.floor((bottom - 0.001) / grid)),
    };
  }

  private expandPoint(point: Coordinate, clearance: number, grid: number): ObstacleRect {
    return this.expandRect(
      {
        left: point[0],
        top: point[1],
        right: point[0],
        bottom: point[1],
        gridLeft: 0,
        gridTop: 0,
        gridRight: 0,
        gridBottom: 0,
        blockedRight: 0,
        blockedBottom: 0,
      },
      clearance,
      grid,
    );
  }

  private isPolylineClear(points: Coordinate[], obstacles: ObstacleRect[]): boolean {
    for (let index = 0; index < points.length - 1; ++index) {
      if (!this.isSegmentClear(points[index], points[index + 1], obstacles)) return false;
    }
    return true;
  }

  private pointBlocked(
    point: Coordinate,
    obstacles: ObstacleRect[],
    ignored: Set<number> = new Set(),
  ): boolean {
    const candidates = this.getObstacleCandidatesForPoint(point);
    for (const obstacleIndex of candidates) {
      if (ignored.has(obstacleIndex)) continue;
      if (this.pointInsideRect(point, obstacles[obstacleIndex])) return true;
    }
    return false;
  }

  private isSegmentClear(
    a: Coordinate,
    b: Coordinate,
    obstacles: ObstacleRect[],
    ignored: Set<number> = new Set(),
  ): boolean {
    if (this.samePoint(a, b)) return true;
    if (this.segmentTouchesParallelWire(a, b)) return false;

    const segmentRect: ObstacleRect = {
      left: Math.min(a[0], b[0]),
      top: Math.min(a[1], b[1]),
      right: Math.max(a[0], b[0]),
      bottom: Math.max(a[1], b[1]),
      gridLeft: 0,
      gridTop: 0,
      gridRight: 0,
      gridBottom: 0,
      blockedRight: 0,
      blockedBottom: 0,
    };

    const candidates = this.getObstacleCandidatesForSegment(a, b);
    for (const obstacleIndex of candidates) {
      if (ignored.has(obstacleIndex)) continue;
      const obstacle = obstacles[obstacleIndex];
      if (!this.rectsOverlap(segmentRect, obstacle)) continue;
      if (this.segmentIntersectsRect(a, b, obstacle)) return false;
    }

    return true;
  }

  private segmentIntersectsRect(a: Coordinate, b: Coordinate, rect: ObstacleRect): boolean {
    if (a[0] === b[0]) {
      const x = a[0];
      if (x < rect.left || x > rect.right) return false;

      const top = Math.min(a[1], b[1]);
      const bottom = Math.max(a[1], b[1]);
      return !(bottom < rect.top || top > rect.bottom);
    }

    if (a[1] === b[1]) {
      const y = a[1];
      if (y < rect.top || y > rect.bottom) return false;

      const left = Math.min(a[0], b[0]);
      const right = Math.max(a[0], b[0]);
      return !(right < rect.left || left > rect.right);
    }

    return false;
  }

  private normalizePoints(points: Coordinate[]): Coordinate[] {
    if (points.length <= 2) {
      return points.map((p) => [p[0], p[1]] as Coordinate);
    }

    const normalized: Coordinate[] = [[points[0][0], points[0][1]]];
    
    for (let index = 1; index < points.length - 1; ++index) {
      const currentPoint = points[index];
      
      // Filter out immediate identical points to act as deduplication
      if (this.samePoint(currentPoint, points[index - 1])) continue;

      const previousPoint = normalized[normalized.length - 1];
      const nextPoint = points[index + 1];
      
      const isCollinear =
        (previousPoint[0] === currentPoint[0] && currentPoint[0] === nextPoint[0]) ||
        (previousPoint[1] === currentPoint[1] && currentPoint[1] === nextPoint[1]);

      if (!isCollinear) {
        normalized.push([currentPoint[0], currentPoint[1]]);
      }
    }

    const last = points[points.length - 1];
    if (!this.samePoint(normalized[normalized.length - 1], last)) {
      normalized.push([last[0], last[1]]);
    }
    
    return normalized;
  }

  private pathLength(points: Coordinate[]): number {
    let total = 0;
    for (let index = 0; index < points.length - 1; ++index) {
      total += Math.abs(points[index + 1][0] - points[index][0]) + Math.abs(points[index + 1][1] - points[index][1]);
    }
    return total;
  }

  private turnCount(points: Coordinate[]): number {
    let turns = 0;
    for (let index = 1; index < points.length - 1; ++index) {
      const a = points[index - 1];
      const b = points[index];
      const c = points[index + 1];
      if ((a[1] === b[1]) !== (b[1] === c[1])) {
        ++turns;
      }
    }
    return turns;
  }

  private directionPenalty(direction: number, profile: ConnectionProfile, usingFallbackDirections: boolean): number {
    if (!usingFallbackDirections) return 0;
    return profile.primaryDirections.includes(direction) ? 0 : 1000;
  }

  private pointOnSegment(point: Coordinate, a: Coordinate, b: Coordinate): boolean {
    if (a[0] === b[0] && point[0] === a[0]) {
      return point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
    }

    if (a[1] === b[1] && point[1] === a[1]) {
      return point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]);
    }

    return false;
  }

  private pointInsideRect(point: Coordinate, rect: ObstacleRect): boolean {
    return point[0] >= rect.left && point[0] <= rect.right && point[1] >= rect.top && point[1] <= rect.bottom;
  }

  private rectsOverlap(a: ObstacleRect, b: ObstacleRect): boolean {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  private samePoint(a: Coordinate | null | undefined, b: Coordinate | null | undefined): boolean {
    return !!a && !!b && a[0] === b[0] && a[1] === b[1];
  }

  private manhattan(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  private clearance(grid: number): number {
    return Math.max(grid / 2, 1);
  }

  private createSearchContext(
    start: Coordinate,
    end: Coordinate,
    grid: number,
    portalStepLimit: number,
  ): SearchContext {
    const startX = Math.round(start[0] / grid);
    const startY = Math.round(start[1] / grid);
    const endX = Math.round(end[0] / grid);
    const endY = Math.round(end[1] / grid);

    let minX = Math.min(startX, endX);
    let maxX = Math.max(startX, endX);
    let minY = Math.min(startY, endY);
    let maxY = Math.max(startY, endY);

    if (this.workspace.bounds) {
      minX = Math.min(minX, this.workspace.bounds.minX);
      maxX = Math.max(maxX, this.workspace.bounds.maxX);
      minY = Math.min(minY, this.workspace.bounds.minY);
      maxY = Math.max(maxY, this.workspace.bounds.maxY);
    }

    const margin = SEARCH_MARGIN + portalStepLimit;
    minX -= margin;
    maxX += margin;
    minY -= margin;
    maxY += margin;

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const blockedNodes = new Uint8Array(width * height);

    for (const obstacle of this.workspace.obstacles) {
      const left = Math.max(minX, obstacle.gridLeft);
      const right = Math.min(maxX, obstacle.blockedRight);
      const top = Math.max(minY, obstacle.gridTop);
      const bottom = Math.min(maxY, obstacle.blockedBottom);
      if (left > right || top > bottom) continue;

      for (let x = left; x <= right; ++x) {
        const xOffset = (x - minX) * height;
        for (let y = top; y <= bottom; ++y) {
          blockedNodes[xOffset + (y - minY)] = 1;
        }
      }
    }

    return { minX, maxX, minY, maxY, width, height, blockedNodes };
  }

  private computeObstacleBounds(obstacles: ObstacleRect[]): GridBounds {
    let minX = obstacles[0].gridLeft;
    let maxX = obstacles[0].gridRight;
    let minY = obstacles[0].gridTop;
    let maxY = obstacles[0].gridBottom;

    for (let index = 1; index < obstacles.length; ++index) {
      const obstacle = obstacles[index];
      minX = Math.min(minX, obstacle.gridLeft);
      maxX = Math.max(maxX, obstacle.gridRight);
      minY = Math.min(minY, obstacle.gridTop);
      maxY = Math.max(maxY, obstacle.gridBottom);
    }

    return { minX, maxX, minY, maxY };
  }

  private buildObstacleIndex(obstacles: ObstacleRect[], bounds: GridBounds | null): ObstacleIndex {
    if (!bounds) {
      return { rowBuckets: [], columnBuckets: [] };
    }

    const rowBuckets = Array.from({ length: bounds.maxY - bounds.minY + 1 }, () => [] as number[]);
    const columnBuckets = Array.from({ length: bounds.maxX - bounds.minX + 1 }, () => [] as number[]);

    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; ++obstacleIndex) {
      const obstacle = obstacles[obstacleIndex];
      for (let y = obstacle.gridTop; y <= obstacle.gridBottom; ++y) {
        rowBuckets[y - bounds.minY].push(obstacleIndex);
      }
      for (let x = obstacle.gridLeft; x <= obstacle.gridRight; ++x) {
        columnBuckets[x - bounds.minX].push(obstacleIndex);
      }
    }

    return { rowBuckets, columnBuckets };
  }

  private buildWireIndex(items: DocItem[]): WireIndex {
    const horizontal = new Map<number, WireSpan[]>();
    const vertical = new Map<number, WireSpan[]>();

    for (const item of items) {
      if (item.NodeName !== DocItemTypes.Wire) continue;

      for (let index = 0; index < item.d_points.length - 1; ++index) {
        const a = item.d_points[index];
        const b = item.d_points[index + 1];

        if (a[1] === b[1]) {
          this.pushWireSpan(horizontal, a[1], Math.min(a[0], b[0]), Math.max(a[0], b[0]));
        } else if (a[0] === b[0]) {
          this.pushWireSpan(vertical, a[0], Math.min(a[1], b[1]), Math.max(a[1], b[1]));
        }
      }
    }

    return { horizontal, vertical };
  }

  private buildActivePointDirections(items: DocItem[]): PointDirectionLookup {
    const lookup: PointDirectionLookup = new Map();

    for (const item of items) {
      if (item.NodeName !== DocItemTypes.Symbol && item.NodeName !== DocItemTypes.Power) continue;

      const updater = updateAPFactory(item);
      const activePoints = updater?.active_points?.() ?? [];
      if (activePoints.length === 0) continue;

      const rect = this.getBoundingRect(item);
      for (const point of activePoints) {
        if (this.hasPointDirection(lookup, point[0], point[1])) continue;
        this.setPointDirectionMask(lookup, point[0], point[1], this.computeActivePointMask(point, rect));
      }
    }

    return lookup;
  }

  private computeActivePointMask(point: Coordinate, rect: ObstacleRect | null): number {
    if (!rect) return this.directionMask(0) | this.directionMask(1) | this.directionMask(2) | this.directionMask(3);

    const epsilon = 0.001;
    let mask = 0;

    if (Math.abs(point[0] - rect.left) <= epsilon) mask |= this.directionMask(1);
    if (Math.abs(point[0] - rect.right) <= epsilon) mask |= this.directionMask(0);
    if (Math.abs(point[1] - rect.top) <= epsilon) mask |= this.directionMask(3);
    if (Math.abs(point[1] - rect.bottom) <= epsilon) mask |= this.directionMask(2);

    if (mask !== 0) return mask;

    const leftDistance = Math.abs(point[0] - rect.left);
    const rightDistance = Math.abs(point[0] - rect.right);
    const topDistance = Math.abs(point[1] - rect.top);
    const bottomDistance = Math.abs(point[1] - rect.bottom);
    const minimum = Math.min(leftDistance, rightDistance, topDistance, bottomDistance);

    if (minimum === leftDistance) return this.directionMask(1);
    if (minimum === rightDistance) return this.directionMask(0);
    if (minimum === topDistance) return this.directionMask(3);
    return this.directionMask(2);
  }

  private getCachedPortal(
    point: Coordinate,
    directionIndex: number,
    portalCache: Array<Coordinate | null | undefined>,
    obstacles: ObstacleRect[],
    grid: number,
    portalStepLimit: number,
  ): Coordinate | null {
    const cached = portalCache[directionIndex];
    if (cached !== undefined) {
      return cached;
    }

    const portal = this.createPortal(point, directionIndex, obstacles, grid, portalStepLimit);
    portalCache[directionIndex] = portal;
    return portal;
  }

  private getCachedGridRoute(
    start: Coordinate,
    end: Coordinate,
    grid: number,
    routeCache: RouteSearchCache,
  ): Coordinate[] | null {
    const startCell = this.toCellIndex(Math.round(start[0] / grid), Math.round(start[1] / grid), routeCache.searchContext);
    const endCell = this.toCellIndex(Math.round(end[0] / grid), Math.round(end[1] / grid), routeCache.searchContext);
    const cachedByStart = routeCache.routes.get(startCell);
    if (cachedByStart?.has(endCell)) {
      return cachedByStart.get(endCell) ?? null;
    }

    const route = this.findGridRoute(start, end, grid, routeCache.searchContext);
    const nextCachedByStart = cachedByStart ?? new Map<number, Coordinate[] | null>();
    nextCachedByStart.set(endCell, route);
    routeCache.routes.set(startCell, nextCachedByStart);

    if (route) {
      let reverseRoute = routeCache.routes.get(endCell);
      if (!reverseRoute) {
        reverseRoute = new Map<number, Coordinate[] | null>();
        routeCache.routes.set(endCell, reverseRoute);
      }
      reverseRoute.set(startCell, [...route].reverse().map((point) => [point[0], point[1]] as Coordinate));
    }

    return route;
  }

  private buildReusedRoute(
    previousRoute: Coordinate[],
    anchorIndex: number,
    suffix: Coordinate[],
  ): Coordinate[] {
    const candidate: Coordinate[] = [];

    for (let index = 0; index <= anchorIndex; ++index) {
      const point = previousRoute[index];
      candidate.push([point[0], point[1]]);
    }

    for (const point of suffix) {
      candidate.push([point[0], point[1]]);
    }

    return this.normalizePoints(candidate);
  }

  private getObstaclesAtPoint(point: Coordinate, obstacles: ObstacleRect[]): number[] {
    const containing: number[] = [];
    const candidates = this.getObstacleCandidatesForPoint(point);

    for (const obstacleIndex of candidates) {
      if (this.pointInsideRect(point, obstacles[obstacleIndex])) {
        containing.push(obstacleIndex);
      }
    }

    return containing;
  }

  private pointBlockedByIgnored(point: Coordinate, obstacles: ObstacleRect[], ignored: number[]): boolean {
    for (const obstacleIndex of ignored) {
      if (this.pointInsideRect(point, obstacles[obstacleIndex])) return true;
    }
    return false;
  }

  private getObstacleCandidatesForPoint(point: Coordinate): number[] {
    if (!this.workspace.bounds) return [];

    const rowIndex = Math.round(point[1] / this.workspace.grid) - this.workspace.bounds.minY;
    if (rowIndex < 0 || rowIndex >= this.workspace.obstacleIndex.rowBuckets.length) return [];
    return this.workspace.obstacleIndex.rowBuckets[rowIndex];
  }

  private getObstacleCandidatesForSegment(a: Coordinate, b: Coordinate): number[] {
    if (!this.workspace.bounds) return [];

    if (a[0] === b[0]) {
      const columnIndex = Math.round(a[0] / this.workspace.grid) - this.workspace.bounds.minX;
      if (columnIndex < 0 || columnIndex >= this.workspace.obstacleIndex.columnBuckets.length) return [];
      return this.workspace.obstacleIndex.columnBuckets[columnIndex];
    }

    if (a[1] === b[1]) {
      const rowIndex = Math.round(a[1] / this.workspace.grid) - this.workspace.bounds.minY;
      if (rowIndex < 0 || rowIndex >= this.workspace.obstacleIndex.rowBuckets.length) return [];
      return this.workspace.obstacleIndex.rowBuckets[rowIndex];
    }

    return [];
  }

  private pushWireSpan(index: Map<number, WireSpan[]>, key: number, start: number, end: number) {
    const spans = index.get(key);
    if (spans) {
      spans.push({ start, end });
      return;
    }

    index.set(key, [{ start, end }]);
  }

  private directionMask(direction: number): number {
    return 1 << direction;
  }

  private maskToDirections(mask: number): number[] {
    const directions: number[] = [];

    for (let direction = 0; direction < DIRECTIONS.length; ++direction) {
      if ((mask & this.directionMask(direction)) !== 0) {
        directions.push(direction);
      }
    }

    return directions;
  }

  private hasPointDirection(lookup: PointDirectionLookup, x: number, y: number): boolean {
    return lookup.get(x)?.has(y) ?? false;
  }

  private getPointDirectionMask(lookup: PointDirectionLookup, x: number, y: number): number {
    return lookup.get(x)?.get(y) ?? 0;
  }

  private setPointDirectionMask(lookup: PointDirectionLookup, x: number, y: number, mask: number) {
    const column = lookup.get(x);
    if (column) {
      column.set(y, mask);
      return;
    }

    lookup.set(x, new Map([[y, mask]]));
  }

  private toCellIndex(x: number, y: number, searchContext: SearchContext): number {
    return (x - searchContext.minX) * searchContext.height + (y - searchContext.minY);
  }

  private segmentTouchesParallelWire(a: Coordinate, b: Coordinate): boolean {
    if (a[0] === b[0]) {
      const spans = this.workspace.wireIndex.vertical.get(a[0]);
      if (!spans) return false;

      const top = Math.min(a[1], b[1]);
      const bottom = Math.max(a[1], b[1]);
      for (const span of spans) {
        const overlapTop = Math.max(top, span.start);
        const overlapBottom = Math.min(bottom, span.end);
        if (overlapTop > overlapBottom) {
          continue;
        }

        if (overlapTop < overlapBottom) {
          return true;
        }

        if (!this.allowParallelEndpointTouch([a[0], overlapTop], a, b, span.start, span.end, true)) {
          return true;
        }
      }
      return false;
    }

    if (a[1] === b[1]) {
      const spans = this.workspace.wireIndex.horizontal.get(a[1]);
      if (!spans) return false;

      const left = Math.min(a[0], b[0]);
      const right = Math.max(a[0], b[0]);
      for (const span of spans) {
        const overlapLeft = Math.max(left, span.start);
        const overlapRight = Math.min(right, span.end);
        if (overlapLeft > overlapRight) {
          continue;
        }

        if (overlapLeft < overlapRight) {
          return true;
        }

        if (!this.allowParallelEndpointTouch([overlapLeft, a[1]], a, b, span.start, span.end, false)) {
          return true;
        }
      }
    }

    return false;
  }

  private allowParallelEndpointTouch(
    touchPoint: Coordinate,
    a: Coordinate,
    b: Coordinate,
    spanStart: number,
    spanEnd: number,
    verticalSegment: boolean,
  ): boolean {
    if (!this.samePoint(touchPoint, a) && !this.samePoint(touchPoint, b)) {
      return false;
    }

    if (verticalSegment) {
      return touchPoint[1] === spanStart || touchPoint[1] === spanEnd;
    }

    return touchPoint[0] === spanStart || touchPoint[0] === spanEnd;
  }

  private getWireDirectionMask(point: Coordinate): number {
    let mask = 0;
    const horizontal = this.workspace.wireIndex.horizontal.get(point[1]);
    if (horizontal) {
      for (const span of horizontal) {
        if (point[0] >= span.start && point[0] <= span.end) {
          mask |= this.directionMask(0) | this.directionMask(1);
        }
      }
    }

    const vertical = this.workspace.wireIndex.vertical.get(point[0]);
    if (vertical) {
      for (const span of vertical) {
        if (point[1] >= span.start && point[1] <= span.end) {
          mask |= this.directionMask(2) | this.directionMask(3);
        }
      }
    }

    return mask;
  }

  private sortDirectionsByReference(
    directions: number[],
    point: Coordinate,
    referencePoint: Coordinate,
  ): number[] {
    const dx = referencePoint[0] - point[0];
    const dy = referencePoint[1] - point[1];
    const preferredOrder = Math.abs(dx) >= Math.abs(dy)
      ? [dx >= 0 ? 0 : 1, dx >= 0 ? 1 : 0, dy >= 0 ? 2 : 3, dy >= 0 ? 3 : 2]
      : [dy >= 0 ? 2 : 3, dy >= 0 ? 3 : 2, dx >= 0 ? 0 : 1, dx >= 0 ? 1 : 0];

    return directions.slice().sort((a, b) => preferredOrder.indexOf(a) - preferredOrder.indexOf(b));
  }

  private getPortalStepLimit(start: Coordinate, end: Coordinate, grid: number): number {
    const directDistance = this.manhattan(start[0], start[1], end[0], end[1]);
    const directSteps = Math.ceil(directDistance / grid);
    return Math.max(BASE_MAX_PORTAL_STEPS, directSteps + SEARCH_MARGIN);
  }

  private getIterationLimit(stateCount: number): number {
    return Math.max(BASE_MAX_ITERATIONS, Math.min(MAX_ITERATIONS_HARD_CAP, stateCount * 2));
  }

  private getNearbyWireConnectionPoints(point: Coordinate, grid: number): Coordinate[] {
    const candidates: Coordinate[] = [];
    const seen = new Set<string>();
    const maxDistance = grid * MAX_NEARBY_WIRE_SEARCH_STEPS;

    const addCandidate = (x: number, y: number) => {
      if (x === point[0] && y === point[1]) return;
      const key = `${x}:${y}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push([x, y]);
    };

    const horizontal = this.workspace.wireIndex.horizontal.get(point[1]);
    if (horizontal) {
      for (const span of horizontal) {
        if (point[0] < span.start || point[0] > span.end) continue;

        for (let offset = grid; offset <= maxDistance; offset += grid) {
          const left = point[0] - offset;
          const right = point[0] + offset;
          if (left >= span.start) addCandidate(left, point[1]);
          if (right <= span.end) addCandidate(right, point[1]);
          if (left < span.start && right > span.end) break;
        }
      }
    }

    const vertical = this.workspace.wireIndex.vertical.get(point[0]);
    if (vertical) {
      for (const span of vertical) {
        if (point[1] < span.start || point[1] > span.end) continue;

        for (let offset = grid; offset <= maxDistance; offset += grid) {
          const up = point[1] - offset;
          const down = point[1] + offset;
          if (up >= span.start) addCandidate(point[0], up);
          if (down <= span.end) addCandidate(point[0], down);
          if (up < span.start && down > span.end) break;
        }
      }
    }

    return candidates;
  }
}