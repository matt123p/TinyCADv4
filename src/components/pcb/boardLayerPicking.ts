import type { BoardLayerId } from '../../pcb/boardLayers';

export function copperBoardLayer(side: 'top' | 'bottom'): BoardLayerId {
  return side === 'top' ? 'F.Cu' : 'B.Cu';
}

type LayerTarget = {
  kind: string;
  layer: 'top' | 'bottom' | 'both';
  boardLayer?: BoardLayerId;
};

const top = ['F.Cu'] as const;
const bottom = ['B.Cu'] as const;
const both = ['F.Cu', 'B.Cu'] as const;
const edge = ['Edge.Cuts'] as const;

export function boardPickLayers(target: LayerTarget): readonly BoardLayerId[] {
  if (target.boardLayer) return [target.boardLayer];
  if (target.kind === 'cutout' || target.kind === 'hole') return edge;
  return target.layer === 'both' ? both : target.layer === 'top' ? top : bottom;
}

export function canPickOnLayers(pickableLayers: ReadonlySet<BoardLayerId>, target: LayerTarget) {
  return boardPickLayers(target).some((id) => pickableLayers.has(id));
}
