import type { Polygon } from '../../pcb/contours';
import { lengthInNanometres } from '../../pcb/geometry';

const mm = (value: number) => String(value / 1_000_000);
const nm = (value: string) => lengthInNanometres(value, 'mm');

export const outlineText = (points: Polygon) =>
  points.map(({ x, y }) => mm(x) + ', ' + mm(y)).join('\n');

export function outlineVertices(text: string): Polygon {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const fields = line.trim().split(/\s*,\s*|\s+/);
      if (fields.length !== 2 || fields.some((field) => !field))
        throw new Error(
          'Enter an X and Y coordinate in millimetres on each line.',
        );
      return { x: nm(fields[0]), y: nm(fields[1]) };
    });
}
