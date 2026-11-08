import { ResultData, ResultVector } from './contracts';
import {
  MeasurementDefinition,
  MeasurementResult,
  RequirementDefinition,
  RequirementResult,
  metricKinds,
} from './explorerTypes';
import { parseQuantity } from './numbers';

export const metricAlgorithm = 'tinycad-metrics-1' as const;
const vector = (data: ResultData, name: string) =>
  data.vectors.find((v) => v.name.toLowerCase() === name.toLowerCase());
function interpolate(
  x: number[],
  y: number[],
  at: number,
  logarithmic = false,
): number {
  if (at < x[0] || at > x.at(-1))
    throw new Error('Requested position is outside the acquisition.');
  let lo = 0,
    hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (x[mid] <= at) lo = mid;
    else hi = mid;
  }
  if (x[lo] === at || lo === hi) return y[lo];
  const transform = (n: number) => (logarithmic ? Math.log(n) : n);
  return (
    y[lo] +
    ((y[hi] - y[lo]) * (transform(at) - transform(x[lo]))) /
      (transform(x[hi]) - transform(x[lo]))
  );
}
function crossings(
  x: number[],
  y: number[],
  level: number,
  direction: 1 | -1,
): number[] {
  const result: number[] = [];
  for (let i = 1; i < x.length; i++)
    if (direction * (y[i - 1] - level) < 0 && direction * (y[i] - level) >= 0)
      result.push(
        x[i - 1] + ((x[i] - x[i - 1]) * (level - y[i - 1])) / (y[i] - y[i - 1]),
      );
  return result;
}
export function measure(
  def: MeasurementDefinition,
  data?: ResultData,
): MeasurementResult {
  const base = { id: def.id, unit: '', explanation: '' };
  if (!metricKinds.includes(def.kind))
    return {
      ...base,
      state: 'invalid',
      explanation: 'Unsupported named measurement.',
    };
  try {
    if (!data) throw new Error('No acquisition available.');
    const signal = vector(data, def.source),
      reference = def.reference && vector(data, def.reference);
    if (!signal) throw new Error(`Signal ${def.source} is unavailable.`);
    if (def.reference && !reference)
      throw new Error(`Reference ${def.reference} is unavailable.`);
    const axis = vector(data, data.scale);
    const x = axis?.real || signal.real.map((_, i) => i);
    if (
      !x.length ||
      signal.real.length !== x.length ||
      x.some((n, i) => !Number.isFinite(n) || (i > 0 && n <= x[i - 1]))
    )
      throw new Error(
        'Measurement requires finite samples and a strictly increasing axis.',
      );
    const axisUnit = axis?.unit || '';
    const from = def.from ? parseQuantity(def.from, axisUnit) : x[0],
      to = def.to ? parseQuantity(def.to, axisUnit) : x.at(-1);
    if (from > to || from < x[0] || to > x.at(-1))
      throw new Error('Measurement window is outside the acquisition.');
    const xx = [
      from,
      ...x.filter((n) => n > from && n < to),
      ...(to > from ? [to] : []),
    ];
    const log = data.scale === 'frequency';
    const sample = (v: ResultVector, imaginary = false) => {
      const values = imaginary ? v.imaginary : v.real;
      if (!values) return xx.map(() => 0);
      let index = 0;
      return xx.map((n) => {
        while (index + 1 < x.length && x[index + 1] <= n) index++;
        if (x[index] === n) return values[index];
        const ratio = log
          ? Math.log(n / x[index]) / Math.log(x[index + 1] / x[index])
          : (n - x[index]) / (x[index + 1] - x[index]);
        return values[index] + (values[index + 1] - values[index]) * ratio;
      });
    };
    let yy = sample(signal),
      unit = signal.unit;
    const min = () => yy.reduce((a, b) => Math.min(a, b), Infinity);
    const max = () => yy.reduce((a, b) => Math.max(a, b), -Infinity);
    const point = () => (def.at ? parseQuantity(def.at, axisUnit) : from);
    let value: number;
    const timing = [
      'riseTime',
      'fallTime',
      'period',
      'frequency',
      'dutyCycle',
      'pulseWidth',
      'delay',
      'settlingTime',
      'timeConstant',
      'overshoot',
      'undershoot',
    ].includes(def.kind);
    if (timing && data.scale !== 'time')
      throw new Error('This measurement requires a transient time axis.');
    if (
      ['gain', 'phase', 'cutoff', 'bandwidth', 'resonance'].includes(def.kind)
    ) {
      if (data.scale !== 'frequency' || !reference)
        throw new Error(
          'AC measurements require a frequency acquisition and input reference.',
        );
      if (signal.unit !== reference.unit)
        throw new Error('Gain requires matching input and output units.');
      const a = yy,
        b = sample(signal, true),
        c = sample(reference),
        d = sample(reference, true);
      const real = a.map(
        (v, i) => (v * c[i] + b[i] * d[i]) / (c[i] * c[i] + d[i] * d[i]),
      );
      const im = a.map(
        (v, i) => (b[i] * c[i] - v * d[i]) / (c[i] * c[i] + d[i] * d[i]),
      );
      yy = real.map((v, i) => Math.hypot(v, im[i]));
      if (yy.some((n) => !Number.isFinite(n)))
        throw new Error('Input reference is zero or undefined.');
      if (def.kind === 'gain') {
        value = interpolate(xx, yy, point(), true);
        unit = `${signal.unit}/${reference.unit}`;
      } else if (def.kind === 'phase') {
        const phase = real.map(
          (v, i) => (Math.atan2(im[i], v) * 180) / Math.PI,
        );
        for (let i = 1; i < phase.length; i++) {
          while (phase[i] - phase[i - 1] > 180) phase[i] -= 360;
          while (phase[i] - phase[i - 1] < -180) phase[i] += 360;
        }
        value = interpolate(xx, phase, point(), true);
        unit = 'deg';
      } else if (def.kind === 'resonance') {
        value = xx[yy.indexOf(max())];
        unit = 'Hz';
        if (value === from || value === to)
          throw new Error('Resonance is outside the acquired range.');
      } else {
        const referenceGain =
          def.referenceGain === 'peak'
            ? max()
            : parseQuantity(def.referenceGain || '1');
        if (referenceGain <= 0)
          throw new Error('Reference gain must be positive (or peak).');
        const level = referenceGain / Math.sqrt(2),
          hits: number[] = [];
        for (let i = 1; i < xx.length; i++)
          if (
            (yy[i - 1] - level) * (yy[i] - level) < 0 ||
            (yy[i] === level && yy[i - 1] !== level)
          )
            hits.push(
              Math.exp(
                Math.log(xx[i - 1]) +
                  ((Math.log(xx[i]) - Math.log(xx[i - 1])) *
                    (level - yy[i - 1])) /
                    (yy[i] - yy[i - 1]),
              ),
            );
        if (def.kind === 'cutoff' && hits.length !== 1)
          throw new Error(
            `Expected one -3 dB crossing; found ${hits.length}. Adjust range or use bandwidth.`,
          );
        if (def.kind === 'bandwidth' && hits.length !== 2)
          throw new Error(
            `Bandwidth requires two -3 dB crossings; found ${hits.length}.`,
          );
        value = def.kind === 'cutoff' ? hits[0] : hits[1] - hits[0];
        unit = 'Hz';
      }
    } else if (timing) {
      const initial = def.initial ? parseQuantity(def.initial, unit) : min(),
        final = def.final ? parseQuantity(def.final, unit) : max();
      const span = final - initial;
      const level = def.threshold
        ? parseQuantity(def.threshold, unit)
        : (initial + final) / 2;
      const up = crossings(xx, yy, level, 1),
        down = crossings(xx, yy, level, -1);
      unit = 's';
      if (def.kind === 'riseTime' || def.kind === 'fallTime') {
        if (!def.initial || !def.final || span <= 0)
          throw new Error(
            'Set initial and final levels (low and high) for 10–90% timing.',
          );
        const falling = def.kind === 'fallTime',
          starts = crossings(
            xx,
            yy,
            initial + span * (falling ? 0.9 : 0.1),
            falling ? -1 : 1,
          );
        const end =
          starts.length &&
          crossings(
            xx,
            yy,
            initial + span * (falling ? 0.1 : 0.9),
            falling ? -1 : 1,
          ).find((n) => n > starts[0]);
        value = typeof end === 'number' ? end - starts[0] : NaN;
      } else if (def.kind === 'period' || def.kind === 'frequency') {
        value = up[1] - up[0];
        if (def.kind === 'frequency') {
          value = 1 / value;
          unit = 'Hz';
        }
      } else if (def.kind === 'pulseWidth' || def.kind === 'dutyCycle') {
        value = (down.find((n) => n > up[0]) ?? NaN) - up[0];
        if (def.kind === 'dutyCycle') {
          value = (100 * value) / (up[1] - up[0]);
          unit = '%';
        }
      } else if (def.kind === 'delay') {
        if (!reference || reference.unit !== signal.unit)
          throw new Error(
            'Delay requires a reference signal with matching units.',
          );
        value = up[0] - crossings(xx, sample(reference), level, 1)[0];
      } else {
        if (!def.initial || !def.final || !span)
          throw new Error('Set distinct initial and final levels.');
        if (def.kind === 'overshoot' || def.kind === 'undershoot') {
          value =
            (100 *
              (def.kind === 'overshoot'
                ? Math.max(0, span > 0 ? max() - final : final - min())
                : Math.max(0, span > 0 ? initial - min() : max() - initial))) /
            Math.abs(span);
          unit = '%';
        } else if (def.kind === 'timeConstant') {
          value =
            crossings(
              xx,
              yy,
              initial + span * (1 - 1 / Math.E),
              span > 0 ? 1 : -1,
            )[0] - from;
        } else {
          const tolerance = parseQuantity(def.tolerance || '2') / 100;
          if (tolerance <= 0 || tolerance >= 1)
            throw new Error(
              'Settling tolerance must be between 0 and 100 percent.',
            );
          const error = yy.map(
            (n) => Math.abs(n - final) - Math.abs(span) * tolerance,
          );
          if (error.at(-1) > 0)
            throw new Error('Waveform has not settled within the acquisition.');
          let last = -1;
          error.forEach((n, i) => {
            if (n > 0) last = i;
          });
          value =
            last < 0
              ? 0
              : xx[last] +
                ((xx[last + 1] - xx[last]) * error[last]) /
                  (error[last] - error[last + 1]) -
                from;
        }
      }
    } else if (def.kind === 'value') value = interpolate(xx, yy, point(), log);
    else if (def.kind === 'minimum') value = min();
    else if (def.kind === 'maximum') value = max();
    else if (def.kind === 'peakToPeak') value = max() - min();
    else {
      if (data.scale !== 'time')
        throw new Error(
          'Time average, RMS and integration require a transient acquisition.',
        );
      if (to === from)
        throw new Error('Measurement requires a nonzero time window.');
      let integral = 0,
        square = 0;
      for (let i = 1; i < xx.length; i++) {
        const dt = xx[i] - xx[i - 1],
          a = yy[i - 1],
          b = yy[i];
        integral += (dt * (a + b)) / 2;
        square += (dt * (a * a + a * b + b * b)) / 3;
      }
      const mean = integral / (to - from),
        rms2 = square / (to - from);
      value =
        def.kind === 'mean'
          ? mean
          : def.kind === 'integral'
          ? integral
          : Math.sqrt(
              Math.max(0, rms2 - (def.kind === 'rippleRms' ? mean * mean : 0)),
            );
      if (def.kind === 'integral') unit = unit === 'W' ? 'J' : `${unit} s`;
    }
    if (!Number.isFinite(value))
      throw new Error(
        'Required crossings or samples were not found in this window.',
      );
    return {
      ...base,
      state: 'valid',
      value,
      unit,
      explanation: `${def.kind}; ${from}–${to} ${axisUnit}. ${metricAlgorithm}`,
      evidence: { from, to, source: def.source, reference: def.reference },
    };
  } catch (error) {
    return {
      ...base,
      state: 'unavailable',
      explanation: error instanceof Error ? error.message : String(error),
    };
  }
}
export function checkRequirement(
  rule: RequirementDefinition,
  results: MeasurementResult[],
): RequirementResult {
  const result = results.find((r) => r.id === rule.measurement);
  try {
    if (!result || result.state !== 'valid' || !Number.isFinite(result.value))
      throw new Error(result?.explanation || 'Named measurement is missing.');
    if (rule.unit !== result.unit)
      throw new Error(
        `Requirement unit ${rule.unit} does not match ${result.unit}.`,
      );
    const lower =
      rule.comparison === 'atMost'
        ? -Infinity
        : parseQuantity(rule.lower, rule.unit);
    const upper =
      rule.comparison === 'atLeast'
        ? Infinity
        : parseQuantity(rule.upper, rule.unit);
    if (lower > upper) throw new Error('Lower limit exceeds upper limit.');
    const pass = result.value >= lower && result.value <= upper;
    return {
      id: rule.id,
      state: pass ? 'pass' : 'fail',
      explanation: `${result.value} ${result.unit}; required ${lower} to ${upper} ${rule.unit}.`,
    };
  } catch (error) {
    return {
      id: rule.id,
      state: 'unavailable',
      explanation: error instanceof Error ? error.message : String(error),
    };
  }
}
