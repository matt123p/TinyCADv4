import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent } from './load-component.mjs';
import update from 'immutability-helper';

test('simulation panel opens for simulation tools and DZN files and respects Hide / Show', () => {
  const { AltStoreReducer } = loadComponent(
    'src/state/stores/altStoreReducer.ts',
    {
      'immutability-helper': update,
      '../actions/docActions': { DocActionTypes: { SetDocument: 'load' } },
      '../../io/drawingSaveFormat': {
        hasSimulation: (drawing) => drawing.simulationContent,
      },
    },
  );
  const blank = AltStoreReducer(undefined, { type: '@@INIT' });
  assert.equal(blank.simulationPanelActivated, false);
  const load = (doc, filename) =>
    AltStoreReducer(blank, { type: 'load', doc, filename });
  for (const [doc, name] of [
    [{}, 'circuit.DZN'],
    [{ representation: 'zip-v1' }, 'circuit'],
    [{ simulationContent: true }, 'legacy.dsn'],
  ]) {
    const state = load(doc, name);
    assert.equal(state.simulationPanelVisible, true);
    assert.equal(state.simulationPanelActivated, true);
  }
  for (const type of [
    'simulation/add',
    'simulation/duplicate',
    'simulation/insert-control',
  ]) {
    const opened = AltStoreReducer(blank, { type });
    assert.equal(opened.simulationPanelVisible, true, type);
    const hidden = AltStoreReducer(opened, {
      type: 'simulation/panel',
      visible: false,
    });
    assert.equal(hidden.simulationPanelVisible, false);
    assert.equal(
      hidden.simulationPanelActivated,
      true,
      'hiding preserves mounted chart windows',
    );
    assert.equal(
      AltStoreReducer(hidden, { type: 'simulation/panel', visible: true })
        .simulationPanelVisible,
      true,
    );
  }
  assert.equal(load({}, 'ordinary.dsn').simulationPanelVisible, false);
});
