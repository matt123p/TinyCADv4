import { isEntityId } from '../model/schematicIdentity';
import type { BoardDocument } from './board';
import type { PolygonRegion } from './contours';
import {
  capsulePolygon,
  circlePolygon,
  polygonBoundariesMeet,
  profileRegion,
} from './contours';
import type { BoardDrill } from './copper';
import { BOARD_COORDINATE_LIMIT_NM, pointInPolygon, samePoint } from './geometry';

export interface BoardMechanicalHole extends BoardDrill {
  readonly landWidthNm?: number;
  readonly clearanceNm?: number;
  readonly screwHeadDiameterNm?: number;
  readonly screwHeadSide?: 'top' | 'bottom' | 'both';
  readonly bodyClearanceNm?: number;
}

function validKeepoutRadius(hole: BoardMechanicalHole) {
  const radius = Math.ceil(hole.screwHeadDiameterNm / 2) + (hole.bodyClearanceNm ?? 0);
  return Number.isSafeInteger(radius) && radius > 0 &&
    Math.max(Math.abs(hole.start.x), Math.abs(hole.start.y)) + radius <= BOARD_COORDINATE_LIMIT_NM;
}

export function mountingKeepouts(board: BoardDocument) {
  return (board.mechanicalHoles ?? []).flatMap((hole) => {
    if (hole.screwHeadDiameterNm === undefined) return [];
    const radius = Math.ceil(hole.screwHeadDiameterNm / 2);
    const copper: PolygonRegion = {
      outer: circlePolygon(hole.start, radius), holes: [],
    };
    const body = hole.bodyClearanceNm
      ? circlePolygon(hole.start, radius + hole.bodyClearanceNm)
      : copper.outer;
    const sides: ('top' | 'bottom')[] = hole.screwHeadSide === 'both'
      ? ['top', 'bottom']
      : [hole.screwHeadSide];
    return sides.map((side) => ({
      id: hole.id,
      side,
      location: hole.start,
      copper,
      body,
    }));
  });
}

export function validateBoardMechanical(board: BoardDocument) {
  if (
    (board.mechanicalHoles !== undefined) !==
    board.requiredFeatures.includes('mechanical-holes')
  )
    throw new Error('PCB holes must declare the mechanical-holes feature.');
  if (!board.mechanicalHoles) return;
  if (!Array.isArray(board.mechanicalHoles))
    throw new Error('Invalid PCB hole collection.');

  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  const ids = new Set<string>([
    ...(board.vias ?? []).map(({ id }) => id.toLowerCase()),
    ...(board.tracks ?? []).map(({ id }) => id.toLowerCase()),
  ]);
  for (const hole of board.mechanicalHoles) {
    if (
      !isEntityId(hole?.id) ||
      ids.has(hole.id.toLowerCase()) ||
      typeof hole.plated !== 'boolean' ||
      (hole.plated &&
        (!Number.isSafeInteger(hole.landWidthNm) ||
          hole.landWidthNm <= hole.widthNm)) ||
      (!hole.plated && hole.landWidthNm !== undefined) ||
      (hole.clearanceNm !== undefined &&
        (!Number.isSafeInteger(hole.clearanceNm) || hole.clearanceNm < 0))
    )
      throw new Error('Invalid PCB hole, slot or annular ring.');
    const head = hole.screwHeadDiameterNm;
    if (head === undefined) {
      if (hole.screwHeadSide !== undefined || hole.bodyClearanceNm !== undefined)
        throw new Error('Set a screw-head diameter before setting its side or body clearance.');
    } else if (
      !samePoint(hole.start, hole.end) ||
      !Number.isSafeInteger(head) ||
      head < (hole.landWidthNm ?? hole.widthNm) ||
      !['top', 'bottom', 'both'].includes(hole.screwHeadSide) ||
      (hole.bodyClearanceNm !== undefined &&
        (!Number.isSafeInteger(hole.bodyClearanceNm) || hole.bodyClearanceNm < 0)) ||
      !validKeepoutRadius(hole)
    ) {
      throw new Error(
        'A screw-head keep-out needs a round hole, a side, a diameter at least as large as the opening and land, and a nonnegative component clearance within the board coordinate range.',
      );
    }
    ids.add(hole.id.toLowerCase());
    const perimeter = capsulePolygon(
      hole.start,
      hole.end,
      hole.landWidthNm ?? hole.widthNm,
    );
    if (
      perimeter.some(
        (point) => pointInPolygon(point, profile.outer) !== 'inside',
      ) ||
      polygonBoundariesMeet(perimeter, profile.outer) ||
      profile.holes.some(
        (cutout) =>
          pointInPolygon(cutout[0], perimeter) !== 'outside' ||
          pointInPolygon(perimeter[0], cutout) !== 'outside' ||
          polygonBoundariesMeet(perimeter, cutout),
      )
    )
      throw new Error(
        'PCB holes and lands must be inside the board and clear of its cutouts.',
      );
  }
}
