import { test } from 'node:test';
import assert from 'node:assert/strict';
import update from 'immutability-helper';
import { loadComponent } from './load-component.mjs';

function reducer() {
  return loadComponent('src/state/stores/altStoreReducer.ts', {
    'immutability-helper': update,
    '../actions/docActions': {
      DocActionTypes: { SetDocument: 'load', SetFileData: 'save' },
    },
    '../../io/drawingSaveFormat': {
      hasSimulation: (drawing) => drawing.simulationContent,
    },
  }).AltStoreReducer;
}

const item = {
  id: 'divider',
  title: 'Voltage divider',
  preview: 'divider.svg',
  descriptionPath: 'spice/01-overview.md',
};

test('example explanations toggle independently of simulation and retain their source when saved', () => {
  const reduce = reducer();
  const initial = reduce(undefined, { type: '@@INIT' });
  assert.equal(initial.exampleExplanation, null);
  assert.equal(initial.exampleExplanationVisible, false);
  assert.equal(
    reduce(initial, { type: 'example/explanation', visible: true }),
    initial,
  );

  let state = reduce(initial, {
    type: 'load',
    doc: { simulationContent: true },
    filename: 'divider.dzn',
  });
  state = reduce(state, { type: 'example/loaded', item });
  assert.equal(state.exampleExplanation, item);
  assert.equal(state.exampleExplanationVisible, false);
  state = reduce(state, { type: 'example/explanation', visible: true });
  assert.equal(state.exampleExplanationVisible, true);
  assert.equal(state.simulationPanelVisible, true);
  state = reduce(state, { type: 'simulation/panel', visible: false });
  assert.equal(state.exampleExplanationVisible, true);
  assert.equal(state.simulationPanelVisible, false);
  state = reduce(state, {
    type: 'save',
    filename: 'my-divider.dzn',
    drawingVersion: 4,
  });
  assert.equal(state.exampleExplanation, item);
  assert.equal(state.exampleExplanationVisible, true);
  const savedVersion = state.savedVersion;
  state = reduce(state, { type: 'example/explanation', visible: false });
  assert.equal(
    state.exampleExplanation,
    item,
    'Hiding must preserve the source for reopening',
  );
  assert.equal(
    state.savedVersion,
    savedVersion,
    'Panel toggles do not change saved drawing state',
  );
  state = reduce(state, { type: 'simulation/panel', visible: true });
  assert.equal(state.exampleExplanationVisible, false);
});

test('replacing the drawing clears the old explanation and the next example starts collapsed', () => {
  const reduce = reducer();
  let state = reduce(undefined, { type: 'example/loaded', item });
  state = reduce(state, { type: 'example/explanation', visible: true });
  state = reduce(state, { type: 'load', doc: {}, filename: 'other.dsn' });
  assert.equal(state.exampleExplanation, null);
  assert.equal(state.exampleExplanationVisible, false);
  const next = {
    ...item,
    id: 'filter',
    description: 'Inline filter instructions',
    descriptionPath: undefined,
  };
  state = reduce(state, { type: 'example/loaded', item: next });
  assert.equal(state.exampleExplanation, next);
  assert.equal(state.exampleExplanationVisible, false);
});
