import { runRegression } from './run-regression.mjs';

await runRegression(`
import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionCreators } from 'redux-undo';
import { DocStoreReducer } from './src/state/stores/docStoreReducer';
import { DocStoreWithHistory } from './src/state/undo/undo';
import { DocActionTypes } from './src/state/actions/docActions';
import { optimiseLayout, sameConnectivity } from './src/layout';
import { blank } from './src/io/ioXml';
import { get_global_id } from './src/util/global_id';

const wire = (id, a, b) => ({ NodeName: 'wire', _id: id, d_points: [a, b], _magnetic: null });
function fixture() {
  const initial = DocStoreReducer(undefined, { type: 'init' });
  const source = { ...blank().sheets[0], items: [
    wire(1, [100, 100], [200, 100]),
    wire(2, [200, 100], [200, 200]),
    wire(3, [200, 100], [300, 100]),
  ] };
  const other = { ...blank().sheets[0], name: 'Other sheet', items: [wire(4, [0, 0], [10, 0])] };
  const original = { ...initial, drawing: { ...initial.drawing, sheets: [source, other] },
    view: { ...initial.view, _selected_array: [1, 2, 3] } };
  const result = optimiseLayout(source, { phases: ['junctions'] });
  assert.ok(result.changes.some(c => !c.before), 'fixture creates a junction');
  const action = { type: DocActionTypes.ApplyAutoLayout, source, changes: structuredClone(result.changes) };
  return { source, other, original, action };
}
function historyFor(present, past = []) {
  return { past, present, future: [], _latestUnfiltered: present, group: null, index: past.length, limit: past.length + 1 };
}

test('applying layout preserves connectivity, unchanged identities, selection and source immutability', () => {
  const { source, other, original, action } = fixture();
  const before = JSON.stringify(original);
  const applied = DocStoreReducer(original, action);
  assert.equal(applied.drawingVersion, original.drawingVersion + 1);
  assert.equal(applied.drawing.sheets[1], other);
  for (const item of source.items) assert.equal(applied.drawing.sheets[0].items.find(i => i._id === item._id), item);
  assert.ok(sameConnectivity(source, applied.drawing.sheets[0]));
  assert.deepEqual(applied.view._selected_array, original.view._selected_array);
  assert.equal(JSON.stringify(original), before);
});

test('new segments and junctions receive globally unique IDs without breaking wire membership', () => {
  const { source, other, original } = fixture();
  const first = source.items[0];
  const changes = [
    { id: 1, before: first, after: wire(1, [100, 100], [150, 100]) },
    { id: 4, after: wire(4, [150, 100], [175, 100]) },
    { id: 5, after: wire(5, [175, 100], [200, 100]) },
    { id: 6, after: { NodeName: 'junction', _id: 6, point: [200, 100] } },
  ];
  const applied = DocStoreReducer(original, { type: DocActionTypes.ApplyAutoLayout, source, changes });
  const items = applied.drawing.sheets[0].items;
  const ids = applied.drawing.sheets.flatMap(s => s.items.map(i => i._id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(applied.drawing.sheets[1], other);
  const newWires = items.filter(i => i.NodeName === 'wire' && !source.items.some(old => old._id === i._id));
  assert.equal(newWires.length, 2);
  const origins = Object.fromEntries(newWires.map(i => [i._id, 1]));
  assert.ok(sameConnectivity(source, applied.drawing.sheets[0], origins));
  assert.ok(!ids.includes(get_global_id()), 'next editor-created object also remains unique');
});

test('applying layout clears active drawing previews and drops deleted selection IDs', () => {
  const { source, original } = fixture();
  original.view = { ...original.view, add: wire(99, [0, 0], [0, 0]), display_add: true,
    menu_command: 'add_wire', in_add_rect: true, drag: {}, hover_obj: source.items[0],
    hover_ids: [1], hover_pins: ['1'], selection_candidates: [source.items[0]] };
  const applied = DocStoreReducer(original, { type: DocActionTypes.ApplyAutoLayout, source,
    changes: [{ id: 1, before: source.items[0] }] });
  assert.deepEqual(applied.view._selected_array, [2, 3]);
  assert.equal(applied.view.add, null); assert.equal(applied.view.drag, null);
  assert.equal(applied.view.display_add, false); assert.equal(applied.view.in_add_rect, false);
  assert.equal(applied.view.menu_command, ''); assert.equal(applied.view.selection_candidates, null);
  assert.deepEqual(applied.view.hover_ids, []); assert.deepEqual(applied.view.hover_pins, []);
  assert.equal(applied.view.hover_obj, null);
  assert.ok(applied.view.tracker, 'subsequent drawing tools require a tracker');
  assert.equal(applied.view.tracker.pointToPointPreview, undefined);
});

for (const scenario of ['changed snapshot', 'different sheet', 'browser tab', 'symbol editor', 'library editor']) {
  test('reducer rejects layout after ' + scenario, () => {
    const { original, action } = fixture();
    let current = { ...original, view: { ...original.view } };
    if (scenario === 'changed snapshot') current.drawing = { ...original.drawing, sheets: [{ ...action.source }, original.drawing.sheets[1]] };
    if (scenario === 'different sheet') current.view.selected_sheet = 1;
    if (scenario === 'browser tab') current.view.selected_sheet = -1;
    if (scenario === 'symbol editor') current.editSymbol = {};
    if (scenario === 'library editor') current.editLibrary = {};
    assert.equal(DocStoreReducer(current, action), current);
  });
}

test('empty and stale results create no document changes or extra undo entries', () => {
  const { original, action } = fixture();
  assert.equal(DocStoreReducer(original, { ...action, changes: [] }), original);
  let history = DocStoreWithHistory(historyFor(original), action);
  const applied = history;
  history = DocStoreWithHistory(history, action);
  assert.equal(history, applied);
  history = DocStoreWithHistory(history, { ...action, source: history.present.drawing.sheets[0], changes: [] });
  assert.equal(history, applied);
  assert.equal(history.past.length, 1);
});

test('first edit after opening a file is one complete undo/redo transaction', () => {
  const { original, action } = fixture();
  let history = DocStoreWithHistory(historyFor(original), ActionCreators.clearHistory());
  assert.equal(history._latestUnfiltered, null);
  history = DocStoreWithHistory(history, action);
  assert.equal(history.past.length, 1);
  const laidOut = history.present;
  history = DocStoreWithHistory(history, ActionCreators.undo());
  assert.equal(history.present.drawing, original.drawing);
  assert.equal(history.present.drawingVersion, original.drawingVersion);
  assert.deepEqual(history.present.view._selected_array, original.view._selected_array);
  history = DocStoreWithHistory(history, ActionCreators.redo());
  assert.equal(history.present, laidOut);
});

test('layout preserves older undo history and creates a separate checkpoint for every run', () => {
  const { original, action } = fixture();
  const older = { ...original, drawing: blank() };
  let history = DocStoreWithHistory(historyFor(original, [older]), action);
  const firstLayout = history.present;
  const secondSource = firstLayout.drawing.sheets[0];
  const wireBefore = secondSource.items[0];
  history = DocStoreWithHistory(history, { type: DocActionTypes.ApplyAutoLayout, source: secondSource,
    changes: [{ id: wireBefore._id, before: wireBefore, after: { ...wireBefore, net_type: 'Signal' } }] });
  assert.equal(history.past.length, 3);
  history = DocStoreWithHistory(history, ActionCreators.undo());
  assert.equal(history.present, firstLayout);
  history = DocStoreWithHistory(history, ActionCreators.undo());
  assert.equal(history.present, original);
  history = DocStoreWithHistory(history, ActionCreators.undo());
  assert.equal(history.present, older);
});
`, { bundlePackages: ['redux-undo'] });
