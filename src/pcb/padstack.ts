import type { BoardDocument, CopperLayer } from './board';
import { capsulePolygon } from './contours';
import type { Polygon } from './contours';
import type { BoardDrill, CopperFeature } from './copper';
import { placeFootprintPoint, validatePadMap } from './footprint';
import type {
  FootprintPad,
  FootprintPlacement,
  PadAssignment,
} from './footprint';
import { isBoardPoint, validateOutline } from './geometry';
import type { BoardPoint } from './geometry';

type Side = CopperLayer['id'];

export type PadShape =
  | { readonly kind: 'polygon'; readonly vertices: Polygon }
  | {
      readonly kind: 'capsule';
      readonly start: BoardPoint;
      readonly end: BoardPoint;
      readonly widthNm: number;
    };

export interface PadStack {
  readonly copper: Partial<Readonly<Record<Side, PadShape>>>;
  readonly mask?: Partial<Readonly<Record<Side, PadShape>>>;
  readonly paste?: Partial<Readonly<Record<Side, PadShape>>>;
  readonly drill?: Pick<BoardDrill, 'start' | 'end' | 'widthNm' | 'plated'>;
}

export interface PhysicalPad extends FootprintPad {
  readonly stack: PadStack;
}

export interface PhysicalDevice {
  readonly id: string;
  readonly pads: readonly PhysicalPad[];
  readonly assignments: readonly PadAssignment[];
}

export interface TerminalBinding {
  readonly signalId: string;
  readonly terminalId: string;
  readonly netId?: string;
}

export function validatePadStack(stack: PadStack): void {
  if (!stack || !stack.copper)
    throw new Error('A padstack needs a copper layer map.');
  for (const map of [stack.copper, stack.mask ?? {}, stack.paste ?? {}]) {
    if (!map || typeof map !== 'object' || Array.isArray(map))
      throw new Error('Invalid padstack layer map.');
    for (const [side, shape] of Object.entries(map)) {
      if ((side !== 'top' && side !== 'bottom') || !shape)
        throw new Error('Invalid padstack surface.');
      if (shape.kind === 'polygon') validateOutline(shape.vertices);
      else if (shape.kind === 'capsule')
        capsulePolygon(shape.start, shape.end, shape.widthNm);
      else throw new Error('Unsupported padstack shape.');
    }
  }
  if (stack.drill !== undefined) {
    if (!stack.drill || typeof stack.drill.plated !== 'boolean')
      throw new Error('A drill must declare its plating.');
    capsulePolygon(stack.drill.start, stack.drill.end, stack.drill.widthNm);
  }
}

export function placeEmbeddedDevice(
  board: BoardDocument,
  instanceId: string,
  bindings: readonly TerminalBinding[],
) {
  const instance = board.footprints?.find(
    ({ id }) => id.toLowerCase() === instanceId.toLowerCase(),
  );
  const device = board.deviceDefinitions?.find(
    ({ id }) => id.toLowerCase() === instance?.deviceId.toLowerCase(),
  );
  const footprint = board.footprintDefinitions?.find(
    ({ id }) => id.toLowerCase() === device?.footprintId.toLowerCase(),
  );
  if (
    !instance ||
    !device ||
    !footprint ||
    !footprint.pads.every((pad): pad is PhysicalPad => !!pad.stack)
  ) {
    throw new Error(
      'Embedded footprint placement needs a resolved device and explicit padstacks.',
    );
  }
  return placeDevice(
    instance.id,
    { id: device.id, pads: footprint.pads, assignments: device.assignments },
    instance,
    board.copperLayers.map(({ id }) => id),
    bindings,
  );
}

export function placeDevice(
  instanceId: string,
  device: PhysicalDevice,
  placement: FootprintPlacement,
  layerIds: readonly Side[],
  bindings: readonly TerminalBinding[],
) {
  if (
    !instanceId ||
    !layerIds.length ||
    new Set(layerIds).size !== layerIds.length ||
    layerIds.some((side) => side !== 'top' && side !== 'bottom')
  )
    throw new Error('Invalid placement ID or copper stack.');
  const signals = new Map(
    bindings.map((binding) => [binding.signalId, binding]),
  );
  if (bindings.some(({ terminalId, netId }) => !terminalId || netId === ''))
    throw new Error(
      'A terminal needs an ID and any supplied net ID must be nonempty.',
    );
  const issues = validatePadMap(
    bindings.map(({ signalId }) => signalId),
    device.pads,
    device.assignments,
  );
  if (issues.length) throw new Error(`Invalid pad map: ${issues[0]}`);
  const byPad = new Map(
    device.assignments.map((assignment) => [assignment.padId, assignment]),
  );
  const copper: CopperFeature[] = [];
  const drills: BoardDrill[] = [];
  const apertures: {
    id: string;
    kind: 'mask' | 'paste';
    side: Side;
    polygon: Polygon;
  }[] = [];
  for (const pad of device.pads) {
    if (!isBoardPoint(pad.positionNm) || !pad.id || pad.id.includes('/'))
      throw new Error('Invalid pad ID or local position.');
    const assignment = byPad.get(pad.id);
    const binding =
      assignment.kind === 'signal'
        ? signals.get(assignment.signalId)
        : undefined;
    const padId = `${instanceId}:${pad.id}`;
    const transform = (point: BoardPoint) =>
      placeFootprintPoint(
        {
          x: point.x + pad.positionNm.x,
          y: point.y + pad.positionNm.y,
        },
        placement,
      );
    const flatten = (shape: PadShape): Polygon => {
      const polygon =
        shape.kind === 'capsule'
          ? capsulePolygon(
              transform(shape.start),
              transform(shape.end),
              shape.widthNm,
            )
          : shape.vertices.map(transform);
      if (shape.kind === 'polygon') validateOutline(polygon);
      return polygon;
    };
    let lands = 0;
    for (const side of ['top', 'bottom'] as const) {
      const layer =
        placement.side === 'top' ? side : side === 'top' ? 'bottom' : 'top';
      const shape = pad.stack.copper[side];
      if (shape && layerIds.includes(layer)) {
        const land: CopperFeature = {
          id: `${padId}:${layer}`,
          layerId: layer,
          kind: 'pad',
          region: { outer: flatten(shape), holes: [] },
        };
        copper.push(
          binding?.netId
            ? { ...land, netId: binding.netId, terminalId: binding.terminalId }
            : land,
        );
        lands++;
      }
      for (const kind of ['mask', 'paste'] as const) {
        const aperture = pad.stack[kind]?.[side];
        if (aperture)
          apertures.push({
            id: `${padId}:${kind}:${layer}`,
            kind,
            side: layer,
            polygon: flatten(aperture),
          });
      }
    }
    if (binding && !lands)
      throw new Error(
        `Mapped pad ${pad.label} has no land on a physical copper layer.`,
      );
    const drill = pad.stack.drill;
    if (drill) {
      const start = transform(drill.start);
      const end = transform(drill.end);
      capsulePolygon(start, end, drill.widthNm);
      drills.push({ ...drill, id: padId, start, end });
    }
  }
  return { copper, drills, apertures };
}
