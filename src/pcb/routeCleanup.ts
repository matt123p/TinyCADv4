import { validateBoard } from './board';
import type { BoardDocument } from './board';
import { boardCopperGeometry } from './boardCopperGeometry';
import type { BoardTrack } from './boardRouting';
import { boardZoneGeometry } from './boardZoneGeometry';
import { analyseCopper } from './copper';
import { orientation, samePoint } from './geometry';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

function between(a: BoardPoint, b: BoardPoint, c: BoardPoint) {
  return (
    orientation(a, b, c) === 0 &&
    b.x >= Math.min(a.x, c.x) &&
    b.x <= Math.max(a.x, c.x) &&
    b.y >= Math.min(a.y, c.y) &&
    b.y <= Math.max(a.y, c.y)
  );
}

export function simplifyRoutePath<
  T extends { position: BoardPoint; layer: string },
>(path: readonly T[]): T[] {
  const simplified: T[] = [];
  for (const point of path) {
    const last = simplified.at(-1);
    if (last?.layer === point.layer && samePoint(last.position, point.position))
      continue;
    const previous = simplified.at(-2);
    if (
      previous?.layer === point.layer &&
      last?.layer === point.layer &&
      between(previous.position, last.position, point.position)
    )
      simplified.pop();
    simplified.push(point);
  }
  return simplified;
}

function junctionKey(layer: string, { x, y }: BoardPoint) {
  return layer + ':' + x + ',' + y;
}

const protectedTrack = ({ locked, reviewRequired }: BoardTrack) =>
  !!locked || !!reviewRequired;

function dissolveCollinear(
  tracks: readonly BoardTrack[],
  viaKeys: ReadonlySet<string>,
) {
  const active = new Map(tracks.map((track) => [track.id, track]));
  const junctions = new Map<string, Set<string>>();
  function record(track: BoardTrack) {
    for (const point of [track.start, track.end]) {
      const key = junctionKey(track.layerId, point);
      const group = junctions.get(key) ?? new Set<string>();
      group.add(track.id);
      junctions.set(key, group);
    }
  }
  for (const track of tracks) record(track);
  let merged = 0;
  for (const [key, group] of junctions) {
    if (group.size !== 2 || viaKeys.has(key)) continue;
    const [a, b] = [...group].map((id) => active.get(id));
    if (protectedTrack(a) || protectedTrack(b) || a.widthNm !== b.widthNm)
      continue;
    const shared = junctionKey(a.layerId, a.start) === key ? a.start : a.end;
    const aEnd = samePoint(a.start, shared) ? a.end : a.start;
    const bEnd = samePoint(b.start, shared) ? b.end : b.start;
    if (samePoint(aEnd, bEnd) || !between(aEnd, shared, bEnd)) continue;

    for (const track of [a, b])
      for (const point of [track.start, track.end])
        junctions.get(junctionKey(track.layerId, point)).delete(track.id);
    const replacement = samePoint(a.end, shared)
      ? { ...a, end: bEnd }
      : { ...a, start: bEnd };
    active.set(a.id, replacement);
    active.delete(b.id);
    record(replacement);
    merged++;
  }
  return { tracks: [...active.values()], merged };
}

function removeDuplicates(tracks: readonly BoardTrack[]) {
  const retained = new Map<string, BoardTrack>();
  const extras = new Set<string>();
  // A protected copy can account for the copper of an otherwise duplicate track.
  for (const track of [
    ...tracks.filter(protectedTrack),
    ...tracks.filter((track) => !protectedTrack(track)),
  ]) {
    const ends = [
      junctionKey(track.layerId, track.start),
      junctionKey(track.layerId, track.end),
    ].sort();
    const key = [...ends, track.widthNm].join('/');
    if (retained.has(key) && !protectedTrack(track)) extras.add(track.id);
    else retained.set(key, track);
  }
  return {
    tracks: tracks.filter(({ id }) => !extras.has(id)),
    duplicates: extras.size,
  };
}

function loopTracks(
  tracks: readonly BoardTrack[],
  board: BoardDocument,
  netId: string,
): BoardTrack[] {
  const parents = new Map<string, string>();
  function root(key: string) {
    let node = key;
    while (parents.has(node)) node = parents.get(node);
    if (key !== node) parents.set(key, node);
    return node;
  }
  function join(from: string, to: string) {
    const a = root(from);
    const b = root(to);
    if (a === b) return false;
    parents.set(b, a);
    return true;
  }
  for (const via of board.vias ?? []) {
    if (via.netId === netId)
      join(
        junctionKey('top', via.positionNm),
        junctionKey('bottom', via.positionNm),
      );
  }
  const joinTrack = ({ layerId, start, end }: BoardTrack) =>
    join(junctionKey(layerId, start), junctionKey(layerId, end));
  tracks.filter(protectedTrack).forEach(joinTrack);
  const length = ({ start, end }: BoardTrack) =>
    Math.hypot(end.x - start.x, end.y - start.y);
  return tracks
    .filter((track) => !protectedTrack(track))
    .sort((a, b) => length(a) - length(b) || (a.id < b.id ? -1 : 1))
    .filter((track) => !joinTrack(track));
}

function cycleRuns(
  tracks: readonly BoardTrack[],
  loopEdges: readonly BoardTrack[],
  viaKeys: ReadonlySet<string>,
) {
  const junctions = new Map<string, BoardTrack[]>();
  for (const track of tracks) {
    for (const point of [track.start, track.end]) {
      const key = junctionKey(track.layerId, point);
      const list = junctions.get(key) ?? [];
      list.push(track);
      junctions.set(key, list);
    }
  }
  return loopEdges.map((seed) => {
    const visited = new Set([seed]);
    const pending = [seed];
    while (pending.length) {
      const edge = pending.pop();
      for (const point of [edge.start, edge.end]) {
        const key = junctionKey(edge.layerId, point);
        const neighbours = junctions.get(key);
        if (neighbours.length !== 2 || viaKeys.has(key)) continue;
        const next = neighbours.find((track) => track !== edge);
        if (visited.has(next) || protectedTrack(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
    // If there is no branch on this loop, preserve a route on the island.
    const closes = [...visited].every((track) =>
      [track.start, track.end].every((point) => {
        const key = junctionKey(track.layerId, point);
        const neighbours = junctions.get(key);
        return (
          !viaKeys.has(key) &&
          neighbours.length === 2 &&
          neighbours.every((item) => visited.has(item))
        );
      }),
    );
    return { seed, tracks: closes ? [seed] : [...visited] };
  });
}

function readTopology(board: BoardDocument, kernel: PolygonKernel) {
  const geometry = boardCopperGeometry(board, { includeApertures: false });
  const { fills } = boardZoneGeometry(board, kernel, geometry);
  return analyseCopper(
    kernel,
    [...geometry.features, ...fills],
    geometry.drills,
    geometry.assemblyLinks,
  );
}

type CopperTopology = ReturnType<typeof readTopology>;

function preservesTerminals(
  before: CopperTopology['bareOpens'],
  after: CopperTopology['bareOpens'],
) {
  const previouslyMissing = new Set(before.missingTerminals);
  if (
    after.missingTerminals.some((terminal) => !previouslyMissing.has(terminal))
  )
    return false;
  const beforeByNet = new Map(
    before.nets.map(({ netId, terminalGroups }) => [netId, terminalGroups]),
  );
  return after.nets.every(({ netId, terminalGroups }) => {
    const earlier = beforeByNet.get(netId);
    return (
      !!earlier &&
      earlier.every((group) =>
        terminalGroups.some((candidate) =>
          group.every((terminal) => candidate.includes(terminal)),
        ),
      )
    );
  });
}

function preservesConnections(
  before: CopperTopology,
  after: CopperTopology,
  changed: ReadonlySet<string>,
) {
  if (
    !preservesTerminals(before.bareOpens, after.bareOpens) ||
    !preservesTerminals(before.assembledOpens, after.assembledOpens)
  )
    return false;
  const fixed = new Set(
    before.copper
      .filter(
        ({ feature }) => feature.kind !== 'zone' && !changed.has(feature.id),
      )
      .map(({ id }) => id),
  );
  const islandByFragment = new Map(
    after.connectedSets.flatMap((island) =>
      island.map((fragment) => [fragment, island] as const),
    ),
  );
  for (const island of before.connectedSets) {
    const [first, ...others] = island.filter((fragment) => fixed.has(fragment));
    if (!first) continue;
    const destination = islandByFragment.get(first);
    if (
      !destination ||
      others.some((fragment) => islandByFragment.get(fragment) !== destination)
    )
      return false;
  }

  // Permit an existing short while rejecting a short that gains new fixed
  // contacts or joins a new pair of nets after zones are refilled.
  return after.shorts.every(({ netIds, fragments }) => {
    const contacts = fragments.filter((fragment) => fixed.has(fragment));
    return before.shorts.some(
      (short) =>
        netIds.every((netId) => short.netIds.includes(netId)) &&
        contacts.every((fragment) => short.fragments.includes(fragment)),
    );
  });
}

export interface RouteCleanupResult {
  readonly board: BoardDocument;
  readonly merged: number;
  readonly duplicates: number;
  readonly loops: readonly BoardTrack[];
}

function cleanupCandidate(
  board: BoardDocument,
  netId: string,
  kernel: PolygonKernel,
): RouteCleanupResult {
  if (!board.nets?.some(({ id }) => id === netId))
    throw new Error('Choose a board net.');
  const selected = (board.tracks ?? []).filter(
    (track) => track.netId === netId,
  );
  const viaKeys = new Set(
    (board.vias ?? [])
      .filter((via) => via.netId === netId)
      .flatMap(({ positionNm }) => [
        junctionKey('top', positionNm),
        junctionKey('bottom', positionNm),
      ]),
  );
  const unique = removeDuplicates(selected);
  const merged = dissolveCollinear(unique.tracks, viaKeys);
  const loops = loopTracks(merged.tracks, board, netId);
  const empty: RouteCleanupResult = {
    board,
    merged: 0,
    duplicates: 0,
    loops: [],
  };
  if (!unique.duplicates && !merged.merged && !loops.length) return empty;

  const previous = readTopology(board, kernel);
  function verified(tracks: BoardTrack[]) {
    const keep = new Map(tracks.map((track) => [track.id, track]));
    const changed = new Set(
      selected
        .filter((track) => keep.get(track.id) !== track)
        .map(({ id }) => id),
    );
    const candidate = {
      ...board,
      tracks: board.tracks.flatMap((track) =>
        track.netId !== netId
          ? [track]
          : keep.has(track.id)
          ? [keep.get(track.id)]
          : [],
      ),
    };
    return preservesConnections(
      previous,
      readTopology(candidate, kernel),
      changed,
    )
      ? candidate
      : undefined;
  }

  const runs = cycleRuns(merged.tracks, loops, viaKeys);
  const proposed = [...new Set(runs.flatMap(({ tracks }) => tracks))];
  const removeLoops = new Set(proposed.map(({ id }) => id));
  const cleaned = verified(
    merged.tracks.filter(({ id }) => !removeLoops.has(id)),
  );
  if (cleaned)
    return {
      board: cleaned,
      merged: merged.merged,
      duplicates: unique.duplicates,
      loops: proposed,
    };

  // A pad or off-centre copper tap can protect a whole run. Try its
  // cycle-closing segment in isolation before dropping that proposal.
  let tracks = merged.tracks;
  let candidate = verified(tracks);
  if (!candidate) return empty;
  const removed: BoardTrack[] = [];
  for (const { seed, tracks: run } of runs) {
    if (!tracks.includes(seed)) continue;
    for (const proposal of run.length > 1 ? [run, [seed]] : [[seed]]) {
      const kept = tracks.filter((track) => !proposal.includes(track));
      const next = verified(kept);
      if (!next) continue;
      removed.push(...tracks.filter((track) => proposal.includes(track)));
      tracks = kept;
      candidate = next;
      break;
    }
  }
  return {
    board: removed.length || merged.merged || unique.duplicates ? candidate : board,
    merged: merged.merged,
    duplicates: unique.duplicates,
    loops: removed,
  };
}

export interface RouteCleanupChange {
  readonly removedTrackIds: readonly string[];
  readonly replacements: readonly BoardTrack[];
  readonly loops: readonly BoardTrack[];
  readonly merged: number;
  readonly duplicates: number;
}

export function prepareRouteCleanupChange(
  board: BoardDocument,
  netId: string,
  kernel: PolygonKernel,
): RouteCleanupChange {
  const result = cleanupCandidate(board, netId, kernel);
  const original = new Map(board.tracks?.map((track) => [track.id, track]));
  const remaining = new Set(result.board.tracks?.map(({ id }) => id));
  return {
    removedTrackIds: [...original.keys()].filter((id) => !remaining.has(id)),
    replacements: (result.board.tracks ?? []).filter((track) => original.get(track.id) !== track),
    loops: result.loops,
    merged: result.merged,
    duplicates: result.duplicates,
  };
}

export function prepareRouteCleanup(
  board: BoardDocument,
  netId: string,
  kernel: PolygonKernel,
): RouteCleanupResult {
  const result = cleanupCandidate(board, netId, kernel);
  return result.board === board ? result : { ...result, board: validateBoard(result.board) };
}
