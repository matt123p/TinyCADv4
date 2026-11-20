import { validateBoard } from './board';
import type { BoardDocument } from './board';
import type { BoardFootprint } from './boardAssets';
import { profileRegion } from './contours';
import { placeFootprintPoint } from './footprint';
import { isBoardPoint, pointInPolygon } from './geometry';
import { stableHierarchyId } from './hierarchicalNetlist';
import { placeEmbeddedDevice } from './padstack';

export async function placeUnplacedComponent(
  board: BoardDocument,
  componentId: string,
  placement: Pick<
    BoardFootprint,
    'positionNm' | 'rotationMicrodegree' | 'side'
  >,
): Promise<BoardDocument> {
  const component = board.components?.find(({ id }) => id === componentId);
  if (!component?.deviceId)
    throw new Error('The component needs a reviewed device before placement.');
  if (
    board.footprints?.some(({ componentId: placed }) => placed === componentId)
  )
    throw new Error('The component is already placed.');
  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  if (
    !isBoardPoint(placement.positionNm) ||
    pointInPolygon(placement.positionNm, profile.outer) !== 'inside' ||
    profile.holes.some(
      (cutout) => pointInPolygon(placement.positionNm, cutout) !== 'outside',
    )
  )
    throw new Error(
      'Place the footprint origin inside the board outline and outside its cutouts.',
    );
  if (!board.copperLayers.some(({ id }) => id === placement.side))
    throw new Error('Choose a side with a physical copper layer.');
  return validateBoard({
    ...board,
    revision: board.revision + 1,
    footprints: [
      ...(board.footprints ?? []),
      {
        ...placement,
        id: await stableHierarchyId(
          'board-footprint',
          board.boardId,
          componentId,
        ),
        componentId,
        deviceId: component.deviceId,
        locked: false,
      },
    ],
  });
}

export function boardPlacementView(board: BoardDocument) {
  const devices = new Map(
    board.deviceDefinitions?.map((device) => [device.id, device]),
  );
  const definitions = new Map(
    board.footprintDefinitions?.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const components = new Map(
    board.components?.map((component) => [component.id, component]),
  );
  const profile = board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
  const features = (board.footprints ?? []).flatMap((placement) => {
    const component = components.get(placement.componentId);
    const device = devices.get(placement.deviceId);
    const definition = definitions.get(device?.footprintId);
    if (!definition || !component || !device) return [];
    const bindings = new Map(
      component.signals?.map(({ signalId, netId }) => [signalId, netId]),
    );
    const assignments = new Map(
      device.assignments.map((assignment) => [assignment.padId, assignment]),
    );
    const pads = definition.pads.map(({ id, positionNm, label }) => {
      const assignment = assignments.get(id);
      return {
        id,
        label,
        position: placeFootprintPoint(positionNm, placement),
        netId:
          assignment?.kind === 'signal'
            ? bindings.get(assignment.signalId)
            : undefined,
      };
    });
    const copper = definition.pads.every(({ stack }) => !!stack)
      ? placeEmbeddedDevice(
          board,
          placement.id,
          device.signalIds.map((signalId) => ({
            signalId,
            netId: bindings.get(signalId),
            terminalId: component.id + ':' + signalId,
          })),
        ).copper
      : [];
    return [
      {
        id: component.id,
        label: component.reference ?? definition.name,
        placement,
        pads,
        copper,
      },
    ];
  });
  return { profile, features };
}
