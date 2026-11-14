import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  drawingOpenMenu,
  drawingViewMenu,
} from '../../electron/drawingMenus.js';
import { loadComponent } from './load-component.mjs';

const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const label = (_key, fallback) => fallback;
const off = {
  hasExampleExplanation: false,
  exampleExplanationVisible: false,
  simulationPanelVisible: false,
};

test('Electron places Open Recent, separator, Open Example, separator before Save', () => {
  const sent = [],
    recent = [{ label: 'My drawing' }];
  const items = drawingOpenMenu(label, recent, (command) => sent.push(command));
  assert.deepEqual(
    items.map((i) => i.type || i.label),
    ['Open Recent', 'separator', 'Open Example', 'separator'],
  );
  assert.equal(items[0].submenu, recent);
  items[2].click();
  assert.deepEqual(sent, ['file-open-example']);
  assert.equal(
    drawingOpenMenu(label, [], () => {})[0].submenu[0].enabled,
    false,
  );
});

test('Electron View items lead the menu and follow explanation/chart availability and visibility', () => {
  const sent = [];
  let items = drawingViewMenu(label, off, false, (command) =>
    sent.push(command),
  );
  assert.deepEqual(
    items.map((i) => (i.type === 'separator' ? 'separator' : i.label)),
    ['View Explanation', 'Show Charts', 'separator', 'Zoom In', 'Zoom Out'],
  );
  assert.equal(items[0].enabled, false);
  assert.equal(items[0].checked, false);
  assert.equal(items[1].enabled, true);
  assert.equal(items[1].checked, false);
  items = drawingViewMenu(
    label,
    {
      hasExampleExplanation: true,
      exampleExplanationVisible: true,
      simulationPanelVisible: true,
    },
    false,
    (command) => sent.push(command),
  );
  assert.equal(items[0].enabled, true);
  assert.equal(items[0].checked, true);
  assert.equal(items[1].checked, true);
  items[0].click();
  items[1].click();
  assert.deepEqual(sent, ['view-explanation', 'view-show-charts']);
  const library = drawingViewMenu(label, off, true, () => {});
  assert.equal(library[0].enabled, false);
  assert.equal(library[1].enabled, false);
});

test('native View commands toggle current Redux panel state and ignore unavailable explanations', () => {
  const { handleMenuCommand } = loadComponent('src/io/files.tsx', {});
  const state = {
    docStore: { present: { editLibrary: null, editSymbol: null } },
    altStore: {
      exampleExplanation: null,
      exampleExplanationVisible: false,
      simulationPanelVisible: false,
    },
  };
  const actions = [],
    dispatch = (action) => actions.push(action),
    run = (command) => handleMenuCommand(command)(dispatch, () => state);
  run('view-explanation');
  assert.equal(actions.length, 0);
  state.altStore.exampleExplanation = { id: 'example' };
  run('view-explanation');
  assert.deepEqual(actions.pop(), {
    type: 'example/explanation',
    visible: true,
  });
  state.altStore.exampleExplanationVisible = true;
  run('view-explanation');
  assert.deepEqual(actions.pop(), {
    type: 'example/explanation',
    visible: false,
  });
  run('view-show-charts');
  assert.deepEqual(actions.pop(), { type: 'simulation/panel', visible: true });
  state.altStore.simulationPanelVisible = true;
  run('view-show-charts');
  assert.deepEqual(actions.pop(), { type: 'simulation/panel', visible: false });
  state.docStore.present.editLibrary = {};
  run('view-explanation');
  run('view-show-charts');
  assert.equal(actions.length, 0);
});

test('Tools Auto-layout opens the existing dialog only for an editable schematic', () => {
  const actions = [];
  const { handleMenuCommand } = loadComponent('src/io/files.tsx', {
    '../state/dispatcher/AppDispatcher': {
      actionSelectDialog: (dialog, props) => ({
        type: 'dialog',
        dialog,
        props,
      }),
    },
  });
  const present = {
    editLibrary: null,
    editSymbol: null,
    drawing: { sheets: [{ kind: 'schematic' }] },
    view: { selected_sheet: 0 },
  };
  const state = { docStore: { present }, altStore: {} };
  const run = () =>
    handleMenuCommand('tools-auto-layout')(
      (action) => actions.push(action),
      () => state,
    );
  run();
  assert.deepEqual(actions.pop(), {
    type: 'dialog',
    dialog: 'auto_layout',
    props: null,
  });
  present.editLibrary = {};
  run();
  assert.equal(actions.length, 0);
  present.editLibrary = null;
  present.editSymbol = {};
  run();
  assert.equal(actions.length, 0);
  present.editSymbol = null;
  present.drawing.sheets[0].kind = 'simulation';
  run();
  assert.equal(actions.length, 0);
  present.view.selected_sheet = -1;
  run();
  assert.equal(actions.length, 0);
});

test('browser title bar opens examples and shows the explanation toggle only when available', () => {
  const actions = [];
  const { Topbar } = loadComponent('src/components/toolbar/topbar.tsx', {
    react: {
      ...React,
      useState: (v) => [v, () => {}],
      useEffect: () => {},
      useRef: () => ({ current: null }),
      useCallback: (fn) => fn,
    },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '../../state/dispatcher/AppDispatcher': {
      actionSelectDialog: (dialog, props) => ({
        type: 'dialog',
        dialog,
        props,
      }),
    },
  });
  const props = {
    user: { name: 'User' },
    file: { name: 'Drawing.dsn' },
    saveNeeded: false,
    dispatch: (a) => actions.push(a),
    canOpenExamples: true,
    hasExampleExplanation: false,
    exampleExplanationVisible: false,
  };
  const buttons = (p) => nodes(Topbar(p)).filter((n) => n.type === 'button');
  let items = buttons(props);
  assert.equal(items.length, 1);
  items[0].props.onClick();
  assert.deepEqual(actions.pop(), {
    type: 'dialog',
    dialog: 'open_example',
    props: null,
  });
  items = buttons({ ...props, hasExampleExplanation: true });
  assert.equal(items.length, 2);
  assert.equal(items[1].props['aria-pressed'], false);
  items[1].props.onClick();
  assert.deepEqual(actions.pop(), {
    type: 'example/explanation',
    visible: true,
  });
  items = buttons({
    ...props,
    hasExampleExplanation: true,
    exampleExplanationVisible: true,
  });
  assert.equal(items[1].props['aria-pressed'], true);
  items[1].props.onClick();
  assert.deepEqual(actions.pop(), {
    type: 'example/explanation',
    visible: false,
  });
  assert.equal(buttons({ ...props, canOpenExamples: false }).length, 0);
});

test('Electron forwards current panel state to the native menu independently of file changes', () => {
  const effects = [],
    states = [];
  const { MainAppElectron } = loadComponent(
    'src/components/pages/mainAppElectron.tsx',
    {
      react: {
        ...React,
        useEffect: (effect, deps) => effects.push({ effect, deps }),
      },
    },
  );
  const previous = globalThis.window;
  globalThis.window = {
    electronAPI: { setViewMenuState: (state) => states.push(state) },
  };
  try {
    const props = {
      ...off,
      dispatch: () => {},
      file: { name: 'Drawing.dsn' },
      saveNeeded: false,
    };
    MainAppElectron(props);
    effects[1].effect();
    assert.deepEqual(states.pop(), off);
    effects.length = 0;
    MainAppElectron({
      ...props,
      hasExampleExplanation: true,
      exampleExplanationVisible: true,
      simulationPanelVisible: true,
    });
    assert.deepEqual(effects[1].deps, [true, true, true]);
    effects[1].effect();
    assert.deepEqual(states.pop(), {
      hasExampleExplanation: true,
      exampleExplanationVisible: true,
      simulationPanelVisible: true,
    });
  } finally {
    globalThis.window = previous;
  }
});
