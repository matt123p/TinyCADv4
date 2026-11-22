import type { BoardDocument, CopperLayer } from './board';
import { boardCopperGeometry } from './boardCopperGeometry';
import type { BoardTrack, BoardVia } from './boardRouting';
import { capsulePolygon } from './contours';
import type { PolygonRegion } from './contours';
import { regionsTouch } from './copper';
import { isBoardPoint, orientation } from './geometry';
import type { BoardPoint } from './geometry';

export type RouteDeletionScope =
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'items'; readonly ids: readonly string[] }
  | { readonly kind: 'net'; readonly netId: string }
  | {
      readonly kind: 'connection';
      readonly trackId: string;
      readonly picked?: BoardPoint;
    }
  | {
      readonly kind: 'region';
      readonly start: BoardPoint;
      readonly end: BoardPoint;
      readonly layer: CopperLayer['id'] | 'all';
    };

export interface RouteDeletionPlan {
  readonly source: BoardDocument;
  readonly tracks: readonly BoardTrack[];
  readonly vias: readonly BoardVia[];
  readonly remaining: ReadonlyMap<string, readonly BoardTrack[]>;
}

type TrackEdge = { readonly kind: 'track'; readonly track: BoardTrack };
type ViaEdge = { readonly kind: 'via'; readonly via: BoardVia };
type Junction = { readonly edges: RouteEdge[]; stop: boolean };
type RouteEdge = (TrackEdge | ViaEdge) & {
  readonly from: Junction;
  readonly to: Junction;
};

function onTrack(point: BoardPoint, track: BoardTrack) {
  const { start, end } = track;
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y) &&
    orientation(start, end, point) === 0
  );
}

function alongTrack(track: BoardTrack, point: BoardPoint) {
  return (
    (point.x - track.start.x) * (track.end.x - track.start.x) +
    (point.y - track.start.y) * (track.end.y - track.start.y)
  );
}

export function routeDeletionBounds(start: BoardPoint, end: BoardPoint) {
  return {
    minX: Math.min(start.x, end.x),
    maxX: Math.max(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxY: Math.max(start.y, end.y),
  };
}

function trackRegion(
  start: BoardPoint,
  end: BoardPoint,
  widthNm: number,
): PolygonRegion {
  return { outer: capsulePolygon(start, end, widthNm), holes: [] };
}

function connectionDeletion(
  board: BoardDocument,
  scope: Extract<RouteDeletionScope, { kind: 'connection' }>,
  includeLocked = false,
): RouteDeletionPlan {
  const seed = board.tracks?.find(({ id }) => id === scope.trackId);
  if (!seed?.netId) throw new Error('Choose a track assigned to a PCB net.');
  if (seed.locked && !includeLocked) throw new Error('Unlock this track before deleting it.');
  const sameNet = (item: { netId?: string }) => item.netId === seed.netId;
  const tracks = board.tracks.filter(sameNet);
  const vias = (board.vias ?? []).filter(sameNet);
  const junctions = new Map<string, Junction>();
  const key = (layer: CopperLayer['id'], point: BoardPoint) =>
    layer + ':' + point.x + ',' + point.y;
  function junction(layer: CopperLayer['id'], point: BoardPoint) {
    const id = key(layer, point);
    const current = junctions.get(id) ?? { edges: [], stop: false };
    junctions.set(id, current);
    return current;
  }
  function join<T extends TrackEdge | ViaEdge>(
    from: Junction,
    to: Junction,
    object: T,
  ) {
    const edge = { ...object, from, to };
    from.edges.push(edge);
    to.edges.push(edge);
    return edge;
  }

  const geometry = boardCopperGeometry(board, { includeApertures: false });
  const anchors = geometry.features.filter(
    (feature) =>
      feature.netId === seed.netId && !geometry.owners.has(feature.id),
  );
  const endpoints = tracks.flatMap(({ layerId, start, end }) => [
    { layerId, point: start },
    { layerId, point: end },
  ]);
  for (const via of vias)
    for (const { id: layerId } of board.copperLayers)
      endpoints.push({ layerId, point: via.positionNm });
  for (const { layerId, anchor } of anchors)
    if (anchor) endpoints.push({ layerId, point: anchor });

  const pieces = new Map(
    tracks.map((track) => {
      const points = new Map<string, BoardPoint>();
      for (const { layerId, point } of endpoints)
        if (layerId === track.layerId && onTrack(point, track))
          points.set(key(layerId, point), point);
      const ordered = [...points.values()].sort(
        (a, b) => alongTrack(track, a) - alongTrack(track, b),
      );
      return [
        track.id,
        ordered.slice(1).map((end, index) => {
          const start = ordered[index];
          return join(
            junction(track.layerId, start),
            junction(track.layerId, end),
            { kind: 'track', track: { ...track, start, end } },
          );
        }),
      ];
    }),
  );

  for (const via of vias)
    join(junction('top', via.positionNm), junction('bottom', via.positionNm), {
      kind: 'via',
      via,
    });

  // Pads, jumpers and connections through off-centre copper contacts bound a
  // deletion. Following only explicit centreline junctions avoids taking a
  // neighbouring branch along with the selected run.
  const edges = [...pieces.values()].flat();
  const regions = edges.map((edge) => {
    const { start, end, layerId, widthNm, id } = edge.track;
    const box = routeDeletionBounds(start, end);
    const radius = Math.ceil(widthNm / 2);
    return {
      edge,
      id,
      layerId,
      box: {
        minX: box.minX - radius,
        maxX: box.maxX + radius,
        minY: box.minY - radius,
        maxY: box.maxY + radius,
      },
      region: trackRegion(start, end, widthNm),
    };
  });
  for (const { edge, layerId, region } of regions) {
    for (const anchor of anchors) {
      if (layerId !== anchor.layerId || !regionsTouch(region, anchor.region))
        continue;
      const { start, end, widthNm } = edge.track;
      const first = regionsTouch(
        trackRegion(start, start, widthNm),
        anchor.region,
      );
      const last = regionsTouch(trackRegion(end, end, widthNm), anchor.region);
      if (first || !last) edge.from.stop = true;
      if (last || !first) edge.to.stop = true;
    }
  }
  const viasById = new Map(vias.map((via) => [via.id, via]));
  for (const { id, layerId, region } of geometry.features) {
    const via = viasById.get(geometry.owners.get(id));
    if (!via) continue;
    const node = junction(layerId, via.positionNm);
    if (
      anchors.some(
        (anchor) =>
          anchor.layerId === layerId && regionsTouch(region, anchor.region),
      )
    )
      node.stop = true;
    for (const piece of regions) {
      if (
        piece.layerId !== layerId ||
        piece.edge.from === node ||
        piece.edge.to === node ||
        !regionsTouch(region, piece.region)
      )
        continue;
      node.stop = piece.edge.from.stop = piece.edge.to.stop = true;
    }
  }
  for (const [index, left] of regions.entries()) {
    for (let i = index + 1; i < regions.length; i++) {
      const right = regions[i];
      if (
        left.id === right.id ||
        left.layerId !== right.layerId ||
        left.box.minX > right.box.maxX ||
        right.box.minX > left.box.maxX ||
        left.box.minY > right.box.maxY ||
        right.box.minY > left.box.maxY ||
        left.edge.from === right.edge.from ||
        left.edge.from === right.edge.to ||
        left.edge.to === right.edge.from ||
        left.edge.to === right.edge.to ||
        !regionsTouch(left.region, right.region)
      )
        continue;
      left.edge.from.stop =
        left.edge.to.stop =
        right.edge.from.stop =
        right.edge.to.stop =
          true;
    }
  }

  const seedPieces = pieces.get(seed.id);
  const pick = scope.picked ?? seed.start;
  const at = alongTrack(seed, pick);
  const chosen =
    seedPieces.find(({ track }) => at <= alongTrack(seed, track.end)) ??
    seedPieces.at(-1);
  const visited = new Set<RouteEdge>([chosen]);
  const pending: RouteEdge[] = [chosen];
  while (pending.length) {
    const edge = pending.pop();
    for (const node of [edge.from, edge.to]) {
      if (node.stop || node.edges.length !== 2) continue;
      const next = node.edges.find((entry) => entry !== edge);
      if (visited.has(next) || (!includeLocked && (next.kind === 'via' ? next.via.locked : next.track.locked))) continue;
      if (
        next.kind === 'via' &&
        [next.from, next.to].some(
          (side) => side.stop || side.edges.length !== 2,
        )
      )
        continue;
      visited.add(next);
      pending.push(next);
    }
  }

  const remaining = new Map<string, BoardTrack[]>();
  const selected: BoardTrack[] = [];
  for (const track of tracks) {
    const segments = pieces.get(track.id);
    if (!segments.some((piece) => visited.has(piece))) continue;
    const keep: BoardTrack[] = [];
    let run: BoardTrack | undefined;
    for (const segment of segments) {
      if (visited.has(segment)) {
        selected.push(segment.track);
        if (run) keep.push(run);
        run = undefined;
      } else run = run ? { ...run, end: segment.track.end } : segment.track;
    }
    if (run) keep.push(run);
    remaining.set(track.id, keep);
  }
  return {
    source: board,
    tracks: selected,
    vias: [...visited].flatMap((edge) =>
      edge.kind === 'via' ? [edge.via] : [],
    ),
    remaining,
  };
}

export function connectedRouteIds(board: BoardDocument, id: string, picked?: BoardPoint): string[] {
  const track = board.tracks?.find((track) => track.id === id);
  const via = board.vias?.find((via) => via.id === id);
  const seeds = track ? [track] : via?.netId
    ? board.tracks?.filter((track) => track.netId === via.netId && onTrack(via.positionNm, track)) ?? []
    : [];
  const selected = new Set([id]);
  for (const seed of seeds) {
    if (!seed.netId) continue;
    const route = connectionDeletion(board, { kind: 'connection', trackId: seed.id, picked }, true);
    for (const item of [...route.tracks, ...route.vias]) selected.add(item.id);
  }
  return [...selected];
}

export function planRouteDeletion(
  board: BoardDocument,
  scope: RouteDeletionScope,
): RouteDeletionPlan {
  if (scope.kind === 'connection') return connectionDeletion(board, scope);
  let tracks: BoardTrack[];
  let vias: BoardVia[];
  if (scope.kind === 'region') {
    const { start, end, layer } = scope;
    if (
      !isBoardPoint(start) ||
      !isBoardPoint(end) ||
      start.x === end.x ||
      start.y === end.y
    )
      throw new Error('Choose two opposite corners of a routed copper region.');
    if (layer !== 'all' && !board.copperLayers.some(({ id }) => id === layer))
      throw new Error('Choose a physical copper layer.');
    const { minX, maxX, minY, maxY } = routeDeletionBounds(start, end);
    const inside = (point: BoardPoint, radius: number) =>
      point.x - radius >= minX &&
      point.x + radius <= maxX &&
      point.y - radius >= minY &&
      point.y + radius <= maxY;
    tracks = (board.tracks ?? []).filter(
      (track) =>
        (layer === 'all' || track.layerId === layer) &&
        inside(track.start, track.widthNm / 2) &&
        inside(track.end, track.widthNm / 2),
    );
    vias = (board.vias ?? []).filter(({ positionNm, diameterNm }) =>
      inside(positionNm, diameterNm / 2),
    );
  } else {
    const matches = (item: { id: string; netId?: string }) =>
      scope.kind === 'item' ? scope.id === item.id :
        scope.kind === 'items' ? scope.ids.includes(item.id) : scope.netId === item.netId;
    tracks = (board.tracks ?? []).filter(matches);
    vias = (board.vias ?? []).filter(matches);
  }
  tracks = tracks.filter(({ locked }) => !locked);
  vias = vias.filter(({ locked }) => !locked);
  return {
    source: board,
    tracks,
    vias,
    remaining: new Map<string, readonly BoardTrack[]>(
      tracks.map(({ id }): [string, readonly BoardTrack[]] => [id, []]),
    ),
  };
}

export function applyRouteDeletion(
  board: BoardDocument,
  plan: RouteDeletionPlan,
): BoardDocument {
  if (plan.source !== board)
    throw new Error('The PCB changed. Preview the deletion again.');
  if (!plan.tracks.length && !plan.vias.length)
    throw new Error('No routed copper matches this deletion.');
  const vias = new Set(plan.vias.map(({ id }) => id));
  return {
    ...board,
    tracks: (board.tracks ?? []).flatMap((track) => {
      if (track.locked) return [track];
      const remaining = plan.remaining.get(track.id);
      return remaining
        ? remaining.map((piece, index) =>
            index ? { ...piece, id: crypto.randomUUID() } : piece,
          )
        : [track];
    }),
    vias: (board.vias ?? []).filter(({ id, locked }) => locked || !vias.has(id)),
  };
}
