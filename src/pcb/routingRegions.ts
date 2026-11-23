import { validateAreaShape } from './boardAreaShape';
import type { BoardAreaShape } from './boardAreaShape';
import { MAX_CONTOUR_VERTICES as MAX_AREA_VERTICES } from './contours';
import { isEntityId } from '../model/schematicIdentity';
import type { BoardDocument, CopperLayer } from './board';
import { boardRuleResolver } from './boardRules';
import type { Polygon, PolygonRegion } from './contours';
import { regionsTouch } from './copper';
import { BOARD_COORDINATE_LIMIT_NM, validateOutline } from './geometry';

export const routingRegionKinds = ['track', 'via', 'zone'] as const;
type RoutingKind = (typeof routingRegionKinds)[number];
type Layer = CopperLayer['id'];

export interface RoutingRegion {
  readonly id: string;
  readonly name: string;
  readonly side: Layer | 'both';
  readonly classId?: string;
  readonly outline: Polygon;
  readonly shape?: BoardAreaShape;
  readonly exclusions: readonly RoutingKind[];
  readonly minWidthNm?: number;
  readonly maxWidthNm?: number;
  readonly clearanceNm?: number;
}

export function routingRegionPolygon({ outline }: RoutingRegion): PolygonRegion {
  return { outer: outline, holes: [] };
}

export function routingRegionApplies(region: RoutingRegion, layer: Layer, classId?: string) {
  return (region.side === 'both' || region.side === layer) &&
    (!region.classId || region.classId === (classId ?? 'default'));
}

export function routingRegionViolation(region: RoutingRegion, kind: RoutingKind, widthNm?: number) {
  if (region.exclusions.includes(kind))
    return { code: 'region-exclusion', message: 'The routing region excludes this ' + kind + '.' };
  if (kind === 'track' && region.minWidthNm !== undefined && widthNm < region.minWidthNm)
    return { code: 'region-track-minimum', message: 'Track is narrower than the regional minimum.', requiredNm: region.minWidthNm };
  if (kind === 'track' && region.maxWidthNm !== undefined && widthNm > region.maxWidthNm)
    return { code: 'region-track-maximum', message: 'Track is wider than the regional maximum.', requiredNm: region.maxWidthNm };
}

export function routingRegionKeepouts(board: BoardDocument, kind: RoutingKind, netId: string, widthNm?: number) {
  const classId = board.nets?.find(({ id }) => id === netId)?.classId;
  return (board.routingRegions ?? []).flatMap((region) =>
    routingRegionViolation(region, kind, widthNm)
      ? board.copperLayers.filter(({ id }) => routingRegionApplies(region, id, classId))
          .map(({ id }) => ({ side: id, copper: routingRegionPolygon(region) }))
      : [],
  );
}

export function validateRoutingRegions(board: BoardDocument) {
  const regions = board.routingRegions;
  if ((regions !== undefined) !== board.requiredFeatures.includes('routing-regions'))
    throw new Error('Routing regions must declare the routing-regions feature.');
  if (regions === undefined) return;
  if (!Array.isArray(regions) || regions.length > 128)
    throw new Error('Invalid PCB routing region collection.');
  const ids = new Set<string>();
  const classes = new Set(board.netClasses?.map(({ id }) => id));
  const resolver = boardRuleResolver(board);
  const caps = [{ netId: undefined, classId: undefined }, ...(board.nets ?? []).map(({ id, classId }) => ({ netId: id, classId }))];
  for (const region of regions) {
    if (!isEntityId(region?.id) || ids.has(region.id.toLowerCase()) ||
      typeof region.name !== 'string' || !region.name.trim() || region.name.length > 128 ||
      !['top', 'bottom', 'both'].includes(region.side) ||
      (region.classId !== undefined && region.classId !== 'default' && !classes.has(region.classId)) ||
      !Array.isArray(region.exclusions) ||
      region.exclusions.some((kind: RoutingKind) => !routingRegionKinds.includes(kind)) ||
      new Set(region.exclusions).size !== region.exclusions.length ||
      [region.minWidthNm, region.maxWidthNm, region.clearanceNm].some((dimension) => dimension !== undefined &&
        (!Number.isSafeInteger(dimension) || dimension <= 0 || dimension > BOARD_COORDINATE_LIMIT_NM)) ||
      (!region.exclusions.length && region.minWidthNm === undefined &&
        region.maxWidthNm === undefined && region.clearanceNm === undefined))
      throw new Error('Invalid routing region rules.');
    ids.add(region.id.toLowerCase());
    validateOutline(region.outline, region.shape ? MAX_AREA_VERTICES : undefined);
    validateAreaShape(region.shape, region.outline);
    if (region.minWidthNm > region.maxWidthNm)
      throw new Error('The minimum track width exceeds the maximum in routing region ' + region.name + '.');
    for (const { netId, classId } of caps) {
      if (region.classId && region.classId !== (classId ?? 'default')) continue;
      const rules = resolver.net(netId);
      if (Math.max(region.minWidthNm ?? 0, rules.minWidthNm) >
        Math.min(region.maxWidthNm ?? Infinity, rules.maxWidthNm ?? Infinity))
        throw new Error('The effective track width range is empty in routing region ' + region.name + '.');
    }
  }
  for (const first of regions) {
    if (first.minWidthNm === undefined) continue;
    for (const second of regions) {
      if (first.minWidthNm <= (second.maxWidthNm ?? Infinity) ||
        (first.classId && second.classId && first.classId !== second.classId) ||
        !board.copperLayers.some(({ id }) =>
          (first.side === 'both' || first.side === id) && (second.side === 'both' || second.side === id)) ||
        !regionsTouch(routingRegionPolygon(first), routingRegionPolygon(second))) continue;
      throw new Error('Overlapping routing regions have contradictory track widths: ' + first.name + ' and ' + second.name + '.');
    }
  }
}
