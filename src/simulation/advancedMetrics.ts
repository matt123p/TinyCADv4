import { ResultData } from './contracts';
import { MeasurementDefinition, MeasurementResult } from './explorerTypes';
import { parseQuantity } from './numbers';
type Measure = (
  definition: MeasurementDefinition,
  data?: ResultData,
) => MeasurementResult;
export const advancedKinds = [
  'absolutePeak',
  'efficiency',
  'loss',
  'impedance',
  'groupDelay',
  'passbandRipple',
  'attenuation',
  'bandpassQ',
] as const;
export function advancedMetric(
  def: MeasurementDefinition,
  data: ResultData | undefined,
  measure: Measure,
): MeasurementResult {
  const base = { id: def.id, unit: '', explanation: '' };
  try {
    if (!data) throw new Error('No acquisition.');
    const source = data.vectors.find(
        (v) => v.name.toLowerCase() === def.source.toLowerCase(),
      ),
      reference = data.vectors.find(
        (v) => v.name.toLowerCase() === def.reference?.toLowerCase(),
      );
    if (!source) throw new Error('Output signal is missing.');
    if (def.kind === 'absolutePeak') {
      if (data.scale === 'frequency')
        throw new Error(
          'Stress ratings require transient or DC data, not a small-signal AC sweep.',
        );
      const low = measure({ ...def, kind: 'minimum' }, data),
        high = measure({ ...def, kind: 'maximum' }, data);
      if (low.state !== 'valid' || high.state !== 'valid')
        throw new Error(low.explanation || high.explanation);
      return {
        ...high,
        id: def.id,
        value: Math.max(Math.abs(low.value), Math.abs(high.value)),
        explanation: 'Maximum absolute value in the selected interval.',
      };
    }
    if (!reference)
      throw new Error('Select an explicit input reference / power boundary.');
    if (def.kind === 'efficiency' || def.kind === 'loss') {
      if (source.unit !== 'W' || reference.unit !== 'W')
        throw new Error(
          'Select consumed output power and signed supplying input power (W).',
        );
      const kind = data.scale === 'time' ? 'mean' : 'value',
        output = measure({ ...def, kind }, data),
        input = measure(
          { ...def, kind, source: def.reference, reference: undefined },
          data,
        );
      if (output.state !== 'valid' || input.state !== 'valid')
        throw new Error(output.explanation || input.explanation);
      if (input.value >= 0 || output.value < 0)
        throw new Error(
          'Input must supply power (negative consumed W), and output must consume power (positive W). Check boundary and terminal directions.',
        );
      return {
        ...base,
        state: 'valid',
        value:
          def.kind === 'efficiency'
            ? (100 * output.value) / -input.value
            : -input.value - output.value,
        unit: def.kind === 'efficiency' ? '%' : 'W',
        explanation:
          'Explicit input/output boundary; time-weighted mean power for transient data.',
        evidence: output.evidence,
      };
    }
    if (data.scale !== 'frequency')
      throw new Error('This metric requires an AC frequency sweep.');
    if (def.kind === 'bandpassQ') {
      const width = measure(
          { ...def, kind: 'bandwidth', referenceGain: 'peak' },
          data,
        ),
        peak = measure({ ...def, kind: 'resonance' }, data);
      if (width.state !== 'valid' || peak.state !== 'valid' || width.value <= 0)
        throw new Error(
          'Band-pass Q requires an interior peak and two half-power crossings.',
        );
      return {
        ...base,
        state: 'valid',
        value: peak.value / width.value,
        unit: '',
        explanation:
          'Band-pass response definition Q = peak frequency / half-power bandwidth; not a universal topology/device Q.',
        evidence: width.evidence,
      };
    }
    if (
      def.kind === 'impedance'
        ? source.unit !== 'V' || reference.unit !== 'A'
        : source.unit !== reference.unit
    )
      throw new Error(
        def.kind === 'impedance'
          ? 'Port impedance requires voltage divided by current into the port; use a dedicated test source/current probe.'
          : 'Input/output units must match.',
      );
    const axis = data.vectors.find((v) => v.name === data.scale),
      x = axis?.real;
    if (
      !x?.length ||
      x.some((v, i) => v <= 0 || !Number.isFinite(v) || (i && v <= x[i - 1]))
    )
      throw new Error('Frequency scale is missing or invalid.');
    const re: number[] = [],
      im: number[] = [];
    source.real.forEach((a, i) => {
      const b = source.imaginary?.[i] || 0,
        c = reference.real[i],
        d = reference.imaginary?.[i] || 0,
        den = c * c + d * d;
      re.push((a * c + b * d) / den);
      im.push((b * c - a * d) / den);
    });
    const magnitude = re.map((r, i) => Math.hypot(r, im[i]));
    if (magnitude.some((v) => !Number.isFinite(v) || v <= 0))
      throw new Error(
        'Zero/undefined reference or response in the acquisition.',
      );
    const at = def.at ? parseQuantity(def.at, 'Hz') : x[0],
      from = def.from ? parseQuantity(def.from, 'Hz') : x[0],
      to = def.to ? parseQuantity(def.to, 'Hz') : x.at(-1);
    if (from > to || from < x[0] || to > x.at(-1) || at < x[0] || at > x.at(-1))
      throw new Error('Frequency/window is outside the acquisition.');
    const interpolate = (values: number[], frequency: number) => {
      let i = 0;
      while (i + 1 < x.length && x[i + 1] <= frequency) i++;
      if (x[i] === frequency) return values[i];
      return (
        values[i] +
        ((values[i + 1] - values[i]) * Math.log(frequency / x[i])) /
          Math.log(x[i + 1] / x[i])
      );
    };
    let value: number,
      unit = '';
    if (def.kind === 'impedance') {
      value = interpolate(magnitude, at);
      unit = 'Ohm';
    } else if (def.kind === 'attenuation') {
      const gain = parseQuantity(def.referenceGain || '1');
      if (gain <= 0) throw new Error('Reference gain must be positive.');
      value = -20 * Math.log10(interpolate(magnitude, at) / gain);
      unit = 'dB';
    } else if (def.kind === 'passbandRipple') {
      const values = [
        interpolate(magnitude, from),
        ...magnitude.filter((_, i) => x[i] > from && x[i] < to),
        interpolate(magnitude, to),
      ];
      value = 20 * Math.log10(Math.max(...values) / Math.min(...values));
      unit = 'dB';
    } else {
      const phase = re.map((r, i) => Math.atan2(im[i], r));
      for (let i = 1; i < phase.length; i++) {
        while (phase[i] - phase[i - 1] > Math.PI) phase[i] -= 2 * Math.PI;
        while (phase[i] - phase[i - 1] < -Math.PI) phase[i] += 2 * Math.PI;
      }
      const delay = phase.map((_, i) => {
        const lo = Math.max(0, i - 1),
          hi = Math.min(x.length - 1, i + 1);
        return -(phase[hi] - phase[lo]) / (2 * Math.PI * (x[hi] - x[lo]));
      });
      value = interpolate(delay, at);
      unit = 's';
    }
    if (!Number.isFinite(value))
      throw new Error('Metric is undefined in this acquisition.');
    return {
      ...base,
      state: 'valid',
      value,
      unit,
      explanation: `${def.kind}; explicit AC input/output, logarithmic frequency interpolation.`,
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
