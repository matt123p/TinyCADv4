import { validateBoard } from './board';
import type { BoardDocument, CopperLayer } from './board';
import { boardCopperGeometry } from './boardCopperGeometry';
import { applyBoardRoutingEdit } from './boardRouting';
import type { BoardRoutingEdit, BoardTrack, BoardVia } from './boardRouting';
import { capsulePolygon, profileRegion } from './contours';
import type { PolygonRegion } from './contours';
import type { BoardPoint } from './geometry';
import { isBoardPoint, pointInPolygon, samePoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';
import { centrelineClearance, prepareCentrelineClearance, trackWidthViolation } from './routing';
import type { RouteRules } from './routing';
import { fabricationProfileFor } from './fabricationProfiles';
import { drillGapNm } from './regionDistances';
import { boardRuleResolver } from './boardRules';
import { mountingKeepouts } from './boardMechanical';
import { analyseCopper, regionsTouch } from './copper';
import type { BoardDrill } from './copper';
import { boardZoneGeometry } from './boardZoneGeometry';
import { planTrackEdit } from './trackEdits';
import { simplifyRoutePath } from './routeCleanup';
import { routingRegionKeepouts } from './routingRegions';
import { regionalClearance } from './regionalClearance';
import type { ManualTrackEdit } from './trackEdits';

export interface ManualRoute {
  readonly netId: string;
  readonly widthNm: number;
  readonly path: readonly {
    position: BoardPoint;
    layer: CopperLayer['id'];
  }[];
  readonly viaDiameterNm: number;
  readonly viaDrillNm: number;
  readonly replaceTrack?: string;
}

function requireTrackWidth(widthNm: number, rules: RouteRules) {
  const violation = trackWidthViolation(widthNm, rules);
  if (violation)
    throw new Error(violation.code === 'track-width'
      ? 'Track width is below the board minimum.'
      : 'Track width is above the board maximum.');
}

function existingLayerConnection(
  existing: ReturnType<typeof boardCopperGeometry>,
  position: BoardPoint,
  netId: string,
  layers: readonly CopperLayer['id'][],
  kernel: PolygonKernel,
) {
  const contains = (region: PolygonRegion) =>
    pointInPolygon(position, region.outer) !== 'outside' &&
    region.holes.every((hole) => pointInPolygon(position, hole) === 'outside');
  const lands = existing.features.filter(({ netId: net, region }) =>
    net === netId && contains(region),
  );
  if (!layers.every((layer) => lands.some(({ layerId }) => layerId === layer))) return false;
  const landsById = new Map(lands.map((land) => [land.id, land]));
  const plated = existing.drills.find(({ id, plated }) =>
    plated && layers.every((layer) => landsById.has(id + ':' + layer)),
  );
  if (!plated) return false;
  const drillRegion = ({ start, end, widthNm }: BoardDrill): PolygonRegion => ({
    outer: capsulePolygon(start, end, widthNm), holes: [],
  });
  const opening = drillRegion(plated);
  const cutters = existing.drills.map(drillRegion);
  return layers.every((layer) => kernel.boolean(
    'difference', [landsById.get(plated.id + ':' + layer).region], cutters,
  ).some((region) => contains(region) && regionsTouch(region, opening)));
}

function routeClearance(
  board: BoardDocument,
  netId: string,
  kernel: PolygonKernel,
) {
  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  const regional = regionalClearance(board, kernel);
  // Spatial clearance rules still use the copper polygons for region clipping.
  const existing = boardCopperGeometry(
    regional.hasRules ? board : { ...board, tracks: [] },
    { includeApertures: false },
  );
  const resolver = boardRuleResolver(board);
  const sameNetDrills = new Set(
    existing.features
      .filter((feature) => feature.netId === netId)
      .map(({ id }) => id.slice(0, id.lastIndexOf(':'))),
  );
  const mountingClearance = new Map(
    board.mechanicalHoles?.map(({ id, clearanceNm }) => [id, clearanceNm ?? 0]),
  );
  const drills = existing.drills.map((drill) => ({
    ...drill,
    widthNm: drill.widthNm + 2 * (mountingClearance.get(drill.id) ?? 0),
  }));
  const mounting = mountingKeepouts(board);
  const spacing = board.copperLayers.flatMap(({ id }) =>
    regional.obstaclesFor(id, netId, existing.features).map((copper) => ({ side: id, copper })),
  );
  const otherTracks = (board.tracks ?? []).filter((track) => track.netId !== netId);
  const straightTrackObstacles = (kind: 'track' | 'via') => otherTracks.map(
    ({ start, end, layerId, widthNm, netId: otherNet }) => ({
      start, end, layerId, widthNm,
      clearanceNm: resolver.copperClearance({ netId, kind }, { netId: otherNet, kind: 'track' }),
    }),
  );
  const clearance = {
    profile,
    rules: resolver.net(netId),
    layers: board.copperLayers.map(({ id }) => id),
    netId,
    obstacles: existing.features.filter(({ kind }) => kind !== 'track'),
    straightTrackObstacles: straightTrackObstacles('via'),
    clearanceFor: (feature: (typeof existing.features)[number]) =>
      resolver.copperClearance({ netId, kind: 'via' }, feature),
    keepouts: [...mounting, ...spacing, ...routingRegionKeepouts(board, 'via', netId)],
    drills,
  };
  const trackObstacles = straightTrackObstacles('track');
  const trackContext = (widthNm: number) => ({
    ...clearance,
    straightTrackObstacles: trackObstacles,
    keepouts: [...mounting, ...spacing, ...routingRegionKeepouts(board, 'track', netId, widthNm)],
    clearanceFor: (feature: (typeof existing.features)[number]) =>
      resolver.copperClearance({ netId, kind: 'track' }, feature),
    drills: drills.filter(
      ({ id, plated }) =>
        !(plated || existing.jumperDrillIds.has(id)) || !sameNetDrills.has(id),
    ),
  });
  return {
    existing,
    clearance,
    trackContext,
    trackClearance: (widthNm: number) =>
      centrelineClearance(kernel, trackContext(widthNm), Math.ceil(widthNm / 2)),
  };
}

export function prepareManualTrackClearance(
  board: BoardDocument,
  { netId, widthNm, replaceTrack }: Pick<ManualRoute, 'netId' | 'widthNm' | 'replaceTrack'>,
  kernel: PolygonKernel,
) {
  const { trackContext } = routeClearance(replaceTrack
    ? { ...board, tracks: board.tracks?.filter(({ id }) => id !== replaceTrack) }
    : board, netId, kernel);
  const context = trackContext(widthNm);
  requireTrackWidth(widthNm, context.rules);
  return prepareCentrelineClearance(kernel, context, Math.ceil(widthNm / 2));
}

function preserveRouteContacts(
  before: BoardDocument,
  after: BoardDocument,
  netId: string,
  replaced: readonly BoardTrack[],
  replacements: readonly BoardTrack[],
  kernel: PolygonKernel,
) {
  const oldIds = new Set(replaced.map(({ id }) => id));
  const newIds = new Set(replacements.map(({ id }) => id));
  const featureId = (fragment: string) =>
    fragment.slice(0, fragment.lastIndexOf('/'));
  const topology = (board: BoardDocument) => {
    const geometry = boardCopperGeometry(board, { includeApertures: false });
    const { fills } = boardZoneGeometry(board, kernel, geometry);
    const copper = [...geometry.features, ...fills].filter(
      (feature) => feature.netId === netId,
    );
    return {
      islands: analyseCopper(kernel, copper, geometry.drills).connectedSets,
      fixedIds: new Set(geometry.features.map(({ id }) => id)),
    };
  };
  const prior = topology(before);
  const contacts = prior.islands
    .filter((island) =>
      island.some((fragment) => oldIds.has(featureId(fragment))),
    )
    .map((island) =>
      island.filter((fragment) => {
        const id = featureId(fragment);
        return prior.fixedIds.has(id) && !oldIds.has(id);
      }),
    )
    .filter(({ length }) => length);
  if (!contacts.length) return;
  const next = topology(after);
  const islandByFragment = new Map(
    next.islands.flatMap((island) =>
      island.map((fragment) => [fragment, island] as const),
    ),
  );
  for (const [first, ...others] of contacts) {
    const island = islandByFragment.get(first);
    if (
      !island ||
      others.some((fragment) => islandByFragment.get(fragment) !== island) ||
      !island.some((fragment) => newIds.has(featureId(fragment)))
    ) {
      throw new Error(
        'The edit would disconnect an attached track, pad or via.',
      );
    }
  }
}

export function editManualTracks(
  board: BoardDocument,
  edit: ManualTrackEdit,
  kernel: PolygonKernel,
): BoardDocument {
  return prepareManualTrackEdit(board, edit, kernel).board;
}

export function prepareManualTrackEdit(
  board: BoardDocument,
  edit: ManualTrackEdit,
  kernel: PolygonKernel,
) {
  const { replace, pieces, netId } = planTrackEdit(board, edit);
  const oldIds = new Set(replace.map(({ id }) => id));
  const tracks = board.tracks.filter(({ id }) => !oldIds.has(id));
  const { clearance, trackClearance } = routeClearance(
    { ...board, tracks },
    netId,
    kernel,
  );
  const checks = new Map<number, ReturnType<typeof trackClearance>>();
  for (const { widthNm, start, end, layerId } of pieces) {
    requireTrackWidth(widthNm, clearance.rules);
    const clear = checks.get(widthNm) ?? trackClearance(widthNm);
    checks.set(widthNm, clear);
    if (!clear(start, end, layerId))
      throw new Error(
        'Track blocked by the board edge, a drill, copper clearance or a routing region.',
      );
  }
  const replacements = pieces.map((piece) => ({
    ...piece,
    id: piece.id ?? crypto.randomUUID(),
  }));
  const change: BoardRoutingEdit = {
    kind: 'track-edit', removedTrackIds: [...oldIds], addedTracks: replacements,
  };
  const candidate = validateBoard(applyBoardRoutingEdit(board, change));
  preserveRouteContacts(board, candidate, netId, replace, replacements, kernel);
  return { board: candidate, change };
}

export function commitManualRoute(
  board: BoardDocument,
  route: ManualRoute,
  kernel: PolygonKernel,
): BoardDocument {
  return prepareManualRoute(board, route, kernel).board;
}

export function prepareManualRoute(
  board: BoardDocument,
  route: ManualRoute,
  kernel: PolygonKernel,
) {
  const rules = boardRuleResolver(board).net(route.netId);
  const process = fabricationProfileFor(board)?.limits;
  const oldVias = new Set(board.vias?.map(({ id }) => id));
  if (!board.nets?.some(({ id }) => id === route.netId))
    throw new Error('Choose an assigned PCB net.');
  requireTrackWidth(route.widthNm, rules);
  if (
    route.path.length < 2 ||
    !route.path.every(({ position }) => isBoardPoint(position))
  )
    throw new Error('A route needs at least two points.');

  const layers = board.copperLayers.map(({ id }) => id);
  const oldTrack = board.tracks?.find(({ id }) => id === route.replaceTrack);
  if (route.replaceTrack && (!oldTrack || oldTrack.netId !== route.netId))
    throw new Error('The track to reroute is no longer assigned to this net.');
  if (oldTrack?.locked) throw new Error('Unlock this track before rerouting it.');
  if (oldTrack) {
    const first = route.path[0];
    const last = route.path[route.path.length - 1];
    if (
      first.layer !== oldTrack.layerId ||
      last.layer !== oldTrack.layerId ||
      !samePoint(first.position, oldTrack.start) ||
      !samePoint(last.position, oldTrack.end)
    )
      throw new Error(
        'A reroute must keep both original track endpoints and their copper layer.',
      );
  }

  const { existing, clearance, trackClearance } = routeClearance(
    oldTrack ? { ...board, tracks: board.tracks.filter(({ id }) => id !== oldTrack.id) } : board,
    route.netId,
    kernel,
  );
  const trackClear = trackClearance(route.widthNm);

  const addedTracks: BoardTrack[] = [];
  const addedVias: BoardVia[] = [];
  const routeVias = new Map<string, BoardPoint>();
  let viaClear: ReturnType<typeof centrelineClearance>;
  const path = simplifyRoutePath(route.path);
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1];
    const to = path[index];
    if (!layers.includes(from.layer) || !layers.includes(to.layer))
      throw new Error('Route on a physical copper layer.');
    if (from.layer === to.layer) {
      if (samePoint(from.position, to.position)) continue;
      if (!trackClear(from.position, to.position, to.layer))
        throw new Error(
          'Track blocked by the board edge, a drill, copper clearance or a routing region.',
        );
      addedTracks.push({
        id: addedTracks.length === 0 && oldTrack ? oldTrack.id : crypto.randomUUID(),
        layerId: to.layer,
        netId: route.netId,
        start: from.position,
        end: to.position,
        widthNm: route.widthNm,
      });
      continue;
    }

    if (layers.length !== 2 || !samePoint(from.position, to.position))
      throw new Error('Change layers at one position on a two-layer board.');
    const position = from.position;
    if (existingLayerConnection(existing, position, route.netId, layers, kernel)) continue;
    if (
      route.viaDrillNm <= 0 ||
      route.viaDiameterNm - route.viaDrillNm < 2 * rules.minViaAnnulusNm ||
      route.viaDiameterNm <= route.viaDrillNm
    )
      throw new Error('Via annular ring is below the board minimum.');
    if (process && route.viaDrillNm < process.minViaDrillNm)
      throw new Error('Via drill is below the fabrication profile minimum.');
    const key = position.x + ',' + position.y;
    if (routeVias.has(key)) continue;
    if (process) {
      const opening = {
        id: '',
        start: position,
        end: position,
        widthNm: route.viaDrillNm,
        plated: true,
      };
      const tooClose =
        existing.drills.some(
          (other) =>
            drillGapNm(opening, other) <
            (oldVias.has(other.id)
              ? process.minViaGapNm
              : process.minHoleGapNm),
        ) ||
        [...routeVias.values()].some(
          (other) =>
            Math.hypot(position.x - other.x, position.y - other.y) -
              route.viaDrillNm <
            process.minViaGapNm,
        );
      if (tooClose)
        throw new Error('Via drill violates the fabrication profile spacing.');
    }
    viaClear ??= centrelineClearance(
      kernel,
      clearance,
      Math.ceil(route.viaDiameterNm / 2),
    );
    if (layers.some((layer) => !viaClear(position, position, layer)))
      throw new Error(
        'Via blocked by the board edge, another drill, copper clearance or a routing region.',
      );
    if (
      [...routeVias.values()].some(
        (other) =>
          Math.hypot(other.x - position.x, other.y - position.y) <=
          (route.viaDiameterNm + route.viaDrillNm) / 2 + rules.clearanceNm,
      )
    )
      throw new Error('Via is too close to another via on this route.');
    routeVias.set(key, position);
    addedVias.push({
      id: crypto.randomUUID(),
      netId: route.netId,
      positionNm: position,
      diameterNm: route.viaDiameterNm,
      drillNm: route.viaDrillNm,
    });
  }
  if (!addedTracks.length && !addedVias.length)
    throw new Error('The route does not add any copper.');
  const change: BoardRoutingEdit = {
    kind: 'route', removedTrackIds: oldTrack ? [oldTrack.id] : [], addedTracks, addedVias,
  };
  const candidate = validateBoard(applyBoardRoutingEdit(board, change));
  if (oldTrack)
    preserveRouteContacts(
      board,
      candidate,
      route.netId,
      [oldTrack],
      addedTracks,
      kernel,
    );
  return { board: candidate, change };
}
