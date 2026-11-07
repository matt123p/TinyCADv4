import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

// Storage/retention benchmark, not an engine or interactive rendering test.
// Each workload runs in a fresh process so its peak RSS is independent.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'build/qualification/result-performance');
await fs.mkdir(directory, { recursive: true });
const output = path.join(directory, 'benchmark.cjs');
await build({
  stdin: {
    resolveDir: root,
    contents: `
      const assert = require('node:assert/strict');
      const { performance } = require('node:perf_hooks');
      const { blank } = require('./src/io/ioXml');
      const { encodeDrawing, decodeDrawing } = require('./src/io/dsnCodec');
      const { createSimulationSheet } = require('./src/simulation/document');
      const { defaultAnalysis } = require('./src/simulation/contracts');
      const { putResult, getResult, resultBytes } = require('./src/simulation/resultStore');
      async function main() {
        const samples = Number(process.argv[2]);
        const representation = process.argv[3];
        const drawing = blank();
        const sheet = createSimulationSheet(drawing.sheets[0], 'Storage benchmark');
        drawing.sheets.push(sheet);
        const id = crypto.randomUUID();
        const data = {scale:'frequency', log:'Synthetic complex AC storage workload', vectors:[
          {name:'frequency',unit:'Hz',real:Array.from({length:samples},(_,i)=>1+i*.01)},
          {name:'in',unit:'V',real:Array(samples).fill(1)},
          {name:'out',unit:'V',real:Array.from({length:samples},(_,i)=>Math.cos(i*.001)),imaginary:Array.from({length:samples},(_,i)=>-Math.sin(i*.001))}
        ]};
        const run = {id,created:new Date().toISOString(),state:'complete',backend:'native',buildId:'storage-benchmark',
          circuitHash:'benchmark',setupHash:'benchmark',analysis:{...defaultAnalysis(),kind:'ac'},parameters:{},samples,pinned:false,dataState:'available'};
        sheet.simulation.runs.push(run);
        let start = performance.now(); putResult(id,data);
        const insertMs = performance.now()-start;
        start=performance.now(); const saved=await encodeDrawing(drawing,representation);
        const encodeMs=performance.now()-start;
        assert.equal(saved[0],representation==='zip-v1'?80:60,'Requested container format must be used');
        start=performance.now(); const reopened=await decodeDrawing(saved);
        const decodeMs=performance.now()-start;
        const restored=getResult(id);
        assert.equal(restored.vectors[2].imaginary.length,samples);
        assert.equal(restored.vectors[2].real[samples-1],data.vectors[2].real[samples-1]);
        assert.equal(restored.vectors[2].imaginary[samples-1],data.vectors[2].imaginary[samples-1]);
        reopened.sheets[1].simulation.runs[0].dataState='removed';
        assert.ok(getResult(id),'Removed history keeps session buffers available to Undo');
        start=performance.now();const compact=await encodeDrawing(reopened,representation);
        await decodeDrawing(compact);const compactRoundTripMs=performance.now()-start;
        assert.equal(getResult(id),undefined,'Reopening compact drawing releases result/Undo cache');
        console.log(JSON.stringify({samples,representation,resultBytes:resultBytes(data),archiveBytes:saved.length,compactBytes:compact.length,
          insertMs,encodeMs,decodeMs,compactRoundTripMs,peakRSSMiB:process.resourceUsage().maxRSS/1024}));
      }
      main().catch(error=>{console.error(error);process.exitCode=1;});
    `,
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: output,
  logLevel: 'error',
  plugins: [
    {
      name: 'isolate-browser-services',
      setup(builder) {
        builder.onResolve(
          { filter: /\/(?:startup|i18n)$/ },
          ({ path: service }) => ({
            path: service.endsWith('/startup') ? 'startup' : 'i18n',
            namespace: 'benchmark',
          }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: 'benchmark' },
          ({ path: service }) => ({
            contents:
              service === 'startup'
                ? 'export const store={dispatch(){}}; export function getStore(){return store;}'
                : 'export default {t:key=>key};',
          }),
        );
      },
    },
  ],
});
const requested = process.argv.slice(2);
const workloads = requested.length ? requested.map(Number) : [250000, 1000000];
if (
  workloads.some(
    (count) => !Number.isSafeInteger(count) || count < 1 || count > 2000000,
  )
)
  throw new Error('Provide sample counts between 1 and 2000000.');
const results = [];
for (const samples of workloads)
  for (const representation of ['zip-v1', 'xml']) {
    const child = spawnSync(
      process.execPath,
      [output, String(samples), representation],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (child.status !== 0)
      throw new Error(
        child.stderr || child.error?.message || 'Benchmark failed',
      );
    results.push(JSON.parse(child.stdout));
  }
const report = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  created: new Date().toISOString(),
  results,
};
await fs.writeFile(
  path.join(directory, 'results.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
