import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNgspice } from './ngspice-runner.mjs';
import { circuitSaveLine } from '../../shared/spiceSaveVectors.js';
import { teachingModel } from '../lib/teaching-models.mjs';
const master = JSON.parse(
  await fs.readFile(
    new URL('../../docs/symbol-libraries/all-symbols.json', import.meta.url),
  ),
);
export async function simulate(id, values = {}, options = {}) {
  const r = master.symbols.find((r) => r.id === id),
    model = teachingModel(id, r.pins, options),
    fields = { ...model.fields, ...options.fields, ref: 'U1' },
    nodes = Object.fromEntries(
      r.pins.map((p) => [
        p.logical_number,
        ['VSS', 'GND', 'COMMON', 'REF', 'V-', 'COIL_B'].includes(p.name)
          ? '0'
          : 'n' + p.logical_number,
      ]),
    );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tinycad-model-'));
  const expand = (s) =>
    s
      .replace(/\$\(([^)]+)\)/g, (_, n) => fields[n] ?? '<' + n + '>')
      .replace(/%\(([^)]+)\)/g, (_, n) => nodes[n]);
  const h = ['Vanchor anchor 0 1', 'Ranchor anchor 0 1g'];
  for (const p of r.pins) {
    const n = nodes[p.logical_number];
    if (n === '0') continue;
    if (
      Object.hasOwn(values, p.name) ||
      p.electrical_type === 'power_input' ||
      p.electrical_type === 'input'
    )
      h.push(
        `V_${p.logical_number} ${n} 0 ${
          values[p.name] ??
          ([
            'VCC',
            'VDD',
            'V+',
            'VREF',
            'ENABLE',
            'RESET_N',
            'SET_N',
            'UP_DOWN',
          ].includes(p.name)
            ? 5
            : 0)
        }`,
      );
    else h.push(`R_${p.logical_number} ${n} 0 1meg`);
  }
  const signals =
      options.signals ||
      r.pins.filter((p) => p.electrical_type === 'output').map((p) => p.name),
    times = options.times || [1e-6];
  const measurements = signals.flatMap((name, j) =>
    times.map(
      (t, i) =>
        `.meas tran m${j}_${i} FIND v(${
          nodes[r.pins.find((p) => p.name === name).logical_number]
        }) AT=${t}`,
    ),
  );
  const body = `${h.join('\n')}\n${expand(model.prolog)}\n${expand(
    model.template,
  )}`;
  const saved = circuitSaveLine(body, Object.values(nodes));
  const deck = `${id}\n${body}\n${saved}\n.tran ${options.step || '1n'} ${
    Math.max(...times) + 1e-8
  }\n${measurements.join('\n')}\n.end\n`;
  const file = directory + '/circuit.cir';
  await fs.writeFile(file, deck);
  let result;
  try {
    result = runNgspice(file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  const log = result.log;
  if (result.status !== 0 || /error:|fatal:|singular|not converg/i.test(log))
    throw Error(id + ' ' + log.slice(-2000));
  const found = Object.fromEntries(
    [...log.matchAll(/(m\d+_\d+)\s*=\s*([-+e.\d]+)/g)].map((m) => [
      m[1],
      Number(m[2]),
    ]),
  );
  return Object.fromEntries(
    signals.map((n, j) => [n, times.map((_, i) => found[`m${j}_${i}`])]),
  );
}
