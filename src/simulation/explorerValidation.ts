import {
  metricKinds,
  ExplorerSnapshot,
  MeasurementDefinition,
  RequirementDefinition,
  ParameterBinding,
  SweepDefinition,
  SweepRun,
} from './explorerTypes';
const text = (s: unknown, limit = 256) =>
  typeof s === 'string' && s.length <= limit;
function list(value: unknown, test: (v: any) => boolean) {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((v) => !v || !text(v.id, 80) || !v.id || !test(v)) ||
    new Set(value.map((v) => v.id)).size !== value.length
  )
    throw new Error('Invalid Circuit Explorer definitions.');
}
export function validateExplorer(value: {
  measurements?: MeasurementDefinition[];
  requirements?: RequirementDefinition[];
  bindings?: ParameterBinding[];
  sweep?: SweepDefinition;
  sweeps?: SweepRun[];
}) {
  list(
    value.measurements,
    (d) =>
      text(d.name) &&
      metricKinds.includes(d.kind) &&
      text(d.source, 1024) &&
      [
        'reference',
        'from',
        'to',
        'at',
        'threshold',
        'initial',
        'final',
        'tolerance',
        'referenceGain',
      ].every((k) => d[k] === undefined || text(d[k], 1024)),
  );
  list(
    value.requirements,
    (d) =>
      text(d.name) &&
      text(d.measurement, 80) &&
      ['between', 'atLeast', 'atMost'].includes(d.comparison) &&
      ['lower', 'upper', 'unit'].every((k) => text(d[k])),
  );
  list(
    value.bindings,
    (d) =>
      [
        'name',
        'sheet',
        'reference',
        'property',
        'unit',
        'minimum',
        'maximum',
      ].every((k) => text(d[k])) &&
      typeof d.logarithmic === 'boolean' &&
      ['continuous', 'E12', 'E24', 'E96'].includes(d.series),
  );
  const s = value.sweep;
  if (
    s &&
    (!text(s.binding, 80) ||
      !['linear', 'log', 'list'].includes(s.mode) ||
      !text(s.start) ||
      !text(s.stop) ||
      !text(s.values, 10000) ||
      !Number.isInteger(s.count) ||
      s.count < 2 ||
      s.count > 100)
  )
    throw new Error('Invalid parameter sweep.');
  list(value.sweeps, (batch: SweepRun) => {
    if (
      !text(batch.created) ||
      !Number.isFinite(Date.parse(batch.created)) ||
      !['running', 'complete', 'stopped', 'failed'].includes(batch.state) ||
      !Array.isArray(batch.points) ||
      !Array.isArray(batch.measurements) ||
      !batch.definition ||
      batch.definition.binding !== batch.binding?.id ||
      batch.points.length > 100 ||
      batch.points.some(
        (p) => !p || !Number.isFinite(p.value) || !text(p.runId, 80),
      )
    )
      return false;
    validateExplorer({
      bindings: [batch.binding],
      measurements: batch.measurements,
      sweep: batch.definition,
    });
    return true;
  });
}
export function validateSnapshot(value: ExplorerSnapshot) {
  if (!value) return;
  if (
    !Array.isArray(value.definitions) ||
    !Array.isArray(value.requirements) ||
    !Array.isArray(value.bindings)
  )
    throw new Error('Invalid captured Explorer definitions.');
  if (
    value.traces &&
    (!Array.isArray(value.traces) ||
      value.traces.length > 16 ||
      value.traces.some(
        (t) =>
          !t ||
          !text(t.name) ||
          !text(t.left) ||
          !text(t.right) ||
          !['subtract', 'multiply', 'divide'].includes(t.operation),
      ))
  )
    throw new Error('Invalid captured traces.');
  validateExplorer({ ...value, measurements: value.definitions });
  if (
    value.algorithm !== 'tinycad-metrics-1' ||
    !value.overrides ||
    typeof value.overrides !== 'object' ||
    Array.isArray(value.overrides) ||
    Object.keys(value.overrides).length > 100 ||
    Object.entries(value.overrides).some(
      ([k, v]) => !text(k, 80) || !text(v),
    ) ||
    !Array.isArray(value.measurements) ||
    value.measurements.length > 100 ||
    value.measurements.some(
      (r) =>
        !r ||
        !text(r.id, 80) ||
        !['valid', 'unavailable', 'invalid'].includes(r.state) ||
        !text(r.unit) ||
        !text(r.explanation, 10000) ||
        (r.evidence &&
          (!Number.isFinite(r.evidence.from) ||
            !Number.isFinite(r.evidence.to) ||
            r.evidence.from > r.evidence.to ||
            !text(r.evidence.source, 1024) ||
            (r.evidence.reference !== undefined &&
              !text(r.evidence.reference, 1024)))) ||
        (r.state === 'valid' && !Number.isFinite(r.value)),
    ) ||
    !Array.isArray(value.checks) ||
    value.checks.length > 100 ||
    value.checks.some(
      (r) =>
        !r ||
        !text(r.id, 80) ||
        !['pass', 'fail', 'unavailable'].includes(r.state) ||
        !text(r.explanation, 10000),
    )
  )
    throw new Error('Invalid Circuit Explorer result snapshot.');
}
