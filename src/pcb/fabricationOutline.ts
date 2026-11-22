import type { PolygonRegion } from './contours';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';
import { measureRegionWidth } from './zoneWidthChecks';

export interface OutlineFeatureCheck {
  readonly name: string;
  readonly rule: 'minOutlineWebNm' | 'minNonPlatedSlotNm';
  readonly requiredNm: number;
  readonly result: 'passed' | 'failed' | 'unverified';
  readonly measuredNm?: number;
  readonly location?: BoardPoint;
  readonly detail?: string;
}

export function inspectFabricationOutline(
  kernel: PolygonKernel,
  profile: PolygonRegion,
  limits: { minOutlineWebNm: number; minNonPlatedSlotNm: number },
): OutlineFeatureCheck[] {
  function inspect(
    name: string, rule: OutlineFeatureCheck['rule'], region: PolygonRegion, outside = false,
  ): OutlineFeatureCheck {
    const requiredNm = limits[rule];
    const check = { name, rule, requiredNm };
    try {
      const narrow = measureRegionWidth(kernel, region, requiredNm, { outside });
      return narrow
        ? { ...check, ...narrow, result: 'failed' }
        : { ...check, result: 'passed' };
    } catch (failure) {
      return {
        ...check,
        result: 'unverified',
        detail: failure instanceof Error ? failure.message : String(failure),
      };
    }
  }

  return [
    inspect('Board material', 'minOutlineWebNm', profile),
    inspect('Open notches', 'minNonPlatedSlotNm', { outer: profile.outer, holes: [] }, true),
    ...profile.holes.map((outer, index) =>
      inspect('Cutout ' + (index + 1), 'minNonPlatedSlotNm', { outer, holes: [] })),
  ];
}
