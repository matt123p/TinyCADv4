import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tutorialRuntime } from './tutorials/runtime.mjs';
const api = await tutorialRuntime(),
  records = [],
  datasets = {};
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
for (const course of ['spice', 'xspice'])
  for (const file of (
    await fs.readdir('tutorials/' + course + '/circuits')
  ).filter((n) => n.endsWith('.dzn'))) {
    const id = file.slice(0, -4),
      bytes = await fs.readFile('tutorials/' + course + '/circuits/' + file),
      drawing = await api.decodeDrawing(bytes),
      sim = drawing.sheets.find((s) => s.kind === 'simulation').simulation,
      run = sim.runs.at(-1),
      data = api.getResult(run.id);
    check(
      run.state === 'complete' && data?.vectors.length,
      id + ' retained complete acquisition',
    );
    const deck = api.buildDeck(new api.NetlistWorkerState().init(drawing), sim),
      hash = createHash('sha256')
        .update(deck + JSON.stringify(sim.models))
        .digest('hex');
    check(
      run.circuitHash === hash,
      id + ' retained circuit matches saved drawing',
    );
    if (sim.analysis.kind === 'tran') {
      const t = data.vectors.find((v) => v.name === 'time').real;
      const end = Number(deck.match(/\.tran\s+\S+\s+(\S+)/)[1]);
      check(t.at(-1) >= end * (1 - 1e-8), id + ' reaches end');
    }
    check(
      drawing.sheets[0].items
        .filter((i) => i.NodeName === 'wire')
        .every((w) => w.d_points.length === 2),
      id + ' native wires',
    );
    datasets[id] = data;
    records.push({
      id,
      course,
      analysis: sim.analysis.kind,
      samples: run.samples,
      buildId: run.buildId,
      drawingSha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
const v = (id, name) => {
  const d = datasets[id];
  return [...d.vectors, ...(d.plots || []).flatMap((p) => p.vectors)].find(
    (v) => v.name.toLowerCase() === name.toLowerCase(),
  );
};
const close = (actual, expected, tolerance, label) =>
  check(
    Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' expected ' + expected,
  );
const at = (id, name, time) => {
  const x = v(id, datasets[id].scale).real,
    y = v(id, name).real;
  let i = x.findIndex((t) => t >= time);
  if (i < 1) return y[0];
  return y[i - 1] + ((y[i] - y[i - 1]) * (time - x[i - 1])) / (x[i] - x[i - 1]);
};
const stats = (id, name, start) => {
  const t = v(id, 'time').real,
    y = v(id, name).real;
  let sum = 0,
    sq = 0,
    dtSum = 0,
    min = Infinity,
    max = -Infinity;
  for (let i = 1; i < t.length; i++) {
    if (t[i - 1] < start) continue;
    const dt = t[i] - t[i - 1];
    sum += ((y[i] + y[i - 1]) * dt) / 2;
    sq += ((y[i] ** 2 + y[i] * y[i - 1] + y[i - 1] ** 2) * dt) / 3;
    dtSum += dt;
    min = Math.min(min, y[i]);
    max = Math.max(max, y[i]);
  }
  return { mean: sum / dtSum, rms: Math.sqrt(sq / dtSum), min, max };
};
close(v('divider', 'out').real[0], 2.5, 1e-9, 'Divider output');
close(v('divider', 'v1#branch').real[0], -0.0025, 1e-10, 'Source current sign');
close(v('dc-sweep', 'out').real.at(-1), 5, 1e-9, 'DC sweep endpoint');
close(at('rc-step', 'out', 0.001), 1 - Math.exp(-1), 0.001, 'RC time constant');
for (const id of ['rc-ac', 'amp-ac']) {
  const f = v(id, 'frequency').real,
    o = v(id, 'out'),
    i = f.findIndex((x) => x >= 999);
  const g = Math.hypot(o.real[i], o.imaginary[i]);
  close(
    g,
    id === 'rc-ac'
      ? 1 / Math.sqrt(1 + (2 * Math.PI * f[i] * 0.001) ** 2)
      : 0.891736,
    0.003,
    id + ' gain',
  );
}
for (const [n, e] of Object.entries({
  base: 1.0234856,
  collector: 10.2800129,
  emitter: 9.5475756,
  out: 0,
  'vcc#branch': -0.02204438,
}))
  close(v('amp-bias', n).real[0], e, 1e-6, 'Amplifier bias ' + n);
const amp = stats('amp-small-signal', 'out', 0.008),
  clip = stats('amp-clipping', 'out', 0.008),
  rect = stats('rectifier', 'out', 0.16),
  filter = stats('logic-filter', 'filtered', 0.004);
close(amp.rms, 0.0063041, 0.00005, 'Small-signal RMS');
close(clip.min, -0.16215, 0.005, 'Clipped negative peak');
close(clip.max, 0.38856, 0.005, 'Clipped positive peak');
close(rect.mean, 3.90247, 0.01, 'Rectifier mean');
close(rect.max - rect.min, 0.68389, 0.01, 'Rectifier ripple');
close(filter.mean, 1.24224, 0.01, 'PWM filter mean');
close(filter.max - filter.min, 0.10767, 0.01, 'PWM ripple');
close(v('rc-tf', 'Transfer_function').real[0], 1, 1e-9, 'RC DC transfer');
close(v('rc-pz', 'pole(1)').real[0], -1000, 1e-6, 'RC pole');
close(
  v('rc-noise', 'onoise_total').real[0],
  6.42118e-8,
  1e-10,
  'Integrated RC noise',
);
for (const [t, e] of [
  [0.25, 5],
  [0.75, 5],
  [1.25, 5],
  [1.75, 0],
])
  close(at('logic-nand', 'y', t * 1e-6), e, 0.01, 'NAND truth table at ' + t);
close(at('logic-buffer', 'y', 0.8e-6), 5, 0.01, 'Buffer high');
close(at('logic-hazard', 'y', 0.55e-6), 5, 0.01, 'Hazard pulse');
close(at('logic-hazard', 'y', 0.8e-6), 0, 0.01, 'Hazard settles');
close(at('logic-dff', 'q', 0.8e-6), 5, 0.01, 'DFF captures');
close(at('logic-dff', 'q', 2.8e-6), 0, 0.01, 'DFF next data');
close(at('logic-dff', 'q', 6.2e-6), 0, 0.01, 'Asynchronous reset');
for (let i = 0; i < 16; i++) {
  const count = [0, 1, 2, 3].reduce(
    (n, k) =>
      n + (at('logic-counter', 'q' + k, (i + 0.8) * 1e-6) > 2.5 ? 2 ** k : 0),
    0,
  );
  close(count, (i + 1) % 16, 0, 'Counter state ' + i);
}
close(at('logic-unknown', 'y', 1.5e-6), 2.5, 0.01, 'Unknown-state mapping');
close(
  Math.max(...v('controlled-source', 'out').real),
  2,
  0.001,
  'Controlled gain',
);
for (const [id, min, max] of [
  ['dc', 5, 5],
  ['sine', -1, 3],
  ['pulse', 0, 5],
  ['triangle', -1, 1],
  ['pwl', 0, 3],
  ['exponential', 0, 4.99],
  ['fm', -1, 1],
  ['current', -1, 0],
]) {
  const y = v('source-' + id, 'out').real;
  close(Math.min(...y), min, 0.02, id + ' min');
  close(Math.max(...y), max, 0.03, id + ' max');
}
const walk = async (dir) =>
  (
    await Promise.all(
      (
        await fs.readdir(dir, { withFileTypes: true })
      ).map((e) =>
        e.isDirectory()
          ? walk(path.join(dir, e.name))
          : [path.join(dir, e.name)],
      ),
    )
  ).flat();
const all = await walk('tutorials');
let links = 0;
for (const file of all.filter((f) => f.endsWith('.md'))) {
  const text = await fs.readFile(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    check(
      (
        await fs.stat(
          path.resolve(path.dirname(file), decodeURIComponent(target)),
        )
      ).isFile(),
      file + ' -> ' + target,
    );
    links++;
  }
}
const power = (id) => {
  const o = stats(id, 'out', 0.008),
    s = stats(id, 'vcc#branch', 0.008),
    input = -12 * s.mean,
    load = o.rms ** 2 / 8;
  return {
    inputWatts: input,
    loadWatts: load,
    efficiencyPercent: (100 * load) / input,
    windowSeconds: [0.008, 0.012],
  };
};
const report = {
  date: new Date().toISOString(),
  checks,
  links,
  drawings: records.length,
  engine: 'bundled ngspice 47 (native)',
  measurements: {
    smallSignal: amp,
    clipped: clip,
    rectifier: rect,
    pwmFilter: filter,
    smallSignalPower: power('amp-small-signal'),
    clippedPower: power('amp-clipping'),
  },
  records,
};
await fs.writeFile(
  'tutorials/verification.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify({ checks, links, drawings: records.length }));
