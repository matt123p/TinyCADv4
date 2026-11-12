import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutRuntime } from './lib/layout-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const value = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
if (args.includes('--help')) {
  console.log(
    'node scripts/layout-drawing.mjs --input drawing.dsn|drawing.dzn [--output-dir build/layout-review] [--disturbance low|medium|high] [--max-evaluations 2500] [--annealing-steps 0] [--analyse-only]',
  );
  process.exit(0);
}
const options = {
  disturbance: value('--disturbance', 'medium'),
  maxEvaluations: Number(value('--max-evaluations', '2500')),
  annealingSteps: Number(value('--annealing-steps', '0')),
};
if (!value('--input') || value('--input').startsWith('--'))
  throw Error('Specify a drawing with --input path/to/design.dsn (or .dzn)');
const inputs = [path.resolve(value('--input'))];
const output = path.resolve(
  value('--output-dir', path.join(root, 'build/layout-review')),
);
// Refuse any output location that could overwrite a source drawing.
for (const input of inputs)
  if (path.dirname(input).toLowerCase() === output.toLowerCase())
    throw Error('Output directory must differ from the source directory');
await fs.mkdir(output, { recursive: true });
const api = await layoutRuntime(),
  reports = [];
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        c
      ]),
  );
const cards = [];
for (const input of inputs) {
  const bytes = await fs.readFile(input),
    drawing = await api.decodeDrawing(bytes),
    name = path.basename(input, path.extname(input));
  const updated = { ...drawing, sheets: [...drawing.sheets] };
  for (const [index, sheet] of drawing.sheets.entries()) {
    if (sheet.kind === 'simulation' || sheet.hierarchicalSymbol) continue;
    const start = performance.now();
    const result = args.includes('--analyse-only')
      ? {
          sheet,
          before: api.analyseLayout(sheet, options),
          after: api.analyseLayout(sheet, options),
          changes: [],
          evaluations: 0,
          stopped: 'analysis',
          connectivityPreserved: true,
        }
      : api.optimiseLayout(sheet, options);
    updated.sheets[index] = result.sheet;
    const report = {
      input,
      sheet: sheet.name,
      options,
      changes: result.changes.map((c) => ({
        id: c.id,
        kind: c.after?.NodeName,
        added: !c.before,
      })),
      before: result.before,
      after: result.after,
      evaluations: result.evaluations,
      stopped: result.stopped,
      connectivityPreserved: result.connectivityPreserved,
      milliseconds: Math.round(performance.now() - start),
    };
    reports.push(report);
    const id = `${name}-${index + 1}`,
      b = api.circuitBounds(sheet),
      a = api.circuitBounds(result.sheet);
    const bounds = {
      x1: Math.min(a.x1, b.x1),
      y1: Math.min(a.y1, b.y1),
      x2: Math.max(a.x2, b.x2),
      y2: Math.max(a.y2, b.y2),
    };
    const before = api.renderCircuit(sheet, bounds),
      after = api.renderCircuit(result.sheet, bounds);
    await fs.writeFile(path.join(output, id + '-before.svg'), before);
    await fs.writeFile(path.join(output, id + '-after.svg'), after);
    const metrics = [
      'wireBodyCollisions',
      'pinExitViolations',
      'textCollisions',
      'labelOverhangs',
      'netLabelPosition',
      'labelAlignment',
      'bends',
      'junctionIssues',
      'bundleDisorder',
      'annotationCrowding',
      'componentDisorder',
      'connectedDistance',
      'wireLength',
      'area',
    ];
    cards.push(
      `<article><h2>${escape(id)} · ${escape(sheet.name)}</h2><p>${
        result.changes.length
      } changed items · ${result.evaluations} proposals · ${escape(
        result.stopped,
      )} · electrical and physical connectivity preserved</p><div class="pair"><figure><figcaption>Before</figcaption>${before}</figure><figure><figcaption>Proposal (same scale)</figcaption>${after}</figure></div><table><tr><th>Metric</th><th>Before</th><th>After</th></tr>${metrics
        .map(
          (k) =>
            `<tr><td>${k}</td><td>${report.before.metrics[k].toFixed(
              1,
            )}</td><td>${report.after.metrics[k].toFixed(1)}</td></tr>`,
        )
        .join('')}</table><details><summary>${
        report.after.diagnostics.length
      } remaining diagnostics</summary><pre>${escape(
        JSON.stringify(report.after.diagnostics, null, 2),
      )}</pre></details></article>`,
    );
    console.log(
      `${id}: ${
        result.changes.length
      } changes; wire length ${report.before.metrics.wireLength.toFixed(
        0,
      )} → ${report.after.metrics.wireLength.toFixed(0)}; ${
        report.milliseconds
      } ms`,
    );
  }
  if (!args.includes('--analyse-only')) {
    const encoded = await api.encodeDrawing(
      updated,
      path.extname(input).toLowerCase() === '.dzn' ? 'zip-v1' : 'xml',
    );
    // Check the serialized proposal too, since this is what an external caller consumes.
    const reopened = await api.decodeDrawing(encoded);
    for (let i = 0; i < drawing.sheets.length; i++)
      if (drawing.sheets[i].kind !== 'simulation') {
        // DSN IDs are session-local and reassigned by decoding. Match stable item
        // order after serialization before comparing terminal partitions.
        const aligned = {
          ...reopened.sheets[i],
          items: reopened.sheets[i].items.map((item, j) => ({
            ...item,
            _id: updated.sheets[i].items[j]?._id,
          })),
        };
        if (
          aligned.items.length !== updated.sheets[i].items.length ||
          !api.sameConnectivity(updated.sheets[i], aligned)
        )
          throw Error(
            'Saved proposal failed connectivity validation: ' + input,
          );
      }
    await fs.writeFile(
      path.join(output, name + '-proposal' + path.extname(input)),
      encoded,
    );
  }
}
await fs.writeFile(
  path.join(output, 'report.json'),
  JSON.stringify(reports, null, 2) + '\n',
);
await fs.writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>TinyCAD layout review</title><style>body{font:15px system-ui;margin:24px;background:#eef2f6;color:#172a40}article{background:white;padding:20px;margin:20px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;overflow:auto}svg{max-width:100%;height:auto}figcaption{font-weight:bold;margin:10px 0}td,th{text-align:left;padding:4px 18px 4px 0}pre{white-space:pre-wrap}summary{cursor:pointer}</style><h1>TinyCAD layout proposals</h1><p>Original files are unchanged. Disturbance: ${escape(
    options.disturbance,
  )}. Each pair uses the same component scale. These are local optimisation proposals; remaining diagnostics require review.</p>${cards.join(
    '\n',
  )}`,
);
console.log('Review: ' + path.join(output, 'index.html'));
