import { ResultData } from './contracts';
import { MeasurementDefinition, MeasurementResult } from './explorerTypes';
import { measurementAxis, measurementLabels } from './measurementPresentation';
import { parseQuantity } from './numbers';
import { chartPoints } from './chartData';
import { measure } from './metrics';

type Point = { x: number; y: number };
type Level = { value: number; label: string; reading?: number };
export function measurementDiagram(
  def: MeasurementDefinition,
  data?: ResultData,
  result?: MeasurementResult,
) {
  const frequency = measurementAxis(def.kind) === 'frequency';
  const advancedIllustration =
    frequency || ['efficiency', 'loss'].includes(def.kind);
  const source = data?.vectors.find(
    (v) => v.name.toLowerCase() === def.source.toLowerCase(),
  );
  const axis = data?.vectors.find((v) => v.name === data.scale);
  const actual = !!source && source.real.some(Number.isFinite);
  const validAxis =
    actual &&
    !!axis &&
    source.real.length === axis.real.length &&
    axis.real.every(
      (n, i) => Number.isFinite(n) && (!i || n > axis.real[i - 1]),
    );
  const unit = actual
    ? source.unit
    : frequency
    ? def.kind === 'phase' || def.kind === 'groupDelay'
      ? 'deg'
      : def.kind === 'impedance'
      ? 'Ohm'
      : 'ratio'
    : ['efficiency', 'loss'].includes(def.kind)
    ? 'W'
    : source?.unit || 'V';
  const xUnit = actual ? (validAxis ? axis.unit : '') : frequency ? 'Hz' : 's';
  const logX = actual
    ? validAxis && data.scale === 'frequency' && axis.real.every((x) => x > 0)
    : frequency;
  const annotations = result ? result.state === 'valid' : !data;
  if (data && !actual)
    return {
      actual: false,
      captured: true,
      annotations: false,
      points: [] as Point[],
      reference: undefined as Point[] | undefined,
      from: 0,
      to: 0,
      lines: [] as Level[],
      interval: undefined as
        | { from: number; to: number; label: string }
        | undefined,
      at: undefined as number | undefined,
      description: `No captured samples are available for signal ${
        def.source || '(none selected)'
      }.`,
      xUnit: '',
      unit: '',
      logX: false,
      fill: false,
    };
  const number = (text: string | undefined, fallback: number, units = unit) => {
    try {
      const n = text ? parseQuantity(text, units) : fallback;
      return Number.isFinite(n) ? n : fallback;
    } catch {
      return fallback;
    }
  };
  let points: Point[];
  let reference: Point[] | undefined;
  const low = number(def.initial, 0),
    high = number(def.final, 1);
  const step = [
    'riseTime',
    'fallTime',
    'overshoot',
    'undershoot',
    'settlingTime',
    'timeConstant',
  ].includes(def.kind);
  if (actual) {
    const plot = validAxis ? data : { ...data, scale: '' };
    const mode = validAxis && data.scale === 'frequency' ? 'magnitude' : 'real';
    points = chartPoints(plot, source, mode, logX);
    const ref = data.vectors.find(
      (v) => v.name.toLowerCase() === def.reference?.toLowerCase(),
    );
    if (
      ref &&
      ref.unit === source.unit &&
      ref.real.length === source.real.length
    )
      reference = chartPoints(plot, ref, mode, logX);
  } else {
    points = Array.from({ length: 241 }, (_, i) => {
      const t = i / 240,
        x = frequency ? 10 * 10 ** (4 * t) : t * 0.005;
      let y = Math.sin(t * Math.PI * 6);
      if (frequency) {
        const w = x / 1000;
        y =
          def.kind === 'phase' || def.kind === 'groupDelay'
            ? (-Math.atan(w) * 180) / Math.PI
            : ['bandwidth', 'bandpassQ', 'resonance'].includes(def.kind)
            ? w / Math.sqrt((1 - w * w) ** 2 + w * w)
            : def.kind === 'passbandRipple'
            ? 0.95 + 0.05 * Math.cos(t * 8 * Math.PI)
            : 1 / Math.sqrt(1 + w * w);
      } else if (step) {
        const progress = Math.max(0, Math.min(1, (t - 0.2) / 0.4));
        y =
          low +
          (high - low) * (def.kind === 'fallTime' ? 1 - progress : progress);
        if (
          ['overshoot', 'undershoot', 'settlingTime'].includes(def.kind) &&
          t > 0.6
        )
          y =
            high +
            (high - low) *
              0.2 *
              Math.exp(-10 * (t - 0.6)) *
              Math.sin(35 * (t - 0.6));
        if (def.kind === 'timeConstant')
          y = low + (high - low) * (1 - Math.exp(-Math.max(0, t - 0.2) * 8));
      }
      return { x, y };
    });
    if (def.kind === 'delay')
      reference = points.map((p) => ({
        ...p,
        y: Math.sin((p.x / 0.005 + 0.08) * Math.PI * 6),
      }));
    if (def.kind === 'efficiency' || def.kind === 'loss') {
      points = points.map((p, i) => ({
        ...p,
        y: 2 + 0.2 * Math.sin((i / 240) * 6 * Math.PI),
      }));
      reference = points.map((p) => ({ ...p, y: -p.y - 1 }));
    }
  }
  const from = number(def.from, points[0]?.x || 0, xUnit),
    to = number(def.to, points.at(-1)?.x || 1, xUnit);
  const selected = points.filter((p) => p.x >= from && p.x <= to);
  const values = selected.length ? selected : points;
  const min = Math.min(...values.map((p) => p.y)),
    max = Math.max(...values.map((p) => p.y));
  const average = values.reduce((sum, p) => sum + p.y, 0) / values.length;
  const rms = Math.sqrt(
    values.reduce((sum, p) => sum + p.y * p.y, 0) / values.length,
  );
  const measured = (fallback: number) =>
    actual && result?.state === 'valid' ? result.value : fallback;
  const lines: Level[] = [];
  let interval: { from: number; to: number; label: string } | undefined;
  let at: number | undefined;
  let description =
    'The highlighted interval is the part of the signal used by this measurement.';
  const crossings = (wave: Point[], level: number, direction = 1) =>
    wave.slice(1).flatMap((p, i) => {
      const prev = wave[i];
      if (
        p.x < from ||
        prev.x > to ||
        direction * (prev.y - level) >= 0 ||
        direction * (p.y - level) < 0 ||
        p.y === prev.y
      )
        return [];
      const x = prev.x + ((p.x - prev.x) * (level - prev.y)) / (p.y - prev.y);
      return x >= from && x <= to ? [x] : [];
    });
  if (
    ['rms', 'rippleRms', 'mean', 'minimum', 'maximum', 'absolutePeak'].includes(
      def.kind,
    )
  ) {
    const value = measured(
      def.kind === 'mean'
        ? average
        : def.kind === 'minimum'
        ? min
        : def.kind === 'maximum'
        ? max
        : def.kind === 'absolutePeak'
        ? Math.max(Math.abs(min), Math.abs(max))
        : rms,
    );
    if (actual && def.kind === 'rippleRms' && annotations) {
      const dc = measure({ ...def, kind: 'mean' }, data);
      const centre = dc.state === 'valid' ? dc.value : average;
      lines.push(
        { value: centre, label: 'DC mean' },
        { value: centre + value, label: 'AC RMS above mean', reading: value },
      );
    } else lines.push({ value, label: measurementLabels[def.kind] });
    description =
      def.kind === 'rms'
        ? 'RMS: the horizontal line is the equivalent DC level with the same mean-square value over the highlighted window.'
        : def.kind === 'rippleRms'
        ? 'AC RMS measures ripple about the DC mean. The captured waveform is unchanged; the AC RMS line is one ripple RMS above the mean.'
        : def.kind === 'mean'
        ? 'Mean: signed area under the waveform divided by the selected time span.'
        : `${
            measurementLabels[def.kind]
          } is taken from the highlighted window.`;
  } else if (def.kind === 'peakToPeak') {
    lines.push(
      { value: min, label: 'Minimum' },
      { value: max, label: 'Maximum' },
    );
    description =
      'Peak-to-peak = maximum − minimum within the highlighted window.';
  } else if (def.kind === 'integral')
    description =
      'Integral: signed area between the waveform and zero over the highlighted time window.';
  else if (
    ['period', 'frequency', 'pulseWidth', 'dutyCycle', 'delay'].includes(
      def.kind,
    )
  ) {
    const level = number(def.threshold, (min + max) / 2);
    lines.push({ value: level, label: 'Crossing level' });
    const up = crossings(points, level),
      down = crossings(points, level, -1);
    if (def.kind === 'delay') {
      const ref = reference && crossings(reference, level)[0];
      if (ref !== undefined && up[0] !== undefined)
        interval = { from: ref, to: up[0], label: 'Delay' };
      description =
        'Delay: time from the reference rising crossing (blue) to the signal rising crossing (green), at the same level.';
    } else {
      const end = ['pulseWidth', 'dutyCycle'].includes(def.kind)
        ? down.find((x) => x > up[0])
        : up[1];
      if (up[0] !== undefined && end !== undefined)
        interval = {
          from: up[0],
          to: end,
          label: ['period', 'frequency'].includes(def.kind)
            ? 'One period'
            : 'High pulse',
        };
      description =
        def.kind === 'frequency'
          ? 'Frequency = 1 / period. One period lies between two consecutive rising crossings.'
          : def.kind === 'period'
          ? 'Period: time between two consecutive rising crossings.'
          : def.kind === 'dutyCycle'
          ? 'Duty cycle = high-pulse duration / complete period × 100%.'
          : 'Pulse width: time from a rising crossing to the following falling crossing.';
    }
  } else if (step) {
    const initial = number(def.initial, min),
      final = number(def.final, max),
      span = final - initial;
    if (def.kind === 'riseTime' || def.kind === 'fallTime') {
      const falling = def.kind === 'fallTime',
        a = initial + span * (falling ? 0.9 : 0.1),
        b = initial + span * (falling ? 0.1 : 0.9);
      lines.push(
        { value: a, label: falling ? '90%' : '10%' },
        { value: b, label: falling ? '10%' : '90%' },
      );
      const start = crossings(points, a, falling ? -1 : 1)[0],
        end = crossings(points, b, falling ? -1 : 1).find((x) => x > start);
      if (start !== undefined && end !== undefined)
        interval = { from: start, to: end, label: measurementLabels[def.kind] };
      description = `${
        measurementLabels[def.kind]
      }: elapsed time between the 10% and 90% levels of the configured initial-to-final step.`;
    } else if (def.kind === 'timeConstant') {
      const level = initial + span * (1 - 1 / Math.E);
      lines.push({ value: level, label: '63.2%' });
      const end = crossings(points, level, span > 0 ? 1 : -1)[0];
      if (end !== undefined)
        interval = { from, to: end, label: 'Time constant' };
      description =
        'Time constant: time from the window start to 63.2% of the initial-to-final change.';
    } else if (def.kind === 'settlingTime') {
      const tolerance = (Math.abs(span) * number(def.tolerance, 2, '')) / 100;
      lines.push(
        { value: final - tolerance, label: 'Lower tolerance' },
        { value: final + tolerance, label: 'Upper tolerance' },
      );
      if (actual && result?.state === 'valid') at = from + result.value;
      description =
        'Settling time: the last entry into the tolerance band, after which the waveform stays inside it.';
    } else {
      lines.push(
        { value: final, label: 'Final level' },
        { value: def.kind === 'overshoot' ? max : min, label: 'Excursion' },
      );
      description = `${
        measurementLabels[def.kind]
      }: the largest excursion beyond the configured level, relative to the step size.`;
    }
  } else if (frequency) {
    at = number(def.at, 1000, 'Hz');
    if (['cutoff', 'bandwidth', 'bandpassQ'].includes(def.kind)) {
      lines.push({
        value: Math.SQRT1_2,
        label: '−3 dB (0.707 × reference gain)',
      });
      const down = crossings(points, Math.SQRT1_2, -1),
        up = crossings(points, Math.SQRT1_2);
      if (def.kind === 'cutoff') at = down[0];
      else if (up[0] !== undefined && down[0] !== undefined) {
        interval = { from: up[0], to: down[0], label: 'Bandwidth' };
        at = undefined;
      }
    }
    if (def.kind === 'resonance' && points.length)
      at = points.reduce((best, p) => (p.y > best.y ? p : best), points[0]).x;
    if (def.kind === 'passbandRipple')
      lines.push(
        { value: min, label: 'Minimum gain' },
        { value: max, label: 'Maximum gain' },
      );
    if (def.kind === 'passbandRipple') at = undefined;
    description = (
      {
        gain: 'Gain compares output to reference magnitude at the selected frequency.',
        phase:
          'Phase is the output-to-reference phase difference at the selected frequency.',
        cutoff:
          'Cutoff is a crossing of the reference gain divided by √2 (−3 dB).',
        bandwidth:
          'Bandwidth is the frequency difference between two −3 dB crossings.',
        resonance:
          'Resonance is the frequency of the response peak inside the selected window.',
        impedance:
          'Impedance compares voltage to current into the port at the selected frequency.',
        groupDelay:
          'Group delay is the negative slope of output-to-reference phase against angular frequency.',
        passbandRipple:
          'Passband ripple compares the largest and smallest gains in the selected band, in dB.',
        attenuation:
          'Attenuation compares the gain to the configured reference gain at the selected frequency.',
        bandpassQ: 'Band-pass Q = peak frequency / half-power bandwidth.',
      } as Record<string, string>
    )[def.kind];
  } else if (def.kind === 'value') {
    at = number(def.at, from, xUnit);
    description =
      'Value: interpolate the signal at the marked position inside the selected window.';
  } else if (def.kind === 'efficiency' || def.kind === 'loss')
    description =
      def.kind === 'efficiency'
        ? 'Efficiency = consumed output mean power / supplied input mean power × 100%. Select explicit input and output power boundaries.'
        : 'Power loss = supplied input mean power − consumed output mean power over the selected window.';
  if (actual && advancedIllustration) {
    lines.length = 0;
    interval = undefined;
    at = def.at && annotations ? number(def.at, points[0].x, xUnit) : undefined;
    description = `Captured ${def.source}${
      reference ? ` (green) and ${def.reference} (blue)` : ''
    }${
      validAxis && data.scale === 'frequency' ? ' magnitude' : ''
    }. ${description}`;
  }
  if (!annotations) {
    lines.length = 0;
    interval = undefined;
    at = undefined;
    if (actual)
      description =
        'Captured signal shown without measurement markers because the measurement could not be calculated.';
  }
  return {
    actual,
    captured: !!data,
    annotations,
    points,
    reference,
    from,
    to,
    lines,
    interval,
    at,
    description,
    xUnit,
    unit,
    logX,
    fill: annotations && def.kind === 'integral',
  };
}
