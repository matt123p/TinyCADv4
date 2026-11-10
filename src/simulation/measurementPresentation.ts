import { MeasurementDefinition, MetricKind } from './explorerTypes';
import { signalLabel } from './signals';

export const measurementLabels: Record<MetricKind, string> = {
  absolutePeak: 'Absolute peak',
  efficiency: 'Efficiency',
  loss: 'Power loss',
  impedance: 'Impedance',
  groupDelay: 'Group delay',
  passbandRipple: 'Passband ripple',
  attenuation: 'Attenuation',
  bandpassQ: 'Band-pass Q',
  value: 'Value',
  minimum: 'Minimum',
  maximum: 'Maximum',
  mean: 'Mean',
  rms: 'RMS',
  peakToPeak: 'Peak-to-peak',
  rippleRms: 'AC RMS',
  integral: 'Integral',
  riseTime: 'Rise time',
  fallTime: 'Fall time',
  period: 'Period',
  frequency: 'Frequency',
  dutyCycle: 'Duty cycle',
  pulseWidth: 'Pulse width',
  delay: 'Delay',
  overshoot: 'Overshoot',
  undershoot: 'Undershoot',
  settlingTime: 'Settling time',
  timeConstant: 'Time constant',
  gain: 'Gain',
  phase: 'Phase',
  cutoff: 'Cutoff frequency',
  bandwidth: 'Bandwidth',
  resonance: 'Resonance',
};

export function measurementAxis(
  kind: MetricKind,
): 'time' | 'frequency' | undefined {
  if (
    [
      'mean',
      'rms',
      'rippleRms',
      'integral',
      'riseTime',
      'fallTime',
      'period',
      'frequency',
      'dutyCycle',
      'pulseWidth',
      'delay',
      'overshoot',
      'undershoot',
      'settlingTime',
      'timeConstant',
    ].includes(kind)
  )
    return 'time';
  if (
    [
      'gain',
      'phase',
      'cutoff',
      'bandwidth',
      'resonance',
      'impedance',
      'groupDelay',
      'passbandRipple',
      'attenuation',
      'bandpassQ',
    ].includes(kind)
  )
    return 'frequency';
}

export function measurementUsesReference(kind: MetricKind) {
  return [
    'gain',
    'phase',
    'cutoff',
    'bandwidth',
    'resonance',
    'delay',
    'efficiency',
    'loss',
    'impedance',
    'groupDelay',
    'passbandRipple',
    'attenuation',
    'bandpassQ',
  ].includes(kind);
}

export function measurementTitle(def: MeasurementDefinition): string {
  const parts = [
    signalLabel(def.source) || 'Select signal',
    measurementLabels[def.kind] || def.kind,
  ];
  if (def.reference && measurementUsesReference(def.kind))
    parts.push(`ref ${signalLabel(def.reference)}`);
  if (
    def.at &&
    [
      'value',
      'gain',
      'phase',
      'impedance',
      'groupDelay',
      'attenuation',
    ].includes(def.kind)
  )
    parts.push(`at ${def.at}`);
  if (def.from || def.to)
    parts.push(`${def.from || 'start'}–${def.to || 'end'}`);
  if (
    def.threshold &&
    ['period', 'frequency', 'dutyCycle', 'pulseWidth', 'delay'].includes(
      def.kind,
    )
  )
    parts.push(`crossing ${def.threshold}`);
  if (
    [
      'riseTime',
      'fallTime',
      'overshoot',
      'undershoot',
      'settlingTime',
      'timeConstant',
    ].includes(def.kind)
  ) {
    if (def.initial || def.final)
      parts.push(`${def.initial || 'auto'} → ${def.final || 'auto'}`);
    if (def.kind === 'riseTime' || def.kind === 'fallTime')
      parts.push('10–90%');
  }
  if (def.kind === 'settlingTime') parts.push(`±${def.tolerance || '2'}%`);
  if (['cutoff', 'bandwidth', 'attenuation'].includes(def.kind))
    parts.push(`reference gain ${def.referenceGain || '1'}`);
  const title = parts.join(' · ');
  // Measurement names are limited to 256 characters in saved documents.
  return title.length > 256 ? `${title.slice(0, 255)}…` : title;
}

// Names are presentation only; changing a generated name does not change evidence.
export function sameMeasurementDefinitions(
  a: MeasurementDefinition[] = [],
  b: MeasurementDefinition[] = [],
) {
  const key = (definitions: MeasurementDefinition[]) =>
    JSON.stringify(
      definitions.map((def) =>
        Object.fromEntries(
          Object.entries(def)
            .filter(([key]) => key !== 'name')
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    );
  return key(a) === key(b);
}

export function measurementValue(result?: {
  state: string;
  value?: number;
  unit: string;
}) {
  return result?.state === 'valid' && Number.isFinite(result.value)
    ? `${Number(result.value.toPrecision(6))}${
        result.unit ? ` ${result.unit}` : ''
      }`
    : '—';
}
