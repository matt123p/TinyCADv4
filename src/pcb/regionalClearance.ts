import type { BoardDocument, CopperLayer } from './board';
import type { PolygonRegion } from './contours';
import type { CopperFeature } from './copper';
import { regionsTouch } from './copper';
import type { PolygonKernel } from './polygonKernel';
import { boundaryDistance, bounds, near } from './regionDistances';
import { routingRegionApplies, routingRegionPolygon } from './routingRegions';

export function regionalClearance(board: BoardDocument, kernel: PolygonKernel) {
  const areas = (board.routingRegions ?? []).filter(({ clearanceNm }) => clearanceNm !== undefined)
    .map((rule) => {
      const polygon = routingRegionPolygon(rule);
      return { rule, polygon, box: bounds(polygon), clips: new WeakMap<CopperFeature, PolygonRegion[]>() };
    });
  const classes = new Map(board.nets?.map(({ id, classId }) => [id, classId]));
  const maximumClearanceNm = areas.reduce((maximum, { rule }) => Math.max(maximum, rule.clearanceNm), 0);
  type Area = (typeof areas)[number];
  type Box = ReturnType<typeof bounds>;

  function clip(area: Area, feature: CopperFeature, box: Box) {
    if (!routingRegionApplies(area.rule, feature.layerId, classes.get(feature.netId)) ||
      !near(area.box, box, 0)) return [];
    let regions = area.clips.get(feature);
    if (!regions) {
      regions = kernel.boolean('intersection', [feature.region], [area.polygon]);
      area.clips.set(feature, regions);
    }
    return regions;
  }

  // The minimum applies to the portion of either matching copper object inside the region.
  function obstaclesFor(layer: CopperLayer['id'], netId: string, copper: readonly CopperFeature[]) {
    if (!areas.length) return [];
    const foreign = copper.filter((item) => item.layerId === layer && item.netId !== netId)
      .map((feature) => ({ feature, box: bounds(feature.region) }));
    return areas.flatMap((area) => {
      const { rule, polygon, box } = area;
      if (rule.side !== 'both' && rule.side !== layer) return [];
      const nearby = foreign.filter((item) => near(item.box, box, rule.clearanceNm));
      if (!nearby.length) return [];
      const inside = routingRegionApplies(rule, layer, classes.get(netId))
        ? kernel.boolean('intersection', kernel.offset(nearby.map(({ feature }) => feature.region), rule.clearanceNm), [polygon])
        : [];
      const clippedForeign = nearby.flatMap(({ feature, box }) => clip(area, feature, box));
      return [...inside, ...kernel.offset(clippedForeign, rule.clearanceNm)];
    });
  }

  function measurements(
    first: CopperFeature, firstBox: Box, second: CopperFeature, secondBox: Box, minimumViolationBase?: number,
  ) {
    if (minimumViolationBase !== undefined &&
      (minimumViolationBase >= maximumClearanceNm || !near(firstBox, secondBox, maximumClearanceNm))) return [];
    return areas.flatMap((area) => {
      const requiredNm = area.rule.clearanceNm;
      if (minimumViolationBase !== undefined &&
        (requiredNm <= minimumViolationBase || !near(firstBox, secondBox, requiredNm))) return [];
      const candidates = [
        ...clip(area, first, firstBox).map((part) => ({ part, other: second.region })),
        ...clip(area, second, secondBox).map((part) => ({ part, other: first.region })),
      ];
      let closest: { measuredNm: number; location: PolygonRegion['outer'][number] };
      for (const { part, other } of candidates) {
        const measuredNm = regionsTouch(part, other) ? 0 : boundaryDistance(part, other);
        if (!closest || measuredNm < closest.measuredNm)
          closest = { measuredNm, location: part.outer[0] };
      }
      if (!closest || (minimumViolationBase !== undefined && closest.measuredNm >= requiredNm)) return [];
      return [{ rule: area.rule, requiredNm, ...closest }];
    });
  }

  return {
    obstaclesFor,
    measurements,
    violations: (first: CopperFeature, firstBox: Box, second: CopperFeature, secondBox: Box, baseClearanceNm: number) =>
      measurements(first, firstBox, second, secondBox, baseClearanceNm),
    hasRules: areas.length > 0,
  };
}
