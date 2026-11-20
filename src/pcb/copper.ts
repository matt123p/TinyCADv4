import type { CopperLayer } from './board';
import { capsulePolygon, polygonBoundariesMeet } from './contours';
import type { PolygonRegion } from './contours';
import { pointInPolygon } from './geometry';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

type LayerId = CopperLayer['id'];

export interface CopperFeature {
  readonly id: string;
  readonly layerId: LayerId;
  readonly kind: 'pad' | 'track' | 'zone' | 'tie';
  readonly region: PolygonRegion;
  readonly netId?: string;
  readonly terminalId?: string;
}

export interface BoardDrill {
  readonly id: string;
  readonly start: BoardPoint;
  readonly end: BoardPoint;
  readonly widthNm: number;
  readonly plated: boolean;
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

function boundsOf(region: PolygonRegion): Fragment['bounds'] {
  let left = Infinity,
    bottom = Infinity,
    right = -Infinity,
    top = -Infinity;
  for (const point of region.outer) {
    left = Math.min(left, point.x);
    bottom = Math.min(bottom, point.y);
    right = Math.max(right, point.x);
    top = Math.max(top, point.y);
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
  return (
    boundsMeet(boundsOf(a), boundsOf(b)) &&
    (locate(a.outer[0], b) !== 'outside' ||
      locate(b.outer[0], a) !== 'outside' ||
      boundariesMeet(a, b))
  );
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

/** Uses the same clipped copper regions for contact, plated barrels and diagnosis. */
export function analyseCopper(
  kernel: PolygonKernel,
  features: readonly CopperFeature[],
  drills: readonly BoardDrill[],
  assemblyLinks: readonly AssemblyLink[] = [],
  ties: readonly CopperNetTie[] = [],
) {
  if (features.length > 1_024 || drills.length > 256)
    throw new Error('Copper extraction exceeds the G0 job limits.');
  if (
    new Set(features.map(({ id }) => id)).size !== features.length ||
    features.some(({ id }) => !id || id.includes('/'))
  ) {
    throw new Error(
      'Copper feature IDs must be unique and may not contain a slash.',
    );
  }
  const holes = drills.map(
    (drill): { drill: BoardDrill; region: PolygonRegion } => ({
      drill,
      region: {
        outer: capsulePolygon(drill.start, drill.end, drill.widthNm),
        holes: [],
      },
    }),
  );
  if (
    new Set(drills.map(({ id }) => id)).size !== drills.length ||
    drills.some(({ id, plated }) => !id || typeof plated !== 'boolean')
  ) {
    throw new Error('Drill IDs and plating must be explicit.');
  }
  for (let i = 0; i < holes.length; i++) {
    if (
      holes
        .slice(i + 1)
        .some(({ region }) => regionsTouch(holes[i].region, region))
    ) {
      throw new Error(
        'Intersecting drill or slot voids are outside the G0 extraction subset.',
      );
    }
  }
  const fragments: Fragment[] = [];
  for (const feature of [...features].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    if (feature.terminalId && (feature.kind !== 'pad' || !feature.netId))
      throw new Error('A terminal needs a pad and intended net.');
    const bounds = boundsOf(feature.region);
    const cutters = holes
      .filter(({ region }) => boundsMeet(bounds, boundsOf(region)))
      .map(({ region }) => region);
    const copper = kernel.boolean('difference', [feature.region], cutters);
    copper.forEach((region, index) =>
      fragments.push({
        feature,
        id: `${feature.id}/${index}`,
        region,
        bounds: boundsOf(region),
      }),
    );
    if (fragments.length > 2_048)
      throw new Error('Copper extraction exceeds the G0 fragment limit.');
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
  const pairs: Pair[] = [];
  const boundaryOnlyContacts: [string, string][] = [];
  const platedTies = new Set<string>();
  for (let i = 0; i < fragments.length; i++) {
    const a = fragments[i];
    for (let j = i + 1; j < fragments.length; j++) {
      const b = fragments[j];
      if (
        a.feature.layerId !== b.feature.layerId ||
        !boundsMeet(a.bounds, b.bounds) ||
        !regionsTouch(a.region, b.region)
      )
        continue;
      pairs.push([i, j]);
      if (!kernel.boolean('intersection', [a.region], [b.region]).length)
        boundaryOnlyContacts.push([a.id, b.id]);
    }
  }
  for (const { drill, region } of holes) {
    if (!drill.plated) continue;
    const drillBounds = boundsOf(region);
    const touching = fragments.flatMap(({ region: copper, bounds }, index) =>
      boundsMeet(bounds, drillBounds) && boundariesMeet(copper, region)
        ? [index]
        : [],
    );
    const ordinary = touching.filter(
      (index) => fragments[index].feature.kind !== 'tie',
    );
    const anchor = ordinary[0] ?? touching[0];
    for (const index of touching) {
      if (fragments[index].feature.kind === 'tie')
        platedTies.add(fragments[index].feature.id);
      if (index !== anchor) pairs.push([anchor, index]);
    }
  }

  const physical = new CopperSets(fragments.length);
  const withoutTies = new CopperSets(fragments.length);
  const assembled = new CopperSets(fragments.length);
  const tiePairs: Pair[] = [];
  for (const [a, b] of pairs) {
    physical.join(a, b);
    if (
      fragments[a].feature.kind === 'tie' ||
      fragments[b].feature.kind === 'tie'
    ) {
      tiePairs.push([a, b]);
    } else {
      withoutTies.join(a, b);
      assembled.join(a, b);
    }
  }

  const islands = reportIslands(fragments, withoutTies);
  const fragmentsByTerminal = new Map<string, number[]>();
  const netsByRoot = new Map<number, Set<string>>();
  fragments.forEach(({ feature }, index) => {
    const { terminalId, netId } = feature;
    if (terminalId)
      fragmentsByTerminal.set(terminalId, [
        ...(fragmentsByTerminal.get(terminalId) ?? []),
        index,
      ]);
    const root = withoutTies.root(index);
    if (netId) {
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
    if (!link.fitted) continue;
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
        roots.set(root, [...(roots.get(root) ?? []), terminal]);
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
  return {
    copper: fragments,
    connectedSets: reportIslands(fragments, physical).map((island) =>
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
    bareOpens: opens(withoutTies),
    assembledOpens: opens(assembled),
    floatingFragments: islands.flatMap((island) =>
      island.some(({ feature }) => feature.terminalId)
        ? []
        : island
            .filter(
              ({ feature }) =>
                feature.kind === 'track' || feature.kind === 'zone',
            )
            .map(({ id }) => id),
    ),
    invalidTies: [...new Set(invalidTies)].sort(),
    boundaryOnlyContacts,
  };
}
