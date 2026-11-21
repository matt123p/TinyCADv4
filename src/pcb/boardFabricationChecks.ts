import type { BoardDocument } from './board';
import type { BoardIssue } from './boardChecks';
import type { boardCopperGeometry } from './boardCopperGeometry';
import { capsulePolygon, TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import { regionsTouch } from './copper';
import { drillWidthMinimum } from './fabricationProfiles';
import type { fabricationProfileFor } from './fabricationProfiles';
import { samePoint, signedDoubleArea } from './geometry';
import type { PolygonKernel } from './polygonKernel';
import { boundaryDistance, bounds, drillGapNm, near } from './regionDistances';

function doubleArea(regions: readonly PolygonRegion[]): bigint {
  const zero = BigInt(0);
  const magnitude = (ring: PolygonRegion['outer']) => {
    const area = signedDoubleArea(ring);
    return area < zero ? -area : area;
  };
  return regions.reduce((total, { outer, holes }) =>
    total + magnitude(outer) - holes.reduce((sum, hole) => sum + magnitude(hole), zero), zero);
}

export function checkFabrication(
  board: BoardDocument,
  kernel: PolygonKernel,
  geometry: ReturnType<typeof boardCopperGeometry>,
  outline: PolygonRegion,
  profile: NonNullable<ReturnType<typeof fabricationProfileFor>>,
): BoardIssue[] {
  const issues: BoardIssue[] = [];
  const { limits } = profile;
  if (
    !profile.layerCounts.includes(board.copperLayers.length) ||
    !profile.thicknessesNm.includes(board.fabrication.thicknessNm)
  ) {
    issues.push({
      code: 'fabrication-applicability',
      objects: [board.boardId],
      message:
        'Layer count or thickness is outside the selected fabrication profile.',
    });
  }
  const viaIds = new Set(board.vias?.map(({ id }) => id));
  const lands = new Map(
    geometry.features.map((feature) => [feature.id, feature]),
  );
  const openings = geometry.drills;
  for (let index = 0; index < openings.length; index++) {
    const drill = openings[index];
    const via = viaIds.has(drill.id);
    const required = drillWidthMinimum(limits, drill, via);
    if (drill.widthNm < required) {
      issues.push({
        code: 'fabrication-drill-width',
        objects: [drill.id],
        location: drill.start,
        measuredNm: drill.widthNm,
        requiredNm: required,
        message:
          'Drill or slot width is below the fabrication profile minimum.',
      });
    }
    if (drill.plated && !samePoint(drill.start, drill.end)) {
      const slotLength =
        Math.hypot(drill.end.x - drill.start.x, drill.end.y - drill.start.y) +
        drill.widthNm;
      const requiredLength = drill.widthNm * limits.minPlatedSlotRatio;
      if (slotLength < requiredLength) {
        issues.push({
          code: 'fabrication-slot-length',
          objects: [drill.id],
          location: drill.start,
          measuredNm: Math.round(slotLength),
          requiredNm: requiredLength,
          message: 'Plated slot is too short for its finished width.',
        });
      }
    }
    for (let next = index + 1; next < openings.length; next++) {
      const other = openings[next];
      const gap = drillGapNm(drill, other);
      const minimum =
        via && viaIds.has(other.id) ? limits.minViaGapNm : limits.minHoleGapNm;
      if (gap >= 0 && gap < minimum) {
        issues.push({
          code: 'fabrication-hole-spacing',
          objects: [drill.id, other.id],
          location: drill.start,
          measuredNm: Math.round(gap),
          requiredNm: minimum,
          message:
            'Spacing between drill or slot edges is below the fabrication profile minimum.',
        });
      }
    }
    if (via || !drill.plated) continue;
    const enlarged: PolygonRegion = {
      outer: capsulePolygon(
        drill.start,
        drill.end,
        drill.widthNm +
          2 * (limits.minPadAnnulusNm - TESSELLATION_TOLERANCE_NM),
      ),
      holes: [],
    };
    const bore: PolygonRegion = {
      outer: capsulePolygon(drill.start, drill.end, drill.widthNm),
      holes: [],
    };
    for (const { id: layer } of board.copperLayers) {
      const land = lands.get(drill.id + ':' + layer);
      if (
        land &&
        !kernel.boolean('difference', [enlarged], [land.region]).length
      )
        continue;
      const measured =
        !land || kernel.boolean('difference', [bore], [land.region]).length
          ? 0
          : boundaryDistance(land.region, bore);
      issues.push({
        code: 'fabrication-pad-annulus',
        objects: land ? [drill.id, land.id] : [drill.id],
        location: drill.start,
        measuredNm: measured,
        requiredNm: limits.minPadAnnulusNm,
        message:
          'Plated pad annular ring is below the fabrication profile minimum on ' +
          layer +
          '.',
      });
    }
  }

  const artwork = geometry.apertures.map(({ polygon, ...item }) => {
    const region: PolygonRegion = { outer: polygon, holes: [] };
    return { ...item, region, box: bounds(region) };
  });
  const mask = artwork.filter(({ kind }) => kind === 'mask');
  const minWeb = limits.minMaskWebNm;
  for (const [index, a] of mask.entries()) {
    for (const b of mask.slice(index + 1)) {
      if (a.side !== b.side || !near(a.box, b.box, minWeb)) continue;
      const distance = regionsTouch(a.region, b.region)
        ? 0
        : boundaryDistance(a.region, b.region);
      if (distance < minWeb) {
        issues.push({
          code: 'fabrication-mask-web',
          objects: [a.id, b.id],
          location: a.region.outer[0],
          measuredNm: distance,
          requiredNm: minWeb,
          message:
            'Solder-mask web is narrower than the fabrication profile minimum.',
        });
      }
    }
  }
  for (const aperture of artwork) {
    const land = lands.get(aperture.landId);
    if (land && aperture.kind === 'mask') {
      const expanded = limits.minMaskExpansionNm
        ? kernel.offset([land.region], limits.minMaskExpansionNm)
        : [land.region];
      const covered = kernel.boolean('difference', expanded, [aperture.region]);
      if (covered.length) {
        issues.push({
          code: 'fabrication-mask-expansion',
          objects: [aperture.id, land.id],
          location: covered[0].outer[0],
          requiredNm: limits.minMaskExpansionNm,
          message: 'Solder mask covers part of the copper land or its required opening margin.',
        });
      }
    }
    if (!land && aperture.kind === 'paste') {
      issues.push({
        code: 'fabrication-paste-no-land',
        objects: [aperture.id],
        location: aperture.region.outer[0],
        message: 'Paste aperture has no associated copper land on this side.',
      });
    }
    if (land && aperture.kind === 'paste') {
      const overlap = kernel.boolean('intersection', [land.region], [aperture.region]);
      const coverage = doubleArea(overlap) * BigInt(1000) / doubleArea([land.region]);
      const minimum = limits.minPasteLandCoveragePermille;
      if (coverage < BigInt(minimum)) {
        issues.push({
          code: 'fabrication-paste-coverage',
          objects: [aperture.id, land.id],
          location: land.anchor ?? land.region.outer[0],
          message: `Paste aperture covers ${Number(coverage) / 10}% of its copper land. The fabrication profile requires at least ${minimum / 10}%.`,
        });
      }
    }
    if (kernel.boolean('difference', [aperture.region], [outline]).length) {
      issues.push({
        code: 'fabrication-aperture-edge',
        objects: [aperture.id],
        location: aperture.region.outer[0],
        message: 'Solder mask or paste opening crosses the board profile.',
      });
    }
    if (
      aperture.kind === 'paste' &&
      !kernel.offset(
        [aperture.region],
        -limits.minPasteApertureNm / 2 + TESSELLATION_TOLERANCE_NM,
      ).length
    ) {
      issues.push({
        code: 'fabrication-paste-aperture',
        objects: [aperture.id],
        location: aperture.region.outer[0],
        requiredNm: limits.minPasteApertureNm,
        message:
          'Paste opening cannot contain the minimum fabrication aperture.',
      });
    }
  }
  return issues;
}
