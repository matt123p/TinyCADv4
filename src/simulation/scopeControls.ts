import { InstrumentConfig } from './instruments';
import { parseQuantity, positiveQuantity } from './numbers';

// Each detent changes range by the conventional 1–2–5 sequence.
export const scopeVoltageSteps = [
  '1mV',
  '2mV',
  '5mV',
  '10mV',
  '20mV',
  '50mV',
  '100mV',
  '200mV',
  '500mV',
  '1V',
  '2V',
  '5V',
  '10V',
];
export const scopeTimeSteps = [
  '1us',
  '2us',
  '5us',
  '10us',
  '20us',
  '50us',
  '100us',
  '200us',
  '500us',
  '1ms',
  '2ms',
  '5ms',
  '10ms',
  '20ms',
  '50ms',
  '100ms',
  '200ms',
  '500ms',
  '1s',
];

export function scopeStepIndex(value: string, steps: string[], unit: string) {
  const actual = positiveQuantity(value, unit);
  return steps.reduce(
    (best, step, index) =>
      Math.abs(Math.log(positiveQuantity(step, unit) / actual)) <
      Math.abs(Math.log(positiveQuantity(steps[best], unit) / actual))
        ? index
        : best,
    0,
  );
}

export function scopeNextStep(
  value: string,
  steps: string[],
  unit: string,
  direction: number,
) {
  const actual = positiveQuantity(value, unit);
  const candidates = direction > 0 ? steps : [...steps].reverse();
  return (
    candidates.find((candidate) =>
      direction > 0
        ? positiveQuantity(candidate, unit) > actual * (1 + 1e-8)
        : positiveQuantity(candidate, unit) < actual * (1 - 1e-8),
    ) || (direction > 0 ? steps[steps.length - 1] : steps[0])
  );
}

export function scopeQuantity(value: number, unit: string) {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  const exponent = magnitude
    ? Math.max(-12, Math.min(9, Math.floor(Math.log10(magnitude) / 3) * 3))
    : 0;
  const prefixes: Record<number, string> = {
    [-12]: 'p',
    [-9]: 'n',
    [-6]: 'µ',
    [-3]: 'm',
    0: '',
    3: 'k',
    6: 'M',
    9: 'G',
  };
  return `${Number((value / 10 ** exponent).toPrecision(4))} ${
    prefixes[exponent]
  }${unit}`;
}

export function scopePosition(config: InstrumentConfig, channel: 'A' | 'B') {
  // The stored offset is the voltage at screen centre. A positive position
  // moves the zero-volt marker up, so its centre voltage is negative.
  return (
    -parseQuantity(config[channel === 'A' ? 'offsetA' : 'offsetB'], 'V') /
      positiveQuantity(config[channel === 'A' ? 'scaleA' : 'scaleB'], 'V') || 0
  );
}

export function scopePositionPatch(
  config: InstrumentConfig,
  channel: 'A' | 'B',
  divisions: number,
): Partial<InstrumentConfig> {
  const voltage =
    -divisions *
    positiveQuantity(config[channel === 'A' ? 'scaleA' : 'scaleB'], 'V');
  return channel === 'A'
    ? { offsetA: String(voltage) }
    : { offsetB: String(voltage) };
}

export function scopeScalePatch(
  config: InstrumentConfig,
  channel: 'A' | 'B',
  scale: string,
): Partial<InstrumentConfig> {
  const offset = -scopePosition(config, channel) * positiveQuantity(scale, 'V');
  return channel === 'A'
    ? { scaleA: scale, offsetA: String(offset) }
    : { scaleB: scale, offsetB: String(offset) };
}
