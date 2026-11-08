import { dsnSymbol } from '../model/dsnItem';
import { ResultData } from './contracts';
import { parseQuantity, positiveQuantity } from './numbers';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { spicePinLabel } from '../io/netlists/netlistSpice';

export type WaveShape =
  | 'dc'
  | 'sine'
  | 'pulse'
  | 'triangle'
  | 'pwl'
  | 'exponential'
  | 'fm';
export interface SourceConfig {
  kind: 'source';
  type: 'voltage' | 'current';
  waveform: WaveShape;
  dc: string;
  acMagnitude: string;
  acPhase: string;
  offset: string;
  amplitude: string;
  frequency: string;
  phase: string;
  delay: string;
  damping: string;
  low: string;
  high: string;
  rise: string;
  fall: string;
  width: string;
  period: string;
  points: string;
  riseDelay: string;
  fallDelay: string;
  riseTau: string;
  fallTau: string;
  modulationFrequency: string;
  modulationIndex: string;
}
export interface ProbeConfig {
  kind: 'probe';
  mode: 'voltage' | 'differential' | 'current';
  invert: boolean;
}
export interface ControlledConfig {
  kind: 'controlled';
  type: 'voltage' | 'current';
  gain: string;
}
export type SpiceControl = SourceConfig | ProbeConfig | ControlledConfig;
export const CONTROL_ATTRIBUTE = '$$SPICE_CONTROL';
export const defaultSource = (): SourceConfig => ({
  kind: 'source',
  type: 'voltage',
  waveform: 'dc',
  dc: '5',
  acMagnitude: '1',
  acPhase: '0',
  offset: '0',
  amplitude: '1',
  frequency: '1kHz',
  phase: '0',
  delay: '0',
  damping: '0',
  low: '0',
  high: '5',
  rise: '1us',
  fall: '1us',
  width: '0.5ms',
  period: '1ms',
  points: '0 0\n1ms 1\n2ms 0',
  riseDelay: '1ms',
  fallDelay: '3ms',
  riseTau: '0.5ms',
  fallTau: '0.5ms',
  modulationFrequency: '100Hz',
  modulationIndex: '1',
});
export function readControl(symbol: dsnSymbol): SpiceControl | undefined {
  const text = symbol.text.find(
    (f) => f.description === CONTROL_ATTRIBUTE,
  )?.value;
  if (!text) return;
  try {
    const value = JSON.parse(text);
    if (value && ['source', 'probe', 'controlled'].includes(value.kind))
      return value;
  } catch {
    /* Ordinary symbols have no built-in configuration. */
  }
}
const nonnegative = (text: string, unit = '') => {
  const value = parseQuantity(text, unit);
  if (value < 0) throw new Error('This value must be zero or greater.');
  return value;
};

// The SPICE statement and preview share the same validated numeric parameters.
export function compileSource(c: SourceConfig) {
  if (!['voltage', 'current'].includes(c.type))
    throw new Error('Choose voltage or current.');
  const unit = c.type === 'voltage' ? 'V' : 'A';
  const level = (text: string) => parseQuantity(text, unit);
  const dc = level(c.dc),
    ac = nonnegative(c.acMagnitude, unit),
    acPhase = parseQuantity(c.acPhase);
  let expression = '',
    duration = 0.005,
    value = (_t: number) => dc;
  let corners: number[] = [];
  switch (c.waveform) {
    case 'dc':
      break;
    case 'sine': {
      const offset = level(c.offset),
        amplitude = level(c.amplitude),
        frequency = positiveQuantity(c.frequency, 'Hz');
      const delay = nonnegative(c.delay, 's'),
        phase = parseQuantity(c.phase),
        damping = nonnegative(c.damping);
      duration = delay + 3 / frequency;
      expression = `SIN(${offset} ${amplitude} ${frequency} ${delay} ${damping} ${phase})`;
      value = (t) =>
        offset +
        amplitude *
          Math.sin(
            2 * Math.PI * frequency * Math.max(0, t - delay) +
              (phase * Math.PI) / 180,
          ) *
          Math.exp(-damping * Math.max(0, t - delay));
      corners = [delay];
      break;
    }
    case 'pulse':
    case 'triangle': {
      const low = level(c.low),
        high = level(c.high),
        delay = nonnegative(c.delay, 's');
      const period = positiveQuantity(c.period, 's');
      const rise =
        c.waveform === 'triangle' ? period / 2 : positiveQuantity(c.rise, 's');
      const fall =
        c.waveform === 'triangle' ? period / 2 : positiveQuantity(c.fall, 's');
      const width = c.waveform === 'triangle' ? 0 : nonnegative(c.width, 's');
      if (rise + width + fall > period * (1 + 1e-12))
        throw new Error(
          'Rise + pulse width + fall must not exceed the period.',
        );
      duration = delay + 3 * period;
      expression = `PULSE(${low} ${high} ${delay} ${rise} ${fall} ${width} ${period})`;
      value = (t) => {
        if (t < delay) return low;
        const phase = (t - delay) % period;
        if (phase < rise) return low + ((high - low) * phase) / rise;
        if (phase < rise + width) return high;
        if (phase < rise + width + fall)
          return high + ((low - high) * (phase - rise - width)) / fall;
        return low;
      };
      for (let i = 0; i < 3; i++)
        corners.push(
          ...[0, rise, rise + width, rise + width + fall].map(
            (t) => delay + i * period + t,
          ),
        );
      break;
    }
    case 'pwl': {
      const tokens = c.points.trim().split(/\s+/);
      if (tokens.length < 4 || tokens.length % 2 || tokens.length > 2000)
        throw new Error('Enter 2–1000 time/value pairs.');
      const points: [number, number][] = [];
      for (let i = 0; i < tokens.length; i += 2) {
        const time = nonnegative(tokens[i], 's');
        if (points.length && time <= points.at(-1)[0])
          throw new Error('PWL times must increase.');
        points.push([time, level(tokens[i + 1])]);
      }
      duration = points.at(-1)[0];
      expression = `PWL(${points.flat().join(' ')})`;
      value = (t) => {
        const next = points.findIndex((p) => p[0] > t);
        if (next === 0) return points[0][1];
        if (next < 0) return points.at(-1)[1];
        const a = points[next - 1],
          b = points[next];
        return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
      };
      corners = points.map((p) => p[0]);
      break;
    }
    case 'exponential': {
      const low = level(c.low),
        high = level(c.high),
        riseDelay = nonnegative(c.riseDelay, 's');
      const fallDelay = nonnegative(c.fallDelay, 's'),
        riseTau = positiveQuantity(c.riseTau, 's'),
        fallTau = positiveQuantity(c.fallTau, 's');
      if (fallDelay <= riseDelay)
        throw new Error('Fall delay must be after rise delay.');
      expression = `EXP(${low} ${high} ${riseDelay} ${riseTau} ${fallDelay} ${fallTau})`;
      duration = fallDelay + 5 * Math.max(riseTau, fallTau);
      value = (t) =>
        low +
        (t < riseDelay
          ? 0
          : (high - low) * (1 - Math.exp(-(t - riseDelay) / riseTau))) +
        (t < fallDelay
          ? 0
          : (low - high) * (1 - Math.exp(-(t - fallDelay) / fallTau)));
      corners = [riseDelay, fallDelay];
      break;
    }
    case 'fm': {
      const offset = level(c.offset),
        amplitude = level(c.amplitude),
        frequency = positiveQuantity(c.frequency, 'Hz');
      const modulation = positiveQuantity(c.modulationFrequency, 'Hz'),
        index = nonnegative(c.modulationIndex);
      expression = `SFFM(${offset} ${amplitude} ${frequency} ${index} ${modulation})`;
      duration = 3 / Math.min(frequency, modulation);
      value = (t) =>
        offset +
        amplitude *
          Math.sin(
            2 * Math.PI * frequency * t +
              index * Math.sin(2 * Math.PI * modulation * t),
          );
      break;
    }
    default:
      throw new Error('Choose a supported source waveform.');
  }
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error('Source preview duration is out of range.');
  return {
    statement: `DC ${dc} AC ${ac} ${acPhase}${
      expression ? ' ' + expression : ''
    }`,
    duration,
    value,
    corners,
    unit,
  };
}
export function controlTemplate(control: SpiceControl): string {
  switch (control.kind) {
    case 'source':
      return `$(ref) %(1) %(2) ${compileSource(control).statement}`;
    case 'controlled': {
      if (!['voltage', 'current'].includes(control.type))
        throw new Error('Choose voltage or current.');
      return `$(ref) %(1) %(2) %(3) %(4) ${parseQuantity(control.gain)}`;
    }
    case 'probe':
      if (!['voltage', 'differential', 'current'].includes(control.mode))
        throw new Error('Choose a probe type.');
      return control.mode === 'current'
        ? '$(ref) %(1) %(2) DC 0'
        : '* Voltage probe $(ref)';
  }
}
export function sourcePreview(config: SourceConfig): ResultData {
  const source = compileSource(config);
  const times = [
    ...new Set([
      ...Array.from({ length: 801 }, (_, i) => (i * source.duration) / 800),
      ...source.corners,
    ]),
  ].sort((a, b) => a - b);
  return {
    scale: 'time',
    log: '',
    vectors: [
      { name: 'time', unit: 's', real: times },
      { name: 'Source', unit: source.unit, real: times.map(source.value) },
    ],
  };
}
export function probeResult(
  net: NetlistData,
  symbol: dsnSymbol,
  data: ResultData,
): ResultData | undefined {
  const control = readControl(symbol);
  if (control?.kind !== 'probe') return;
  const ref = symbol.text
    .find((f) => f.description === 'Ref')
    ?.value.toLowerCase();
  const find = (name: string) =>
    data.vectors.find(
      (v) =>
        v.name.toLowerCase() === name?.toLowerCase() ||
        v.name.toLowerCase() === `v(${name?.toLowerCase()})`,
    );
  const scale = data.vectors.find((v) => v.name === data.scale);
  let measured;
  if (control.mode === 'current') {
    const current = find(`${ref}#branch`) || find(`i(${ref})`);
    if (!current) return;
    measured = {
      ...current,
      name: ref,
      real: control.invert ? current.real.map((n) => -n) : current.real,
      imaginary: control.invert
        ? current.imaginary?.map((n) => -n)
        : current.imaginary,
    };
  } else {
    const plus = spicePinLabel('1', symbol, net);
    const minus =
      control.mode === 'differential' ? spicePinLabel('2', symbol, net) : '0';
    if (!plus || !minus) return;
    const a = plus === '0' ? undefined : find(plus),
      b = minus === '0' ? undefined : find(minus);
    if ((plus !== '0' && !a) || (minus !== '0' && !b)) return;
    const count = a?.real.length || b?.real.length || scale?.real.length || 1;
    const sign = control.invert ? -1 : 1;
    measured = {
      name: ref,
      unit: 'V',
      real:
        !b && a && !control.invert
          ? a.real
          : Array.from(
              { length: count },
              (_, i) => sign * ((a?.real[i] ?? 0) - (b?.real[i] ?? 0)),
            ),
      imaginary:
        !b && a && !control.invert
          ? a.imaginary
          : a?.imaginary || b?.imaginary
          ? Array.from(
              { length: count },
              (_, i) =>
                sign * ((a?.imaginary?.[i] ?? 0) - (b?.imaginary?.[i] ?? 0)),
            )
          : undefined,
    };
  }
  return { ...data, vectors: [...(scale ? [scale] : []), measured] };
}
