import type { Polygon } from '../../pcb/contours';
import { boardCoordinateFields, boardInputLength } from './boardNumberInput';
import { areaOutline } from '../../pcb/boardAreaShape';
import type { BoardAreaShape } from '../../pcb/boardAreaShape';

const mm = (value: number) => String(value / 1_000_000);
const nm = (value: string) => boardInputLength(value, 'mm');

export const outlineText = (points: Polygon) =>
  points.map(({ x, y }) => mm(x) + ', ' + mm(y)).join('\n');

export function outlineVertices(text: string): Polygon {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [x, y] = boardCoordinateFields(line, 2);
      return { x: nm(x), y: nm(y) };
    });
}

export function areaFields(data: FormData, shape?: BoardAreaShape) {
  if (!shape) return { outline: outlineVertices(String(data.get('outline'))) };
  const next = shape.kind === 'rectangle' ? { ...shape, radiusNm: nm(String(data.get('radius'))) } : shape;
  return { shape: next, outline: areaOutline(next) };
}
