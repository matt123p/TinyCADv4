import { isEntityId } from '../model/schematicIdentity';
import { capsulePolygon } from './contours';
import type { BoardDocument, CopperLayer } from './board';
import type { BoardDrill, CopperFeature } from './copper';
import type { BoardPoint } from './geometry';

interface RouteAssignment {
  readonly id: string;
  readonly netId?: string;
  readonly reviewRequired?: boolean;
}

export interface BoardTrack extends RouteAssignment {
  readonly layerId: CopperLayer['id'];
  readonly start: BoardPoint;
  readonly end: BoardPoint;
  readonly widthNm: number;
}

export interface BoardVia extends RouteAssignment {
  readonly positionNm: BoardPoint;
  readonly diameterNm: number;
  readonly drillNm: number;
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
        typeof item.reviewRequired !== 'boolean')
    )
      throw new Error('Invalid PCB route identity or net assignment.');
    ids.add(item.id.toLowerCase());
  }
  for (const { layerId, start, end, widthNm } of tracks ?? []) {
    if (!layers.has(layerId))
      throw new Error('A PCB track needs a physical copper layer.');
    capsulePolygon(start, end, widthNm);
  }
  for (const { positionNm, diameterNm, drillNm } of vias ?? []) {
    if (layers.size !== 2 || drillNm >= diameterNm)
      throw new Error(
        'A through via needs two copper layers and a positive annular ring.',
      );
    capsulePolygon(positionNm, positionNm, diameterNm);
    capsulePolygon(positionNm, positionNm, drillNm);
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
  const drills: BoardDrill[] = [];
  for (const via of board.vias ?? []) {
    const { id, positionNm, diameterNm, drillNm, netId } = via;
    const outer = capsulePolygon(positionNm, positionNm, diameterNm);
    for (const layerId of ['top', 'bottom'] as const) {
      const featureId = `${id}:${layerId}`;
      owners.set(featureId, id);
      features.push({
        id: featureId,
        layerId,
        kind: 'track',
        netId,
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
