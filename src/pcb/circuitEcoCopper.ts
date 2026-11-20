import type { BoardDocument } from './board';
import { routeGeometry } from './boardRouting';
import { analyseCopper, regionsTouch } from './copper';
import { capsulePolygon } from './contours';
import { canonicalDeviceJson } from './deviceLibrary';
import { placeEmbeddedDevice } from './padstack';
import type { PolygonKernel } from './polygonKernel';
import type { PolygonRegion } from './contours';

function geometry(board: BoardDocument, availableNets: ReadonlySet<string>) {
  const routing = routeGeometry(board);
  const { features, drills, owners } = routing;
  const devices = new Map(
    board.deviceDefinitions?.map((item) => [item.id, item]),
  );
  const components = new Map(board.components?.map((item) => [item.id, item]));
  for (const footprint of board.footprints ?? []) {
    const device = devices.get(footprint.deviceId);
    const signals = new Map(
      components
        .get(footprint.componentId)
        ?.signals?.map(({ signalId, netId }) => [signalId, netId]),
    );
    const placed = placeEmbeddedDevice(
      board,
      footprint.id,
      device.signalIds.map((signalId) => ({
        signalId,
        terminalId: `${footprint.componentId}:${signalId}`,
        netId: signals.get(signalId),
      })),
    );
    features.push(...placed.copper);
    drills.push(...placed.drills);
  }
  // Retired route nets are removed from the intended topology before diagnosing contact.
  return {
    ...routing,
    owners,
    features: features.map((feature) =>
      owners.has(feature.id) && !availableNets.has(feature.netId)
        ? { ...feature, netId: undefined }
        : feature,
    ),
  };
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
  };
  const routes = [...(before.tracks ?? []), ...(before.vias ?? [])];
  if (!routes.length) return unchanged;

  const beforeNets = new Set(before.nets?.map(({ id }) => id));
  const afterNets = new Set(after.nets?.map(({ id }) => id));
  const retired = routes.filter(({ netId }) => netId && !afterNets.has(netId));
  const oldGeometry = geometry(before, beforeNets);
  const newGeometry = geometry(after, afterNets);
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
  const changedDrills = [
    ...new Set([...priorDrills.keys(), ...nextDrills.keys()]),
  ].filter(
    (id) =>
      canonicalDeviceJson(priorDrills.get(id)) !==
      canonicalDeviceJson(nextDrills.get(id)),
  );
  if (!changedPads.size && !changedDrills.length && !retired.length)
    return unchanged;

  if (!loadKernel)
    throw new Error(
      'PCB geometry analysis is needed to review affected copper.',
    );
  const kernel = await loadKernel();
  const oldTopology = analyseCopper(
    kernel,
    oldGeometry.features,
    oldGeometry.drills,
  );
  const newTopology = analyseCopper(
    kernel,
    newGeometry.features,
    newGeometry.drills,
  );
  const featureId = (fragment: string) => fragment.split('/')[0];
  const routeIds = (fragments: string[]) =>
    fragments.flatMap((fragment) => {
      const route = newGeometry.owners.get(featureId(fragment));
      return route ? [route] : [];
    });
  const changedVoids = changedDrills.flatMap((id) =>
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
  };
}
