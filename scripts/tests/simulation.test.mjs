import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const output = await fs.mkdtemp(
  path.join(os.tmpdir(), 'tinycad-simulation-tests-'),
);
await build({
  stdin: {
    contents: `export * from './src/io/dsnCodec'; export * from './src/io/dsnContainer'; export * from './src/io/ioXml'; export * from './src/simulation/document'; export * from './src/simulation/contracts'; export * from './src/simulation/resultStore'; export * from './src/simulation/numbers'; export * from './src/simulation/deck'; export * from './src/simulation/export'; export * from './src/simulation/traces'; export * from './src/io/drawingSaveFormat'; export * from './shared/drawingFiles.js';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(output, 'test.mjs'),
  packages: 'external',
  plugins: [
    {
      name: 'isolate-browser-startup',
      setup(builder) {
        builder.onResolve({ filter: /^file-saver$/ }, () => ({
          path: 'file-saver',
          namespace: 'saver',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'saver' }, () => ({
          contents: 'export const saveAs = () => {};',
        }));
        builder.onResolve({ filter: /\/startup$/ }, () => ({
          path: 'startup',
          namespace: 'test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const store = null;',
        }));
      },
    },
  ],
});
// Resolve dependencies from the workspace even though the bundle is temporary.
await fs.symlink(
  path.resolve('node_modules'),
  path.join(output, 'node_modules'),
  'dir',
);
const m = await import(pathToFileURL(path.join(output, 'test.mjs')));
const encoder = new TextEncoder();
const drawing = () => {
  const doc = m.blank();
  doc.sheets.push(m.createSimulationSheet(doc.sheets[0], 'Experiment'));
  return doc;
};
function addResult(doc) {
  const run = {
    id: crypto.randomUUID(),
    created: new Date().toISOString(),
    state: 'complete',
    backend: 'wasm',
    buildId: 'ngspice-47-tinycad-1',
    circuitHash: 'test',
    setupHash: 'test',
    analysis: m.defaultAnalysis(),
    parameters: {},
    samples: 3,
    pinned: false,
    dataState: 'available',
  };
  doc.sheets[1].simulation.runs.push(run);
  m.putResult(run.id, {
    vectors: [
      { name: 'time', unit: 's', real: [0, 0.1, 0.2] },
      { name: 'out', unit: 'V', real: [0, 2.5, 5], imaginary: [0, 0.1, 0] },
    ],
    scale: 'time',
    log: 'fixture',
  });
  return run;
}

test('quantity parser distinguishes milli, mega, units, scientific notation and comma ambiguity', () => {
  assert.equal(m.parseQuantity('5ms', 's'), 0.005);
  assert.equal(m.parseQuantity('10K'), 10000);
  assert.equal(m.parseQuantity('4.7kOhm', 'Ohm'), 4700);
  assert.equal(m.parseQuantity('1µs', 's'), 1e-6);
  assert.equal(m.parseQuantity('1MHz', 'Hz'), 1e6);
  assert.equal(m.parseQuantity('2e-3'), 0.002);
  assert.equal(m.parseQuantity('1,5'), 1.5);
  for (const text of ['1M', '1,000', '1e999', 'NaN', '5V'])
    assert.throws(() => m.parseQuantity(text));
});
test('analysis commands validate ranges and source names', () => {
  const a = m.defaultAnalysis();
  assert.equal(m.analysisCommand(a), '.op');
  assert.match(m.analysisCommand({ ...a, kind: 'tran' }), /^\.tran /);
  assert.match(
    m.analysisCommand({ ...a, kind: 'ac' }),
    /^\.ac dec 100 10 100000$/,
  );
  assert.throws(() =>
    m.analysisCommand({ ...a, kind: 'dc', source: 'V1', sweepStep: '-1' }),
  );
  assert.throws(() =>
    m.analysisCommand({ ...a, kind: 'ac', stopFrequency: '1Hz' }),
  );
  assert.throws(() =>
    m.analysisCommand({
      ...a,
      kind: 'tf',
      input: 'V1\nshell rm',
      output: 'out',
    }),
  );
});
test('model text cannot escape document file ownership or invoke control scripts', () => {
  m.validateSpiceText('.include device.lib', { 'device.lib': '.model D1 D' });
  for (const text of [
    '.include /tmp/secret',
    '.include ../secret.lib',
    '.control\nshell echo bad\n.endc',
    '.osdi evil.so',
  ])
    assert.throws(() => m.validateSpiceText(text, {}));
});
test('ZIP header auto detection and exact complex vector round trip', async () => {
  const doc = drawing(),
    run = addResult(doc);
  const bytes = await m.encodeDrawing(doc, 'zip-v1');
  assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
  const restored = await m.decodeDrawing(bytes);
  assert.equal(restored.documentId, doc.documentId);
  assert.equal(restored.sheets.length, 2);
  assert.equal(restored.sheets[1].kind, 'simulation');
  assert.equal(restored.representation, 'zip-v1');
  assert.deepEqual(m.getResult(run.id).vectors[1].imaginary, [0, 0.1, 0]);
});
test('automatic saves use XML .dsn for ordinary drawings and ZIP .dzn for large retained results', async () => {
  const doc = drawing();
  assert.equal(m.drawingSaveFormat(doc), 'xml');
  assert.equal(m.isCompressedDrawing(await m.encodeDrawing(doc)), false);
  const run = addResult(doc),
    count = m.LARGE_RESULT_BYTES / 8;
  run.samples = count;
  m.putResult(run.id, {
    scale: '',
    log: '',
    vectors: [{ name: 'out', unit: 'V', real: Array(count).fill(2.5) }],
  });
  assert.equal(m.drawingSaveFormat(doc), 'zip-v1');
  const bytes = await m.encodeDrawing(doc);
  assert.equal(m.isCompressedDrawing(bytes), true);
  assert.equal(m.drawingFileName('lesson.dsn', true), 'lesson.dzn');
  assert.equal(m.drawingFileName('lesson.dzn', false), 'lesson.dsn');
  assert.equal(m.drawingFileName('lesson.dsn.dzn', true), 'lesson.dzn');
  doc.sheets[1].simulation.retainResults = false;
  assert.equal(m.drawingSaveFormat(doc), 'xml');
  doc.sheets[1].simulation.retainResults = true;
  assert.equal(m.drawingSaveFormat(m.withoutResults(doc)), 'xml');
  doc.saveFormat = 'xml';
  assert.equal(m.drawingSaveFormat(doc), 'xml');
  doc.saveFormat = 'zip-v1';
  assert.equal(m.drawingSaveFormat(doc), 'zip-v1');
  // The decoder has no filename input: renamed .dsn/.dzn content is interpreted
  // solely from the ZIP/XML header, including legacy compressed .dsn files.
  assert.equal((await m.decodeDrawing(bytes)).representation, 'zip-v1');
  assert.equal(
    (await m.decodeDrawing(await m.encodeDrawing(doc, 'xml'))).representation,
    'xml',
  );
});
test('legacy XML, UTF-16, XML with inline vectors and compressed conversion are readable', async () => {
  assert.equal((await m.decodeDrawing(m.blankXML())).sheets.length, 1);
  const utf16 = new Uint8Array(
    Buffer.concat([
      Buffer.from([255, 254]),
      Buffer.from(m.blankXML(), 'utf16le'),
    ]),
  );
  assert.equal((await m.decodeDrawing(utf16)).sheets.length, 1);
  const doc = drawing(),
    run = addResult(doc);
  const xml = await m.encodeDrawing(doc, 'xml');
  assert.notEqual(xml[0], 80);
  assert.equal((await m.decodeDrawing(xml)).representation, 'xml');
  assert.deepEqual(m.getResult(run.id).vectors[1].real, [0, 2.5, 5]);
});
test('compact copy keeps setup and provenance while omitting numerical buffers', async () => {
  const doc = drawing(),
    run = addResult(doc);
  doc.sheets[1].simulation.instructions = 'Compare the resistor values';
  const compact = m.withoutResults(doc);
  assert.equal(doc.sheets[1].simulation.runs[0].dataState, 'available');
  assert.equal(compact.sheets[1].simulation.runs[0].samples, 3);
  const bytes = await m.encodeDrawing(compact);
  const result = await m.unpackDsn(bytes);
  assert.deepEqual(Object.keys(result.payloads), []);
  const restored = await m.decodeDrawing(bytes);
  assert.equal(restored.sheets[1].simulation.runs[0].dataState, 'removed');
  assert.equal(
    restored.sheets[1].simulation.instructions,
    'Compare the resistor values',
  );
});
test('invalid archives and unknown format versions are rejected', async () => {
  await assert.rejects(m.unpackDsn(new Uint8Array([80, 75, 5, 6])));
  await assert.rejects(
    m.packDsn(m.blankXML(), { '../outside': encoder.encode('bad') }),
  );
  await assert.rejects(
    m.unpackDsn(encoder.encode('<!DOCTYPE TinyCAD><TinyCAD/>')),
  );
  const bytes = await m.packDsn(m.blankXML(), {});
  await assert.rejects(m.unpackDsn(bytes.slice(0, bytes.length - 15)));
});
test('saved result cache is unchanged after a rejected document', async () => {
  const doc = drawing(),
    run = addResult(doc);
  const prior = m.getResult(run.id);
  const xml = new m.ioXML().to_dsn(doc, true, true).tostring();
  const malicious = await m.packDsn(xml, {
    [`results/${run.id}/index.json`]: encoder.encode(
      JSON.stringify({
        version: 1,
        scale: 'time',
        log: '',
        vectors: [
          { name: 'out', real: 'results/another/0-real.bin', count: 3 },
        ],
      }),
    ),
  });
  await assert.rejects(m.decodeDrawing(malicious));
  assert.equal(m.getResult(run.id), prior);
});
test('CSV quotes signal names and preserves imaginary samples; statistics are numeric', () => {
  const data = {
    scale: '',
    log: '',
    vectors: [{ name: 'v(a,b)', unit: 'V', real: [1, 2], imaginary: [3, 4] }],
  };
  assert.match(
    m.csv(data),
    /^"v\(a,b\) \[V\]","v\(a,b\) imaginary \[V\]"\r\n1,3\r\n2,4$/,
  );
  assert.equal(m.measurements([1, 2, 3]).mean, 2);
  assert.equal(m.measurements([1, 2, 3]).peakToPeak, 2);
});
test('derived traces preserve complex gain, differential voltage and power units', () => {
  const data = {
    scale: '',
    log: '',
    vectors: [
      { name: 'in', unit: 'V', real: [1], imaginary: [0] },
      { name: 'out', unit: 'V', real: [0.5], imaginary: [-0.5] },
      { name: 'current', unit: 'A', real: [0.002], imaginary: [0] },
    ],
  };
  const result = m.deriveTraces(data, [
    { name: 'gain', operation: 'divide', left: 'out', right: 'in' },
    { name: 'difference', operation: 'subtract', left: 'in', right: 'out' },
    { name: 'power', operation: 'multiply', left: 'in', right: 'current' },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.data.vectors.find((v) => v.name === 'gain').imaginary,
    [-0.5],
  );
  assert.equal(result.data.vectors.find((v) => v.name === 'power').unit, 'W');
  assert.deepEqual(data.vectors.length, 3);
  assert.equal(
    m.deriveTraces(data, [
      { name: 'invalid', operation: 'divide', left: 'in', right: '0' },
    ]).errors.length,
    1,
  );
});
test('noise spectrum and integrated plots round trip independently', async () => {
  const doc = drawing(),
    run = addResult(doc),
    data = m.getResult(run.id);
  data.plots = [
    {
      scale: '',
      vectors: [{ name: 'onoise_total', unit: 'V RMS', real: [1.25e-6] }],
    },
  ];
  const restored = await m.decodeDrawing(await m.encodeDrawing(doc));
  assert.equal(restored.sheets[1].simulation.runs[0].samples, 3);
  assert.deepEqual(m.getResult(run.id).plots[0].vectors[0].real, [1.25e-6]);
});

process.once('exit', () => {
  fs.rm(output, { recursive: true, force: true }).catch(() => {});
});
