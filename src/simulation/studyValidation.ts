import { defaultAnalysis, SimulationSetup } from './contracts';
import { validateExplorer } from './explorerValidation';
import { StudyDefinition, StudyRecord, TestCase } from './studies';
import { positiveQuantity } from './numbers';
const text = (v: unknown, max = 256) =>
  typeof v === 'string' && v.length <= max;
function array(v: unknown, max: number, validate: (v: any) => void) {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > max)
    throw new Error('Laboratory metadata exceeds its limits.');
  v.forEach(validate);
}
function map(v: unknown) {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.entries(v).length > 100 ||
    Object.entries(v).some(([k, value]) => !text(k) || !text(value, 4096))
  )
    throw new Error('Invalid laboratory parameter values.');
}
function definition(d: StudyDefinition) {
  if (
    !d ||
    !text(d.id, 80) ||
    !text(d.name) ||
    !['monteCarlo', 'corners', 'tests'].includes(d.kind) ||
    !Number.isInteger(d.seed) ||
    d.seed < 0 ||
    d.seed > 0xffffffff ||
    !Number.isInteger(d.count) ||
    d.count < 2 ||
    d.count > 100 ||
    !Array.isArray(d.variations)
  )
    throw new Error('Invalid laboratory study.');
  array(d.variations, 100, (v) => {
    if (
      !v ||
      !text(v.binding, 80) ||
      !text(v.percent) ||
      !['uniform', 'normal'].includes(v.distribution) ||
      !text(v.group)
    )
      throw new Error('Invalid variation distribution.');
  });
  if (new Set(d.variations.map((v) => v.binding)).size !== d.variations.length)
    throw new Error('Duplicate variation binding.');
}
function test(t: TestCase) {
  if (
    !t ||
    !text(t.id, 80) ||
    !text(t.name) ||
    !t.analysis ||
    !['op', 'tran', 'ac', 'dc', 'noise', 'tf', 'pz'].includes(
      t.analysis.kind,
    ) ||
    Object.entries(defaultAnalysis()).some(
      ([key, value]) =>
        typeof t.analysis[key as keyof typeof t.analysis] !== typeof value ||
        (typeof value === 'string' &&
          !text(t.analysis[key as keyof typeof t.analysis], 4096)),
    ) ||
    !Array.isArray(t.bindings) ||
    !Array.isArray(t.measurements) ||
    !Array.isArray(t.requirements) ||
    !Array.isArray(t.traces)
  )
    throw new Error('Invalid captured test case.');
  map(t.parameters);
  map(t.overrides);
  validateExplorer({
    measurements: t.measurements,
    requirements: t.requirements,
    bindings: t.bindings,
  });
  array(t.traces, 16, (trace) => {
    if (
      !trace ||
      !text(trace.name) ||
      !text(trace.left) ||
      !text(trace.right) ||
      !['subtract', 'multiply', 'divide'].includes(trace.operation)
    )
      throw new Error('Invalid test-case trace.');
  });
}
function record(r: StudyRecord) {
  if (
    !r ||
    !text(r.id, 80) ||
    !text(r.created) ||
    !Number.isFinite(Date.parse(r.created)) ||
    !['running', 'complete', 'failed', 'stopped'].includes(r.state) ||
    !Array.isArray(r.points)
  )
    throw new Error('Invalid study acquisition.');
  definition(r.definition);
  validateExplorer({ bindings: r.bindings });
  array(r.tests, 100, test);
  array(r.points, 100, (p) => {
    if (
      !p ||
      !text(p.label, 1024) ||
      !['complete', 'failed', 'stopped'].includes(p.state) ||
      (p.runId !== undefined && !text(p.runId, 80)) ||
      (p.testId !== undefined && !text(p.testId, 80)) ||
      (p.error !== undefined && !text(p.error, 100000))
    )
      throw new Error('Invalid study case result.');
    map(p.overrides);
  });
}
export function validateStudies(setup: SimulationSetup) {
  array(setup.studies, 100, definition);
  array(setup.testCases, 100, test);
  array(setup.studyRuns, 100, record);
  for (const run of setup.runs) {
    const test = run.resistanceTest;
    if (
      test &&
      (!text(test.sheet) ||
        !text(test.reference) ||
        !text(test.current) ||
        !text(test.baseHash, 128))
    )
      throw new Error('Invalid resistance-test provenance.');
    if (test) positiveQuantity(test.current, 'A');
  }
}
