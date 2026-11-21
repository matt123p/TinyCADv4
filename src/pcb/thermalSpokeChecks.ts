import { TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import type { PolygonKernel } from './polygonKernel';
import type { FilledThermalSpoke } from './zoneFill';

const widthToleranceNm = 2 * TESSELLATION_TOLERANCE_NM;

export function measureThermalSpoke(
  kernel: PolygonKernel,
  spoke: FilledThermalSpoke,
  requiredNm: number,
  retained?: readonly PolygonRegion[],
) {
  const copper = retained
    ? kernel.boolean('intersection', spoke.copper, retained)
    : spoke.copper;
  const bridges = (regions: readonly PolygonRegion[]) =>
    regions.some(
      (region) =>
        kernel.boolean('intersection', [region], [spoke.pad]).length &&
        kernel.boolean('difference', [region], spoke.halo).length,
    );

  if (!bridges(copper))
    return { code: 'thermal-spoke-missing' as const, measuredNm: 0 };

  // A centre path survives this inset only if the filled spoke can carry
  // a disk of the given radius between the land and the surrounding pour.
  const supportsRadius = (radius: number) =>
    bridges(kernel.offset(copper, -radius));
  let low = 0;
  let high = Math.floor((requiredNm - widthToleranceNm) / 2);
  if (high <= 0 || supportsRadius(high)) return undefined;
  while (high - low > widthToleranceNm / 2) {
    const radius = Math.floor((low + high) / 2);
    if (supportsRadius(radius)) low = radius;
    else high = radius;
  }
  return { code: 'thermal-spoke-width' as const, measuredNm: low * 2 };
}
