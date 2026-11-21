import type { PolygonRegion } from './contours';
import type { BoardPoint } from './geometry';

export const svgEscape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function wrapDrawingLine(text: string, columns = 52) {
  const lines: string[] = [];
  const chars = Array.from(text);
  while (chars.length > columns) {
    const boundary = chars.lastIndexOf(' ', columns);
    lines.push(chars.splice(0, boundary > 0 ? boundary : columns).join(''));
    if (chars[0] === ' ') chars.shift();
  }
  lines.push(chars.join(''));
  return lines;
}

export function svgRegionPath(
  { outer, holes }: PolygonRegion,
  toSvg: (point: BoardPoint) => BoardPoint,
) {
  return [outer, ...holes]
    .map(
      (ring) =>
        'M' +
        ring
          .map((point) => {
            const { x, y } = toSvg(point);
            return x + ',' + y;
          })
          .join(' L') +
        ' Z',
    )
    .join(' ');
}
