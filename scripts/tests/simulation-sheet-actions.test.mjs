import { test } from 'node:test';
import { runRegression } from './run-regression.mjs';

test('duplicating a simulation sheet copies its setup without results in one action', async () => {
  await runRegression(`
    import assert from 'node:assert/strict';
    import { DocStoreReducer } from './src/state/stores/docStoreReducer';
    let state = DocStoreReducer(undefined, { type: '@@INIT' });
    state = DocStoreReducer(state, { type: 'simulation/add', name: 'Experiment' });
    const sheet = state.drawing.sheets[state.view.selected_sheet];
    sheet.simulation.parameters = { resistance: '10k' };
    sheet.simulation.instructions = 'Compare the response';
    sheet.simulation.models = { 'device.lib': '.model test D' };
    sheet.simulation.runs = [{ id: 'run1', dataState: 'available' }];
    const copy = DocStoreReducer(state, { type: 'simulation/duplicate', sheetId: sheet.id });
    const added = copy.drawing.sheets[copy.view.selected_sheet];
    assert.notEqual(added.id, sheet.id);
    assert.equal(added.name, 'Experiment copy');
    assert.deepEqual(added.simulation, { ...sheet.simulation, runs: [] });
    assert.equal(sheet.simulation.runs.length, 1);
    assert.equal(copy.drawingVersion, state.drawingVersion + 1);
    const repeated = DocStoreReducer(copy, { type: 'simulation/duplicate', sheetId: sheet.id });
    assert.equal(repeated.drawing.sheets.at(-1).name, 'Experiment copy (2)');
    assert.equal(DocStoreReducer(state, { type: 'simulation/duplicate', sheetId: 'missing' }), state);
    assert.equal(DocStoreReducer(state, { type: 'simulation/duplicate', sheetId: state.drawing.sheets[0].id }), state);
  `);
});
