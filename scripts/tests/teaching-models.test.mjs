import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { teachingModel } from '../lib/teaching-models.mjs';
import { simulate } from './teaching-model-runner.mjs';
const native = { skip: !process.env.NGSPICE_BIN };
const digital = (x) => Number(x > 2.5);
const near = (value, expected, tolerance = 0.002) =>
  assert.ok(
    Number.isFinite(value) && Math.abs(value - expected) < tolerance,
    `${value} != ${expected}`,
  );
test('all 96 non-editor contracts have complete portable teaching models', async () => {
  const m = JSON.parse(
    await readFile(
      new URL('../../docs/symbol-libraries/all-symbols.json', import.meta.url),
    ),
  );
  for (const r of m.symbols.filter(
    (r) => r.asset_kind !== 'editor_primitive',
  )) {
    const model = teachingModel(r.id, r.pins);
    assert.ok(model.template.trim(), r.id);
    assert.ok(
      !/^A\S*\s/m.test(model.template),
      r.id + ' must run in the browser engine',
    );
    for (const pin of [
      ...(model.template + model.prolog).matchAll(/%\(([^)]+)\)/g),
    ])
      assert.ok(
        r.pins.some((p) => p.logical_number === pin[1]),
        r.id + ':' + pin[1],
      );
    for (const attr of [
      ...(model.template + model.prolog).matchAll(/\$\(([^)]+)\)/g),
    ])
      assert.ok(
        attr[1] === 'ref' || Object.hasOwn(model.fields, attr[1]),
        r.id + ':' + attr[1],
      );
  }
});
test(
  'ngspice verifies every gate truth table and full-adder carry/sum',
  native,
  async () => {
    const functions = {
      gate_and: (a, b) => a && b,
      gate_nand: (a, b) => !(a && b),
      gate_or: (a, b) => a || b,
      gate_nor: (a, b) => !(a || b),
      gate_xor: (a, b) => a !== b,
      gate_xnor: (a, b) => a === b,
      gate_not: (a) => !a,
      gate_buffer: (a) => a,
    };
    for (const [id, fn] of Object.entries(functions))
      for (const a of [0, 1])
        for (const b of [0, 1]) {
          const out = await simulate(id, { A: 5 * a, B: 5 * b });
          assert.equal(digital(out.Y[0]), Number(fn(a, b)), `${id} ${a}${b}`);
        }
    for (let n = 0; n < 8; n++) {
      const a = n & 1,
        b = (n >> 1) & 1,
        c = (n >> 2) & 1,
        out = await simulate('full_adder', {
          A: 5 * a,
          B: 5 * b,
          CARRY_IN: 5 * c,
        });
      assert.equal(digital(out.SUM[0]), (a + b + c) % 2);
      assert.equal(digital(out.CARRY_OUT[0]), Number(a + b + c >= 2));
    }
  },
);
test(
  'ngspice verifies decoder, priority encoder and multiplexer selection',
  native,
  async () => {
    for (let n = 0; n < 4; n++) {
      const out = await simulate('decoder2to4', {
        A0: (n & 1) * 5,
        A1: ((n >> 1) & 1) * 5,
      });
      for (let i = 0; i < 4; i++)
        assert.equal(digital(out['Y' + i][0]), Number(i === n));
    }
    for (let n = 0; n < 16; n++) {
      const out = await simulate(
        'encoder4to2',
        Object.fromEntries(
          [0, 1, 2, 3].map((i) => ['I' + i, ((n >> i) & 1) * 5]),
        ),
      );
      let priority = 0;
      for (let i = 0; i < 4; i++) if (n & (1 << i)) priority = i;
      assert.equal(digital(out.VALID[0]), Number(n !== 0));
      assert.equal(digital(out.Y0[0]), priority & 1);
      assert.equal(digital(out.Y1[0]), priority >> 1);
    }
    for (let n = 0; n < 8; n++) {
      const out = await simulate('mux2', {
        D0: (n & 1) * 5,
        D1: ((n >> 1) & 1) * 5,
        SELECT: ((n >> 2) & 1) * 5,
      });
      assert.equal(digital(out.Y[0]), n & 4 ? (n >> 1) & 1 : n & 1);
    }
  },
);
test(
  'ngspice verifies counter wraparound, down count, Johnson sequence and shift storage',
  native,
  async () => {
    const CLK = 'PULSE(0 5 1u 1n 1n 499n 1u)',
      times = Array.from({ length: 12 }, (_, i) => (i + 0.2) * 1e-6),
      code = (out, i) =>
        Object.keys(out).reduce(
          (n, k) => n + 2 ** Number(k.slice(1)) * digital(out[k][i]),
          0,
        );
    for (const id of [
      'counter_binary3_sync',
      'counter_binary3_async',
      'counter_bcd',
    ]) {
      const out = await simulate(id, { CLK }, { times, step: '5n' }),
        mod = id === 'counter_bcd' ? 10 : 8;
      times.forEach((_, i) =>
        assert.equal(code(out, i), i % mod, id + ':' + i),
      );
    }
    const down = await simulate(
      'counter_bcd',
      { CLK, UP_DOWN: 0 },
      { times, step: '5n' },
    );
    times.forEach((_, i) => assert.equal(code(down, i), (10 - (i % 10)) % 10));
    const johnson = await simulate(
        'counter_johnson',
        { CLK },
        { times, step: '5n' },
      ),
      sequence = [0, 1, 3, 7, 15, 14, 12, 8];
    times.forEach((_, i) => assert.equal(code(johnson, i), sequence[i % 8]));
    const shift = await simulate(
      'shift_register3',
      { CLK, DATA: 5 },
      { times: times.slice(0, 5), step: '5n' },
    );
    [0, 1, 3, 7, 7].forEach((n, i) => assert.equal(code(shift, i), n));
  },
);
test(
  'ngspice verifies rising/falling sampling, asynchronous reset and level-sensitive latch hold',
  native,
  async () => {
    const CLK = 'PULSE(0 5 1u 1n 1n 499n 1u)',
      D = 'PULSE(0 5 700n 1n 1n 600n 2u)',
      times = [0.8e-6, 1.2e-6, 1.4e-6, 1.7e-6, 2.2e-6];
    const rising = await simulate(
        'flipflop_d',
        { CLK, D },
        { times, step: '5n' },
      ),
      falling = await simulate(
        'flipflop_d',
        { CLK, D },
        { times, step: '5n', edge: 'falling' },
      );
    assert.deepEqual(rising.Q.map(digital), [0, 1, 1, 1, 0]);
    assert.deepEqual(falling.Q.map(digital), [0, 0, 0, 0, 0]);
    const reset = await simulate(
      'flipflop_d',
      { CLK, D: 5, RESET_N: 'PULSE(5 0 1.3u 1n 1n 500n 3u)' },
      { times: [1.2e-6, 1.5e-6], step: '5n' },
    );
    assert.deepEqual(reset.Q.map(digital), [1, 0]);
    const latch = await simulate(
      'latch_d',
      { D, ENABLE: 'PULSE(0 5 500n 1n 1n 600n 4u)' },
      { times: [0.6e-6, 0.9e-6, 1.4e-6], step: '5n' },
    );
    assert.deepEqual(latch.Q.map(digital), [0, 1, 1]);
  },
);
test(
  'ngspice verifies sensor scaling, AM carrier bias, ADC/DAC conversion and analogue switching',
  native,
  async () => {
    near(
      (await simulate('hall_sensor', {}, { fields: { MagneticFlux: 0.1 } }))
        .OUT[0],
      3.5,
      0.005,
    );
    near(
      (
        await simulate(
          'temperature_sensor',
          {},
          { fields: { Temperature: 37 } },
        )
      ).OUT[0],
      0.37,
    );
    near(
      (await simulate('light_sensor', {}, { fields: { Illuminance: 250 } }))
        .OUT[0],
      0.25,
    );
    near(
      (await simulate('pressure_sensor', {}, { fields: { Pressure: 5 } }))
        .OUT[0],
      2.45,
      0.005,
    );
    const am = await simulate('am_modulator', {
      'CARRIER+': 1,
      'MESSAGE+': 0.5,
      'OUT-': 0,
    });
    near(am['OUT+'][0], 1.25);
    const dac = await simulate('dac4', { D0: 5, D1: 0, D2: 5, D3: 0, VREF: 4 });
    near(dac.ANALOG_OUT[0], 1.25);
    const adc = await simulate(
      'adc4',
      { ANALOG_IN: 1.4, VREF: 4, CLOCK: 'PULSE(0 5 1u 1n 1n 499n 1u)' },
      { times: [1.2e-6], step: '5n' },
    );
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => digital(adc['D' + i][0])),
      [1, 0, 1, 0],
    );
    const on = await simulate(
        'controlled_switch',
        { A: 5, 'CTRL+': 5 },
        { signals: ['B'] },
      ),
      off = await simulate(
        'controlled_switch',
        { A: 5, 'CTRL+': 0 },
        { signals: ['B'] },
      );
    near(on.B[0], 5);
    assert.ok(off.B[0] < 0.01);
  },
);

test(
  'ngspice verifies configurable MCU/FPGA truth tables, ADC inputs and clocked outputs',
  native,
  async () => {
    const gpio = await simulate(
      'microcontroller',
      { GPIO0: 5, GPIO1: 0 },
      { signals: ['GPIO2', 'GPIO3'] },
    );
    assert.equal(digital(gpio.GPIO2[0]), 1);
    assert.equal(digital(gpio.GPIO3[0]), 0);
    const and = await simulate(
      'fpga',
      { IO0: 5, IO1: 0 },
      { fields: { Truth2: 8 }, signals: ['IO2'] },
    );
    assert.equal(digital(and.IO2[0]), 0);
    const analogue = await simulate(
      'microcontroller',
      { GPIO0: 0, GPIO1: 0, AIN0: 4 },
      { fields: { Input0FromADC: 1 }, signals: ['GPIO2'] },
    );
    assert.equal(digital(analogue.GPIO2[0]), 1);
    const sampled = await simulate(
      'fpga',
      {
        IO0: 'PULSE(0 5 700n 1n 1n 600n 4u)',
        IO1: 0,
        CLOCK: 'PULSE(0 5 1u 1n 1n 499n 1u)',
      },
      {
        fields: { Clocked: 1 },
        signals: ['IO2'],
        times: [0.9e-6, 1.2e-6, 1.4e-6, 2.2e-6],
        step: '5n',
      },
    );
    assert.deepEqual(sampled.IO2.map(digital), [0, 1, 1, 0]);
  },
);
