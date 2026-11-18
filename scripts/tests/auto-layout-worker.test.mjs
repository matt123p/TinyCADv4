import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLayoutModule } from './layout-module.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();

function workerHarness({ optimise = api.optimiseLayout, loadFont = async face => face } = {}) {
  const responses = [], fonts = [], faces = [], calls = [];
  const { sandbox } = loadLayoutModule('src/web-worker/main.ts', {
    '../layout': { optimiseLayout(sheet, options) {
      assert.equal(fonts.length, 3, 'register bundled fonts before measuring the layout');
      calls.push({ sheet, options });
      return optimise(sheet, options);
    } },
    './netlistState': { NetlistWorkerState: class {
      init(drawing) { return { drawing }; }
      update(sheets, removedSheets) { return { sheets, removedSheets }; }
      get() { return { nets: {} }; }
    } },
  }, {
    onmessage: null,
    postMessage: response => responses.push(structuredClone(response)),
    fonts: { add: face => fonts.push(face) },
    FontFace: class {
      constructor(family, source) { this.family = family; this.source = source; faces.push(this); }
      load() { return loadFont(this); }
    },
  });
  return { responses, fonts, faces, calls,
    send: request => sandbox.onmessage({ data: structuredClone(request) }),
  };
}

function circuit() {
  const font = { font_name: 'Arial', font_size: 9, font_bold: false, font_italic: false, font_colour: '#000000' };
  return { ...api.blank().sheets[0], items: [
    { NodeName: 'wire', _id: 1, d_points: [[100, 100], [300, 100]], _magnetic: null },
    api.refresh({ ...font, NodeName: 'label', _id: 2, point: [101, 100], rotation: 0, which: 0, text: 'SIGNAL', textData: null }),
    { NodeName: 'wire', _id: 3, d_points: [[100, 300], [300, 300]], _magnetic: null },
    api.refresh({ ...font, NodeName: 'label', _id: 4, point: [101, 300], rotation: 0, which: 0, text: 'OTHER', textData: null }),
  ] };
}

for (const disturbance of ['low', 'medium', 'high']) {
  test(`worker runs the real optimiser at ${disturbance}, preserving unselected geometry`, async () => {
    const h = workerHarness(), source = circuit(), before = JSON.stringify(source);
    const options = { disturbance, selectedIds: [2] };
    await h.send({ id: 17, command: 'auto-layout', payload: { sheet: source, options } });
    const response = h.responses[0];
    assert.equal(response.id, 17);
    assert.equal(response.ok, true);
    assert.equal(response.data.connectivityPreserved, true);
    assert.ok(response.data.changes.length, 'fixture must produce a visible improvement');
    assert.ok(response.data.changes.every(c => c.id === 2));
    assert.deepEqual(h.calls[0].options, options);
    const after = { ...source, items: source.items.map(item => response.data.changes.find(c => c.id === item._id)?.after ?? item) };
    assert.ok(api.sameConnectivity(source, after));
    assert.equal(JSON.stringify(source), before, 'worker cannot mutate the source');
    assert.equal('sheet' in response.data, false, 'return changes instead of replacing the full sheet');
  });
}

test('whole-sheet worker request includes both circuit sections', async () => {
  const h = workerHarness(), source = circuit();
  await h.send({ id: 1, command: 'auto-layout', payload: { sheet: source, options: { disturbance: 'high' } } });
  assert.equal(h.responses[0].ok, true);
  const ids = h.responses[0].data.changes.map(c => c.id);
  assert.ok(ids.includes(2)); assert.ok(ids.includes(4));
});

test('worker shares font initialization across requests and waits for loading', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = workerHarness({ loadFont: face => gate.then(() => face) });
  const request = id => ({ id, command: 'auto-layout', payload: { sheet: circuit(), options: { selectedIds: [] } } });
  const first = h.send(request(1)), second = h.send(request(2));
  assert.equal(h.calls.length, 0); assert.equal(h.responses.length, 0);
  assert.equal(h.faces.length, 3, 'one font load per face');
  assert.deepEqual(h.faces.map(f => f.family), ['Arial', 'Courier New', 'Times New Roman']);
  for (const face of h.faces) assert.match(face.source, /styles\/fonts\/Liberation.+-Regular\.ttf/);
  release(); await Promise.all([first, second]);
  assert.equal(h.fonts.length, 3); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.responses.map(r => r.id).sort(), [1, 2]);
  assert.ok(h.responses.every(r => r.ok && r.data.changes.length === 0));
});

test('font loading failure returns an error without invoking the optimiser', async () => {
  const h = workerHarness({ loadFont: () => Promise.reject(new Error('Font unavailable')) });
  await h.send({ id: 8, command: 'auto-layout', payload: { sheet: circuit(), options: {} } });
  assert.deepEqual(h.responses, [{ id: 8, ok: false, error: 'Font unavailable' }]);
  assert.equal(h.calls.length, 0);
});

test('optimiser errors are returned and do not break subsequent worker requests', async () => {
  const h = workerHarness({ optimise() { throw new Error('Layout invariant failed: connectivity changed'); } });
  await h.send({ id: 1, command: 'auto-layout', payload: { sheet: circuit(), options: {} } });
  assert.equal(h.responses[0].ok, false);
  assert.match(h.responses[0].error, /connectivity changed/);
  await h.send({ id: 2, command: 'netlist-get' });
  assert.deepEqual(h.responses[1], { id: 2, ok: true, data: { nets: {} } });
});

test('adding auto-layout preserves netlist commands and unknown-command errors', async () => {
  const h = workerHarness();
  for (const request of [
    { id: 1, command: 'netlist-init', payload: { drawing: { sheets: [] } } },
    { id: 2, command: 'netlist-update', payload: {} },
    { id: 3, command: 'netlist-get' },
    { id: 4, command: 'netlist', payload: { sheets: [] } },
    { id: 5, command: 'unknown' },
  ]) await h.send(request);
  assert.deepEqual(h.responses, [
    { id: 1, ok: true, data: { drawing: { sheets: [] } } },
    { id: 2, ok: true, data: { sheets: [], removedSheets: [] } },
    { id: 3, ok: true, data: { nets: {} } },
    { id: 4, ok: true, data: { drawing: { sheets: [] } } },
    { id: 5, ok: false, error: 'Unknown worker command: unknown' },
  ]);
  assert.equal(h.faces.length, 0, 'netlist requests need no layout fonts');
});

for (const environment of ['document', 'worker']) {
  test(`text measurement uses and reuses a canvas in the ${environment}`, () => {
    let created = 0;
    const measurements = [];
    const context = { font: '', measureText(text) {
      measurements.push([this.font, text]);
      return { width: text.length * 7, actualBoundingBoxDescent: 3 };
    } };
    const canvas = { getContext: type => { assert.equal(type, '2d'); return context; } };
    const globals = environment === 'document'
      ? { document: { createElement: type => { assert.equal(type, 'canvas'); created++; return canvas; } } }
      : { OffscreenCanvas: class { constructor() { created++; } getContext(type) { return canvas.getContext(type); } } };
    const { exports: measure } = loadLayoutModule('src/util/measureText.ts', {}, globals);
    assert.equal(measure.measureText('9px Arial', 'SIGNAL'), 42);
    assert.equal(measure.measureText('12px Courier New', 'OUT'), 21);
    assert.equal(measure.measureTextOffset('10px Times New Roman'), 3);
    assert.equal(created, 1);
    assert.deepEqual(measurements, [
      ['9px Arial', 'SIGNAL'], ['12px Courier New', 'OUT'], ['10px Times New Roman', 'gyEW'],
    ]);
  });
}
