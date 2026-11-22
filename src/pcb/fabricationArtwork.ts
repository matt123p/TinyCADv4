import { TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import { regionsTouch } from './copper';
import { signedDoubleArea } from './geometry';
import type { PolygonKernel } from './polygonKernel';
import { boundaryDistance } from './regionDistances';

export function artworkGap(first: PolygonRegion, second: PolygonRegion) {
  const touching = regionsTouch(first, second);
  return { touching, measuredNm: touching ? 0 : boundaryDistance(first, second) };
}

export function coveredMaskMargin(
  aperture: PolygonRegion, land: PolygonRegion, minimumNm: number, kernel: PolygonKernel,
) {
  const expanded = minimumNm ? kernel.offset([land], minimumNm) : [land];
  return kernel.boolean('difference', expanded, [aperture]);
}

function doubleArea(regions: readonly PolygonRegion[]): bigint {
  const zero = BigInt(0);
  const magnitude = (ring: PolygonRegion['outer']) => {
    const area = signedDoubleArea(ring);
    return area < zero ? -area : area;
  };
  return regions.reduce((total, { outer, holes }) =>
    total + magnitude(outer) - holes.reduce((sum, hole) => sum + magnitude(hole), zero), zero);
}

export function pasteLandCoverage(aperture: PolygonRegion, land: PolygonRegion, kernel: PolygonKernel) {
  const overlap = kernel.boolean('intersection', [land], [aperture]);
  return Number(doubleArea(overlap) * BigInt(1000) / doubleArea([land]));
}

export function pasteFitsMinimum(aperture: PolygonRegion, minimumNm: number, kernel: PolygonKernel) {
  return kernel.offset([aperture], -minimumNm / 2 + TESSELLATION_TOLERANCE_NM).length > 0;
}
