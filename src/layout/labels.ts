import { dsnLabel } from '../model/dsnItem';
import { LayoutSettings } from './types';
import { point, refresh, texts } from './geometry';

/** Follow the supporting span, retaining an already parallel reading direction. */
export function labelAlongWire(label: dsnLabel, horizontal: boolean): dsnLabel {
  const axis = horizontal ? 0 : 1;
  return label.rotation % 2 === axis
    ? label
    : (refresh({ ...label, rotation: axis }) as dsnLabel);
}

export function labelSpanLength(
  label: dsnLabel,
  horizontal: boolean,
  clearance: number,
) {
  const l = labelAlongWire(label, horizontal),
    r = texts(l)[0];
  if (!r) return 0;
  const axis = horizontal ? 0 : 1;
  const low = (horizontal ? r.x1 : r.y1) - l.point[axis];
  const high = (horizontal ? r.x2 : r.y2) - l.point[axis];
  // The electrical anchor must fit too; rotated renderer offsets can put it
  // outside a span that fits the visible text alone.
  return Math.max(0, high + clearance) - Math.min(0, low - clearance);
}

/** Text bounds, not the anchor, are centred or inset from an end. Text anchors
 * may be off grid: rounding them can make a perfectly adequate span unusable. */
export function labelPositions(
  label: dsnLabel,
  a: number[],
  b: number[],
  o: LayoutSettings,
) {
  const horizontal = a[1] === b[1],
    axis = horizontal ? 0 : 1;
  if (!horizontal && a[0] !== b[0]) return [];
  const l = labelAlongWire(label, horizontal);
  const r = texts(l)[0];
  if (!r) return [];
  const low = Math.min(a[axis], b[axis]),
    high = Math.max(a[axis], b[axis]);
  const length = horizontal ? r.x2 - r.x1 : r.y2 - r.y1;
  const offset = horizontal ? r.x1 - l.point[0] : r.y1 - l.point[1];
  const first = Math.max(low, low + o.clearance - offset),
    last = Math.min(high, high - o.clearance - length - offset);
  if (last < first - 1e-7) return [];
  return [0.5, 0, 1].map((fraction) => {
    const p = point(a);
    p[axis] = Math.max(
      first,
      Math.min(
        last,
        low +
          o.clearance +
          (high - low - length - 2 * o.clearance) * fraction -
          offset,
      ),
    );
    return refresh({ ...l, point: p }) as dsnLabel;
  });
}

export function labelPositionCost(
  label: dsnLabel,
  a: number[],
  b: number[],
  o: LayoutSettings,
) {
  return Math.min(
    ...labelPositions(label, a, b, o).map(
      (l, index) =>
        Math.abs(l.point[0] - label.point[0]) +
        Math.abs(l.point[1] - label.point[1]) +
        (index ? o.grid * 0.25 : 0),
    ),
  );
}
