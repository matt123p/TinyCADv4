import type { BoardDocument, CopperLayer } from './board';
import type { BoardArtworkRegion } from './boardArtwork';
import { capsulePolygon } from './contours';
import type { PolygonRegion } from './contours';
import type { BoardDrill } from './copper';
import type { BoardPoint } from './geometry';
import { bounds } from './regionDistances';
import { placeFootprintPoint } from './footprint';
import { footprintAssemblyMarks } from './footprintDetails';

import { svgEscape, svgRegionPath, wrapDrawingLine } from './boardOutputDrawing';

export function assemblyDrawing(
  board: BoardDocument,
  profile: PolygonRegion,
  drills: readonly BoardDrill[],
  courtyards: readonly BoardArtworkRegion[],
  side: CopperLayer['id'],
): string {
  const { minX, minY, maxX, maxY } = bounds(profile);
  const mirrored = side === 'bottom';
  const margin = 6;
  const mm = (point: BoardPoint) => ({
    x: (mirrored ? minX + maxX - point.x : point.x) / 1e6,
    y: -point.y / 1e6,
  });
  const regionPath = (region: PolygonRegion) => svgRegionPath(region, mm);
  const left = minX / 1e6 - margin;
  const top = -maxY / 1e6 - margin;
  const boardWidth = Math.max(28, (maxX - minX) / 1e6 + 2 * margin);
  const boardHeight = (maxY - minY) / 1e6 + 2 * margin + 5;
  const components = new Map(
    board.components?.map((component) => [component.id, component]),
  );
  const devices = new Map(board.deviceDefinitions?.map(({ id, footprintId }) => [id, footprintId]));
  const footprints = new Map(board.footprintDefinitions?.map((footprint) => [footprint.id, footprint]));
  const instructions: { reference: string; notes: string }[] = [];
  const usedMarkers = new Set<keyof typeof footprintAssemblyMarks>();
  const sideCourtyards = new Map(
    courtyards
      .filter((entry) => entry.side === side)
      .map((entry) => [entry.componentId, entry.regions]),
  );
  const text = (x: number, y: number, value: string, size = 1.5) =>
    `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${size}">${svgEscape(
      value,
    )}</text>`;
  const markSide = side === 'top' ? 'Top view' : 'Bottom view (mirrored)';
  const shapes = [
    `<path fill="#f5f5f1" stroke="#333" stroke-width="0.15" fill-rule="evenodd" d="${regionPath(
      profile,
    )}"/>`,
    ...drills.map(
      ({ start, end, widthNm, plated }) =>
        `<path stroke="${
          plated ? '#8c582c' : '#555'
        }" fill="white" stroke-width="0.12" d="${regionPath({
          outer: capsulePolygon(start, end, widthNm),
          holes: [],
        })}"/>`,
    ),
  ];
  for (const placement of board.footprints ?? []) {
    if (placement.side !== side) continue;
    const component = components.get(placement.componentId);
    const { x, y } = mm(placement.positionNm);
    const dnp = component?.role === 'dnp';
    const state = dnp ? 'DNP' : 'Fitted';
    const name = component?.reference ?? placement.componentId;
    const footprint = footprints.get(devices.get(placement.deviceId));
    const assembly = dnp ? undefined : footprint?.assembly;
    const marker = assembly?.marker;
    const terminal = marker && footprint.pads.find(({ id }) =>
      id.toLowerCase() === marker.padId.toLowerCase());
    const marks: string[] = [];
    if (marker && terminal) {
      const { x, y } = mm(placeFootprintPoint(terminal.positionNm, placement));
      const { name: meaning, glyph } = footprintAssemblyMarks[marker.kind];
      usedMarkers.add(marker.kind);
      marks.push(
        `<g data-assembly-marker="${marker.kind}" data-pad="${svgEscape(terminal.label)}">`,
        `<title>${svgEscape(name + ' · ' + meaning + ' · pad ' + terminal.label)}</title>`,
        `<circle cx="${x}" cy="${y}" r="0.38" fill="#fff" stroke="#824319" stroke-width="0.12"/>`,
        text(x + 0.5, y + 0.85, glyph, 1.1),
        '</g>',
      );
    }
    if (assembly?.notes) instructions.push({ reference: name, notes: assembly.notes });
    const group = [
      `<g data-component-id="${svgEscape(
        placement.componentId,
      )}" data-population="${state}">`,
      ...(sideCourtyards.get(placement.componentId) ?? []).map(
        (region) =>
          `<path fill="none" stroke="#334e6b" stroke-width="0.15" ${
            dnp ? 'stroke-dasharray="0.45 0.3"' : ''
          } d="${regionPath(region)}"/>`,
      ),
      `<path stroke="#334e6b" stroke-width="0.15" d="M${x - 0.45},${y} H${
        x + 0.45
      } M${x},${y - 0.45} V${y + 0.45}"/>`,
      text(x + 0.55, y - 0.45, dnp ? name + ' (DNP)' : name),
      ...marks,
      '</g>',
    ];
    shapes.push(...group);
  }
  if (side === 'bottom') {
    for (const jumper of board.jumpers ?? []) {
      const a = mm(jumper.start);
      const b = mm(jumper.end);
      shapes.push(
        `<path data-wire-jumper="${jumper.id}" d="M${a.x},${a.y} L${b.x},${b.y}" stroke="#744501" stroke-width="0.2" stroke-dasharray="0.65 0.35"/>`,
        text(
          (a.x + b.x) / 2,
          (a.y + b.y) / 2 - 0.5,
          jumper.reference + (jumper.fitted ? ' (wire)' : ' (wire, DNP)'),
        ),
      );
    }
  }
  const markerLines = [...usedMarkers].sort().map((kind) => {
    const { glyph, name } = footprintAssemblyMarks[kind];
    return glyph + ' · ' + name;
  });
  const noteLines = instructions.sort((a, b) => a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0)
    .flatMap(({ reference, notes }) =>
      (reference + ' · ' + notes).split('\n').flatMap((line) => wrapDrawingLine(line)));
  const extra = [...markerLines, ...noteLines];
  const width = extra.length ? Math.max(boardWidth, noteLines.length ? 92 : 37) : boardWidth;
  const height = boardHeight + extra.length * 2.5;
  const measureY = top + boardHeight - 2.5;
  shapes.push(
    text(
      left + 1,
      top + 2.5,
      markSide + ' · Board revision ' + board.revision + ' · 1:1',
      1.6,
    ),
    `<path stroke="#333" stroke-width="0.2" d="M${left + 1},${measureY} H${
      left + 11
    }"/>`,
    text(left + 12, measureY + 0.5, '10 mm'),
    ...extra.map((line, index) => text(left + 1, top + boardHeight + 0.5 + index * 2.5, line, 1.35)),
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${left} ${top} ${width} ${height}">`,
    `<title>${svgEscape(board.title)} · ${markSide}</title>`,
    ...shapes,
    '</svg>',
    '',
  ].join('\n');
}
