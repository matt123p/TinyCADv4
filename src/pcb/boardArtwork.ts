import type { BoardDocument, CopperLayer } from './board';
import {
  arcVertices,
  capsulePolygon,
  circlePolygon,
  TESSELLATION_TOLERANCE_NM,
} from './contours';
import type { Polygon, PolygonRegion } from './contours';
import { placeFootprintPoint } from './footprint';
import { footprintArc } from './footprintArc';
import { footprintTextStrokes, resolveFootprintText } from './footprintText';
import type { FootprintGraphic } from './footprintDetails';
import { samePoint, validateOutline } from './geometry';
import type { BoardPoint } from './geometry';
import type { PolygonKernel } from './polygonKernel';

export interface BoardArtworkRegion {
  id: string;
  componentId: string;
  side: CopperLayer['id'];
  strokeNm?: number;
  textHeightNm?: number;
  regions: PolygonRegion[];
}

type ArtworkIssue = {
  id: string;
  componentId: string;
  code: 'silk-text' | 'silk-geometry' | 'courtyard-open' | 'layer-artwork';
  detail?: string;
};

const area = (outer: Polygon): PolygonRegion => ({ outer, holes: [] });

function rectangle(start: BoardPoint, end: BoardPoint): Polygon {
  return [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }];
}

function closedPolygon(item: FootprintGraphic): Polygon | undefined {
  switch (item.kind) {
    case 'rect':
      return rectangle(item.start, item.end);
    case 'polygon':
      return item.points;
    case 'circle':
      return circlePolygon(
        item.center,
        Math.round(
          Math.hypot(item.end.x - item.center.x, item.end.y - item.center.y),
        ),
      );
  }
}

function finishedArtwork(item: FootprintGraphic, text?: string): PolygonRegion[] {
  if (item.kind === 'text')
    return footprintTextStrokes(item, text).flatMap((stroke) =>
      stroke
        .slice(1)
        .map((point, index) =>
          area(capsulePolygon(stroke[index], point, item.strokeNm)),
        ),
    );
  if (item.kind === 'line')
    return item.strokeNm
      ? [area(capsulePolygon(item.start, item.end, item.strokeNm))]
      : [];
  const half = Math.round(item.strokeNm / 2);
  if (item.kind === 'circle') {
    const radius = Math.round(
      Math.hypot(item.end.x - item.center.x, item.end.y - item.center.y),
    );
    if (!radius || (!item.filled && !half)) return [];
    const outer = circlePolygon(item.center, radius + half);
    const hole =
      !item.filled && radius > half
        ? circlePolygon(item.center, radius - half)
        : null;
    return [{ outer, holes: hole ? [hole] : [] }];
  }
  if (item.kind === 'arc') {
    if (!half) return [];
    const arc = footprintArc(item);
    if (!arc || arc.radius <= half)
      throw new Error('Unsupported silkscreen arc radius.');
    const points = (radius: number) =>
      arcVertices(
        arc.center,
        radius,
        arc.startAngle,
        arc.sweepAngle,
        TESSELLATION_TOLERANCE_NM,
      );
    return [
      area([
        ...points(arc.radius + half),
        ...points(arc.radius - half).reverse(),
      ]),
      area(capsulePolygon(item.start, item.start, item.strokeNm)),
      area(capsulePolygon(item.end, item.end, item.strokeNm)),
    ];
  }
  const polygon = closedPolygon(item);
  if (!polygon) return [];
  validateOutline(polygon);
  return [
    ...(item.filled ? [area(polygon)] : []),
    ...(item.strokeNm
      ? polygon.map((start, i) =>
          area(
            capsulePolygon(
              start,
              polygon[(i + 1) % polygon.length],
              item.strokeNm,
            ),
          ),
        )
      : []),
  ];
}

function courtyardPolygons(graphics: readonly FootprintGraphic[]): Polygon[] {
  const outlines: Polygon[] = [];
  const lines: { start: BoardPoint; end: BoardPoint }[] = [];
  for (const graphic of graphics) {
    if (graphic.kind === 'line') lines.push(graphic);
    else {
      const polygon = closedPolygon(graphic);
      if (!polygon) throw new Error('Unsupported courtyard geometry.');
      validateOutline(polygon);
      outlines.push(polygon);
    }
  }
  while (lines.length) {
    const { start, end } = lines.shift();
    const polygon = [start];
    let point = end;
    while (!samePoint(point, start)) {
      polygon.push(point);
      const matches = lines.flatMap((line, i) =>
        samePoint(line.start, point) || samePoint(line.end, point) ? [i] : [],
      );
      if (matches.length !== 1) throw new Error('Open or ambiguous courtyard.');
      const [next] = lines.splice(matches[0], 1);
      point = samePoint(next.start, point) ? next.end : next.start;
    }
    validateOutline(polygon);
    outlines.push(polygon);
  }
  return outlines;
}

export function boardArtwork(board: BoardDocument, kernel: PolygonKernel) {
  const silk: BoardArtworkRegion[] = [];
  const apertures: (BoardArtworkRegion & { kind: 'mask' | 'paste' | 'adhesive' })[] = [];
  const courtyards: BoardArtworkRegion[] = [];
  const issues: ArtworkIssue[] = [];
  const components = new Map(board.components?.map((part) => [part.id, part]));
  const devices = new Map(
    board.deviceDefinitions?.map((device) => [device.id, device]),
  );
  const definitions = new Map(
    board.footprintDefinitions?.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  function addArtwork(
    graphic: FootprintGraphic,
    id: string,
    componentId: string,
    side: CopperLayer['id'],
    transform: (polygon: Polygon) => Polygon,
    text?: string,
  ) {
    const kind = graphic.layer.endsWith('SilkS') ? 'silk' :
      graphic.layer.endsWith('.Mask') ? 'mask' : graphic.layer.endsWith('.Paste') ? 'paste' :
      graphic.layer.endsWith('.Adhes') ? 'adhesive' : undefined;
    if (!kind || (graphic.kind === 'text' && (!graphic.visible || !text?.trim()))) return;
    try {
      const regions = kernel.boolean('union', finishedArtwork(graphic, text).map(({ outer, holes }) => ({
        outer: transform(outer), holes: holes.map(transform),
      })), []);
      if (!regions.length) throw new Error('Artwork has no printable geometry.');
      const item = { id, componentId, side, strokeNm: graphic.strokeNm,
        ...(graphic.kind === 'text' ? { textHeightNm: graphic.sizeNm.y } : {}), regions };
      if (kind === 'silk') silk.push(item);
      else apertures.push({ ...item, kind });
    } catch (error) {
      issues.push({
        id, componentId,
        code: kind === 'silk' ? (graphic.kind === 'text' ? 'silk-text' : 'silk-geometry') : 'layer-artwork',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const [index, graphic] of (board.annotations?.graphics ?? []).entries()) {
    addArtwork(graphic, board.boardId + ':artwork:' + index, board.boardId,
      graphic.layer.startsWith('B.') ? 'bottom' : 'top', (polygon) => polygon,
      graphic.kind === 'text' ? graphic.text : undefined);
  }
  for (const placement of board.footprints ?? []) {
    const graphics =
      definitions.get(devices.get(placement.deviceId)?.footprintId)?.graphics ??
      [];
    if (!graphics.length) continue;
    const transform = (polygon: Polygon) =>
      polygon.map((point) => placeFootprintPoint(point, placement));
    const physicalSide = (
      layer: FootprintGraphic['layer'],
    ): CopperLayer['id'] =>
      layer.startsWith('F.') === (placement.side === 'top') ? 'top' : 'bottom';
    const { componentId } = placement;
    for (const [i, graphic] of graphics.entries()) {
      const text = graphic.kind === 'text'
        ? resolveFootprintText(graphic.text, components.get(componentId) ?? {}) : undefined;
      const id = placement.id + (graphic.layer.endsWith('SilkS') ? ':silk:' : ':artwork:') + i;
      addArtwork(graphic, id, componentId, physicalSide(graphic.layer), transform, text);
    }
    for (const side of ['top', 'bottom'] as const) {
      const outlines = graphics.filter(
        ({ layer }) => layer.endsWith('CrtYd') && physicalSide(layer) === side,
      );
      if (!outlines.length) continue;
      const id = placement.id + ':courtyard:' + side;
      try {
        const regions = courtyardPolygons(outlines).map((polygon) =>
          area(transform(polygon)),
        );
        courtyards.push({ id, componentId, side, regions });
      } catch {
        issues.push({ id, componentId, code: 'courtyard-open' });
      }
    }
  }
  return { silk, courtyards, apertures, issues };
}
