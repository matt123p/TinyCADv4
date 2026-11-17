import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { tutorialRuntime, spiceLibrary } from './tutorials/runtime.mjs';
import { circuit } from './tutorials/circuits.mjs';
import { digitalCircuit } from './tutorials/digital.mjs';
import { runNgspice } from './tests/ngspice-runner.mjs';
const api = await tutorialRuntime(),
  library = await spiceLibrary(),
  engine = JSON.parse(await fs.readFile('build/engines/native/manifest.json'));
const ids = [
  'controlled-source',
  'divider',
  'dc-sweep',
  ...[
    'dc',
    'sine',
    'pulse',
    'triangle',
    'pwl',
    'exponential',
    'fm',
    'current',
  ].map((s) => 'source-' + s),
  'rc-step',
  'rc-ac',
  'rectifier',
  'amp-bias',
  'amp-ac',
  'amp-small-signal',
  'amp-clipping',
  'rc-noise',
  'rc-tf',
  'rc-pz',
  'logic-buffer',
  'logic-nand',
  'logic-hazard',
  'logic-dff',
  'logic-counter',
  'logic-filter',
  'logic-unknown',
];
const chosen = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1].split(',')
  : ids;
const report = [];
const existing = process.argv.includes('--existing');
const layoutOptions = {
  disturbance: 'high',
  maxEvaluations: 8000,
  nativeWireJunctions: true,
};
for (const id of chosen) {
  const course = id.startsWith('logic-') ? 'xspice' : 'spice',
    dir = 'tutorials/' + course;
  await fs.mkdir(dir + '/circuits', { recursive: true });
  await fs.mkdir(dir + '/images', { recursive: true });
  await fs.mkdir('build/tutorials/results', { recursive: true });
  try {
    const result = existing
      ? {
          drawing: await api.decodeDrawing(
            await fs.readFile(dir + '/circuits/' + id + '.dzn'),
          ),
        }
      : (course === 'xspice' ? digitalCircuit : circuit)(api, library, id);
    const originalSheet = result.drawing.sheets[0];
    const simulationBefore = JSON.stringify(result.drawing.sheets.slice(1));
    const layout = api.optimiseLayout(originalSheet, layoutOptions);
    assert.ok(
      layout.connectivityPreserved &&
        api.sameConnectivity(originalSheet, layout.sheet, layout.wireOrigins),
      id + ': auto-layout must preserve electrical and physical connectivity',
    );
    result.drawing.sheets[0] = layout.sheet;
    assert.equal(
      JSON.stringify(result.drawing.sheets.slice(1)),
      simulationBefore,
      id + ': auto-layout must preserve simulation setup and results',
    );
    await fs.mkdir('build/tutorials/layout', { recursive: true });
    const beforeBounds = api.circuitBounds(originalSheet),
      afterBounds = api.circuitBounds(layout.sheet);
    const reviewBounds = {
      x1: Math.min(beforeBounds.x1, afterBounds.x1),
      y1: Math.min(beforeBounds.y1, afterBounds.y1),
      x2: Math.max(beforeBounds.x2, afterBounds.x2),
      y2: Math.max(beforeBounds.y2, afterBounds.y2),
    };
    await fs.writeFile(
      'build/tutorials/layout/' + id + '-before.svg',
      api.renderCircuit(originalSheet, reviewBounds),
    );
    await fs.writeFile(
      'build/tutorials/layout/' + id + '-after.svg',
      api.renderCircuit(layout.sheet, reviewBounds),
    );
    const bytes = await api.encodeDrawing(result.drawing, 'zip-v1');
    const drawing = await api.decodeDrawing(bytes);
    const expected = result.drawing.sheets[0],
      loaded = drawing.sheets[0],
      aligned = {
        ...loaded,
        items: loaded.items.map((i, j) => ({
          ...i,
          _id: expected.items[j]._id,
        })),
      };
    if (!api.sameConnectivity(expected, aligned))
      throw Error('Roundtrip connectivity ' + id);
    if (
      loaded.items.some((i) => i.NodeName === 'wire' && i.d_points.length !== 2)
    )
      throw Error('Non-native wire');
    const sim = drawing.sheets.find((s) => s.kind === 'simulation'),
      net = new api.NetlistWorkerState().init(drawing),
      deck = api.buildDeck(net, sim.simulation),
      deckFile = path.resolve('build/tutorials/' + id + '.cir');
    await fs.writeFile(deckFile, deck);
    const run = runNgspice(deckFile);
    if (run.status) throw Error(run.log);
    const plots = [];
    let plot;
    for (const e of run.events) {
      if (e.type === 'vectors') {
        plot = {
          vectors: e.names.map((name) => ({
            name,
            unit: api.vectorUnit(name),
            real: [],
          })),
          scale: e.names.includes('time')
            ? 'time'
            : e.names.includes('frequency')
            ? 'frequency'
            : e.names.includes('v-sweep')
            ? 'v-sweep'
            : e.names[0],
        };
        plots.push(plot);
      }
      if (e.type === 'data')
        for (let j = 0; j < e.rows.length; j++)
          for (let i = 0; i < e.rows[j].length; i++) {
            plot.vectors[i].real.push(e.rows[j][i]);
            if (e.imaginary) {
              plot.vectors[i].imaginary ??= [];
              plot.vectors[i].imaginary.push(e.imaginary[j][i]);
            }
          }
    }
    if (!plots.length || !plots[0].vectors[0]?.real.length)
      throw Error('No results');
    const data = {
      ...plots[0],
      log: run.log,
      ...(plots.length > 1 ? { plots: plots.slice(1) } : {}),
    };
    const hash = (text) => createHash('sha256').update(text).digest('hex'),
      setup = sim.simulation,
      runId = randomUUID();
    api.putResult(runId, data);
    setup.runs = [
      {
        id: runId,
        created: new Date().toISOString(),
        state: 'complete',
        backend: 'native',
        buildId: engine.buildId,
        circuitHash: hash(deck + JSON.stringify(setup.models)),
        setupHash: hash(
          JSON.stringify({
            analysis: setup.analysis,
            parameters: setup.parameters,
            models: setup.models,
          }),
        ),
        analysis: { ...setup.analysis },
        parameters: { ...setup.parameters },
        samples: data.vectors[0].real.length,
        pinned: false,
        dataState: 'available',
      },
    ];
    await fs.writeFile(
      dir + '/circuits/' + id + '.dzn',
      await api.encodeDrawing(drawing, 'zip-v1'),
    );
    await fs.writeFile(dir + '/circuits/' + id + '.cir', deck);
    const svg = api.renderCircuit(loaded);
    await fs.writeFile(dir + '/images/' + id + '-circuit.svg', svg);
    await sharp(Buffer.from(svg))
      .resize({ width: 1400 })
      .png()
      .toFile(dir + '/images/' + id + '-circuit.png');
    await fs.writeFile(
      'build/tutorials/results/' + id + '.json',
      JSON.stringify(data),
    );
    const summary = {
      id,
      course,
      analysis: setup.analysis,
      signals: setup.signals,
      samples: setup.runs[0].samples,
      roundTrip: true,
      layout: {
        options: layoutOptions,
        changes: layout.changes.length,
        before: layout.before,
        after: layout.after,
        stopped: layout.stopped,
        evaluations: layout.evaluations,
      },
      plots: plots.map((p) => ({
        scale: p.scale,
        vectors: p.vectors.map((v) => ({
          name: v.name,
          first: v.real[0],
          last: v.real.at(-1),
          min: Math.min(...v.real),
          max: Math.max(...v.real),
        })),
      })),
    };
    report.push(summary);
    console.log(
      id +
        ' OK ' +
        summary.samples +
        ' samples; ' +
        layout.changes.length +
        ' layout changes; wire length ' +
        layout.before.metrics.wireLength +
        ' -> ' +
        layout.after.metrics.wireLength,
    );
  } catch (e) {
    console.error(id + ' FAILED ' + e.message);
    process.exitCode = 1;
    report.push({ id, error: e.message });
  }
}
await fs.writeFile(
  'build/tutorials/report' + (chosen !== ids ? '-partial' : '') + '.json',
  JSON.stringify(report, null, 2) + '\n',
);
if (report.every((entry) => !entry.error)) {
  const reportPath = 'tutorials/layout-verification.json';
  const previous =
    chosen !== ids
      ? JSON.parse(
          await fs.readFile(reportPath, 'utf8').catch(() => '{"drawings":[]}'),
        ).drawings
      : [];
  const current = report.map(({ id, course, layout }) => ({
    id,
    course,
    ...layout,
  }));
  const drawings = [
    ...previous.filter((entry) => !chosen.includes(entry.id)),
    ...current,
  ].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        tool: 'src/layout/optimise.ts',
        connectivityChecked: true,
        roundTripChecked: true,
        drawings,
      },
      null,
      2,
    ) + '\n',
  );
}
