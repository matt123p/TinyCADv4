import type { CopperLayer } from './board';
import { capsulePolygon, TESSELLATION_TOLERANCE_NM } from './contours';
import type { PolygonRegion } from './contours';
import type { BoardDrill, CopperFeature } from './copper';
import { isBoardPoint, pointInPolygon } from './geometry';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

export interface ThermalConnection {
  readonly padId: string;
  readonly anchor: BoardPoint;
  readonly spokeWidthNm: number;
  readonly gapNm: number;
}

export interface FilledThermalSpoke {
  readonly padId: string;
  readonly anchor: BoardPoint;
  readonly direction: 'east' | 'north' | 'west' | 'south';
  readonly widthNm: number;
  readonly pad: PolygonRegion;
  readonly halo: readonly PolygonRegion[];
  readonly copper: readonly PolygonRegion[];
}

const directions = ['east', 'north', 'west', 'south'] as const;

export interface ZoneRequest {
  readonly id: string;
  readonly layerId: CopperLayer['id'];
  readonly netId: string;
  readonly boundary: PolygonRegion;
  readonly profile: PolygonRegion;
  readonly copper: readonly CopperFeature[];
  readonly drills: readonly BoardDrill[];
  readonly keepouts?: readonly PolygonRegion[];
  readonly thermals: readonly ThermalConnection[];
  readonly disconnected?: ReadonlySet<string>;
  readonly featureClearances?: ReadonlyMap<string, number>;
  readonly drillClearances?: ReadonlyMap<string, number>;
  readonly clearanceNm: number;
  readonly edgeClearanceNm: number;
  readonly recordSpoke?: (spoke: FilledThermalSpoke) => void;
}

/** Produces positive copper. Higher-priority zone copper can be passed in as obstacles. */
export function fillZone(
  kernel: PolygonKernel,
  request: ZoneRequest,
): CopperFeature[] {
  const {
    id,
    layerId,
    netId,
    profile,
    boundary,
    thermals,
    clearanceNm,
    edgeClearanceNm,
  } = request;
  if (
    !id ||
    id.includes('/') ||
    !netId ||
    ![clearanceNm, edgeClearanceNm].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) {
    throw new Error('Invalid zone identity or clearance.');
  }
  const padding = 2 * TESSELLATION_TOLERANCE_NM;
  const available = kernel.boolean(
    'intersection',
    [boundary],
    kernel.offset([profile], -edgeClearanceNm - padding),
  );
  const onLayer = request.copper.filter(
    (feature) => feature.layerId === layerId,
  );
  const byClearance = new Map<number, PolygonRegion[]>();
  for (const feature of onLayer) {
    if (feature.netId === netId && !request.disconnected?.has(feature.id))
      continue;
    const required = Math.max(
      clearanceNm,
      request.featureClearances?.get(feature.id) ?? 0,
    );
    const regions = byClearance.get(required) ?? [];
    regions.push(feature.region);
    byClearance.set(required, regions);
  }
  const foreign = [...byClearance].flatMap(([distance, regions]) =>
    kernel.offset(regions, distance + padding),
  );
  const voids = request.drills.flatMap((drill) =>
    kernel.offset(
      [
        {
          outer: capsulePolygon(drill.start, drill.end, drill.widthNm),
          holes: [],
        },
      ],
      padding +
        Math.max(
          drill.plated ? 0 : clearanceNm,
          request.drillClearances?.get(drill.id) ?? 0,
        ),
    ),
  );
  const keepouts = kernel.offset(request.keepouts ?? [], padding);
  const base = kernel.boolean('difference', available, [...foreign, ...voids, ...keepouts]);
  const reliefs: {
    thermal: ThermalConnection;
    pad: PolygonRegion;
    halo: PolygonRegion[];
    spokes: PolygonRegion[];
  }[] = [];
  const seen = new Set<string>();
  for (const thermal of thermals) {
    const pad = onLayer.find(
      ({ id, kind, netId: padNet }) =>
        id === thermal.padId &&
        (kind === 'pad' || kind === 'track' || kind === 'via') &&
        padNet === netId,
    );
    if (
      !pad ||
      seen.has(thermal.padId) ||
      !isBoardPoint(thermal.anchor) ||
      pointInPolygon(thermal.anchor, pad.region.outer) !== 'inside' ||
      pad.region.holes.some(
        (hole) => pointInPolygon(thermal.anchor, hole) !== 'outside',
      ) ||
      !Number.isSafeInteger(thermal.spokeWidthNm) ||
      thermal.spokeWidthNm < 2 ||
      !Number.isSafeInteger(thermal.gapNm) ||
      thermal.gapNm < 1
    )
      throw new Error('Invalid or duplicate thermal pad or dimensions.');
    seen.add(thermal.padId);
    const halo = kernel.offset([pad.region], thermal.gapNm + padding);
    const points = halo.flatMap(({ outer }) => outer);
    let radius = thermal.spokeWidthNm;
    for (const point of points) {
      radius = Math.max(
        radius,
        Math.abs(point.x - thermal.anchor.x) + thermal.spokeWidthNm,
        Math.abs(point.y - thermal.anchor.y) + thermal.spokeWidthNm,
      );
    }
    const spokes: PolygonRegion[] = [];
    for (const [x, y] of [
      [radius, 0],
      [0, radius],
      [-radius, 0],
      [0, -radius],
    ]) {
      spokes.push({
        outer: capsulePolygon(
          thermal.anchor,
          { x: thermal.anchor.x + x, y: thermal.anchor.y + y },
          thermal.spokeWidthNm,
        ),
        holes: [],
      });
    }
    reliefs.push({ thermal, pad: pad.region, halo, spokes });
  }
  const clearances = reliefs.flatMap(({ halo }) => halo);
  const withoutReliefs = kernel.boolean('difference', base, clearances);
  const validSpokes = reliefs.flatMap(
    ({ thermal, pad, halo, spokes }, index) => {
      const obstacles = reliefs.flatMap(({ halo }, other) =>
        other === index ? [] : halo,
      );
      const copper = kernel.boolean(
        'difference',
        kernel.boolean('intersection', spokes, base),
        obstacles,
      );
      if (request.recordSpoke) {
        spokes.forEach((spoke, direction) => {
          request.recordSpoke({
            padId: thermal.padId,
            anchor: thermal.anchor,
            direction: directions[direction],
            widthNm: thermal.spokeWidthNm,
            pad,
            halo,
            copper: kernel.boolean('intersection', copper, [spoke]),
          });
        });
      }
      return copper;
    },
  );
  return kernel
    .boolean('union', withoutReliefs, validSpokes)
    .map((region, index) => ({
      id: `${id}-${index}`,
      layerId,
      netId,
      kind: 'zone',
      region,
    }));
}
