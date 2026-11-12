/** Choose the library symbol's presentation before connecting any wires.
 * Supply polarity is a generation constraint, never an auto-layout rotation. */
export function orientTeachingSymbol(
  symbol: any,
  entry: any,
  ports: (s: any) => Record<string, number[]>,
) {
  const preferred = entry.pins.map((p) => ({
    ...p,
    side:
      entry.id === 'potentiometer'
        ? { END_A: 'top', END_B: 'bottom', WIPER: 'right' }[p.name] || p.side
        : p.side,
  }));
  let best = symbol,
    score = Infinity;
  for (const rotation of [
    symbol.rotation,
    ...Array.from({ length: 8 }, (_, i) => i),
  ]) {
    const candidate = { ...symbol, rotation, _active_points: null };
    const positions = ports(candidate),
      ps = Object.values(positions);
    const left = Math.min(...ps.map((p) => p[0])),
      right = Math.max(...ps.map((p) => p[0]));
    const top = Math.min(...ps.map((p) => p[1])),
      bottom = Math.max(...ps.map((p) => p[1]));
    const cx = (left + right) / 2,
      cy = (top + bottom) / 2;
    const value = preferred.reduce((total, pin) => {
      const p = positions[pin.name];
      const x = (p[0] - cx) / Math.max(1, (right - left) / 2);
      const y = (p[1] - cy) / Math.max(1, (bottom - top) / 2);
      const error =
        ({ left: x, right: -x, top: y, bottom: -y }[pin.side] ?? 0) + 1;
      return total + error * (pin.electrical_type === 'power_input' ? 4 : 1);
    }, 0);
    if (value < score - 1e-8) {
      score = value;
      best = candidate;
    }
  }
  const p = ports(best);
  const upper = preferred.filter(
    (pin) =>
      pin.side === 'top' &&
      (pin.electrical_type === 'power_input' || pin.name === 'END_A'),
  );
  const lower = preferred.filter(
    (pin) =>
      pin.side === 'bottom' &&
      (pin.electrical_type === 'power_input' || pin.name === 'END_B'),
  );
  if (upper.some((a) => lower.some((b) => p[a.name][1] >= p[b.name][1])))
    throw Error('Cannot orient teaching supply pins upright: ' + entry.id);
  return best;
}
