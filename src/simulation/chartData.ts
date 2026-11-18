import { ResultData, ResultVector } from './contracts';

export type DisplayMode = 'real' | 'magnitude' | 'db' | 'phase';
export const displayValue = (
  real: number,
  imaginary = 0,
  mode: DisplayMode = 'real',
) =>
  mode === 'phase'
    ? (Math.atan2(imaginary, real) * 180) / Math.PI
    : mode === 'db'
    ? 20 * Math.log10(Math.max(1e-30, Math.hypot(real, imaginary)))
    : mode === 'magnitude'
    ? Math.hypot(real, imaginary)
    : real;
export const displayUnit = (vector: ResultVector, mode: DisplayMode) =>
  mode === 'phase' ? '°' : mode === 'db' ? 'dB' : vector.unit;

// Preserve extrema and their order; charts stay bounded without changing exports.
export function chartPoints(
  data: ResultData,
  vector: ResultVector,
  mode: DisplayMode,
  logX: boolean,
  range?: { min: number; max: number },
) {
  const x = data.vectors.find((v) => v.name === data.scale)?.real;
  let first = 0,
    last = vector.real.length;
  if (range && last) {
    const descending = x && x[0] > x[last - 1];
    const at = (i: number) => (descending ? -1 : 1) * (x?.[i] ?? i);
    const lower = descending ? -range.max : range.min,
      upper = descending ? -range.min : range.max;
    const bound = (value: number, inclusive: boolean) => {
      let lo = 0,
        hi = vector.real.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (at(mid) < value || (inclusive && at(mid) === value)) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    first = Math.max(0, bound(lower, false) - 1);
    last = Math.min(last, bound(upper, true) + 1);
  }
  const stride = Math.max(1, Math.ceil((last - first) / 1200));
  const points: { x: number; y: number }[] = [];
  const y = (i: number) =>
    displayValue(vector.real[i], vector.imaginary?.[i], mode);
  for (let start = first; start < last; start += stride) {
    const end = Math.min(start + stride, last) - 1;
    let lo = start,
      hi = start;
    for (let i = start + 1; i <= end; i++) {
      if (y(i) < y(lo)) lo = i;
      if (y(i) > y(hi)) hi = i;
    }
    for (const i of [...new Set([start, lo, hi, end])].sort((a, b) => a - b)) {
      const raw = x?.[i] ?? i;
      if (Number.isFinite(raw) && Number.isFinite(y(i)) && (!logX || raw > 0))
        points.push({ x: raw, y: y(i) });
    }
  }
  return points;
}
