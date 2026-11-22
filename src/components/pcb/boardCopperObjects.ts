import type { BoardDocument, BoardOperation, CopperLayer } from '../../pcb/board';
import type { BoardPoint } from '../../pcb/geometry';

export const copperObjectLabels = {
  area: 'Placement area', region: 'Routing region', zone: 'Copper zone', jumper: 'Wire jumper',
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
  ];
}

export function drawCopperObject(
  board: BoardDocument, kind: CopperObjectKind, id: string,
  outline: readonly BoardPoint[], netId: string, layerId: CopperLayer['id'],
): BoardOperation {
  switch (kind) {
    case 'area':
      return { type: 'setPlacementArea', area: { id, name: 'Placement area', kind: 'keep-out', side: 'both', outline } };
    case 'region':
      return { type: 'setRoutingRegion', region: { id, name: 'Routing region', side: 'both', exclusions: ['track'], outline } };
    case 'zone':
      return { type: 'setZone', zone: { id, netId, layerId, priority: 0, outline, cutouts: [],
        padConnection: 'direct', viaConnection: 'direct', spokeWidthNm: 250_000, thermalGapNm: 250_000, islands: 'remove' } };
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
