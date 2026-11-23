import { validateAreaShape } from './boardAreaShape';
import type { BoardAreaShape } from './boardAreaShape';
import { isEntityId } from '../model/schematicIdentity';
import type { BoardDocument, CopperLayer } from './board';
import { MAX_CONTOUR_VERTICES, polygonBoundariesMeet } from './contours';
import type { Polygon } from './contours';
import {
  BOARD_COORDINATE_LIMIT_NM,
  pointInPolygon,
  validateOutline,
} from './geometry';

export type ZoneConnection = 'direct' | 'thermal' | 'none';
export type ZoneIslands = 'remove' | 'retain' | 'flag';

export interface BoardZone {
  readonly id: string;
  readonly netId: string;
  readonly layerId: CopperLayer['id'];
  readonly priority: number;
  readonly outline: Polygon;
  readonly shape?: BoardAreaShape;
  readonly cutouts: readonly { readonly outline: Polygon }[];
  readonly clearanceNm?: number;
  readonly padConnection: ZoneConnection;
  readonly viaConnection: ZoneConnection;
  readonly spokeWidthNm: number;
  readonly thermalGapNm: number;
  readonly islands: ZoneIslands;
}

function validDistance(value: number, min: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= BOARD_COORDINATE_LIMIT_NM
  );
}

export function validateBoardZones(board: BoardDocument) {
  if (
    (board.zones !== undefined) !==
    board.requiredFeatures.includes('copper-zones')
  )
    throw new Error('PCB zones must declare the copper-zones feature.');
  if (board.zones === undefined) return;
  if (!Array.isArray(board.zones) || board.zones.length > 128)
    throw new Error('Invalid PCB zone collection.');

  const ids = new Set<string>();
  const layers = new Set(board.copperLayers.map(({ id }) => id));
  for (const zone of board.zones) {
    if (
      !isEntityId(zone?.id) ||
      ids.has(zone.id.toLowerCase()) ||
      !isEntityId(zone.netId) ||
      !layers.has(zone.layerId) ||
      !Number.isSafeInteger(zone.priority) ||
      !['direct', 'thermal', 'none'].includes(zone.padConnection) ||
      !['direct', 'thermal', 'none'].includes(zone.viaConnection) ||
      !['remove', 'retain', 'flag'].includes(zone.islands) ||
      !validDistance(zone.spokeWidthNm, 2) ||
      !validDistance(zone.thermalGapNm, 1) ||
      (zone.clearanceNm !== undefined && !validDistance(zone.clearanceNm, 0)) ||
      !Array.isArray(zone.cutouts) ||
      zone.cutouts.length > 64
    )
      throw new Error('Invalid PCB zone settings.');
    ids.add(zone.id.toLowerCase());
    validateOutline(zone.outline, MAX_CONTOUR_VERTICES);
    validateAreaShape(zone.shape, zone.outline);
    const holes: Polygon[] = [];
    let vertexCount = zone.outline.length;
    for (const { outline } of zone.cutouts) {
      validateOutline(outline, MAX_CONTOUR_VERTICES);
      vertexCount += outline.length;
      if (
        vertexCount > 16_384 ||
        pointInPolygon(outline[0], zone.outline) !== 'inside' ||
        polygonBoundariesMeet(outline, zone.outline) ||
        holes.some(
          (hole) =>
            polygonBoundariesMeet(hole, outline) ||
            pointInPolygon(outline[0], hole) !== 'outside' ||
            pointInPolygon(hole[0], outline) !== 'outside',
        )
      )
        throw new Error(
          'Zone cutouts must be disjoint and inside the zone outline.',
        );
      holes.push(outline);
    }
  }
}
