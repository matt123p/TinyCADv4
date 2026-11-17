import {
  AnalysisDefinition,
  SimulationRun,
  SimulationSetup,
} from './contracts';
import {
  MeasurementDefinition,
  ParameterBinding,
  RequirementDefinition,
} from './explorerTypes';
import { TraceDefinition } from './traces';
import { dsnDrawing } from '../model/dsnDrawing';
import { bindingValue } from './bindings';
import { parseQuantity } from './numbers';

export interface Variation {
  binding: string;
  percent: string;
  distribution: 'uniform' | 'normal';
  group: string;
}
export interface StudyDefinition {
  id: string;
  name: string;
  kind: 'monteCarlo' | 'corners' | 'tests';
  seed: number;
  count: number;
  variations: Variation[];
}
export interface TestCase {
  id: string;
  name: string;
  analysis: AnalysisDefinition;
  parameters: Record<string, string>;
  overrides: Record<string, string>;
  bindings: ParameterBinding[];
  measurements: MeasurementDefinition[];
  requirements: RequirementDefinition[];
  traces: TraceDefinition[];
}
export interface StudyPoint {
  label: string;
  overrides: Record<string, string>;
  testId?: string;
  runId?: string;
  state: 'complete' | 'failed' | 'stopped';
  error?: string;
}
export interface StudyRecord {
  id: string;
  created: string;
  definition: StudyDefinition;
  bindings: ParameterBinding[];
  tests: TestCase[];
  state: 'running' | 'complete' | 'failed' | 'stopped';
  points: StudyPoint[];
}
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
export function studyPlan(
  def: StudyDefinition,
  drawing: dsnDrawing,
  setup: SimulationSetup,
): Omit<StudyPoint, 'state'>[] {
  if (def.kind === 'tests') {
    if (!setup.testCases?.length)
      throw new Error('Capture at least one test case first.');
    return setup.testCases.map((t) => ({
      label: t.name,
      testId: t.id,
      overrides: { ...t.overrides },
    }));
  }
  if (!def.variations.length)
    throw new Error('Add at least one varied parameter.');
  if (!Number.isInteger(def.seed) || def.seed < 0 || def.seed > 0xffffffff)
    throw new Error('Seed must be an unsigned 32-bit integer.');
  if (def.kind === 'corners' && def.variations.length > 6)
    throw new Error(
      'Corner studies support at most six independent variables (64 combinations).',
    );
  const count = def.kind === 'corners' ? 2 ** def.variations.length : def.count;
  if (!Number.isInteger(count) || count < 2 || count > 100)
    throw new Error('Study requires 2–100 samples.');
  const random = seededRandom(def.seed);
  const variables = def.variations.map((v) => {
    const binding = setup.bindings?.find((b) => b.id === v.binding);
    if (!binding) throw new Error('Variation refers to a missing binding.');
    const nominal = parseQuantity(
        bindingValue(drawing, setup, binding),
        binding.unit,
      ),
      percent = parseQuantity(v.percent);
    if (percent < 0 || percent > 100)
      throw new Error('Tolerance / standard deviation must be 0–100%.');
    if (
      v.group &&
      def.variations.some(
        (other) =>
          other.group === v.group && other.distribution !== v.distribution,
      )
    )
      throw new Error('A correlated group must use one distribution type.');
    return { v, binding, nominal, percent };
  });
  return Array.from({ length: count }, (_, index) => {
    const groups = new Map<string, number>(),
      overrides: Record<string, string> = {};
    let error: string;
    variables.forEach(({ v, binding, nominal, percent }, i) => {
      let z: number;
      if (def.kind === 'corners') z = (index >> i) & 1 ? 1 : -1;
      else if (v.group && groups.has(v.group)) z = groups.get(v.group);
      else {
        z =
          v.distribution === 'uniform'
            ? 2 * random() - 1
            : Math.sqrt(-2 * Math.log(Math.max(random(), Number.EPSILON))) *
              Math.cos(2 * Math.PI * random());
        if (v.group) groups.set(v.group, z);
      }
      const value = nominal * (1 + (z * percent) / 100);
      overrides[binding.id] = String(value);
      if (
        nominal > 0 &&
        value <= 0 &&
        ['Ohm', 'F', 'H', 'Hz'].includes(binding.unit)
      )
        error = `${binding.name}: sampled non-positive physical value (${value} ${binding.unit}).`;
    });
    return {
      label: `${def.kind === 'corners' ? 'Corner' : 'Sample'} ${index + 1}`,
      overrides,
      ...(error ? { error } : {}),
    };
  });
}
export function studyStatistics(
  record: StudyRecord,
  runs: SimulationRun[],
  metric: string,
) {
  const values: number[] = [];
  let passed = 0,
    failed = 0,
    unavailable = 0;
  for (const point of record.points) {
    const run = runs.find((r) => r.id === point.runId),
      result = run?.explorer?.measurements.find((m) => m.id === metric);
    if (point.state === 'complete' && result?.state === 'valid')
      values.push(result.value);
    const checks = run?.explorer?.checks;
    if (
      point.state !== 'complete' ||
      !checks?.length ||
      checks.some((c) => c.state === 'unavailable')
    )
      unavailable++;
    else if (checks.every((c) => c.state === 'pass')) passed++;
    else failed++;
  }
  const mean = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : undefined;
  const variance =
    values.length > 1
      ? values.reduce((sum, n) => sum + (n - mean) ** 2, 0) /
        (values.length - 1)
      : undefined;
  return {
    values,
    minimum: values.length ? Math.min(...values) : undefined,
    maximum: values.length ? Math.max(...values) : undefined,
    mean,
    standardDeviation: variance === undefined ? undefined : Math.sqrt(variance),
    passed,
    failed,
    unavailable,
    total: record.points.length,
    yield:
      record.points.length && passed + failed > 0
        ? passed / record.points.length
        : undefined,
  };
}
