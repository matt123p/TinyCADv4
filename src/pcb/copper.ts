import type { CopperLayer } from './board';
import { capsulePolygon, MAX_CONTOUR_VERTICES, polygonBoundariesMeet } from './contours';
import type { Polygon, PolygonRegion } from './contours';
import { isBoardPoint, orientation, pointInPolygon, segmentIntersectionLocation, segmentsMeet } from './geometry';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

type LayerId = CopperLayer['id'];

export interface CopperFeature {
  readonly id: string;
  readonly layerId: LayerId;
  readonly kind: 'pad' | 'track' | 'via' | 'zone' | 'tie' | 'artwork';
  readonly region: PolygonRegion;
  readonly netId?: string;
  readonly terminalId?: string;
  readonly anchor?: BoardPoint;
  readonly artworkId?: string;
}

export interface BoardDrill {
  readonly id: string;
  readonly start: BoardPoint;
  readonly end: BoardPoint;
  readonly widthNm: number;
  readonly plated: boolean;
}

// Share tessellation while the originating geometry still owns the drill.
const openingOutlines = new WeakMap<BoardDrill, {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  widthNm: number;
  region: PolygonRegion;
}>();

export function openingRegion(drill: BoardDrill): PolygonRegion {
  const { start, end, widthNm } = drill;
  const cached = openingOutlines.get(drill);
  if (cached && cached.widthNm === widthNm &&
      Object.is(cached.startX, start?.x) && Object.is(cached.startY, start?.y) &&
      Object.is(cached.endX, end?.x) && Object.is(cached.endY, end?.y))
    return cached.region;
  const region: PolygonRegion = { outer: capsulePolygon(start, end, widthNm), holes: [] };
  openingOutlines.set(drill, {
    startX: start.x, startY: start.y, endX: end.x, endY: end.y, widthNm, region,
  });
  return region;
}

export interface AssemblyLink {
  readonly kind: 'jumper' | 'internal-equivalence';
  readonly terminals: readonly [string, string];
  readonly source: string;
  readonly fitted: boolean;
}

export interface CopperNetTie {
  readonly featureId: string;
  readonly terminals: readonly [string, string];
}

interface Fragment {
  readonly feature: CopperFeature;
  readonly id: string;
  readonly region: PolygonRegion;
  readonly bounds: readonly [number, number, number, number];
}

function locate(point: BoardPoint, region: PolygonRegion) {
  const outer = pointInPolygon(point, region.outer);
  if (outer !== 'inside') return outer;
  for (const hole of region.holes) {
    const location = pointInPolygon(point, hole);
    if (location === 'inside') return 'outside';
    if (location === 'boundary') return 'boundary';
  }
  return 'inside';
}

function boundsOf({ outer }: PolygonRegion): Fragment['bounds'] {
  let left = Infinity,
    bottom = Infinity,
    right = -Infinity,
    top = -Infinity;
  for (let i = 0; i < outer.length; i++) {
    const { x, y } = outer[i];
    left = Math.min(left, x);
    bottom = Math.min(bottom, y);
    right = Math.max(right, x);
    top = Math.max(top, y);
  }
  return [left, bottom, right, top];
}

function boundsMeet(a: Fragment['bounds'], b: Fragment['bounds']): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

function boundariesMeet(a: PolygonRegion, b: PolygonRegion): boolean {
  const bRings = [b.outer, ...b.holes];
  return [a.outer, ...a.holes].some((first) =>
    bRings.some((second) => polygonBoundariesMeet(first, second)),
  );
}

export function regionsTouch(a: PolygonRegion, b: PolygonRegion): boolean {
  return boundsMeet(boundsOf(a), boundsOf(b)) && regionsTouchWithinBounds(a, b);
}

function regionsTouchWithinBounds(a: PolygonRegion, b: PolygonRegion): boolean {
  return locate(a.outer[0], b) !== 'outside' ||
    locate(b.outer[0], a) !== 'outside' || boundariesMeet(a, b);
}

function isolatedBoundaryContact(a: PolygonRegion, b: PolygonRegion): BoardPoint | undefined {
  let point: BoardPoint | undefined;
  for (const first of [a.outer, ...a.holes]) {
    for (const second of [b.outer, ...b.holes]) {
      for (let i = 0; i < first.length; i++) {
        const start = first[i];
        const end = first[(i + 1) % first.length];
        for (let j = 0; j < second.length; j++) {
          const other = second[j];
          const otherEnd = second[(j + 1) % second.length];
          if (!segmentsMeet(start, end, other, otherEnd)) continue;
          if (orientation(start, end, other) === 0 &&
              orientation(start, end, otherEnd) === 0) {
            const axis = start.x === end.x ? 'y' : 'x';
            const upper = Math.min(Math.max(start[axis], end[axis]), Math.max(other[axis], otherEnd[axis]));
            const lower = Math.max(Math.min(start[axis], end[axis]), Math.min(other[axis], otherEnd[axis]));
            if (upper > lower) return undefined;
          }
          point ??= segmentIntersectionLocation(start, end, other, otherEnd);
        }
      }
    }
  }
  return point;
}

class CopperSets {
  private readonly parent: number[];

  constructor(length: number) {
    this.parent = Array.from({ length }, (_, index) => index);
  }

  root(index: number): number {
    while (this.parent[index] !== index) {
      this.parent[index] = this.parent[this.parent[index]];
      index = this.parent[index];
    }
    return index;
  }

  join(i: number, j: number): void {
    const a = this.root(i);
    const b = this.root(j);
    this.parent[Math.max(a, b)] = Math.min(a, b);
  }
}

type Pair = readonly [number, number];

function reportIslands(fragments: readonly Fragment[], sets: CopperSets) {
  const islands = new Map<number, Fragment[]>();
  fragments.forEach((fragment, index) => {
    const root = sets.root(index);
    const island = islands.get(root) ?? [];
    island.push(fragment);
    islands.set(root, island);
  });
  return [...islands.values()];
}

// A convex ring has two monotone chains along a lexicographic sweep.
function isConvexRing(ring: Polygon): boolean {
  if (ring.length < 3 || ring.length > MAX_CONTOUR_VERTICES ||
      !ring.every(isBoardPoint)) return false;
  let turn = 0;
  let chainEnds = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const c = ring[(i + 2) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Let the kernel handle its small-triangle cleanup near coincident vertices.
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return false;
    const ab = dx || dy;
    const bc = c.x - b.x || c.y - b.y;
    if ((ab > 0) !== (bc > 0)) chainEnds++;
    const side = orientation(a, b, c);
    if (!side) continue;
    if (turn && side !== turn) return false;
    turn = side;
  }
  return turn !== 0 && chainEnds === 2;
}

function extractCopper(
  kernel: PolygonKernel,
  features: readonly CopperFeature[],
  drills: readonly BoardDrill[],
  collectContactDetails: boolean,
) {
  if (features.length > 4_096 || drills.length > 512)
    throw new Error('Copper extraction exceeds the board job limits.');
  if (
    new Set(features.map(({ id }) => id)).size !== features.length ||
    features.some(({ id }) => !id || id.includes('/'))
  ) {
    throw new Error(
      'Copper feature IDs must be unique and may not contain a slash.',
    );
  }
  const holes = drills.map((drill) => {
    const region = openingRegion(drill);
    return { drill, region, bounds: boundsOf(region) };
  });
  if (
    new Set(drills.map(({ id }) => id)).size !== drills.length ||
    drills.some(({ id, plated }) => !id || typeof plated !== 'boolean')
  ) {
    throw new Error('Drill IDs and plating must be explicit.');
  }
  for (let i = 0; i < holes.length; i++) {
    const first = holes[i];
    for (let j = i + 1; j < holes.length; j++) {
      const second = holes[j];
      if (!boundsMeet(first.bounds, second.bounds) ||
          !regionsTouchWithinBounds(first.region, second.region)) continue;
      throw new Error(
        'Intersecting drill or slot voids are outside the G0 extraction subset.',
      );
    }
  }
  const fragments: Fragment[] = [];
  const noCutters: readonly PolygonRegion[] = [];
  for (const feature of [...features].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (feature.terminalId && (feature.kind !== 'pad' || !feature.netId))
      throw new Error('A terminal needs a pad and intended net.');
    const bounds = boundsOf(feature.region);
    let cutters: PolygonRegion[] | undefined;
    for (let index = 0; index < holes.length; index++) {
      const hole = holes[index];
      if (boundsMeet(bounds, hole.bounds)) (cutters ??= []).push(hole.region);
    }
    if (!collectContactDetails && !cutters &&
        !feature.region.holes.length && isConvexRing(feature.region.outer)) {
      fragments.push({ feature, id: `${feature.id}/0`, region: feature.region, bounds });
    } else {
      const copper = (collectContactDetails && !cutters
        ? kernel.normaliseUncut?.(feature.region)
        : undefined) ?? kernel.boolean('difference', [feature.region], cutters ?? noCutters);
      copper.forEach((region, index) =>
        fragments.push({
          feature,
          id: `${feature.id}/${index}`,
          region,
          bounds: boundsOf(region),
        }),
      );
    }
    if (fragments.length > 8_192)
      throw new Error('Copper extraction exceeds the fragment limit.');
  }
  const netByTerminal = new Map<string, string>();
  for (const { terminalId, netId } of features) {
    if (!terminalId) continue;
    if (
      netByTerminal.has(terminalId) &&
      netByTerminal.get(terminalId) !== netId
    )
      throw new Error('Conflicting terminal nets.');
    netByTerminal.set(terminalId, netId);
  }
  const physical = new CopperSets(fragments.length);
  const pairs: Pair[] = [];
  const boundaryOnlyContacts: [string, string][] = [];
  const pointContacts = new Map<Pair, {
    fragments: [string, string];
    netId: string;
    location: BoardPoint;
  }>();
  const platedTies = new Set<string>();
  let candidates = 0;
  for (const layer of ['top', 'bottom']) {
    const ordered: { fragment: Fragment; index: number }[] = [];
    for (let index = 0; index < fragments.length; index++) {
      const fragment = fragments[index];
      if (fragment.feature.layerId === layer) ordered.push({ fragment, index });
    }
    ordered.sort((a, b) => a.fragment.bounds[0] - b.fragment.bounds[0] || a.index - b.index);
    for (let i = 0; i < ordered.length; i++) {
      const { fragment: a, index: ai } = ordered[i];
      for (let j = i + 1; j < ordered.length; j++) {
        const { fragment: b, index: bi } = ordered[j];
        if (a.bounds[2] < b.bounds[0]) break;
        if (!boundsMeet(a.bounds, b.bounds)) continue;
        candidates++;
        if (candidates > 400_000)
          throw new Error(
            'Copper extraction exceeds the contact candidate budget.',
          );
        if (!regionsTouchWithinBounds(a.region, b.region)) continue;
        physical.join(ai, bi);
        if (!collectContactDetails) continue;
        const first = Math.min(ai, bi);
        const second = Math.max(ai, bi);
        const pair: Pair = [first, second];
        pairs.push(pair);
        const hasArea = kernel.intersectionHasArea?.([a.region], [b.region]) ??
          (kernel.boolean('intersection', [a.region], [b.region]).length > 0);
        if (!hasArea) {
          const contact: [string, string] = [fragments[first].id, fragments[second].id];
          boundaryOnlyContacts.push(contact);
          const { netId } = a.feature;
          if (netId && netId === b.feature.netId) {
            const location = isolatedBoundaryContact(a.region, b.region);
            if (location) pointContacts.set(pair, { fragments: contact, netId, location });
          }
        }
      }
    }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  boundaryOnlyContacts.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  const touching: number[] = [];
  for (const { drill, region, bounds: drillBounds } of holes) {
    if (!drill.plated) continue;
    touching.length = 0;
    let ordinary: number | undefined;
    for (let index = 0; index < fragments.length; index++) {
      const fragment = fragments[index];
      if (!boundsMeet(fragment.bounds, drillBounds) || !boundariesMeet(fragment.region, region)) continue;
      touching.push(index);
      if (fragment.feature.kind !== 'tie') ordinary ??= index;
    }
    const anchor = ordinary ?? touching[0];
    for (const index of touching) {
      if (collectContactDetails && fragments[index].feature.kind === 'tie')
        platedTies.add(fragments[index].feature.id);
      if (index === anchor) continue;
      physical.join(anchor, index);
      if (collectContactDetails) pairs.push([anchor, index]);
    }
  }
  return { fragments, netByTerminal, physical, pairs, boundaryOnlyContacts, pointContacts, platedTies };
}

/** Physical islands for consumers that only need to know which copper is joined. */
export function connectedCopperIslands(
  kernel: PolygonKernel,
  features: readonly CopperFeature[],
  drills: readonly BoardDrill[],
) {
  const { fragments, physical } = extractCopper(kernel, features, drills, false);
  return reportIslands(fragments, physical);
}

/** Uses the same clipped copper regions for contact, plated barrels and diagnosis. */
export function analyseCopper(
  kernel: PolygonKernel,
  features: readonly CopperFeature[],
  drills: readonly BoardDrill[],
  assemblyLinks: readonly AssemblyLink[] = [],
  ties: readonly CopperNetTie[] = [],
) {
  const { fragments, netByTerminal, physical, pairs, boundaryOnlyContacts, pointContacts, platedTies } =
    extractCopper(kernel, features, drills, true);
  const hasTies = features.some(({ kind }) => kind === 'tie');
  // Only a physical net tie can make the bare-copper graph differ here.
  const withoutTies = hasTies ? new CopperSets(fragments.length) : physical;
  const assembled = assemblyLinks.some(({ fitted }) => fitted) ? new CopperSets(fragments.length) : undefined;
  const withoutPointContacts = pointContacts.size ? new CopperSets(fragments.length) : undefined;
  const tiePairs: Pair[] = [];
  if (hasTies || assembled || withoutPointContacts) {
    for (const pair of pairs) {
      const [a, b] = pair;
      if (fragments[a].feature.kind === 'tie' || fragments[b].feature.kind === 'tie') {
        tiePairs.push(pair);
      } else {
        if (hasTies) withoutTies.join(a, b);
        assembled?.join(a, b);
        if (withoutPointContacts && !pointContacts.has(pair)) withoutPointContacts.join(a, b);
      }
    }
  }

  const islands = reportIslands(fragments, withoutTies);
  const fragmentsByTerminal = new Map<string, number[]>();
  const netsByRoot = new Map<number, Set<string>>();
  fragments.forEach(({ feature }, index) => {
    const { terminalId, netId } = feature;
    if (terminalId) {
      const indices = fragmentsByTerminal.get(terminalId);
      if (indices) indices.push(index);
      else fragmentsByTerminal.set(terminalId, [index]);
    }
    if (hasTies && netId) {
      const root = withoutTies.root(index);
      const nets = netsByRoot.get(root) ?? new Set<string>();
      nets.add(netId);
      netsByRoot.set(root, nets);
    }
  });
  const invalidTies: string[] = [];
  for (const feature of features.filter(({ kind }) => kind === 'tie')) {
    const declarations = ties.filter(
      ({ featureId }) => featureId === feature.id,
    );
    const tieIndices = fragments.flatMap((fragment, index) =>
      fragment.feature.id === feature.id ? [index] : [],
    );
    if (
      declarations.length !== 1 ||
      tieIndices.length !== 1 ||
      platedTies.has(feature.id)
    ) {
      invalidTies.push(feature.id);
      continue;
    }
    const [tieIndex] = tieIndices;
    const [a, b] = declarations[0].terminals;
    const aNet = netByTerminal.get(a);
    const bNet = netByTerminal.get(b);
    const aRoots = new Set(
      (fragmentsByTerminal.get(a) ?? []).map((index) =>
        withoutTies.root(index),
      ),
    );
    const bRoots = new Set(
      (fragmentsByTerminal.get(b) ?? []).map((index) =>
        withoutTies.root(index),
      ),
    );
    const touches = tiePairs.flatMap(([i, j]) =>
      i === tieIndex ? [j] : j === tieIndex ? [i] : [],
    );
    const roots = [...new Set(touches.map((index) => withoutTies.root(index)))];
    const onlyNet = (root: number, net: string) =>
      netsByRoot.get(root)?.size === 1 && netsByRoot.get(root).has(net);
    if (
      !aNet ||
      !bNet ||
      aNet === bNet ||
      roots.length !== 2 ||
      !roots.some((root) => aRoots.has(root) && onlyNet(root, aNet)) ||
      !roots.some((root) => bRoots.has(root) && onlyNet(root, bNet))
    )
      invalidTies.push(feature.id);
  }
  for (const tie of ties) {
    if (
      !features.some(({ id, kind }) => id === tie.featureId && kind === 'tie')
    )
      invalidTies.push(tie.featureId);
  }
  for (const link of assemblyLinks) {
    const [a, b] = link.terminals;
    if (
      a === b ||
      !netByTerminal.get(a) ||
      netByTerminal.get(a) !== netByTerminal.get(b) ||
      !link.source.trim()
    ) {
      throw new Error(
        'An assembly link needs reviewed, distinct terminals on the same intended net.',
      );
    }
    if (!link.fitted || !assembled) continue;
    const anchors = [
      ...(fragmentsByTerminal.get(a) ?? []),
      ...(fragmentsByTerminal.get(b) ?? []),
    ];
    if (!fragmentsByTerminal.has(a) || !fragmentsByTerminal.has(b)) continue;
    for (const index of anchors.slice(1)) assembled.join(anchors[0], index);
  }
  const opens = (sets: CopperSets) => {
    const nets = new Map<string, Map<number, string[]>>();
    const missing = new Set<string>();
    for (const [terminal, net] of netByTerminal) {
      const indices = fragmentsByTerminal.get(terminal) ?? [];
      if (!indices.length) missing.add(terminal);
      const roots = nets.get(net) ?? new Map<number, string[]>();
      for (const root of new Set(indices.map((index) => sets.root(index)))) {
        const terminals = roots.get(root);
        if (terminals) terminals.push(terminal);
        else roots.set(root, [terminal]);
      }
      nets.set(net, roots);
    }
    return {
      nets: [...nets].flatMap(([netId, roots]) =>
        roots.size > 1 ? [{ netId, terminalGroups: [...roots.values()] }] : [],
      ),
      missingTerminals: [...missing].sort(),
    };
  };
  const bareOpens = opens(withoutTies);
  const assembledOpens = assembled ? opens(assembled) : {
    nets: bareOpens.nets.map(({ netId, terminalGroups }) => ({
      netId, terminalGroups: terminalGroups.map((group) => [...group]),
    })),
    missingTerminals: [...bareOpens.missingTerminals],
  };
  return {
    copper: fragments,
    connectedSets: (hasTies ? reportIslands(fragments, physical) : islands).map((island) =>
      island.map(({ id }) => id),
    ),
    shorts: islands.flatMap((island) => {
      const netIds = [
        ...new Set(
          island.flatMap(({ feature }) =>
            feature.netId ? [feature.netId] : [],
          ),
        ),
      ].sort();
      return netIds.length > 1
        ? [{ netIds, fragments: island.map(({ id }) => id) }]
        : [];
    }),
    bareOpens,
    assembledOpens,
    floatingFragments: islands.flatMap((island) =>
      island.some(({ feature }) => feature.terminalId)
        ? []
        : island
            .filter(
              ({ feature }) =>
                feature.kind === 'track' || feature.kind === 'via' || feature.kind === 'zone',
            )
            .map(({ id }) => id),
    ),
    invalidTies: [...new Set(invalidTies)].sort(),
    boundaryOnlyContacts,
    fragileContacts: withoutPointContacts
      ? [...pointContacts].flatMap(([[a, b], contact]) =>
          withoutPointContacts.root(a) !== withoutPointContacts.root(b) ? [contact] : [])
      : [],
  };
}
