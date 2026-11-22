import type { BoardDocument } from './board';
import { boardCopperGeometry } from './boardCopperGeometry';
import { boardZoneGeometry } from './boardZoneGeometry';
import { analyseCopper, regionsTouch } from './copper';
import { capsulePolygon } from './contours';
import { canonicalDeviceJson } from './deviceLibrary';
import { pairFootprintPads } from './footprint';
import type { PolygonKernel } from './polygonKernel';
import type { PolygonRegion } from './contours';

function placedPadIds(before: BoardDocument, after: BoardDocument) {
  function definitions(board: BoardDocument) {
    const devices = new Map(board.deviceDefinitions?.map(({ id, footprintId }) => [id, footprintId]));
    const footprints = new Map(board.footprintDefinitions?.map(({ id, pads }) => [id, pads]));
    return new Map(board.footprints?.map(({ id, deviceId }) =>
      [id, footprints.get(devices.get(deviceId)) ?? []]));
  }
  const next = definitions(after);
  return [...definitions(before)].flatMap(([placementId, pads]) => {
    const replacement = next.get(placementId);
    if (!replacement || replacement === pads) return [];
    return pairFootprintPads(pads, replacement).flatMap(([a, b]) =>
      a && b && a.id !== b.id
        ? [[placementId + ':' + a.id, placementId + ':' + b.id] as const]
        : [],
    );
  });
}

function excludeEquivalent<T extends { id: string }>(
  changed: Set<string>, before: ReadonlyMap<string, T>, after: ReadonlyMap<string, T>,
  oldId: string, newId: string,
) {
  const a = before.get(oldId);
  const b = after.get(newId);
  if (!a || !b) return;
  const { id: oldKey, ...oldGeometry } = a;
  const { id: newKey, ...newGeometry } = b;
  if (canonicalDeviceJson(oldGeometry) === canonicalDeviceJson(newGeometry)) {
    changed.delete(oldKey);
    changed.delete(newKey);
  }
}

export async function reviewCircuitCopper(
  before: BoardDocument,
  after: BoardDocument,
  loadKernel?: () => Promise<PolygonKernel>,
) {
  const unchanged = {
    candidate: after,
    affected: [] as { id: string; unassigned: boolean }[],
    shorts: [] as ReturnType<typeof analyseCopper>['shorts'],
    opens: [] as ReturnType<typeof analyseCopper>['assembledOpens']['nets'],
  };
  const routes = [...(before.tracks ?? []), ...(before.vias ?? [])];

  const beforeNets = new Set(before.nets?.map(({ id }) => id));
  const afterNets = new Set(after.nets?.map(({ id }) => id));
  const retired = routes.filter(({ netId }) => netId && !afterNets.has(netId));
  const retiredZones = before.zones?.some(({ netId }) => !afterNets.has(netId));
  const oldGeometry = boardCopperGeometry(before, { availableNets: beforeNets, includeApertures: false });
  const newGeometry = boardCopperGeometry(after, { availableNets: afterNets, includeApertures: false });
  const priorFeatures = new Map(
    oldGeometry.features
      .filter(({ kind }) => kind === 'pad')
      .map((feature) => [feature.id, feature]),
  );
  const nextFeatures = new Map(
    newGeometry.features
      .filter(({ kind }) => kind === 'pad')
      .map((feature) => [feature.id, feature]),
  );
  const changedPads = new Set(
    [...new Set([...priorFeatures.keys(), ...nextFeatures.keys()])].filter(
      (id) =>
        canonicalDeviceJson(priorFeatures.get(id)) !==
        canonicalDeviceJson(nextFeatures.get(id)),
    ),
  );
  const priorDrills = new Map(
    oldGeometry.drills.map((drill) => [drill.id, drill]),
  );
  const nextDrills = new Map(
    newGeometry.drills.map((drill) => [drill.id, drill]),
  );
  const changedDrills = new Set([
    ...new Set([...priorDrills.keys(), ...nextDrills.keys()]),
  ].filter(
    (id) =>
      canonicalDeviceJson(priorDrills.get(id)) !==
      canonicalDeviceJson(nextDrills.get(id)),
  ));
  // Family variants have different pad UUIDs even when a labelled land is unchanged.
  for (const [a, b] of placedPadIds(before, after)) {
    for (const layer of ['top', 'bottom'])
      excludeEquivalent(changedPads, priorFeatures, nextFeatures, a + ':' + layer, b + ':' + layer);
    excludeEquivalent(changedDrills, priorDrills, nextDrills, a, b);
  }
  if (!changedPads.size && !changedDrills.size && !retired.length && !retiredZones)
    return unchanged;

  if (!loadKernel)
    throw new Error(
      'PCB geometry analysis is needed to review affected copper.',
    );
  const kernel = await loadKernel();
  function topology(board: BoardDocument, geometry: typeof oldGeometry) {
    const zones = boardZoneGeometry(board, kernel, geometry);
    return analyseCopper(
      kernel,
      [...geometry.features, ...zones.fills],
      geometry.drills,
      geometry.assemblyLinks,
    );
  }
  const oldTopology = topology(before, oldGeometry);
  const newTopology = topology(after, newGeometry);
  function openKey({ netId, terminalGroups }: (typeof unchanged.opens)[number]) {
    const groups = terminalGroups.map((group) => JSON.stringify([...group].sort()));
    return JSON.stringify([netId, groups.sort()]);
  }
  const oldOpens = new Set(oldTopology.assembledOpens.nets.map(openKey));
  const opens = newTopology.assembledOpens.nets.filter(
    (open) => !oldOpens.has(openKey(open)),
  );
  const featureId = (fragment: string) => fragment.split('/')[0];
  const routeIds = (fragments: string[]) =>
    fragments.flatMap((fragment) => {
      const route = newGeometry.owners.get(featureId(fragment));
      return route ? [route] : [];
    });
  const changedVoids = [...changedDrills].flatMap((id) =>
    [priorDrills.get(id), nextDrills.get(id)].flatMap(
      (drill): PolygonRegion[] =>
        drill
          ? [
              {
                outer: capsulePolygon(drill.start, drill.end, drill.widthNm),
                holes: [],
              },
            ]
          : [],
    ),
  );
  const touchedFeatures = new Set(changedPads);
  for (const item of [...oldGeometry.features, ...newGeometry.features]) {
    if (
      changedVoids.some((voidRegion) => regionsTouch(item.region, voidRegion))
    )
      touchedFeatures.add(item.id);
  }
  const touched = [oldTopology, newTopology].flatMap(({ connectedSets }) =>
    connectedSets.flatMap((island) =>
      island.some((fragment) => touchedFeatures.has(featureId(fragment)))
        ? routeIds(island)
        : [],
    ),
  );
  const previouslyFloating = new Set(routeIds(oldTopology.floatingFragments));
  const newlyFloating = routeIds(newTopology.floatingFragments).filter(
    (route) => !previouslyFloating.has(route),
  );
  const unassigned = new Set([
    ...retired.map(({ id }) => id),
    ...newlyFloating,
  ]);
  const affected = new Set([...touched, ...unassigned]);
  const shorts = newTopology.shorts.filter(
    ({ fragments }) =>
      fragments.some((fragment) => touchedFeatures.has(featureId(fragment))) ||
      routeIds(fragments).some((id) => affected.has(id)),
  );
  const flag = <T extends (typeof routes)[number]>(item: T): T => {
    if (!affected.has(item.id)) return item;
    if (!unassigned.has(item.id)) return { ...item, reviewRequired: true };
    const { netId, ...route } = item;
    return { ...route, reviewRequired: true } as T;
  };
  return {
    candidate: {
      ...after,
      ...(after.tracks ? { tracks: after.tracks.map(flag) } : {}),
      ...(after.vias ? { vias: after.vias.map(flag) } : {}),
    },
    affected: routes.flatMap(({ id }) =>
      affected.has(id) ? [{ id, unassigned: unassigned.has(id) }] : [],
    ),
    shorts,
    opens,
  };
}
