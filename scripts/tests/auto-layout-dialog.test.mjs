import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadLayoutModule } from './layout-module.mjs';

const descendants = tree => !tree || typeof tree !== 'object' ? []
  : [tree, ...[tree.props?.children].flat(Infinity).flatMap(descendants)];

function dialogHarness({ items = [{ _id: 1, NodeName: 'wire' }], selectedIds = [], failure } = {}) {
  const source = { name: 'Sheet 1', items };
  const dispatched = [], workers = [], slots = [], effects = [];
  let index = 0;
  const state = { docStore: { present: {
    drawing: { sheets: [source, { name: 'Sheet 2', items: [] }] },
    view: { selected_sheet: 0, _selected_array: selectedIds },
    editSymbol: null, editLibrary: null,
  } } };
  const store = { getState: () => state, dispatch: action => dispatched.push(action) };
  const { exports: { default: Dialog } } = loadLayoutModule('src/components/dialogues/autoLayoutDlg.tsx', {
    react: { ...React,
      useId: () => 'auto-layout-test',
      useState(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = initial;
        return [slots[slot], value => { slots[slot] = value; }];
      },
      useRef(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = { current: initial };
        return slots[slot];
      },
      useEffect(effect) {
        const slot = index++;
        if (!(slot in slots)) { slots[slot] = true; effects.push(effect()); }
      },
    },
    'react-redux': { useStore: () => store, useSelector: selector => selector(state) },
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@fluentui/react-components': Object.fromEntries([
      'Button', 'Dialog', 'DialogActions', 'DialogBody', 'DialogContent', 'DialogSurface',
      'DialogTitle', 'Field', 'Radio', 'RadioGroup', 'Spinner',
    ].map(name => [name, name])),
    '../../state/stores/docStoreReducer': { activeSheet: doc => doc.drawing.sheets[doc.view.selected_sheet] },
    '../../state/dispatcher/AppDispatcher': { actionCancelDialog: () => ({ type: 'cancel-dialog' }) },
    '../../state/actions/docActions': { DocActionTypes: { ApplyAutoLayout: 'apply-layout' } },
  }, {
    Worker: class {
      constructor(url, options) {
        if (failure === 'constructor') throw new Error('Worker unavailable');
        this.url = url; this.options = options; this.terminated = false;
        workers.push(this);
      }
      postMessage(request) {
        if (failure === 'postMessage') throw new Error('Cannot clone sheet');
        this.request = structuredClone(request);
      }
      terminate() { this.terminated = true; }
      respond(data) { if (!this.terminated) this.onmessage({ data }); }
    },
  });
  const render = () => { index = 0; return Dialog(); };
  const node = (type, prop, value) => descendants(render()).find(n => n.type === type && n.props[prop] === value);
  return {
    source, state, dispatched, workers, render,
    go: () => node('Button', 'children', 'autoLayout.go').props.onClick(),
    cancel: () => node('Button', 'children', 'common.cancel').props.onClick(),
    node,
    choose: (label, value) => node('RadioGroup', 'aria-label', label).props.onChange({}, { value }),
    message: () => node('p', 'role', 'status')?.props.children,
    unmount: () => effects.forEach(cleanup => cleanup?.()),
  };
}
const success = (changes = [{ id: 1, after: { _id: 1, NodeName: 'wire' } }]) =>
  ({ ok: true, data: { connectivityPreserved: true, changes } });

test('dialog explains layout and defaults to whole sheet / medium without selection', () => {
  const h = dialogHarness();
  assert.ok(descendants(h.render()).some(n => n.props?.children === 'autoLayout.explanation'));
  assert.ok(descendants(h.render()).some(n => n.type === 'p' && n.props.children === 'autoLayout.undoNote'));
  assert.equal(h.node('Radio', 'value', 'selected').props.disabled, true);
  assert.equal(h.node('RadioGroup', 'aria-label', 'autoLayout.scope').props.value, 'whole');
  assert.equal(h.node('RadioGroup', 'aria-label', 'autoLayout.disturbance').props.value, 'medium');
  for (const level of ['high', 'medium', 'low']) {
    const radio = h.node('Radio', 'value', level);
    const description = h.node('div', 'id', radio.props['aria-describedby']);
    assert.equal(description.props.children, `autoLayout.${level}Description`);
    const option = descendants(h.render()).find(n => n.type === 'div' && n.key === level);
    assert.deepEqual(descendants(option).filter(n => n.type === 'Radio' || n.props?.id).map(n => n.type), ['Radio', 'div']);
  }
});

for (const NodeName of ['symbol', 'wire', 'label', 'power', 'noconnect', 'junction']) {
  test(`selection of a ${NodeName} enables and defaults to Selected Items`, () => {
    const h = dialogHarness({ items: [{ _id: 1, NodeName }], selectedIds: [1] });
    assert.equal(h.node('Radio', 'value', 'selected').props.disabled, false);
    assert.equal(h.node('RadioGroup', 'aria-label', 'autoLayout.scope').props.value, 'selected');
  });
}

for (const selectedIds of [[], [99], [2]]) {
  test(`unsupported or absent selected items cannot enable selection (${selectedIds})`, () => {
    const h = dialogHarness({ items: [{ _id: 1, NodeName: 'wire' }, { _id: 2, NodeName: 'rectangle' }], selectedIds });
    assert.equal(h.node('Radio', 'value', 'selected').props.disabled, true);
  });
}

for (const scope of ['whole', 'selected']) for (const disturbance of ['high', 'medium', 'low']) {
  test(`Go sends ${scope} scope and ${disturbance} level to the real worker entry point`, () => {
    const h = dialogHarness({ selectedIds: [1] });
    h.choose('autoLayout.scope', scope);
    h.choose('autoLayout.disturbance', disturbance);
    h.go();
    const worker = h.workers[0];
    assert.ok(worker.url.pathname.endsWith('/src/web-worker/main.ts'));
    assert.equal(worker.options.type, 'module');
    assert.deepEqual(worker.request, { id: 0, command: 'auto-layout', payload: {
      sheet: h.source, options: { disturbance, ...(scope === 'selected' ? { selectedIds: [1] } : {}) },
    } });
    assert.equal(h.dispatched.length, 0, 'no changes until the worker succeeds');
    h.unmount();
  });
}

test('running disables scope, levels and Go, shows progress, and prevents duplicate jobs', () => {
  const h = dialogHarness(); h.go(); h.go();
  assert.equal(h.workers.length, 1);
  assert.equal(h.node('Button', 'children', 'autoLayout.go').props.disabled, true);
  for (const label of ['autoLayout.scope', 'autoLayout.disturbance']) {
    assert.equal(h.node('RadioGroup', 'aria-label', label).props.disabled, true);
  }
  assert.ok(h.node('Spinner', 'label', 'autoLayout.running'));
  assert.ok(!h.node('Button', 'children', 'common.cancel').props.disabled);
  h.unmount();
});

test('losing the selection prevents an unintended whole-sheet run', () => {
  const h = dialogHarness({ selectedIds: [1] }); h.render();
  h.state.docStore.present.view._selected_array = [];
  assert.equal(h.node('Button', 'children', 'autoLayout.go').props.disabled, true);
  h.go(); assert.equal(h.workers.length, 0);
});

test('successful layout applies once with its original snapshot and closes', () => {
  const h = dialogHarness(); h.go();
  const result = success(); h.workers[0].respond(result);
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.dispatched.length, 2);
  assert.equal(h.dispatched[0].type, 'apply-layout');
  assert.equal(h.dispatched[0].source, h.source);
  assert.equal(h.dispatched[0].changes, result.data.changes);
  assert.equal(h.dispatched[1].type, 'cancel-dialog');
});

test('no improvements leaves the dialog open and document untouched', () => {
  const h = dialogHarness(); h.go(); h.workers[0].respond(success([]));
  assert.equal(h.message(), 'autoLayout.noChanges');
  assert.equal(h.dispatched.length, 0);
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.node('Button', 'children', 'autoLayout.go').props.disabled, false);
});

for (const scenario of ['sheet edit', 'sheet switch', 'symbol editor', 'library editor']) {
  test(`a pending result is discarded after ${scenario}`, () => {
    const h = dialogHarness(); h.go();
    const current = h.state.docStore.present;
    if (scenario === 'sheet edit') current.drawing.sheets[0] = { ...h.source };
    if (scenario === 'sheet switch') current.view.selected_sheet = 1;
    if (scenario === 'symbol editor') current.editSymbol = {};
    if (scenario === 'library editor') current.editLibrary = {};
    h.workers[0].respond(success());
    assert.equal(h.message(), 'autoLayout.sheetChanged');
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.workers[0].terminated, true);
  });
}

for (const [name, response] of [
  ['worker exception', { ok: false, error: 'Layout invariant failed' }],
  ['broken connectivity', { ok: true, data: { connectivityPreserved: false, changes: [] } }],
  ['missing data', { ok: true }],
  ['missing changes', { ok: true, data: { connectivityPreserved: true } }],
]) {
  test(`${name} displays failure without changing the document`, () => {
    const h = dialogHarness(); h.go(); h.workers[0].respond(response);
    assert.equal(h.message(), 'autoLayout.failed');
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.workers[0].terminated, true);
  });
}

for (const failure of ['constructor', 'postMessage']) {
  test(`worker ${failure} errors leave Go enabled and the document untouched`, () => {
    const h = dialogHarness({ failure }); h.go();
    assert.equal(h.message(), 'autoLayout.failed');
    assert.equal(h.node('Button', 'children', 'autoLayout.go').props.disabled, false);
    assert.equal(h.dispatched.length, 0);
    assert.ok(h.workers.every(w => w.terminated));
  });
}

test('a worker crash can be retried successfully', () => {
  const h = dialogHarness(); h.go(); h.workers[0].onerror(new Error('Worker crashed'));
  assert.equal(h.message(), 'autoLayout.failed');
  h.go(); assert.equal(h.workers.length, 2);
  assert.equal(h.message(), undefined);
  h.workers[1].respond(success());
  assert.deepEqual(h.dispatched.map(a => a.type), ['apply-layout', 'cancel-dialog']);
});

for (const running of [false, true]) {
  test(`Cancel ${running ? 'during computation' : 'before Go'} never applies changes`, () => {
    const h = dialogHarness(); if (running) h.go(); h.cancel();
    assert.deepEqual(h.dispatched.map(a => a.type), ['cancel-dialog']);
    assert.ok(h.workers.every(w => w.terminated));
    if (running) h.workers[0].respond(success());
    assert.equal(h.dispatched.length, 1);
  });
}

test('dialog dismissal and unmount stop the worker', () => {
  const h = dialogHarness(); h.go();
  h.render().props.onOpenChange({}, { open: true });
  assert.equal(h.workers[0].terminated, false);
  h.render().props.onOpenChange({}, { open: false });
  assert.equal(h.workers[0].terminated, true);
  assert.deepEqual(h.dispatched.map(a => a.type), ['cancel-dialog']);
  const unmounted = dialogHarness(); unmounted.go(); unmounted.unmount();
  assert.equal(unmounted.workers[0].terminated, true);
  assert.equal(unmounted.dispatched.length, 0);
});
