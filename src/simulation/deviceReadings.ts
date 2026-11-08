import { NetlistData } from '../io/netlists/netlistGenerator';
import { writeSpice, spicePinLabel } from '../io/netlists/netlistSpice';
import { dsnSymbol } from '../model/dsnItem';
import { ResultData, ResultVector, SimulationSetup } from './contracts';

function statement(net: NetlistData, symbol: dsnSymbol): string[] | undefined {
  const ref = symbol.text.find((f) => f.description === 'Ref')?.value;
  return writeSpice({
    ...net,
    symbols: net.symbols.filter(([, s]) => s === symbol),
  })
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((tokens) => tokens[0]?.toLowerCase() === ref?.toLowerCase());
}
export function deviceSaveLine(
  net: NetlistData,
  setup: SimulationSetup,
): string {
  if (!['op', 'tran'].includes(setup.analysis.kind)) return '';
  const refs = new Set(
    (setup.measurements || [])
      .flatMap((d) => [d.source, d.reference])
      .filter(Boolean)
      .flatMap((name) => {
        if (!name.startsWith('device|')) return [];
        const parts = name.split('|');
        try {
          return ['current', 'power'].includes(parts[3])
            ? [decodeURIComponent(parts[2]).toLowerCase()]
            : [];
        } catch {
          return [];
        }
      }),
  );
  const vectors: string[] = [];
  for (const [, symbol] of net.symbols) {
    const hint = symbol.text.find((f) => f.description === 'Ref')?.value;
    if (!refs.has(hint?.toLowerCase())) continue;
    const tokens = statement(net, symbol),
      ref = tokens?.[0];
    if (!ref || !/^[A-Za-z][\w.$:#-]*$/.test(ref)) continue;
    if (/^[RCL]/i.test(ref)) vectors.push(`@${ref}[i]`);
    else if (/^D/i.test(ref)) vectors.push(`@${ref}[id]`);
    else if (/^Q/i.test(ref) && tokens.length === 5)
      vectors.push(`@${ref}[ic]`, `@${ref}[ib]`);
  }
  if (vectors.length > 64)
    throw new Error(
      'Select fewer device current/power measurements (64 saved device vectors per acquisition).',
    );
  return vectors.length ? `.save all ${[...new Set(vectors)].join(' ')}` : '';
}
export function measuredDevice(
  net: NetlistData,
  symbol: dsnSymbol,
  data: ResultData,
): { current?: ResultVector; power?: ResultVector } {
  const hint = symbol.text
    .find((f) => f.description === 'Ref')
    ?.value?.toLowerCase();
  if (!data.vectors.some((v) => v.name.toLowerCase().startsWith(`@${hint}[`)))
    return {};
  const tokens = statement(net, symbol);
  if (!tokens) return {};
  const [ref, p, n, e] = tokens,
    find = (name: string) =>
      data.vectors.find((v) => v.name.toLowerCase() === name.toLowerCase()),
    count = data.vectors[0]?.real.length || 0;
  const node = (name: string): number[] | undefined =>
    name === '0'
      ? Array(count).fill(0)
      : (find(name) || find(`v(${name})`))?.real;
  if (/^Q/i.test(ref) && tokens.length === 5) {
    const c = node(p),
      b = node(n),
      emitter = node(e),
      ic = find(`@${ref}[ic]`),
      ib = find(`@${ref}[ib]`);
    return c && b && emitter && ic && ib
      ? {
          power: {
            name: 'Device power',
            unit: 'W',
            real: c.map(
              (v, i) =>
                (v - emitter[i]) * ic.real[i] +
                (b[i] - emitter[i]) * ib.real[i],
            ),
          },
        }
      : {};
  }
  if (!/^[RCLD]/i.test(ref)) return {};
  const current = find(`@${ref}[${/^D/i.test(ref) ? 'id' : 'i'}]`),
    a = node(p),
    b = node(n);
  if (!current || !a || !b) return {};
  const pin1 = spicePinLabel('1', symbol, net),
    pin2 = spicePinLabel('2', symbol, net),
    sign =
      p.toLowerCase() === pin1?.toLowerCase()
        ? 1
        : p.toLowerCase() === pin2?.toLowerCase()
        ? -1
        : undefined;
  return {
    ...(sign
      ? {
          current: {
            ...current,
            unit: 'A',
            real: current.real.map((v) => sign * v),
          },
        }
      : {}),
    power: {
      name: 'Device power',
      unit: 'W',
      real: a.map((v, i) => (v - b[i]) * current.real[i]),
    },
  };
}
