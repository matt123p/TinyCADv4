import { wireJumperGeometry } from './boardJumpers';
import type { BoardDocument } from './board';
import { routeGeometry, viaIsTented } from './boardRouting';
import { capsulePolygon } from './contours';
import { fabricationProfileFor } from './fabricationProfiles';
import { placeEmbeddedDevice } from './padstack';

export function boardCopperGeometry(
  board: BoardDocument,
  {
    availableNets = new Set(board.nets?.map(({ id }) => id)),
    includeApertures = true,
  }: { availableNets?: ReadonlySet<string>; includeApertures?: boolean } = {},
) {
  const routing = routeGeometry(board);
  const { features, drills, owners } = routing;
  const apertures: ReturnType<typeof placeEmbeddedDevice>['apertures'] = [];
  if (includeApertures) {
    const maskExpansionNm = fabricationProfileFor(board)?.limits.minMaskExpansionNm ?? 0;
    for (const via of board.vias ?? []) {
      for (const { id: side } of board.copperLayers) {
        if (viaIsTented(via, side)) continue;
        apertures.push({
          id: `${via.id}:mask:${side}`,
          kind: 'mask',
          side,
          landId: `${via.id}:${side}`,
          polygon: capsulePolygon(via.positionNm, via.positionNm, via.diameterNm + 2 * maskExpansionNm),
        });
      }
    }
  }
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
      { includeApertures },
    );
    features.push(...placed.copper);
    drills.push(...placed.drills);
    apertures.push(...placed.apertures);
  }
  const jumpers = wireJumperGeometry(board, availableNets);
  features.push(...jumpers.features);
  drills.push(...jumpers.drills);
  // Retired route nets are removed from the intended topology before diagnosing contact.
  return {
    ...routing,
    owners,
    apertures,
    assemblyLinks: jumpers.links,
    jumperDrillIds: new Set(jumpers.drills.map(({ id }) => id)),
    features: features.map((feature) =>
      owners.has(feature.id) && !availableNets.has(feature.netId)
        ? { ...feature, netId: undefined }
        : feature,
    ),
  };
}
