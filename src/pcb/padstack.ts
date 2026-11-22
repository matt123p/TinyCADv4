import type { BoardDocument, CopperLayer } from './board';
import { capsulePolygon, validateCapsule } from './contours';
import type { Polygon } from './contours';
import type { BoardDrill, CopperFeature } from './copper';
import { placeFootprintPoint, validatePadMap } from './footprint';
import type {
  FootprintPad,
  FootprintPlacement,
  PadAssignment,
} from './footprint';
import { isBoardPoint, samePoint, validateOutline } from './geometry';
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

export function padLayer(side: Side, placement: FootprintPlacement): Side {
  return placement.side === 'top' ? side : side === 'top' ? 'bottom' : 'top';
}

export function padPointTransform(position: BoardPoint, placement: FootprintPlacement) {
  return ({ x, y }: BoardPoint) => placeFootprintPoint(
    { x: x + position.x, y: y + position.y }, placement,
  );
}

export function padShapePoints(shape: PadShape): readonly BoardPoint[] {
  if (shape.kind === 'polygon') return shape.vertices;
  const radius = shape.widthNm / 2;
  return [shape.start, shape.end].flatMap(({ x, y }) => [
    { x: x - radius, y: y - radius }, { x: x + radius, y: y + radius },
  ]);
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
        validateCapsule(shape.start, shape.end, shape.widthNm);
      else throw new Error('Unsupported padstack shape.');
    }
  }
  if (stack.drill !== undefined) {
    if (!stack.drill || typeof stack.drill.plated !== 'boolean')
      throw new Error('A drill must declare its plating.');
    validateCapsule(stack.drill.start, stack.drill.end, stack.drill.widthNm);
  }
}

function samePadShape(first: PadShape, second: PadShape): boolean {
  if (first === second) return true;
  if (first.kind === 'capsule' && second.kind === 'capsule')
    return first.widthNm === second.widthNm &&
      samePoint(first.start, second.start) && samePoint(first.end, second.end);
  return first.kind === 'polygon' && second.kind === 'polygon' &&
    first.vertices.length === second.vertices.length &&
    first.vertices.every((vertex, index) => samePoint(vertex, second.vertices[index]));
}

export function placeEmbeddedDevice(
  board: BoardDocument,
  instanceId: string,
  bindings: readonly TerminalBinding[],
  { includeApertures = true }: { includeApertures?: boolean } = {},
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
    { includeApertures },
  );
}

export function placeDevice(
  instanceId: string,
  device: PhysicalDevice,
  placement: FootprintPlacement,
  layerIds: readonly Side[],
  bindings: readonly TerminalBinding[],
  { includeApertures = true }: { includeApertures?: boolean } = {},
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
    landId?: string;
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
    const transform = padPointTransform(pad.positionNm, placement);
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
    let previousLand: { shape: PadShape; anchor: BoardPoint; region: CopperFeature['region'] } | undefined;
    for (const side of ['top', 'bottom'] as const) {
      const layer = padLayer(side, placement);
      const shape = pad.stack.copper[side];
      const landId = shape && layerIds.includes(layer) ? `${padId}:${layer}` : undefined;
      let landPolygon: Polygon | undefined;
      if (landId) {
        if (!previousLand || !samePadShape(previousLand.shape, shape)) {
          previousLand = {
            shape,
            region: { outer: flatten(shape), holes: [] },
            anchor: shape.kind === 'capsule'
              ? transform({
                  x: Math.round((shape.start.x + shape.end.x) / 2),
                  y: Math.round((shape.start.y + shape.end.y) / 2),
                })
              : transform({ x: 0, y: 0 }),
          };
        }
        const { anchor, region } = previousLand;
        landPolygon = region.outer;
        const land: CopperFeature = {
          id: landId,
          layerId: layer,
          kind: 'pad',
          anchor,
          region,
        };
        copper.push(
          binding?.netId
            ? { ...land, netId: binding.netId, terminalId: binding.terminalId }
            : land,
        );
        lands++;
      }
      if (!includeApertures) continue;
      const mask = pad.stack.mask?.[side];
      let maskPolygon: Polygon | undefined;
      for (const kind of ['mask', 'paste'] as const) {
        const aperture = pad.stack[kind]?.[side];
        if (!aperture) continue;
        const polygon = landPolygon && samePadShape(shape, aperture)
          ? landPolygon
          : maskPolygon && samePadShape(mask, aperture)
          ? maskPolygon
          : flatten(aperture);
        if (kind === 'mask') maskPolygon = polygon;
        apertures.push({
          id: `${padId}:${kind}:${layer}`,
          kind,
          side: layer,
          polygon,
          ...(landId ? { landId } : {}),
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
      validateCapsule(start, end, drill.widthNm);
      drills.push({ ...drill, id: padId, start, end });
    }
  }
  return { copper, drills, apertures };
}
