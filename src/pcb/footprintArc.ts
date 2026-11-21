import type { FootprintGraphic } from './footprintDetails';
import type { BoardPoint } from './geometry';

export function footprintArc(item: Extract<FootprintGraphic, { kind: 'arc' }>) {
  const { start: a, mid: b, end: c } = item;
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const cross = bx * cy - by * cx;
  if (cross === 0) return undefined;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const center = {
    x: a.x + (b2 * cy - c2 * by) / (2 * cross),
    y: a.y + (bx * c2 - cx * b2) / (2 * cross),
  };
  const angle = (p: BoardPoint) => Math.atan2(p.y - center.y, p.x - center.x);
  const tau = Math.PI * 2;
  const direction = cross > 0 ? 1 : -1;
  const sweep = (direction * (angle(c) - angle(a)) + tau) % tau;
  return {
    center,
    radius: Math.hypot(a.x - center.x, a.y - center.y),
    startAngle: angle(a),
    sweepAngle: direction * sweep,
    large: sweep > Math.PI ? 1 : 0,
    clockwise: direction < 0 ? 1 : 0,
  };
}
