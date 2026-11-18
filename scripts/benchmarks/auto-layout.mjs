import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';

// Fixed-work benchmark: one warmup, then fresh isolated contexts for each timed run.
// No MCP soft execution allowance: compare the same evaluations, metrics and changes.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  bundle: { type: 'string', default: 'drawing-server.bundle.js' },
  iterations: { type: 'string', default: '3' },
  evaluations: { type: 'string', default: '60' },
} });
const iterations = Number(values.iterations), evaluations = Number(values.evaluations);
if (!positionals.length || !Number.isInteger(iterations) || iterations < 1 || iterations > 20 ||
    !Number.isInteger(evaluations) || evaluations < 1 || evaluations > 500)
  throw new Error('Usage: node scripts/benchmarks/auto-layout.mjs drawing.dsn [...] [--bundle path] [--iterations 3] [--evaluations 60]');
const bundle = fs.readFileSync(values.bundle, 'utf8');
const script = new vm.Script(bundle, { filename: path.resolve(values.bundle) });
for (const file of positionals) {
  const xml = fs.readFileSync(file, 'utf8'), timings = [];
  let result, expected;
  for (let i = 0; i <= iterations; i++) {
    const context = vm.createContext({ console, __xml: xml,
      __options: { maxPasses: 2, maxEvaluations: evaluations } });
    const start = performance.now();
    script.runInContext(context, { timeout: 30000 });
    result = vm.runInContext('TinyCADDrawingServerBundle.tidyTinyCadDrawing(__xml,1,__options)', context, { timeout: 30000 });
    const elapsed = performance.now() - start;
    if (!result.connectivityPreserved || !result.serializationConnectivityPreserved || !result.serializationPhysicalConnectivityPreserved)
      throw new Error('Connectivity verification failed: ' + file);
    const outcome = JSON.stringify({ evaluations: result.evaluations, changes: result.changes, metrics: result.after.metrics });
    if (expected && outcome !== expected) throw new Error('Non-repeatable benchmark output: ' + file);
    expected = outcome;
    if (i) timings.push(elapsed);
  }
  const sorted = [...timings].sort((a, b) => a - b);
  console.log(JSON.stringify({ file, node: process.version,
    inputSha256: createHash('sha256').update(xml).digest('hex'),
    bundleSha256: createHash('sha256').update(bundle).digest('hex'),
    definitionSha256: createHash('sha256').update(result.definition).digest('hex'),
    timingsMs: timings, medianMs: sorted[Math.floor(sorted.length / 2)],
    evaluations: result.evaluations, changes: result.changes.length,
    stopped: result.stopped, metrics: result.after.metrics,
    connectivityPreserved: true,
  }));
}
