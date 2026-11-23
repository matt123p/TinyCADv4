import { isBoardPoint, validateOutline } from './geometry';
import type { BoardPoint } from './geometry';

type Vector3 = readonly [number, number, number];
export const footprintGraphicLayers = [
  'F.SilkS', 'B.SilkS', 'F.Fab', 'B.Fab', 'F.CrtYd', 'B.CrtYd',
  'F.Adhes', 'B.Adhes', 'F.Paste', 'B.Paste', 'F.Mask', 'B.Mask',
  'Dwgs.User', 'Cmts.User', 'Eco1.User', 'Eco2.User', 'Margin',
] as const;
export type FootprintGraphicLayer = (typeof footprintGraphicLayers)[number] | 'F.Cu' | 'B.Cu';
type GraphicShape =
  | { kind: 'line' | 'rect'; start: BoardPoint; end: BoardPoint }
  | { kind: 'arc'; start: BoardPoint; mid: BoardPoint; end: BoardPoint }
  | { kind: 'circle'; center: BoardPoint; end: BoardPoint }
  | { kind: 'polygon'; points: readonly BoardPoint[] }
  | { kind: 'text'; at: BoardPoint; text: string; sizeNm: BoardPoint; rotationMicrodegree: number; visible: boolean; align: readonly string[] };

export type FootprintGraphic = GraphicShape & { layer: FootprintGraphicLayer; strokeNm: number; filled: boolean };

export interface FootprintModelTransform {
  readonly offsetNm: Vector3;
  readonly rotationMicrodegree: Vector3;
  readonly scale: Vector3;
}

export interface FootprintModel extends FootprintModelTransform {
  readonly assetId?: string;
  readonly kind: 'step';
  readonly source: string;
  readonly quality: 'imported-unreviewed' | 'generated-envelope';
}

export const footprintAssemblyMarks = {
  'pin-1': { name: 'Pin 1', glyph: '1' },
  cathode: { name: 'Cathode', glyph: 'K' },
  positive: { name: 'Positive terminal', glyph: '+' },
  negative: { name: 'Negative terminal', glyph: '−' },
} as const;
export const footprintAssemblyNotesLimit = 640;

export interface FootprintAssembly {
  readonly marker?: { readonly kind: keyof typeof footprintAssemblyMarks; readonly padId: string };
  readonly notes?: string;
}

export function validateFootprintDetails(graphics: readonly FootprintGraphic[] = [], models: readonly FootprintModel[] = [], boardArtwork = false) {
  if (!Array.isArray(graphics) || graphics.length > 4096 || !Array.isArray(models) || models.length > 32) throw new Error('Invalid footprint graphics or models.');
  for (const item of graphics as readonly FootprintGraphic[]) {
    const copperText = boardArtwork && item?.kind === 'text' && (item.layer === 'F.Cu' || item.layer === 'B.Cu');
    if (!item || (!copperText && !footprintGraphicLayers.some((layer) => layer === item.layer)) || !Number.isSafeInteger(item.strokeNm) || item.strokeNm < 0 || typeof item.filled !== 'boolean') throw new Error('Invalid footprint graphic style.');
    switch (item.kind) {
      case 'line':
      case 'rect':
        if (!isBoardPoint(item.start) || !isBoardPoint(item.end)) throw new Error('Invalid footprint graphic endpoints.');
        break;
      case 'arc':
        if (![item.start, item.mid, item.end].every(isBoardPoint)) throw new Error('Invalid footprint graphic arc.');
        break;
      case 'circle':
        if (![item.center, item.end].every(isBoardPoint)) throw new Error('Invalid footprint graphic circle.');
        break;
      case 'polygon':
        validateOutline(item.points);
        break;
      case 'text':
        if (!isBoardPoint(item.at) || !isBoardPoint(item.sizeNm) || item.sizeNm.x <= 0 || item.sizeNm.y <= 0 || typeof item.text !== 'string' || !Number.isSafeInteger(item.rotationMicrodegree) || typeof item.visible !== 'boolean' || !Array.isArray(item.align) || !item.align.every((alignment: unknown) => ['left', 'right', 'top', 'bottom', 'mirror'].includes(String(alignment)))) throw new Error('Invalid footprint graphic text.');
        break;
      default:
        throw new Error('Unsupported footprint graphic shape.');
    }
  }
  for (const model of models as readonly FootprintModel[]) {
    const triple = (value: unknown, validate: (n: number) => boolean) => Array.isArray(value) && value.length === 3 && value.every(validate);
    if (!model || model.kind !== 'step' || (model.assetId !== undefined && (typeof model.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(model.assetId))) || typeof model.source !== 'string' || !model.source.trim() || !['imported-unreviewed', 'generated-envelope'].includes(model.quality) ||
      !triple(model.offsetNm, Number.isSafeInteger) || !triple(model.rotationMicrodegree, Number.isSafeInteger) || !triple(model.scale, (x) => Number.isFinite(x) && x > 0)) throw new Error('Invalid footprint STEP model or transform.');
  }
}
