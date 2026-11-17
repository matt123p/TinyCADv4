import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { teachingNativeTools } from '../lib/teaching-native-tools.mjs';
import { runRegression } from './run-regression.mjs';

const json = async (name) => JSON.parse(await readFile(new URL('../../library-sources/inventory/' + name, import.meta.url), 'utf8'));

test('all course and experiment requirements exclude built-in equipment and source duplicates', async () => {
  const master = await json('all-symbols.json');
  const manifest = await json('library-manifest.json');
  assert.equal(master.symbols.length, 102);
  assert.equal(master.existing_tools.length, 18);
  assert.equal(manifest.totals.experiments, 214);
  for (const inventory of [master, ...manifest.libraries]) {
    const ids = new Set(inventory.symbols.map(s => s.id));
    const tools = new Map(inventory.existing_tools.map(t => [t.id, t]));
    for (const id of Object.keys(teachingNativeTools)) assert.ok(!ids.has(id), id);
    for (const tool of tools.values()) {
      assert.equal(tool.generate_symbol, false);
      assert.equal(tool.already_provided, true);
      const { native_tool, configuration } = teachingNativeTools[tool.id];
      assert.equal(tool.native_tool, native_tool);
      assert.deepEqual(tool.configuration, configuration);
    }
    for (const id of inventory.common_symbol_ids || []) assert.ok(ids.has(id), id);
    for (const experiment of inventory.experiments || []) {
      for (const id of experiment.experiment_symbol_ids) assert.ok(ids.has(id), experiment.id + ':' + id);
      for (const id of experiment.existing_tool_ids) {
        assert.ok(tools.has(id), experiment.id + ':' + id);
        assert.ok(tools.get(id).used_by_experiments.includes(experiment.id));
      }
    }
    // Similar electrical equivalents are not sufficient to drop physical or
    // arbitrary-expression interfaces that the built-in tools do not supply.
    for (const id of ['cell', 'battery']) assert.ok(ids.has(id));
  }
  for (const id of ['behavioural_current', 'behavioural_voltage', 'data_logger'])
    assert.ok(master.symbols.some(s => s.id === id));
});

test('audited native tool configurations create actual connected controls and valid templates', async () => {
  await runRegression(String.raw`
    import assert from 'node:assert/strict';
    import { teachingNativeTools } from './scripts/lib/teaching-native-tools.mjs';
    import { DocStoreReducer } from './src/state/stores/docStoreReducer';
    import { createControl, updateControl } from './src/simulation/controlSymbols';
    import { readControl, controlTemplate, compileSource } from './src/simulation/controls';
    import { instrumentInputPin } from './src/simulation/instruments';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    const before = globalThis.document;
    globalThis.document = { createElement: () => ({ getContext: () => ({ font: '', measureText: text => ({ width: String(text).length * 8, actualBoundingBoxDescent: 3 }) }) }) };
    try {
      const state = DocStoreReducer(undefined, { type: '@@INIT' });
      for (const [id, tool] of Object.entries(teachingNativeTools)) {
        const added = createControl(tool.native_tool, state.drawing.sheets[0], state.drawing);
        const config = { ...readControl(added.symbol), ...tool.configuration };
        const symbol = updateControl(added.symbol, config, state.drawing);
        assert.deepEqual(readControl(symbol), config, id);
        assert.equal(symbol.text.find(t => t.description === '$$SPICE').value, controlTemplate(config), id);
        const pins = new updateSymbol(symbol).active_points().map(p => p[2].number);
        const expected = config.kind === 'controlled' || tool.native_tool === 'scope' ? 4 : tool.native_tool === 'meter' ? 3 : tool.native_tool === 'probe' ? 1 : 2;
        assert.equal(pins.length, expected, id);
        if (config.kind === 'source') assert.ok(Number.isFinite(compileSource(config).value(0)), id);
        if (config.kind === 'instrument' && config.type === 'meter')
          assert.equal(instrumentInputPin(config), id === 'ammeter' ? '3' : '1', id);
      }
    } finally { globalThis.document = before; }
  `);
});
