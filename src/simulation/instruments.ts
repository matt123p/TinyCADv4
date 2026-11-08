import { SourceConfig, defaultSource, compileSource } from './controls';
import { positiveQuantity, parseQuantity } from './numbers';
import { dsnSymbol } from '../model/dsnItem';
import { NetlistData } from '../io/netlists/netlistGenerator';
import { spicePinLabel } from '../io/netlists/netlistSpice';
import { ResultData, ResultVector } from './contracts';
import { measure } from './metrics';

export type InstrumentType = 'scope' | 'meter' | 'generator' | 'supply';
export interface InstrumentConfig {
  kind: 'instrument';
  type: InstrumentType;
  enabled: boolean;
  student: boolean;
  mode: 'dcV' | 'acV' | 'dcA' | 'acA' | 'ohm';
  range: string;
  inputResistance: string;
  burden: string;
  testCurrent: string;
  timebase: string;
  scaleA: string;
  scaleB: string;
  offsetA: string;
  offsetB: string;
  couplingA: 'DC' | 'AC' | 'GND';
  couplingB: 'DC' | 'AC' | 'GND';
  trigger: 'A' | 'B';
  edge: 'rising' | 'falling';
  level: string;
  acquisition: 'auto' | 'normal' | 'single';
  source: SourceConfig;
  duty: string;
  voltage: string;
  currentLimit: string;
  outputResistance: string;
  ramp: string;
}
export const instrumentNames: Record<InstrumentType, string> = {
  scope: 'Oscilloscope',
  meter: 'Multimeter',
  generator: 'Function generator',
  supply: 'Bench supply',
};
export function defaultInstrument(type: InstrumentType): InstrumentConfig {
  return {
    kind: 'instrument',
    type,
    enabled: true,
    student: true,
    mode: 'dcV',
    range: 'auto',
    inputResistance: type === 'scope' ? '1megOhm' : '10megOhm',
    burden: '1Ohm',
    testCurrent: '1mA',
    timebase: '1ms',
    scaleA: '1V',
    scaleB: '1V',
    offsetA: '0V',
    offsetB: '0V',
    couplingA: 'DC',
    couplingB: 'DC',
    trigger: 'A',
    edge: 'rising',
    level: '0V',
    acquisition: 'auto',
    source: { ...defaultSource(), waveform: 'sine', dc: '0' },
    duty: '50',
    voltage: '5V',
    currentLimit: '100mA',
    outputResistance: type === 'generator' ? '50Ohm' : '.1Ohm',
    ramp: '0s',
  };
}
export function isInstrumentConfig(value: any): value is InstrumentConfig {
  if (!value || !Object.keys(instrumentNames).includes(value.type))
    return false;
  const defaults = defaultInstrument(value.type);
  return (
    Object.entries(defaults).every(([key, v]) =>
      key === 'source'
        ? value.source &&
          Object.keys(defaultSource()).every(
            (k) =>
              typeof value.source[k] === 'string' &&
              value.source[k].length <= (k === 'points' ? 65536 : 1024),
          )
        : typeof value[key] === typeof v &&
          (typeof v !== 'string' || value[key].length <= 1024),
    ) &&
    ['auto', 'normal', 'single'].includes(value.acquisition) &&
    ['A', 'B'].includes(value.trigger) &&
    ['rising', 'falling'].includes(value.edge)
  );
}
export function generatorSource(c: InstrumentConfig): SourceConfig {
  const f = positiveQuantity(c.source.frequency, 'Hz'),
    amplitude = positiveQuantity(c.source.amplitude, 'V'),
    offset = parseQuantity(c.source.offset, 'V'),
    duty = parseQuantity(c.duty);
  if (duty <= 0 || duty >= 100)
    throw new Error('Duty must be between 0 and 100 percent.');
  return {
    ...c.source,
    type: 'voltage',
    dc: String(offset),
    period: String(1 / f),
    width: String(duty / 100 / f),
    rise: String(1e-4 / f),
    fall: String(1e-4 / f),
    low: String(offset - amplitude),
    high: String(offset + amplitude),
  };
}
export function instrumentFields(
  c: InstrumentConfig,
): { key: string; unit: string; value: string }[] {
  const fields =
    c.type === 'generator'
      ? {
          'source.frequency': 'Hz',
          'source.amplitude': 'V',
          'source.offset': 'V',
          'source.phase': '',
          'source.acMagnitude': 'V',
          duty: '',
          outputResistance: 'Ohm',
        }
      : c.type === 'supply'
      ? { voltage: 'V', currentLimit: 'A', outputResistance: 'Ohm', ramp: 's' }
      : c.type === 'scope'
      ? { inputResistance: 'Ohm' }
      : { inputResistance: 'Ohm', burden: 'Ohm', testCurrent: 'A' };
  return Object.entries(fields).map(([key, unit]) => ({
    key: `instrument:${key}`,
    unit,
    value: key.startsWith('source.')
      ? c.source[key.slice(7) as keyof SourceConfig]
      : (c[key as keyof InstrumentConfig] as string),
  }));
}
export function instrumentOverride(
  c: InstrumentConfig,
  key: string,
  value: string,
): InstrumentConfig {
  if (!instrumentFields(c).some((field) => field.key === key))
    throw new Error('Unsupported instrument parameter.');
  const property = key.slice(11);
  return property.startsWith('source.')
    ? { ...c, source: { ...c.source, [property.slice(7)]: value } }
    : { ...c, [property]: value };
}
export function instrumentTemplate(c: InstrumentConfig): string {
  if (!Object.keys(instrumentNames).includes(c.type))
    throw new Error('Unknown instrument.');
  const ref = '$(ref)',
    p = '%(1)',
    n = '%(2)';
  if (c.type === 'generator')
    return c.enabled
      ? `V_${ref} ${p} _${ref}_out ${
          compileSource(generatorSource(c)).statement
        }\nR_${ref}_out _${ref}_out ${n} ${positiveQuantity(
          c.outputResistance,
          'Ohm',
        )}`
      : `R_${ref}_off ${p} ${n} 1e12`;
  if (c.type === 'supply') {
    const v = parseQuantity(c.voltage, 'V'),
      limit = positiveQuantity(c.currentLimit, 'A'),
      r = positiveQuantity(c.outputResistance, 'Ohm'),
      ramp = parseQuantity(c.ramp, 's');
    if (v < 0 || ramp < 0)
      throw new Error('Supply voltage and ramp must be nonnegative.');
    // Smooth, symmetric current limiting with finite output resistance. This is
    // an explicitly idealised bench supply, not a vendor switching/regulator model.
    return `V_${ref}_set _${ref}_set ${n} DC ${v}${
      ramp ? ` PWL(0 0 ${ramp} ${v})` : ''
    }\nB_${ref}_drive ${n} _${ref}_out I={${
      c.enabled ? limit : 0
    }*tanh((v(_${ref}_set,${n})-v(_${ref}_out,${n}))/(${r}*${limit}))}\nV_${ref}_sense _${ref}_out ${p} 0\nR_${ref}_leak ${p} ${n} 1e12`;
  }
  if (c.type === 'scope') {
    positiveQuantity(c.timebase, 's');
    positiveQuantity(c.scaleA, 'V');
    positiveQuantity(c.scaleB, 'V');
    parseQuantity(c.offsetA, 'V');
    parseQuantity(c.offsetB, 'V');
    parseQuantity(c.level, 'V');
    if (
      !['DC', 'AC', 'GND'].includes(c.couplingA) ||
      !['DC', 'AC', 'GND'].includes(c.couplingB)
    )
      throw new Error('Choose a scope coupling mode.');
    return `R_${ref}_A ${p} ${n} ${positiveQuantity(
      c.inputResistance,
      'Ohm',
    )}\nR_${ref}_B %(3) %(4) ${positiveQuantity(c.inputResistance, 'Ohm')}`;
  }
  if (!['dcV', 'acV', 'dcA', 'acA', 'ohm'].includes(c.mode))
    throw new Error('Choose a meter mode.');
  if (c.range !== 'auto')
    positiveQuantity(
      c.range,
      c.mode === 'ohm' ? 'Ohm' : c.mode.endsWith('A') ? 'A' : 'V',
    );
  positiveQuantity(c.testCurrent, 'A');
  return c.mode.endsWith('A')
    ? `V_${ref}_sense ${p} _${ref}_sense 0\nR_${ref}_burden _${ref}_sense ${n} ${positiveQuantity(
        c.burden,
        'Ohm',
      )}`
    : c.mode === 'ohm'
    ? `R_${ref}_idle ${p} ${n} 1e12`
    : `R_${ref}_in ${p} ${n} ${positiveQuantity(c.inputResistance, 'Ohm')}`;
}
export function instrumentSignals(
  net: NetlistData,
  symbol: dsnSymbol,
  data: ResultData,
  c: InstrumentConfig,
): ResultData {
  const count = data.vectors[0]?.real.length || 0;
  const find = (name: string) =>
    data.vectors.find((v) => v.name.toLowerCase() === name.toLowerCase());
  const node = (pin: string): ResultVector | undefined => {
    const name = spicePinLabel(pin, symbol, net);
    return name === '0'
      ? { name: '0', unit: 'V', real: Array(count).fill(0) }
      : name && (find(name) || find(`v(${name})`));
  };
  const diff = (
    a: string,
    b: string,
    name: string,
  ): ResultVector | undefined => {
    const p = node(a),
      n = node(b);
    return p && n
      ? {
          name,
          unit: 'V',
          real: p.real.map((v, i) => v - n.real[i]),
          imaginary: p.real.map(
            (_, i) => (p.imaginary?.[i] || 0) - (n.imaginary?.[i] || 0),
          ),
        }
      : undefined;
  };
  const ref = symbol.text.find((f) => f.description === 'Ref')?.value;
  const vector =
    c.type === 'meter' && c.mode.endsWith('A')
      ? find(`v_${ref}_sense#branch`)
      : c.type === 'supply'
      ? find(`v_${ref}_sense#branch`)
      : diff('1', '2', c.type === 'scope' ? 'A' : 'Voltage');
  const scale = find(data.scale);
  const vectors = [
    ...(scale ? [scale] : []),
    ...(vector
      ? [
          {
            ...vector,
            name:
              c.type === 'meter'
                ? 'Reading'
                : c.type === 'supply'
                ? 'Current'
                : vector.name,
          },
        ]
      : []),
    ...(c.type === 'scope' ? [diff('3', '4', 'B')].filter(Boolean) : []),
  ];
  if (c.type === 'supply') {
    const voltage = diff('1', '2', 'Voltage');
    if (voltage) vectors.push(voltage);
  }
  return { ...data, vectors };
}
export function meterReading(
  data: ResultData,
  c: InstrumentConfig,
): {
  text: string;
  value?: number;
  unit: string;
  displayUnit?: string;
  explanation: string;
} {
  const vector = data.vectors.find((v) => v.name === 'Reading');
  const unit = c.mode === 'ohm' ? 'Ohm' : c.mode.endsWith('A') ? 'A' : 'V';
  if (!vector)
    return { text: '—', unit, explanation: 'No matching terminal signal.' };
  if (c.mode === 'ohm')
    return {
      text: 'TEST',
      unit,
      explanation: 'Use the separate unpowered resistance test.',
    };
  const ac = c.mode.startsWith('ac');
  const result = measure(
    {
      id: 'meter',
      name: 'Meter',
      kind: ac ? 'rippleRms' : data.scale === 'time' ? 'mean' : 'value',
      source: 'Reading',
    },
    data,
  );
  if (result.state !== 'valid')
    return { text: '—', unit, explanation: result.explanation };
  const display = meterDisplay(result.value, unit, c.range);
  return {
    ...display,
    explanation:
      display.text === 'OL'
        ? 'Over range'
        : ac
        ? 'AC-coupled true RMS over the acquisition window'
        : 'DC value / time-weighted mean',
  };
}
export function meterDisplay(value: number, unit: string, range: string) {
  const ranges =
    unit === 'Ohm'
      ? [200, 2000, 20000, 200000, 2e6, 20e6, 100e6]
      : unit === 'A'
      ? [0.002, 0.02, 0.2, 2, 10]
      : [0.2, 2, 20, 200, 1000];
  const maximum =
    range === 'auto'
      ? ranges.find((n) => n >= Math.abs(value)) || ranges.at(-1)
      : positiveQuantity(range, unit);
  const exponent = Math.max(
      -9,
      Math.min(9, 3 * Math.floor(Math.log10(maximum) / 3)),
    ),
    factor = 10 ** exponent,
    prefix: Record<number, string> = {
      [-9]: 'n',
      [-6]: 'µ',
      [-3]: 'm',
      0: '',
      3: 'k',
      6: 'M',
      9: 'G',
    };
  const resolution = maximum / 100000,
    rounded = Math.round(value / resolution) * resolution,
    decimals = Math.max(
      0,
      Math.min(9, -Math.floor(Math.log10(resolution / factor))),
    );
  return {
    value,
    unit,
    displayUnit: prefix[exponent] + (unit === 'Ohm' ? 'Ω' : unit),
    text:
      Math.abs(value) > maximum
        ? 'OL'
        : (Math.abs(rounded) < resolution / 2 ? 0 : rounded / factor).toFixed(
            decimals,
          ),
  };
}
export function scopeDisplay(
  data: ResultData,
  c: InstrumentConfig,
): { data: ResultData; triggered: boolean; start: number; stop: number } {
  if (data.scale !== 'time')
    throw new Error('The oscilloscope requires a transient acquisition.');
  const time = data.vectors.find((v) => v.name === 'time');
  if (!time?.real.length) throw new Error('No transient samples.');
  const vectors = data.vectors.map((v) => {
    if (v.name !== 'A' && v.name !== 'B') return v;
    const coupling = v.name === 'A' ? c.couplingA : c.couplingB;
    const mean =
      measure({ id: 'mean', name: 'Mean', kind: 'mean', source: v.name }, data)
        .value || 0;
    return {
      ...v,
      real: v.real.map((n) =>
        coupling === 'GND' ? 0 : n - (coupling === 'AC' ? mean : 0),
      ),
    };
  });
  const trigger = vectors.find((v) => v.name === c.trigger),
    level = parseQuantity(c.level, 'V'),
    direction = c.edge === 'rising' ? 1 : -1;
  let crossing: number;
  for (let i = 1; trigger && i < time.real.length; i++)
    if (
      direction * (trigger.real[i - 1] - level) < 0 &&
      direction * (trigger.real[i] - level) >= 0
    ) {
      crossing =
        time.real[i - 1] +
        ((time.real[i] - time.real[i - 1]) * (level - trigger.real[i - 1])) /
          (trigger.real[i] - trigger.real[i - 1]);
      break;
    }
  const start = crossing ?? time.real[0],
    stop = start + positiveQuantity(c.timebase, 's') * 10;
  return {
    data: { ...data, vectors },
    triggered: crossing !== undefined,
    start,
    stop,
  };
}
