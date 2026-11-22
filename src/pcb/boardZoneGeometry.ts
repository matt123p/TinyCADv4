import type { BoardDocument } from './board';
import { boardCopperGeometry } from './boardCopperGeometry';
import { boardRuleResolver } from './boardRules';
import { mountingKeepouts } from './boardMechanical';
import { profileRegion } from './contours';
import type { PolygonRegion } from './contours';
import { connectedCopperIslands, openingRegion, regionsTouch } from './copper';
import type { CopperFeature } from './copper';
import { pointInPolygon } from './geometry';
import type { PolygonKernel } from './polygonKernel';
import { fillZone } from './zoneFill';
import { measureThermalSpoke } from './thermalSpokeChecks';
import { measureRegionWidth } from './zoneWidthChecks';
import { routingRegionKeepouts } from './routingRegions';
import { regionalClearance } from './regionalClearance';
import { bounds, near } from './regionDistances';
import type { FilledThermalSpoke, ThermalConnection } from './zoneFill';

export interface ZoneIssue {
  readonly zoneId: string;
  readonly code:
    | 'missing-net'
    | 'island'
    | 'thermal-anchor'
    | 'thermal-disconnected'
    | 'thermal-spoke-missing'
    | 'thermal-spoke-width'
    | 'zone-minimum-width'
    | 'zone-width-unverified'
    | 'equal-priority';
  readonly objectId?: string;
  readonly direction?: FilledThermalSpoke['direction'];
  readonly location?: FilledThermalSpoke['anchor'];
  readonly measuredNm?: number;
  readonly requiredNm?: number;
  readonly detail?: string;
}

export interface BoardZoneGeometry {
  readonly fills: readonly CopperFeature[];
  readonly issues: readonly ZoneIssue[];
  readonly integrityChecked: boolean;
  readonly clearanceByFill?: ReadonlyMap<string, number>;
}

export function boardZoneGeometry(
  board: BoardDocument,
  kernel: PolygonKernel,
  geometry = boardCopperGeometry(board, { includeApertures: false }),
  measureIntegrity = false,
): BoardZoneGeometry {
  const fills: CopperFeature[] = [];
  const issues: ZoneIssue[] = [];
  if (!board.zones?.length)
    return { fills, issues, integrityChecked: measureIntegrity };

  const resolver = boardRuleResolver(board);
  const regional = regionalClearance(board, kernel);
  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  const nets = new Set(board.nets?.map(({ id }) => id));
  const drills = geometry.drills;
  const keepouts = mountingKeepouts(board);
  const drillClearances = new Map(
    board.mechanicalHoles?.map(({ id, clearanceNm }) => [id, clearanceNm ?? 0]),
  );
  const earlierZones: (typeof board.zones)[number][] = [];
  const clearanceByFill = new Map<string, number>();
  const widthChecks: {
    zoneId: string;
    fill: CopperFeature;
    requiredNm: number;
    thermalHalos: PolygonRegion[];
  }[] = [];
  const zones = [...board.zones].sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1),
  );

  for (const zone of zones) {
    if (!nets.has(zone.netId)) {
      issues.push({ zoneId: zone.id, code: 'missing-net' });
      continue;
    }

    const boundary = {
      outer: zone.outline,
      holes: zone.cutouts.map(({ outline }) => outline),
    };
    const samePriority = earlierZones.filter(
      ({ layerId, netId, priority }) =>
        layerId === zone.layerId &&
        netId !== zone.netId &&
        priority === zone.priority,
    );
    for (const other of samePriority) {
      const overlap = kernel.boolean(
        'intersection',
        [boundary],
        [
          {
            outer: other.outline,
            holes: other.cutouts.map(({ outline }) => outline),
          },
        ],
      );
      if (
        overlap.length &&
        kernel.boolean('intersection', overlap, [profile]).length
      )
        issues.push({
          zoneId: zone.id,
          code: 'equal-priority',
          objectId: other.id,
        });
    }
    earlierZones.push(zone);
    const rules = resolver.net(zone.netId);
    const clearanceNm = Math.max(rules.clearanceNm, zone.clearanceNm ?? 0);
    const thermals: ThermalConnection[] = [];
    const disconnected = new Set<string>();
    const connections = geometry.features.filter(
      ({ netId, layerId, anchor }) =>
        netId === zone.netId && layerId === zone.layerId && anchor,
    );
    for (const { kind, anchor, id, region } of connections) {
      const mode = kind === 'pad' ? zone.padConnection : zone.viaConnection;
      if (mode === 'direct') continue;
      if (mode === 'none') {
        disconnected.add(id);
        continue;
      }
      const inZone =
        pointInPolygon(anchor, boundary.outer) !== 'outside' &&
        boundary.holes.every(
          (hole) => pointInPolygon(anchor, hole) === 'outside',
        );
      if (!inZone) continue;
      if (pointInPolygon(anchor, region.outer) !== 'inside') {
        disconnected.add(id);
        issues.push({ zoneId: zone.id, code: 'thermal-anchor', objectId: id });
        continue;
      }
      thermals.push({
        padId: id,
        anchor,
        gapNm: zone.thermalGapNm,
        spokeWidthNm: zone.spokeWidthNm,
      });
    }

    const fixed = [...geometry.features, ...fills];
    const featureClearances = new Map(fixed.map((feature) => [
      feature.id,
      Math.max(
        feature.netId === zone.netId ? 0
          : resolver.copperClearance({ netId: zone.netId, kind: 'zone' }, feature),
        clearanceByFill.get(feature.id) ?? 0,
      ),
    ]));
    const spokes: FilledThermalSpoke[] = [];
    const regions = fillZone(kernel, {
      id: zone.id,
      layerId: zone.layerId,
      netId: zone.netId,
      boundary,
      profile,
      copper: fixed,
      keepouts: [
        ...[...keepouts, ...routingRegionKeepouts(board, 'zone', zone.netId)]
          .filter(({ side }) => side === zone.layerId)
          .map(({ copper }) => copper),
        ...regional.obstaclesFor(zone.layerId, zone.netId, fixed),
      ],
      drills,
      disconnected,
      featureClearances,
      drillClearances,
      thermals,
      recordSpoke: measureIntegrity
        ? (spoke) => {
            spokes.push(spoke);
          }
        : undefined,
      clearanceNm,
      edgeClearanceNm: rules.edgeClearanceNm,
    });
    const connected = new Set<string>();
    const connectedThermals = new Set<string>();
    if (regions.length && (zone.islands !== 'retain' || thermals.length)) {
      // Zone copper can only touch an existing same-net land on its own layer.
      // Full-board shorts and plated connectivity are checked after all fills.
      const anchors = fixed.filter(
        ({ netId, layerId }) =>
          netId === zone.netId && layerId === zone.layerId,
      );
      const islands = connectedCopperIslands(kernel, [...anchors, ...regions], drills);
      const zoneIds = new Set(regions.map(({ id }) => id));
      for (const island of islands) {
        const features = island.map(({ feature }) => feature);
        const isZone = ({ id }: CopperFeature) => zoneIds.has(id);
        const zoneFeatures = features.filter(isZone);
        if (!zoneFeatures.length) continue;
        for (const { id } of features) connectedThermals.add(id);
        if (
          features.some(
            (feature) => !isZone(feature) && feature.netId === zone.netId,
          )
        ) {
          for (const { id } of zoneFeatures) connected.add(id);
        }
      }
    }
    for (const thermal of thermals) {
      if (!connectedThermals.has(thermal.padId)) {
        issues.push({
          zoneId: zone.id,
          code: 'thermal-disconnected',
          objectId: thermal.padId,
        });
      }
    }
    if (spokes.length) {
      const retained =
        zone.islands === 'remove' &&
        regions.some(({ id }) => !connected.has(id))
          ? regions
              .filter(({ id }) => connected.has(id))
              .map(({ region }) => region)
          : undefined;
      for (const spoke of spokes) {
        const requiredNm = Math.max(rules.minWidthNm, spoke.widthNm);
        const result = measureThermalSpoke(kernel, spoke, requiredNm, retained);
        if (result)
          issues.push({
            zoneId: zone.id,
            objectId: spoke.padId,
            direction: spoke.direction,
            location: spoke.anchor,
            requiredNm,
            ...result,
          });
      }
    }
    const thermalHalos = spokes.flatMap(({ halo }) => halo);
    for (const feature of regions) {
      const island = !connected.has(feature.id);
      if (island && zone.islands === 'remove') continue;
      if (island && zone.islands === 'flag')
        issues.push({ zoneId: zone.id, code: 'island', objectId: feature.id });
      if (measureIntegrity) widthChecks.push({
        zoneId: zone.id, fill: feature, requiredNm: rules.minWidthNm, thermalHalos,
      });
      fills.push(feature);
      clearanceByFill.set(feature.id, clearanceNm);
    }
  }
  if (widthChecks.length) {
    const copper = [...geometry.features, ...fills].map((feature) =>
      ({ feature, box: bounds(feature.region) }));
    const voids = drills.map((drill) => {
      const region = openingRegion(drill);
      return { region, box: bounds(region) };
    });
    for (const { zoneId, fill, requiredNm, thermalHalos } of widthChecks) {
      try {
        let regions = [fill.region];
        const box = bounds(fill.region);
        const neighbours = copper.filter(({ feature, box: other }) =>
          feature !== fill && feature.netId === fill.netId && feature.layerId === fill.layerId &&
          near(box, other, 0) && regionsTouch(fill.region, feature.region));
        if (neighbours.length) {
          const joined = kernel.boolean('union', [fill.region, ...neighbours.map(({ feature }) => feature.region)], []);
          regions = joined.flatMap((region) => {
            const joinedBox = bounds(region);
            return kernel.boolean('difference', [region], voids
              .filter(({ box: opening }) => near(joinedBox, opening, 0))
              .map(({ region }) => region));
          });
        }
        for (const region of regions) {
          const narrow = measureRegionWidth(kernel, region, requiredNm, { thermalHalos, filledZone: fill.region });
          if (narrow) issues.push({
            zoneId, code: 'zone-minimum-width', objectId: fill.id, requiredNm, ...narrow,
          });
        }
      } catch (error) {
        issues.push({
          zoneId, code: 'zone-width-unverified', objectId: fill.id,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { fills, issues, integrityChecked: measureIntegrity, clearanceByFill };
}
