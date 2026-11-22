import { capsulePolygon, TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import type { BoardDocument } from './board';
import { openingRegion } from './copper';
import type { BoardDrill, CopperFeature } from './copper';
import type { FabricationLimits } from './fabricationProfiles';
import { samePoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';
import { boundaryDistance } from './regionDistances';

export function platedSlotLength(drill: BoardDrill, limits: FabricationLimits) {
  if (!drill.plated || samePoint(drill.start, drill.end)) return;
  const { start, end, widthNm } = drill;
  return {
    measuredNm: Math.hypot(end.x - start.x, end.y - start.y) + widthNm,
    requiredNm: widthNm * limits.minPlatedSlotRatio,
  };
}

export function openingSpacingLimit(bothVias: boolean) {
  return bothVias ? 'minViaGapNm' : 'minHoleGapNm';
}

export function openingCopperClearance(
  board: BoardDocument, opening: BoardDrill, lands: readonly CopperFeature[],
  mountingClearanceNm: number, clearance: (first?: string, second?: string) => number,
) {
  const allowedNet = board.vias?.find(({ id }) => id === opening.id)?.netId ??
    lands.find(({ id, terminalId }) => terminalId && id.slice(0, id.lastIndexOf(':')) === opening.id)?.netId;
  return (feature: CopperFeature) => {
    if (feature.id.slice(0, feature.id.lastIndexOf(':')) === opening.id ||
        (allowedNet && allowedNet === feature.netId)) return 0;
    return Math.max(opening.plated ? 0 : clearance(feature.netId, allowedNet), mountingClearanceNm);
  };
}

export function padAnnulusProbe(drill: BoardDrill, minimumNm: number, kernel: PolygonKernel) {
  const bore = openingRegion(drill);
  const enlarged: PolygonRegion = {
    outer: capsulePolygon(drill.start, drill.end, drill.widthNm + 2 * (minimumNm - TESSELLATION_TOLERANCE_NM)),
    holes: [],
  };
  return {
    passes: (land: PolygonRegion | undefined) =>
      !!land && kernel.boolean('difference', [enlarged], [land]).length === 0,
    measuredNm: (land: PolygonRegion | undefined) =>
      !land || kernel.boolean('difference', [bore], [land]).length ? 0 : boundaryDistance(land, bore),
  };
}
