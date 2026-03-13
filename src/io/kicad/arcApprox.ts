import { Coordinate } from '../../model/dsnItem';
import { KiPoint } from './kicadTypes';

function det(a: number, b: number, c: number, d: number) {
  return a * d - b * c;
}

function dist(a: KiPoint, b: KiPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angleOf(center: KiPoint, p: KiPoint) {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

function pointOnCircle(center: KiPoint, r: number, theta: number): KiPoint {
  return {
    x: center.x + r * Math.cos(theta),
    y: center.y + r * Math.sin(theta),
  };
}

function normalizeAngle(theta: number) {
  while (theta <= -Math.PI) {
    theta += 2 * Math.PI;
  }
  while (theta > Math.PI) {
    theta -= 2 * Math.PI;
  }
  return theta;
}

export function arcToQuadraticSegments(
  start: KiPoint,
  mid: KiPoint,
  end: KiPoint,
): Array<{ control: KiPoint; end: KiPoint }> {
  const x1 = start.x;
  const y1 = start.y;
  const x2 = mid.x;
  const y2 = mid.y;
  const x3 = end.x;
  const y3 = end.y;

  const d = 2 * det(x1 - x2, y1 - y2, x2 - x3, y2 - y3);
  if (Math.abs(d) < 1e-9) {
    return [{ control: mid, end }];
  }

  const ux =
    det(
      x1 * x1 + y1 * y1 - (x2 * x2 + y2 * y2),
      y1 - y2,
      x2 * x2 + y2 * y2 - (x3 * x3 + y3 * y3),
      y2 - y3,
    ) / d;
  const uy =
    det(
      x1 - x2,
      x1 * x1 + y1 * y1 - (x2 * x2 + y2 * y2),
      x2 - x3,
      x2 * x2 + y2 * y2 - (x3 * x3 + y3 * y3),
    ) / d;

  const center = { x: ux, y: uy };
  const r = dist(center, start);
  if (r < 1e-9) {
    return [{ control: mid, end }];
  }

  let a0 = angleOf(center, start);
  const am = angleOf(center, mid);
  let a1 = angleOf(center, end);

  let delta = normalizeAngle(a1 - a0);
  const deltaMid = normalizeAngle(am - a0);
  const sameDirection = Math.sign(deltaMid || 1) === Math.sign(delta || 1);

  if (!sameDirection || Math.abs(deltaMid) > Math.abs(delta)) {
    if (delta > 0) {
      delta -= 2 * Math.PI;
    } else {
      delta += 2 * Math.PI;
    }
  }

  a1 = a0 + delta;

  const maxSeg = Math.PI / 2;
  const count = Math.max(1, Math.ceil(Math.abs(delta) / maxSeg));
  const step = delta / count;

  const segments: Array<{ control: KiPoint; end: KiPoint }> = [];
  for (let i = 0; i < count; i += 1) {
    const ta = a0 + i * step;
    const tb = ta + step;
    const tm = (ta + tb) / 2;

    const p0 = pointOnCircle(center, r, ta);
    const p1 = pointOnCircle(center, r, tb);
    const pm = pointOnCircle(center, r, tm);

    const control = {
      x: 2 * pm.x - 0.5 * (p0.x + p1.x),
      y: 2 * pm.y - 0.5 * (p0.y + p1.y),
    };

    segments.push({ control, end: p1 });
  }

  return segments;
}

export function arcToDPoints(
  start: KiPoint,
  mid: KiPoint,
  end: KiPoint,
): Coordinate[] {
  const out: Coordinate[] = [[start.x, start.y]];
  for (const seg of arcToQuadraticSegments(start, mid, end)) {
    out.push([seg.control.x, seg.control.y, 1]);
    out.push([seg.end.x, seg.end.y]);
  }
  return out;
}
