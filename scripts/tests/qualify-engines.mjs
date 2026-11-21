import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

async function packsFor(...ids) {
  return Promise.all(ids.map(async (name) =>
    JSON.parse(await fs.readFile(new URL(`../../bundled-libraries/spice/${name}.json`, import.meta.url), 'utf8')).pack,
  ));
}
const catalogPacks = await packsFor('openjellybean', 'circsim');
const catalogIncludes = catalogPacks.map(({ filename }) => `.include ${filename}`).join('\n');
const catalogFiles = Object.fromEntries(catalogPacks.map(({ filename, spice }) => [filename, spice]));

async function catalogFixture(ids, name, circuit, check, { desktopOnly, adaptiveTimesteps } = {}) {
  const packs = await packsFor(...ids);
  return {
    name, desktopOnly, adaptiveTimesteps,
    files: Object.fromEntries(packs.map(({ filename, spice }) => [filename, spice])),
    deck: packs.map(({ filename }) => '.include ' + filename).join('\n') + '\n' + circuit,
    check,
  };
}

const fixtures = [
  await catalogFixture(['spice-files'], 'additional catalog discrete models',
    [
      'Vcc supply 0 5',
      'Vhigh bias 0 30',
      'Iled1 0 red 20m',
      'Iled2 0 green 20m',
      'Dred red 0 LED_RED_GEN',
      'Dgreen green 0 LED_GREEN_GEN',
      'Rz1 bias z1 510',
      'Rz2 bias z2 850',
      'Dz1 0 z1 1N4733A_GEN',
      'Dz2 0 z2 1N4742A_GEN',
      'Xbridge supply 0 pos neg BRIDGE_GEN',
      'Rbridge pos neg 1k',
      'Rbias neg 0 1meg',
      'Xrelay supply 0 supply relay RELAY_SPST_5V',
      'Rrelay relay 0 1k',
      'S1 supply switch supply 0 SW_IDEAL',
      'Rswitch switch 0 1k',
      ...['OPTO_GEN', 'PC817_GEN', '4N35_GEN', 'CNY17_GEN'].flatMap((id, i) => [
        'Iopto' + i + ' 0 led' + i + ' 1m',
        'Xopto' + i + ' led' + i + ' 0 out' + i + ' 0 ' + id,
        'Ropto' + i + ' supply out' + i + ' 1k',
      ]),
      '.save v(red) v(green) v(z1) v(z2) v(pos) v(neg) v(relay) v(switch) v(out0) v(out1) v(out2) v(out3)',
      '.op',
    ].join('\n'),
    (names, rows) => {
      const value = (name) => rows[0][names.indexOf(name)];
      for (const node of ['red', 'green']) assert.ok(value(node) > 1 && value(node) < 3);
      assert.ok(value('z1') > 4.8 && value('z1') < 5.4);
      assert.ok(value('z2') > 11.5 && value('z2') < 12.5);
      assert.ok(value('pos') - value('neg') > 3 && value('pos') - value('neg') < 4.8);
      for (const node of ['relay', 'switch']) assert.ok(value(node) > 4.99);
      for (let i = 0; i < 4; i++) assert.ok(value('out' + i) > 3.3 && value('out' + i) < 4.4);
    }),
  await catalogFixture(['spice-files'], 'additional catalog crystal and transformer',
    'Vxtal a 0 AC 1\nVxfmr b 0 AC 1\nX1 a 0 XTAL_16M\nX2 b 0 sec 0 XFMR_10TO1\nR1 sec 0 10k\n.save i(Vxtal) v(sec)\n.ac lin 1 ' +
      Array(2).fill(1 / (2 * Math.PI * Math.sqrt(7e-3 * 14.1e-15))).join(' '),
    (names, rows, imaginary) => {
      const amplitude = (name) => {
        const index = names.indexOf(name);
        return Math.hypot(rows[0][index], imaginary[0][index]);
      };
      assert.ok(amplitude('vxtal#branch') > 0.04 && amplitude('vxtal#branch') < 0.06, 'crystal at series resonance');
      assert.ok(amplitude('sec') > 0.09 && amplitude('sec') < 0.11, 'transformer voltage ratio');
    }),
  await catalogFixture(['sky130','ihp-sg13g2'], 'additional catalog foundry PNP transistors',
    'Ve e 0 1\nVb b 0 0.3\nR1 a 0 1k\nR2 c 0 1k\nX1 a b e 0 sky130_fd_pr__pnp_05v5_W0p68L0p68\nX2 c b e pnpMPA\n.save v(a) v(c)\n.op',
    (names, rows) => {
      assert.ok(Math.abs(rows[0][names.indexOf('a')] - 0.00019745) < 1e-6);
      assert.ok(Math.abs(rows[0][names.indexOf('c')] - 0.00012578) < 1e-6);
    }),
  await catalogFixture(['gf180mcu'], 'additional catalog GF180MCU MIM capacitors',
    'V1 a 0 AC 1\nV2 b 0 AC 1\nV3 c 0 AC 1\nX1 a 0 mim_1p0fF\nX2 b 0 mim_1p5fF\nX3 c 0 mim_2p0fF\n.save i(V1) i(V2) i(V3)\n.ac lin 1 1Meg 1Meg',
    (names, rows, imaginary) => {
      const currents = ['v1#branch','v2#branch','v3#branch'].map((name) => Math.abs(imaginary[0][names.indexOf(name)]));
      assert.ok(currents[0] > 6e-7 && currents[2] < 1.6e-6);
      assert.ok(currents[0] < currents[1] && currents[1] < currents[2]);
    }),
  await catalogFixture(['ngspice-special'], 'additional catalog ICL8038 oscillator',
    'Vcc cc 0 12\nX1 adjust sine triangle p4 p5 cc fmb fmb square ct 0 adjust ICL8038\nR1 adjust 0 100k\nR2 square cc 1k\nR4 cc p4 10k\nR5 cc p5 10k\nCt ct 0 10n\n.save v(sine) v(triangle) v(square)\n.tran 1u 2m',
    (names, rows) => {
      for (const name of ['sine', 'triangle', 'square']) {
        const values = rows.map((row) => row[names.indexOf(name)]);
        assert.ok(Math.max(...values) - Math.min(...values) > 0.1, name);
      }
    }, { adaptiveTimesteps: true }),
  await catalogFixture(['ngspice-xspice'], 'additional catalog LTC1044HV voltage inverter',
    'Vcc cc 0 5\nX1 0 cpos 0 cneg neg 0 osc cc LTC1044HV\nC1 cpos cneg 10u\nC2 0 neg 100u\nR1 neg 0 10k\n.save v(neg)\n.tran 50u 100m',
    (names, rows) => assert.ok(rows.at(-1)[names.indexOf('neg')] < -4.8), { desktopOnly: true }),
  await catalogFixture(['ngspice-xspice'], 'additional catalog LR8 regulator',
    'Vcc cc 0 48\nX1 cc out adj LR8ng\nR1 out adj 100k\nR2 adj 0 300k\nC1 out 0 1u\n.nodeset v(out)=4.8 v(adj)=1.2\n.save v(out)\n.op',
    (names, rows) => assert.ok(Math.abs(rows[0][names.indexOf('out')] - 2.6) < 0.01), { desktopOnly: true }),
  {
    name: 'catalog analogue SPICE models',
    files: catalogFiles,
    deck: `${catalogIncludes}
V5 supply 0 5
V12 raw 0 12
Vpos pos 0 15
Vneg neg 0 -15
Vset in 0 1
Vtwo two 0 2
Vgate gate 0 10
Iyellow 0 yellow 20m
Dyellow yellow 0 LED_YELLOW
Ioj 0 oj 5m
Doj oj 0 1N4148_OJ
X741 in follower follower pos neg LM741
X5532 in channel_a channel_a two channel_b channel_b pos neg NE5532
R741 follower 0 10k
Ra channel_a 0 10k
Rb channel_b 0 10k
X393 in two cmp supply 0 LM393
Rcmp supply cmp 1k
X339 in two ca two in cb in two cc two in cd supply 0 LM339_QUAD
Rca supply ca 1k
Rcb supply cb 1k
Rcc supply cc 1k
Rcd supply cd 1k
X555 0 supply timer 0 control supply discharge supply NE555
Rtimer timer 0 10k
Rdisch supply discharge 1k
X7805 raw 0 fixed 7805
Rfixed fixed 0 1k
X317 raw 0 adjusted LM317
Radj adjusted 0 240
X431 reference 0 reference TL431
Rref supply reference 1k
I817 0 led817 5m
I435 0 led435 5m
X817 led817 0 opto817 0 PC817
X435 led435 0 opto435 0 4N35
Ro817 supply opto817 1k
Ro435 supply opto435 1k
M1 mos_a gate 0 MIRLZ44N
M2 mos_b gate 0 MIRF540N
M3 mos_c gate 0 MIRF3205
M4 mos_d 0 raw MIRF9540N
Rma supply mos_a 1k
Rmb supply mos_b 1k
Rmc supply mos_c 1k
Rmd mos_d 0 1k
.save v(yellow) v(oj) v(follower) v(channel_a) v(channel_b) v(cmp) v(ca) v(cb) v(cc) v(cd)
+ v(timer) v(discharge) v(fixed) v(adjusted) v(reference) v(opto817) v(opto435) v(mos_a) v(mos_b) v(mos_c) v(mos_d)
.op`,
    check(names, rows) {
      const value = (name) => rows[0][names.indexOf(name)];
      const expect = (name, lo, hi) => assert.ok(value(name) >= lo && value(name) <= hi, `${name} = ${value(name)}`);
      expect('yellow', 2.09, 2.11);
      expect('oj', 0.64, 0.71);
      expect('follower', 1.000, 1.002);
      expect('channel_a', 0.99, 1.01);
      expect('channel_b', 1.99, 2.01);
      for (const node of ['cmp', 'ca', 'cc']) expect(node, 0.15, 0.25);
      for (const node of ['cb', 'cd']) expect(node, 4.99, 5.01);
      expect('timer', -0.01, 0.01);
      expect('discharge', 0.05, 0.1);
      expect('fixed', 4.99, 5.01);
      expect('adjusted', 1.24, 1.26);
      expect('reference', 2.49, 2.51);
      for (const node of ['opto817', 'opto435']) expect(node, 0, 0.5);
      for (const node of ['mos_a', 'mos_b', 'mos_c']) expect(node, 0, 0.05);
      expect('mos_d', 11.9, 12.01);
    },
  },
  {
    name: 'circsim 741 follower AC',
    files: catalogFiles,
    deck: `${catalogIncludes}\nVpos pos 0 15\nVneg neg 0 -15\nV1 in 0 AC 1\nX1 in out out pos neg LM741\nR1 out 0 10k\n.ac lin 1 1Meg 1Meg`,
    check(names, rows, imaginary) {
      const index = names.indexOf('out');
      const gain = Math.hypot(rows[0][index], imaginary[0][index]);
      assert.ok(Math.abs(gain - 0.7045) < 0.001);
    },
  },
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
const wasm = path.resolve(process.env.TINYCAD_WASM_ENGINE_DIR || 'public/engines/ngspice', 'ngspice.js');
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
  if (process.argv[3] && !fixture.name.includes(process.argv[3])) continue;
  if (backend === 'wasm' && fixture.desktopOnly) continue;
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
      for (const [filename, text] of Object.entries(fixture.files ?? {}))
        await fs.writeFile(path.join(temp, filename), text);
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
  if (backend !== 'native' && !fixture.desktopOnly) {
    const workerSource = `import {parentPort,workerData} from 'node:worker_threads';globalThis.ngspiceEmit=json=>parentPort.postMessage(JSON.parse(json)); const create=(await import(workerData.url)).default;const m=await create();for(const [name,text] of Object.entries(workerData.files))m.FS.writeFile(name,text);m.ccall('tc_run','number',['string'],[workerData.deck]);parentPort.close();`;
    const events = await new Promise((resolve, reject) => {
      const events = [];
      const worker = new Worker(
        new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`),
        { workerData: { deck, files: fixture.files ?? {}, url: pathToFileURL(wasm).href } },
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
  }
  if (nativeResult && wasmResult && !fixture.adaptiveTimesteps) {
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
  console.log('PASS ' + fixture.name + ' (' + (fixture.desktopOnly ? 'native' : backend) + ')');
}
