import { validateBoard } from './board';
import type { BoardDocument } from './board';
import type {
  BoardComponent,
  BoardFootprint,
  EmbeddedDevice,
  EmbeddedFootprint,
} from './boardAssets';
import { profileRegion } from './contours';
import { placeFootprintPoint } from './footprint';
import type { FootprintPlacement } from './footprint';
import { isBoardPoint, pointInPolygon, samePoint } from './geometry';
import type { BoardPoint } from './geometry';
import { stableHierarchyId } from './stableHierarchyId';
import { placeEmbeddedDevice } from './padstack';

export async function placeUnplacedComponent(
  board: BoardDocument,
  componentId: string,
  placement: FootprintPlacement,
): Promise<BoardDocument> {
  const component = board.components?.find(({ id }) => id === componentId);
  if (!component?.deviceId)
    throw new Error('The component needs a reviewed device before placement.');
  if (
    board.footprints?.some(({ componentId: placed }) => placed === componentId)
  )
    throw new Error('The component is already placed.');
  validatePlacementLocation(board, placement);
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

function placementProfile(board: BoardDocument) {
  return board.profile
    ? profileRegion(board.profile)
    : { outer: board.outline, holes: [] };
}

function validatePlacementLocation(
  board: BoardDocument,
  placement: Pick<BoardFootprint, 'positionNm' | 'side'>,
  profile = placementProfile(board),
) {
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
}

function validatePlacementLocks(
  previous: BoardFootprint,
  next: FootprintPlacement,
) {
  const moved = !samePoint(previous.positionNm, next.positionNm);
  const rotated = previous.rotationMicrodegree !== next.rotationMicrodegree;
  if (previous.locked && (moved || rotated || previous.side !== next.side))
    throw new Error('Unlock the component before changing its placement.');
  if (previous.positionLocked && moved)
    throw new Error('Unlock the component position before moving it.');
  if (previous.rotationLocked && rotated)
    throw new Error('Unlock the component rotation before rotating it.');
}

export function movePlacedComponent(
  board: BoardDocument,
  componentId: string,
  placement: FootprintPlacement,
): BoardDocument {
  const previous = board.footprints?.find(
    ({ componentId: id }) => id === componentId,
  );
  if (!previous) throw new Error('Choose a placed component.');
  if (previous.locked)
    throw new Error('Unlock the component before changing its placement.');
  validatePlacementLocks(previous, placement);
  validatePlacementLocation(board, placement);
  return validateBoard({
    ...board,
    revision: board.revision + 1,
    footprints: board.footprints.map((item) =>
      item.id === previous.id
        ? {
            ...item,
            positionNm: placement.positionNm,
            rotationMicrodegree: placement.rotationMicrodegree,
            side: placement.side,
          }
        : item,
    ),
  });
}

export type PlacementGroupOperation =
  | { kind: 'translate'; delta: BoardPoint }
  | { kind: 'rotate'; angle: number }
  | { kind: 'align' | 'distribute'; axis: keyof BoardPoint };

export function movePlacedGroup(
  board: BoardDocument,
  componentIds: readonly string[],
  operation: PlacementGroupOperation,
): BoardDocument {
  const placed = new Map(
    board.footprints?.map((item) => [item.componentId, item]),
  );
  const ids = [...new Set(componentIds)];
  const members = ids.map((id) => placed.get(id));
  const minimum = operation.kind === 'distribute' ? 3 : 2;
  if (members.length < minimum || members.some((item) => !item))
    throw new Error('Select at least ' + minimum + ' placed components.');

  const anchor = members[0].positionNm;
  const positions = new Map<
    string,
    Pick<BoardFootprint, 'positionNm' | 'rotationMicrodegree'>
  >();
  if (operation.kind === 'translate' || operation.kind === 'rotate') {
    for (const member of members) {
      const angle = operation.kind === 'rotate' ? operation.angle : 0;
      const turn = 360_000_000;
      const relative = {
        x: member.positionNm.x - anchor.x,
        y: member.positionNm.y - anchor.y,
      };
      const positionNm =
        operation.kind === 'translate'
          ? {
              x: member.positionNm.x + operation.delta.x,
              y: member.positionNm.y + operation.delta.y,
            }
          : placeFootprintPoint(relative, {
              positionNm: anchor,
              rotationMicrodegree: angle,
              side: 'top',
            });
      positions.set(member.id, {
        positionNm,
        rotationMicrodegree:
          angle % turn === 0
            ? member.rotationMicrodegree
            : (((member.rotationMicrodegree + angle) % turn) + turn) % turn,
      });
    }
  } else {
    const { axis } = operation;
    const ordered =
      operation.kind === 'align'
        ? members
        : [...members].sort((a, b) => a.positionNm[axis] - b.positionNm[axis]);
    const first = ordered[0].positionNm[axis];
    const last = ordered.at(-1).positionNm[axis];
    ordered.forEach((member, index) => {
      const entry =
        operation.kind === 'align'
          ? anchor[axis]
          : Math.round(first + ((last - first) * index) / (ordered.length - 1));
      positions.set(member.id, {
        positionNm: { ...member.positionNm, [axis]: entry },
        rotationMicrodegree: member.rotationMicrodegree,
      });
    });
  }

  let changed = false;
  const profile = placementProfile(board);
  const footprints = board.footprints.map((item) => {
    const move = positions.get(item.id);
    if (
      !move ||
      (samePoint(move.positionNm, item.positionNm) &&
        move.rotationMicrodegree === item.rotationMicrodegree)
    )
      return item;
    const placement = { ...item, ...move };
    validatePlacementLocks(item, placement);
    validatePlacementLocation(board, placement, profile);
    changed = true;
    return placement;
  });
  return changed
    ? validateBoard({ ...board, footprints, revision: board.revision + 1 })
    : board;
}

export function placementPadTemplates(
  component: BoardComponent,
  device: EmbeddedDevice,
  footprint: EmbeddedFootprint,
) {
  const nets = new Map(
    component.signals?.map(({ signalId, netId }) => [signalId, netId]),
  );
  const assignments = new Map(
    device.assignments.map((assignment) => [assignment.padId, assignment]),
  );
  return footprint.pads.map(({ id, positionNm, label }) => {
    const assignment = assignments.get(id);
    return {
      id,
      label,
      position: positionNm,
      netId:
        assignment?.kind === 'signal'
          ? nets.get(assignment.signalId)
          : undefined,
    };
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
  const profile = placementProfile(board);
  const features = (board.footprints ?? []).flatMap((placement) => {
    const component = components.get(placement.componentId);
    const device = devices.get(placement.deviceId);
    const definition = definitions.get(device?.footprintId);
    if (!definition || !component || !device) return [];
    const bindings = new Map(
      component.signals?.map(({ signalId, netId }) => [signalId, netId]),
    );
    const pads = placementPadTemplates(component, device, definition).map(
      (pad) => ({
        ...pad,
        position: placeFootprintPoint(pad.position, placement),
      }),
    );
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
