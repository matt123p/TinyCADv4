import type { BoardDocument } from './board';
import type { BoardIssue } from './boardChecks';
import type { boardCopperGeometry } from './boardCopperGeometry';
import type { PolygonRegion } from './contours';
import { artworkGap, coveredMaskMargin, pasteFitsMinimum, pasteLandCoverage } from './fabricationArtwork';
import { openingSpacingLimit, padAnnulusProbe, platedSlotLength } from './fabricationOpenings';
import { drillWidthLimit } from './fabricationProfiles';
import type { fabricationProfileFor } from './fabricationProfiles';
import type { PolygonKernel } from './polygonKernel';
import { bounds, drillGapNm, near } from './regionDistances';

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
    const widthRule = drillWidthLimit(drill, via);
    const required = limits[widthRule];
    if (drill.widthNm < required) {
      issues.push({
        code: 'fabrication-drill-width',
        ruleIds: [widthRule],
        objects: [drill.id],
        location: drill.start,
        measuredNm: drill.widthNm,
        requiredNm: required,
        message:
          'Drill or slot width is below the fabrication profile minimum.',
      });
    }
    const slot = platedSlotLength(drill, limits);
    if (slot && slot.measuredNm < slot.requiredNm) {
      issues.push({
        code: 'fabrication-slot-length',
        objects: [drill.id],
        location: drill.start,
        measuredNm: Math.round(slot.measuredNm),
        requiredNm: slot.requiredNm,
        message: 'Plated slot is too short for its finished width.',
      });
    }
    for (let next = index + 1; next < openings.length; next++) {
      const other = openings[next];
      const gapNm = drillGapNm(drill, other);
      const spacingRule = openingSpacingLimit(via && viaIds.has(other.id));
      const requiredNm = limits[spacingRule];
      if (gapNm >= 0 && gapNm < requiredNm) {
        issues.push({
          code: 'fabrication-hole-spacing',
          ruleIds: [spacingRule],
          objects: [drill.id, other.id],
          location: drill.start,
          measuredNm: Math.round(gapNm),
          requiredNm,
          message:
            'Spacing between drill or slot edges is below the fabrication profile minimum.',
        });
      }
    }
    if (via || !drill.plated) continue;
    const annulus = padAnnulusProbe(drill, limits.minPadAnnulusNm, kernel);
    for (const { id: layer } of board.copperLayers) {
      const land = lands.get(drill.id + ':' + layer);
      if (annulus.passes(land?.region)) continue;
      issues.push({
        code: 'fabrication-pad-annulus',
        ruleIds: ['minPadAnnulusNm'],
        objects: land ? [drill.id, land.id] : [drill.id],
        layers: ['copper-' + layer],
        location: drill.start,
        measuredNm: annulus.measuredNm(land?.region),
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
      const { measuredNm: distance } = artworkGap(a.region, b.region);
      if (distance < minWeb) {
        issues.push({
          code: 'fabrication-mask-web',
          ruleIds: ['minMaskWebNm'],
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
      const covered = coveredMaskMargin(aperture.region, land.region, limits.minMaskExpansionNm, kernel);
      if (covered.length) {
        issues.push({
          code: 'fabrication-mask-expansion',
          ruleIds: ['minMaskExpansionNm'],
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
      const coverage = pasteLandCoverage(aperture.region, land.region, kernel);
      const minimum = limits.minPasteLandCoveragePermille;
      if (coverage < minimum) {
        issues.push({
          code: 'fabrication-paste-coverage',
          measurement: { unit: 'permille', measured: coverage, required: minimum },
          ruleIds: ['minPasteLandCoveragePermille'],
          objects: [aperture.id, land.id],
          location: land.anchor ?? land.region.outer[0],
          message: `Paste aperture covers ${coverage / 10}% of its copper land. The fabrication profile requires at least ${minimum / 10}%.`,
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
      !pasteFitsMinimum(aperture.region, limits.minPasteApertureNm, kernel)
    ) {
      issues.push({
        code: 'fabrication-paste-aperture',
        ruleIds: ['minPasteApertureNm'],
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
