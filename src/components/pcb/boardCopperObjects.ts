import type { BoardDocument, BoardOperation, CopperLayer } from '../../pcb/board';
import type { BoardPoint } from '../../pcb/geometry';
import { areaContour, areaOutline } from '../../pcb/boardAreaShape';
import type { BoardAreaGeometry } from '../../pcb/boardAreaShape';
import { editableProfile } from '../../pcb/boardProfiles';

const storedShape = (geometry?: BoardAreaGeometry) =>
  geometry?.kind === 'polygon' && !geometry.vertices.some(({ control }) => control) ? undefined : geometry;

export const copperObjectLabels = {
  area: 'Placement area', region: 'Routing region', zone: 'Copper zone',
  jumper: 'Wire jumper', cutout: 'Board cutout', hole: 'Hole or slot',
} as const;

export type CopperObjectKind = keyof typeof copperObjectLabels;
export interface CopperObject {
  kind: CopperObjectKind;
  id: string;
  label: string;
  layer: CopperLayer['id'] | 'both';
}

export function isCopperObject(kind: string): kind is CopperObjectKind {
  return Object.hasOwn(copperObjectLabels, kind);
}

export function boardCopperObjects(board: BoardDocument): CopperObject[] {
  const nets = new Map(board.nets?.map(({ id, name }) => [id, name]));
  return [
    ...(board.placementAreas ?? []).map(({ id, name, side }): CopperObject => ({ kind: 'area', id, label: name, layer: side })),
    ...(board.routingRegions ?? []).map(({ id, name, side }): CopperObject => ({ kind: 'region', id, label: name, layer: side })),
    ...(board.zones ?? []).map(({ id, netId, layerId }): CopperObject => ({
      kind: 'zone', id, label: nets.get(netId) ?? 'Missing net', layer: layerId,
    })),
    ...(board.jumpers ?? []).map(({ id, reference }): CopperObject => ({
      kind: 'jumper', id, label: reference, layer: 'top',
    })),
    ...(board.profile?.cutouts ?? []).map((_, index): CopperObject => ({
      kind: 'cutout', id: String(index), label: `Cutout ${index + 1}`, layer: 'both',
    })),
    ...(board.mechanicalHoles ?? []).map(({ id, start, end }, index): CopperObject => ({
      kind: 'hole', id, label: `${start.x === end.x && start.y === end.y ? 'Hole' : 'Slot'} ${index + 1}`, layer: 'both',
    })),
  ];
}

export function drawCopperObject(
  board: BoardDocument, kind: CopperObjectKind, id: string,
  points: readonly BoardPoint[], netId: string, layerId: CopperLayer['id'], geometry?: BoardAreaGeometry,
  drillWidth = 1_000_000,
): BoardOperation {
  const outline = geometry ? areaOutline(geometry) : points;
  const shape = storedShape(geometry);
  const area = { outline, ...(shape ? { shape } : {}) };
  switch (kind) {
    case 'area':
      return { type: 'setPlacementArea', area: { id, name: 'Placement area', kind: 'keep-out', side: 'both', ...area } };
    case 'region':
      return { type: 'setRoutingRegion', region: { id, name: 'Routing region', side: 'both', exclusions: ['track'], ...area } };
    case 'zone':
      return { type: 'setZone', zone: { id, netId, layerId, priority: 0, ...area, cutouts: [],
        padConnection: 'direct', viaConnection: 'direct', spokeWidthNm: 250_000, thermalGapNm: 250_000, islands: 'remove' } };
    case 'cutout':
      return changeCutout(board, Number(id), geometry);
    case 'hole':
      return { type: 'addMechanicalHole', hole: { id, start: points[0], end: points[1], widthNm: drillWidth, plated: false } };
    case 'jumper': {
      const references = new Set([
        ...board.components?.map(({ reference }) => reference?.trim().toLowerCase()) ?? [],
        ...board.jumpers?.map(({ reference }) => reference.trim().toLowerCase()) ?? [],
      ]);
      let index = 1;
      while (references.has('jp' + index)) index++;
      return { type: 'setWireJumper', jumper: { id, reference: 'JP' + index, netId,
        start: outline[0], end: outline[1], landWidthNm: 2_000_000, drillNm: 800_000, fitted: true } };
    }
  }
}

export function changeCutout(board: BoardDocument, index: number, geometry?: BoardAreaGeometry): BoardOperation {
  const profile = editableProfile(board);
  const cutouts = [...profile.cutouts];
  const cutoutShapes = cutouts.map((_, index) => profile.cutoutShapes?.[index] ?? null);
  if (geometry) {
    cutouts[index] = areaContour(geometry);
    cutoutShapes[index] = storedShape(geometry) ?? null;
  } else {
    cutouts.splice(index, 1);
    cutoutShapes.splice(index, 1);
  }
  return { type: 'replaceProfile', profile: { outline: profile.outline, cutouts,
    ...(cutoutShapes.some(Boolean) ? { cutoutShapes } : {}) } };
}

export function copperAreaGeometry(board: BoardDocument, { kind, id }: CopperObject): BoardAreaGeometry | undefined {
  const area = (kind === 'area' ? board.placementAreas : kind === 'region' ? board.routingRegions :
    kind === 'zone' ? board.zones : undefined)?.find((item) => item.id === id);
  if (area) return area.shape ?? { kind: 'polygon', vertices: area.outline };
  if (kind === 'cutout') {
    const contour = board.profile?.cutouts[Number(id)];
    return board.profile?.cutoutShapes?.[Number(id)] ?? (contour?.every(({ kind }) => kind === 'line')
      ? { kind: 'polygon', vertices: contour.map(({ start }) => start) } : undefined);
  }
}

export function reshapeCopperArea(board: BoardDocument, { kind, id }: CopperObject, geometry: BoardAreaGeometry): BoardOperation {
  if (kind === 'cutout') return changeCutout(board, Number(id), geometry);
  const outline = areaOutline(geometry);
  const shape = storedShape(geometry);
  const changes = { outline, ...(shape ? { shape } : {}) };
  switch (kind) {
    case 'area': {
      const { shape: previous, ...area } = board.placementAreas.find((item) => item.id === id);
      return { type: 'setPlacementArea', area: { ...area, ...changes } };
    }
    case 'region': {
      const { shape: previous, ...region } = board.routingRegions.find((item) => item.id === id);
      return { type: 'setRoutingRegion', region: { ...region, ...changes } };
    }
    case 'zone': {
      const { shape: previous, ...zone } = board.zones.find((item) => item.id === id);
      return { type: 'setZone', zone: { ...zone, ...changes } };
    }
    default: throw new Error('The selected object has no editable area.');
  }
}
