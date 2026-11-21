import type { BoardIssue } from './boardChecks';
import type { boardArtwork } from './boardArtwork';
import type { boardCopperGeometry } from './boardCopperGeometry';
import type { PolygonRegion } from './contours';
import { regionsTouch } from './copper';
import type { FabricationLimits } from './fabricationProfiles';
import type { PolygonKernel } from './polygonKernel';
import { boundaryDistance, bounds, near } from './regionDistances';

export function checkBoardArtwork(
  kernel: PolygonKernel,
  artwork: ReturnType<typeof boardArtwork>,
  geometry: ReturnType<typeof boardCopperGeometry>,
  profile: PolygonRegion,
  limits?: FabricationLimits,
): BoardIssue[] {
  const messages = {
    'silk-text': 'Silkscreen text could not be plotted.',
    'silk-geometry': 'Silkscreen geometry could not be plotted.',
    'courtyard-open':
      'Footprint courtyard has an open or unsupported boundary.',
  };
  const issues: BoardIssue[] = artwork.issues.map(
    ({ id, componentId, code, detail }) => ({
      code,
      objects: [id, componentId],
      message: detail ? messages[code] + ' ' + detail : messages[code],
    }),
  );

  const courtyards = artwork.courtyards.flatMap((item) =>
    item.regions.map((region) => ({ item, region, box: bounds(region) })),
  );
  for (const [i, a] of courtyards.entries()) {
    if (kernel.boolean('difference', [a.region], [profile]).length) {
      issues.push({
        code: 'courtyard-edge',
        objects: [a.item.componentId, a.item.id],
        location: a.region.outer[0],
        message: 'Footprint courtyard crosses the board outline or a cutout.',
      });
    }
    for (const b of courtyards.slice(i + 1)) {
      if (
        a.item.componentId === b.item.componentId ||
        a.item.side !== b.item.side ||
        !near(a.box, b.box, 0) ||
        !kernel.boolean('intersection', [a.region], [b.region]).length
      )
        continue;
      issues.push({
        code: 'courtyard-overlap',
        objects: [a.item.componentId, b.item.componentId],
        location: a.region.outer[0],
        message: 'Footprint courtyards overlap on the same assembly side.',
      });
    }
  }

  const minimumSilkMaskGap = limits?.minSilkMaskGapNm ?? 0;
  const edgeGap = limits?.minSilkEdgeGapNm ?? 0;
  const interior = edgeGap ? kernel.offset([profile], -edgeGap) : [profile];
  const mask = geometry.apertures
    .filter(({ kind }) => kind === 'mask')
    .map(({ polygon, side, id }) => {
      const region: PolygonRegion = { outer: polygon, holes: [] };
      return { id, side, region, box: bounds(region) };
    });
  for (const print of artwork.silk) {
    if (
      limits &&
      print.strokeNm > 0 &&
      print.strokeNm < limits.minSilkStrokeNm
    ) {
      issues.push({
        code: 'silk-stroke',
        objects: [print.componentId, print.id],
        location: print.regions[0].outer[0],
        measuredNm: print.strokeNm,
        requiredNm: limits.minSilkStrokeNm,
        message: 'Silkscreen stroke is thinner than the fabrication minimum.',
      });
    }
    if (kernel.boolean('difference', print.regions, interior).length) {
      issues.push({
        code: 'silk-edge',
        objects: [print.componentId, print.id],
        location: print.regions[0].outer[0],
        requiredNm: edgeGap,
        message: 'Silkscreen crosses the required board edge clearance.',
      });
    }
    for (const region of print.regions) {
      const box = bounds(region);
      for (const hole of mask) {
        if (
          hole.side !== print.side ||
          !near(box, hole.box, minimumSilkMaskGap)
        )
          continue;
        const touching = regionsTouch(region, hole.region);
        const gap = touching ? 0 : boundaryDistance(region, hole.region);
        if (touching || gap < minimumSilkMaskGap) {
          issues.push({
            code: 'silk-mask',
            objects: [print.componentId, print.id, hole.id],
            location: region.outer[0],
            measuredNm: gap,
            requiredNm: minimumSilkMaskGap,
            message:
              'Silkscreen touches or is too close to a solder-mask opening.',
          });
        }
      }
    }
  }
  return issues;
}
