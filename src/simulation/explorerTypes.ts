export const metricKinds = [
  'absolutePeak', 'efficiency', 'loss', 'impedance', 'groupDelay', 'passbandRipple', 'attenuation', 'bandpassQ',
  'value',
  'minimum',
  'maximum',
  'mean',
  'rms',
  'peakToPeak',
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
  'gain',
  'phase',
  'cutoff',
  'bandwidth',
  'resonance',
] as const;
export type MetricKind = (typeof metricKinds)[number];
export interface MeasurementDefinition {
  id: string;
  name: string;
  kind: MetricKind;
  source: string;
  reference?: string;
  from?: string;
  to?: string;
  at?: string;
  threshold?: string;
  initial?: string;
  final?: string;
  tolerance?: string;
  referenceGain?: string;
}
export interface MeasurementResult {
  id: string;
  state: 'valid' | 'unavailable' | 'invalid';
  value?: number;
  unit: string;
  explanation: string;
  evidence?: { from: number; to: number; source: string; reference?: string };
}
export interface RequirementDefinition {
  id: string;
  name: string;
  measurement: string;
  comparison: 'between' | 'atLeast' | 'atMost';
  lower: string;
  upper: string;
  unit: string;
}
export interface RequirementResult {
  id: string;
  state: 'pass' | 'fail' | 'unavailable';
  explanation: string;
}
export interface ParameterBinding {
  id: string;
  name: string;
  sheet: string;
  reference: string;
  property: string;
  unit: string;
  minimum: string;
  maximum: string;
  logarithmic: boolean;
  series: 'continuous' | 'E12' | 'E24' | 'E96';
}
export interface SweepDefinition {
  binding: string;
  mode: 'linear' | 'log' | 'list';
  start: string;
  stop: string;
  count: number;
  values: string;
}
export interface SweepRun {
  id: string;
  created: string;
  state: 'running' | 'complete' | 'stopped' | 'failed';
  binding: ParameterBinding;
  definition: SweepDefinition;
  measurements: MeasurementDefinition[];
  points: { value: number; runId: string }[];
}
export interface ExplorerSnapshot {
  traces?: import('./traces').TraceDefinition[];
  algorithm: 'tinycad-metrics-1';
  definitions: MeasurementDefinition[];
  measurements: MeasurementResult[];
  requirements: RequirementDefinition[];
  checks: RequirementResult[];
  overrides: Record<string, string>;
  bindings: ParameterBinding[];
}
