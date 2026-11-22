import { isEntityId } from '../model/schematicIdentity';
import { capsulePolygon, validateCapsule } from './contours';
import type { BoardDocument, CopperLayer } from './board';
import type { BoardDrill, CopperFeature } from './copper';
import type { BoardPoint } from './geometry';
import { samePoint } from './geometry';
import type { RouteCleanupChange } from './routeCleanup';

interface RouteAssignment {
  readonly id: string;
  readonly netId?: string;
  readonly reviewRequired?: boolean;
  readonly locked?: boolean;
}

export interface BoardTrack extends RouteAssignment {
  readonly layerId: CopperLayer['id'];
  readonly start: BoardPoint;
  readonly end: BoardPoint;
  readonly widthNm: number;
}

export type ViaTenting = 'both' | 'top' | 'bottom' | 'none';

export interface BoardVia extends RouteAssignment {
  readonly positionNm: BoardPoint;
  readonly diameterNm: number;
  readonly drillNm: number;
  readonly tenting?: ViaTenting;
}

export type BoardRoutingEdit = {
  readonly removedTrackIds: readonly string[];
  readonly addedTracks: readonly BoardTrack[];
} & (
  | { readonly kind: 'route'; readonly addedVias: readonly BoardVia[] }
  | { readonly kind: 'track-edit' }
);

/** Assemble the candidate for the normal board validation and revision checks. */
export function applyBoardRoutingEdit(board: BoardDocument, edit: BoardRoutingEdit): BoardDocument {
  const surviving = edit.removedTrackIds.length
    ? (board.tracks ?? []).filter(({ id }) => !edit.removedTrackIds.includes(id))
    : board.tracks ?? [];
  const tracks = edit.addedTracks.length ? [...surviving, ...edit.addedTracks] : surviving;
  if (edit.kind === 'track-edit') return { ...board, tracks };
  const vias = edit.addedVias.length ? [...(board.vias ?? []), ...edit.addedVias] : board.vias ?? [];
  return {
    ...board,
    requiredFeatures: [...new Set([...board.requiredFeatures, 'routed-copper' as const])],
    tracks,
    vias,
  };
}

/** Keep the original order and share everything a cleanup did not change. */
export function applyRouteCleanupChange(
  board: BoardDocument,
  { removedTrackIds, replacements }: Pick<RouteCleanupChange, 'removedTrackIds' | 'replacements'>,
): BoardDocument {
  if (!removedTrackIds.length && !replacements.length) return board;
  const removed = new Set(removedTrackIds);
  const updated = new Map(replacements.map((track) => [track.id, track]));
  const tracks: BoardTrack[] = [];
  for (const track of board.tracks ?? []) {
    if (!removed.has(track.id)) tracks.push(updated.get(track.id) ?? track);
  }
  return { ...board, tracks };
}

export function viaIsTented({ tenting = 'both' }: BoardVia, side: CopperLayer['id']): boolean {
  return tenting === 'both' || tenting === side;
}

export function validateBoardRouting(board: BoardDocument) {
  const { tracks, vias } = board;
  if (
    (tracks !== undefined || vias !== undefined) !==
    board.requiredFeatures.includes('routed-copper')
  )
    throw new Error('PCB routes must declare the routed-copper feature.');
  if (
    (tracks !== undefined && !Array.isArray(tracks)) ||
    (vias !== undefined && !Array.isArray(vias))
  )
    throw new Error('Invalid PCB route collection.');
  const ids = new Set<string>();
  const nets = new Set((board.nets ?? []).map(({ id }) => id));
  const layers = new Set(board.copperLayers.map(({ id }) => id));
  for (const item of [...(tracks ?? []), ...(vias ?? [])]) {
    if (
      !isEntityId(item?.id) ||
      ids.has(item.id.toLowerCase()) ||
      (item.netId !== undefined && !nets.has(item.netId)) ||
      (item.reviewRequired !== undefined &&
        typeof item.reviewRequired !== 'boolean') ||
      (item.locked !== undefined && typeof item.locked !== 'boolean')
    )
      throw new Error('Invalid PCB route identity or net assignment.');
    ids.add(item.id.toLowerCase());
  }
  for (const { layerId, start, end, widthNm } of tracks ?? []) {
    if (!layers.has(layerId))
      throw new Error('A PCB track needs a physical copper layer.');
    if (samePoint(start, end))
      throw new Error('A PCB track needs distinct endpoints.');
    validateCapsule(start, end, widthNm);
  }
  for (const { positionNm, diameterNm, drillNm, tenting } of vias ?? []) {
    if (layers.size !== 2 || drillNm >= diameterNm)
      throw new Error(
        'A through via needs two copper layers and a positive annular ring.',
      );
    validateCapsule(positionNm, positionNm, diameterNm);
    validateCapsule(positionNm, positionNm, drillNm);
    if (tenting !== undefined && !['both', 'top', 'bottom', 'none'].includes(tenting))
      throw new Error('Invalid through-via solder mask tenting.');
  }
}

export function routeGeometry(board: BoardDocument) {
  const owners = new Map<string, string>();
  const features: CopperFeature[] = (board.tracks ?? []).map(
    ({ id, start, end, widthNm, layerId, netId }): CopperFeature => {
      owners.set(id, id);
      return {
        id,
        layerId,
        kind: 'track',
        netId,
        region: { outer: capsulePolygon(start, end, widthNm), holes: [] },
      };
    },
  );
  const drills: BoardDrill[] = [...(board.mechanicalHoles ?? [])];
  for (const hole of board.mechanicalHoles ?? []) {
    if (!hole.plated) continue;
    const outer = capsulePolygon(hole.start, hole.end, hole.landWidthNm);
    for (const { id: layerId } of board.copperLayers) {
      features.push({
        id: hole.id + ':' + layerId,
        kind: 'pad',
        layerId,
        region: { outer, holes: [] },
      });
    }
  }
  for (const via of board.vias ?? []) {
    const { id, positionNm, diameterNm, drillNm, netId } = via;
    const outer = capsulePolygon(positionNm, positionNm, diameterNm);
    for (const layerId of ['top', 'bottom'] as const) {
      const featureId = `${id}:${layerId}`;
      owners.set(featureId, id);
      features.push({
        id: featureId,
        layerId,
        kind: 'via',
        netId,
        anchor: positionNm,
        region: { outer, holes: [] },
      });
    }
    drills.push({
      id,
      start: positionNm,
      end: positionNm,
      widthNm: drillNm,
      plated: true,
    });
  }
  return { features, drills, owners };
}
