import type { BoardFootprint, EmbeddedFootprint } from './boardAssets';
import { placeFootprintPoint } from './footprint';
import type { FootprintGraphic } from './footprintDetails';
import type { BoardPoint } from './geometry';

export function footprintReference(footprint: EmbeddedFootprint | undefined, placement: BoardFootprint, reference?: string) {
  if (!reference) return;
  const index = footprint?.graphics?.findIndex((item) => item.kind === 'text' && item.visible &&
    item.layer.endsWith('SilkS') && item.text === '${REFERENCE}') ?? -1;
  const original = footprint?.graphics?.[index];
  if (original?.kind === 'text') {
    return { index, graphic: { ...original, text: reference, at: placement.referencePositionNm ?? original.at } };
  }
  const pads = footprint?.pads.map(({ positionNm }) => positionNm) ?? [];
  const x = pads.length ? Math.round((Math.min(...pads.map((p) => p.x)) + Math.max(...pads.map((p) => p.x))) / 2) : 0;
  const y = Math.max(0, ...pads.map((p) => p.y)) + 1_500_000;
  const graphic: Extract<FootprintGraphic, { kind: 'text' }> = {
    kind: 'text', layer: 'F.SilkS', text: reference, at: placement.referencePositionNm ?? { x, y },
    sizeNm: { x: 650_000, y: 1_000_000 }, strokeNm: 150_000,
    rotationMicrodegree: 0, align: [], filled: false, visible: true,
  };
  return { index: -1, graphic };
}

export function offsetFootprintReference(at: BoardPoint, offset: BoardPoint, placement: BoardFootprint): BoardPoint {
  const local = placeFootprintPoint(offset, {
    positionNm: { x: 0, y: 0 }, rotationMicrodegree: -placement.rotationMicrodegree, side: 'top',
  });
  return { x: at.x + (placement.side === 'bottom' ? -local.x : local.x), y: at.y + local.y };
}
