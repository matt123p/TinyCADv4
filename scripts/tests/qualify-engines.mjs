import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const fixtures = [
  {
    name: 'laboratory meter loading',
    deck: 'V1 in 0 10\nR1 in out 1k\nRmeter out 0 1k\n.op',
    check(names, rows) {
      assert.ok(Math.abs(rows[0][names.indexOf('out')] - 5) < 1e-9);
    },
  },
  {
    name: 'laboratory supply current limit',
    deck: 'Vset set 0 5\nBdrive 0 internal I={0.01*tanh((v(set)-v(internal))/(0.1*0.01))}\nVsense internal out 0\nRleak out 0 1e12\nRload out 0 100\n.op',
    check(names, rows) {
      assert.ok(Math.abs(rows[0][names.indexOf('out')] - 1) < 1e-6);
      assert.ok(Math.abs(rows[0][names.indexOf('vsense#branch')] - .01) < 1e-9);
    },
  },
  {
    name: 'divider',
    deck: 'V1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k\n.op',
    check(names, rows) {
      assert.ok(Math.abs(rows[0][names.indexOf('out')] - 2.5) < 1e-9);
      assert.ok(Math.abs(rows[0][names.indexOf('v1#branch')] + 0.0025) < 1e-9);
    },
  },
  {
    name: 'RC transient',
    deck: 'V1 in 0 PULSE(0 1 0 1n 1n 1 2)\nR1 in out 1k\nC1 out 0 1u\n.tran 10u 5m',
    check(names, rows) {
      const time = names.indexOf('time'),
        out = names.indexOf('out');
      assert.ok(rows.length > 100);
      const sample = rows.reduce((a, b) =>
        Math.abs(a[time] - 0.001) < Math.abs(b[time] - 0.001) ? a : b,
      );
      assert.ok(
        Math.abs(sample[out] - (1 - Math.exp(-sample[time] / 0.001))) < 0.005,
      );
    },
  },
  {
    name: 'RC AC',
    deck: 'V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac lin 1 159.154943 159.154943',
    check(names, rows, imaginary) {
      const index = names.indexOf('out');
      assert.ok(Math.abs(rows[0][index] - 0.5) < 1e-6);
      assert.ok(Math.abs(imaginary[0][index] + 0.5) < 1e-6);
    },
  },
  {
    name: 'DC sweep',
    deck: 'V1 in 0 0\nR1 in out 1k\nR2 out 0 1k\n.dc V1 0 5 1',
    check(names, rows) {
      assert.equal(rows.length, 6);
      assert.ok(Math.abs(rows.at(-1)[names.indexOf('out')] - 2.5) < 1e-9);
    },
  },
  {
    name: 'Noise',
    deck: 'V1 in 0 DC 1 AC 1\nR1 in out 1k\nC1 out 0 1u\nR2 out 0 1k\n.noise v(out) V1 dec 3 1 1k',
    check(names, rows) {
      assert.ok(rows[0][names.indexOf('onoise_spectrum')] > 0);
      assert.equal(rows.at(-1).length, 2);
    },
  },
  {
    name: 'Transfer function',
    deck: 'V1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n.tf v(out) V1',
    check(names, rows) {
      assert.ok(
        Math.abs(rows[0][names.indexOf('Transfer_function')] - 0.5) < 1e-9,
      );
    },
  },
  {
    name: 'Pole-zero',
    deck: 'V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.pz in 0 out 0 vol pz',
    check(names, rows) {
      assert.ok(Math.abs(rows[0][names.indexOf('pole(1)')] + 1000) < 1e-6);
    },
  },
  {
    name: 'diode model',
    deck: '.model DTEST D(IS=1e-14 N=1)\nV1 in 0 1\nR1 in out 1k\nD1 out 0 DTEST\n.op',
    check(names, rows) {
      const out = rows[0][names.indexOf('out')];
      assert.ok(out > 0.5 && out < 0.8);
    },
  },
  {
    name: 'amplifier AC tutorial',
    // Exercise the complete exported example, including its BJT model,
    // initial conditions, potentiometer expressions and saved signals.
    deck: await fs.readFile(
      new URL('../../tutorials/spice/circuits/amp-ac.cir', import.meta.url),
      'utf8',
    ),
    completeDeck: true,
    check(names, rows, imaginary) {
      const frequency = names.indexOf('frequency');
      const output = names.indexOf('out');
      assert.ok(frequency >= 0 && output >= 0);
      assert.equal(rows.length, 481);
      const index = rows.findIndex(
        (row) => Math.abs(row[frequency] - 1000) < 1e-6,
      );
      assert.ok(index >= 0, 'AC sweep must include the 1 kHz sample');
      const gain = Math.hypot(rows[index][output], imaginary[index][output]);
      assert.ok(
        Math.abs(gain - 0.891736) < 0.001,
        `Amplifier gain at 1 kHz: ${gain}`,
      );
    },
  },
];
function inspect(events, fixture) {
  const finished = events.filter((e) => e.type === 'finished').at(-1);
  assert.equal(
    finished?.state,
    'complete',
    `${fixture.name}: ${JSON.stringify(events)}`,
  );
  const names = events.find((e) => e.type === 'vectors')?.names;
  const rows = events.filter((e) => e.type === 'data').flatMap((e) => e.rows);
  const imaginary = events
    .filter((e) => e.type === 'data')
    .flatMap((e) => e.imaginary);
  fixture.check(names, rows, imaginary);
  return { names, rows, imaginary };
}
const wasm = path.resolve('public/engines/ngspice/ngspice.js');
const nativeDir = path.resolve(
  process.env.TINYCAD_NATIVE_ENGINE_DIR || 'build/engines/native',
);
const backend = process.argv[2] || 'both';
let manifest;
if (backend !== 'wasm')
  manifest = JSON.parse(
    await fs.readFile(path.join(nativeDir, 'manifest.json'), 'utf8'),
  );
for (const fixture of fixtures) {
  const deck = fixture.completeDeck
    ? fixture.deck
    : `TinyCAD qualification ${fixture.name}\n${fixture.deck}\n.end\n`;
  let nativeResult, wasmResult;
  if (backend !== 'wasm') {
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tinycad-engine-test-'),
    );
    try {
      await fs.writeFile(path.join(temp, 'circuit.cir'), deck);
      const result = spawnSync(
        path.join(nativeDir, manifest.helper),
        [
          path.join(nativeDir, manifest.library),
          path.join(temp, 'circuit.cir'),
          ...manifest.modules.map((m) => path.join(nativeDir, m)),
        ],
        {
          cwd: temp,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      assert.equal(
        result.status,
        0,
        `${fixture.name}: ${result.stderr}\n${result.stdout}`,
      );
      nativeResult = inspect(
        result.stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
        fixture,
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
  if (backend !== 'native') {
    const workerSource = `import {parentPort,workerData} from 'node:worker_threads';globalThis.ngspiceEmit=json=>parentPort.postMessage(JSON.parse(json)); const create=(await import(workerData.url)).default;const m=await create();m.ccall('tc_run','number',['string'],[workerData.deck]);parentPort.close();`;
    const events = await new Promise((resolve, reject) => {
      const events = [];
      const worker = new Worker(
        new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`),
        { workerData: { deck, url: pathToFileURL(wasm).href } },
      );
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('WASM fixture timeout'));
      }, 30000);
      worker.on('message', (event) => events.push(event));
      worker.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      worker.on('exit', (code) => {
        clearTimeout(timeout);
        code ? reject(new Error(`WASM exit ${code}`)) : resolve(events);
      });
    });
    wasmResult = inspect(events, fixture);
  }
  if (nativeResult && wasmResult) {
    assert.deepEqual(nativeResult.names, wasmResult.names);
    assert.equal(nativeResult.rows.length, wasmResult.rows.length);
    nativeResult.rows.forEach((row, i) =>
      row.forEach((value, j) =>
        assert.ok(
          Math.abs(value - wasmResult.rows[i][j]) <=
            1e-7 * Math.max(1, Math.abs(value)),
          `${fixture.name} parity at ${i},${j}`,
        ),
      ),
    );
  }
  console.log(`PASS ${fixture.name} (${backend})`);
}
