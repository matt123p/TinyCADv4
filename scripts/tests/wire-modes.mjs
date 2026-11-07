import { runRegression } from './run-regression.mjs';

await runRegression(`
import assert from 'node:assert/strict';
import { updateView } from './src/manipulators/updateView';
import { updateWire } from './src/manipulators/updateWire';
import { Snap } from './src/manipulators/snap';
import { DocItemTypes } from './src/model/dsnItem';

const updater = new updateView();
const wire = points => ({ _id: 900, NodeName: DocItemTypes.Wire, d_points: points, _magnetic: null });
const fresh = mode => ({ sheet: { items: [], details: { grid: 10, grid_snap: true } },
  view: { wireMode: mode, menu_command: 'add_wire', add: wire([]), tracker: {},
    _selected_array: [], hiddenItemIds: [], selected_sheet: 0 } });
function event(state, name, p) {
  return updater.add_event(state.view, state.sheet, name, p, [0, 0], 0);
}
for (const mode of ['90', 'free', '45']) {
  let state = fresh(mode);
  state = event(state, 'lbuttondown', [0, 0]);
  state = event(state, 'dragend', [0, 0]);
  assert.equal(state.view.add.d_points.length, mode === '90' ? 3 : 2);
  state = event(state, 'mousemove', [80, 50]);
  assert.deepEqual(state.view.add.d_points, mode === '90' ? [[0, 0], [80, 0], [80, 50]]
    : mode === 'free' ? [[0, 0], [80, 50]] : [[0, 0], [50, 50]]);
  state = event(state, 'lbuttondown', [80, 50]);
  state = event(state, 'dragend', [80, 50]);
  assert.equal(state.sheet.items.length, 1, 'each click commits a segment');
  assert.equal(state.sheet.items[0].d_points.length, 2);
  assert.equal(state.view.add.d_points.length, mode === '90' ? 3 : 2);
  if (mode !== '90') {
    assert.deepEqual(state.sheet.items[0].d_points, [[0, 0], mode === '45' ? [50, 50] : [80, 50]]);
    const anchor = state.view.add.d_points[0];
    state = event(state, 'mousedrag', [130, 100]);
    assert.deepEqual(state.view.add.d_points[0], anchor, 'next segment keeps its anchor');
    state = event(state, 'lbuttondown', [130, 100]);
    state = event(state, 'dragend', [130, 100]);
    assert.equal(state.sheet.items.length, 2);
    assert.deepEqual(state.sheet.items[0].d_points[1], state.sheet.items[1].d_points[0]);
  }
}

// Starting directly on a wire must split it even before any hover event.
for (const mode of ['90', 'free', '45']) {
  let state = fresh(mode);
  state.sheet.items = [{ ...wire([[0, 0], [100, 0]]), _id: 902 }];
  state = event(state, 'lbuttondown', [50, 0]);
  state = event(state, 'dragend', [50, 0]);
  assert.equal(state.sheet.items.length, 2);
  assert.deepEqual(state.view.add.d_points[0], [50, 0]);
}

// Legacy ToAngle thresholds, all quadrants, with and without grid snapping.
for (const gridSnap of [true, false]) {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    for (const [target, expected] of [
      [[80, 10], [80, 0]], [[10, 80], [0, 80]], [[80, 50], [50, 50]],
      [[50, 80], [80, 80]], [[60, 60], [60, 60]],
    ]) {
      const u = new updateWire(wire([[0, 0], [0, 0]]));
      u.wireMode = '45';
      const p = [target[0] * sx, target[1] * sy];
      const preview = u.move_add(p, new Snap(10, gridSnap), {}, []);
      assert.deepEqual(preview.d_points[1], [expected[0] * sx || 0, expected[1] * sy || 0]);
      assert.deepEqual(u.begin_add(p, {}, new Snap(10, gridSnap), []).obj.d_points[1], preview.d_points[1]);
    }
  }
}

// Joining an existing wire splits at the endpoint; off-angle magnets cannot
// produce a false connection in constrained mode.
for (const mode of ['free', '45', '90']) {
  let state = fresh(mode);
  const existing = { ...wire([[50, 0], [50, 100]]), _id: 901 };
  state.sheet.items = [existing];
  state = event(state, 'lbuttondown', [0, 0]);
  state = event(state, 'dragend', [0, 0]);
  state = event(state, 'mousemove', [50, 50]);
  state = event(state, 'lbuttondown', [50, 50]);
  state = event(state, 'dragend', [50, 50]);
  assert.equal(state.view.add, null, 'joining an existing wire finishes drawing');
  assert.ok(state.sheet.items.filter(i => i.NodeName === DocItemTypes.Wire).length >= 3);
}
const offAngle = new updateWire(wire([[0, 0], [0, 0]]));
offAngle.wireMode = '45';
const snap = { snap: p => p, snap_magnetic: () => ({ point: [80, 50], wire: null }) };
assert.equal(offAngle.move_add([80, 50], snap, {}, [])._magnetic, null);
// Choosing a mode activates wiring from idle or another active tool.
for (const mode of ['90', '45', 'free']) {
  for (const command of ['', 'add_line', 'add_wire_point_to_point']) {
    const state = fresh('90');
    const view = updater.setWireMode({ ...state.view, menu_command: command, in_add_rect: true }, state.sheet, mode);
    assert.equal(view.menu_command, 'add_wire');
    assert.equal(view.wireMode, mode);
    assert.equal(view.add.NodeName, DocItemTypes.Wire);
    assert.deepEqual(view.add.d_points, []);
    assert.equal(view.in_add_rect, false);
    const started = event({ ...state, view }, 'lbuttondown', [20, 30]);
    assert.deepEqual(started.view.add.d_points[0], [20, 30]);
  }
}

// Changing modes reshapes only the preview and keeps committed wires intact.
let changing = fresh('90');
changing = event(changing, 'lbuttondown', [0, 0]);
changing = event(changing, 'dragend', [0, 0]);
changing = event(changing, 'mousemove', [80, 50]);
for (const mode of ['45', 'free', '90', 'free']) {
  const before = changing.view;
  const oldPoints = JSON.stringify(before.add.d_points);
  const oldTracker = JSON.stringify(before.tracker);
  changing.view = updater.setWireMode(before, changing.sheet, mode);
  assert.equal(JSON.stringify(before.add.d_points), oldPoints);
  assert.equal(JSON.stringify(before.tracker), oldTracker);
  assert.deepEqual(changing.view.add.d_points[0], [0, 0]);
  assert.equal(changing.view.add.d_points.length, mode === '90' ? 3 : 2);
  changing = event(changing, 'mousemove', [80, 50]);
}
changing = event(changing, 'lbuttondown', [80, 50]);
changing = event(changing, 'dragend', [80, 50]);
const placed = changing.sheet.items.map(i => i.d_points);
changing = event(changing, 'mousemove', [140, 90]);
changing = event(changing, 'rbuttondown', [140, 90]);
assert.equal(changing.view.add, null);
assert.deepEqual(changing.sheet.items.map(i => i.d_points), placed, 'finish discards the unclicked preview');

// Repeated clicks finish single-segment modes without inserting zero-length wires.
for (const mode of ['free', '45']) {
  let state = fresh(mode);
  for (let i = 0; i < 2; ++i) {
    state = event(state, 'lbuttondown', [0, 0]);
    state = event(state, 'dragend', [0, 0]);
  }
  assert.equal(state.view.add, null);
  assert.equal(state.sheet.items.length, 0);
}
console.log('Wire mode regression checks passed.');
`);

// Check the toolbar menu's selected mode and dispatched action.
const { loadComponent } = await import('./load-component.mjs');
const { default: assert } = await import('node:assert/strict');
const ui = new Proxy({
  makeStyles: () => () => ({}), mergeClasses: () => '',
  tokens: new Proxy({}, { get: () => '#666' }),
}, { get: (target, key) => key in target ? target[key] : String(key) });
const { Toolbar } = loadComponent('src/components/toolbar/toolbar.tsx', {
  '@fluentui/react-components': ui,
  'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) },
  '../../i18n/languages': { normalizeLanguageCode: () => 'en', SUPPORTED_LANGUAGES: [] },
  '../../state/actions/appActions': loadComponent('src/state/actions/appActions.ts', {}),
});
const descendants = tree => !tree || typeof tree !== 'object' ? []
  : [tree, ...[tree.props?.children].flat(Infinity).flatMap(descendants)];
for (const mode of ['90', 'free', '45']) {
  const actions = [];
  const tree = Toolbar({ selected_sheet: 0, menu_command: 'add_wire', wireMode: mode,
    toolbarDefaults: Object.fromEntries(['Power', 'Label', 'Shape', 'Bus', 'Ruler'].map(key =>
      [key, { command: '', image: '' }])), recentFiles: [], dispatch: action => actions.push(action) });
  const nodes = descendants(tree);
  const menu = nodes.find(node => node.props?.checkedValues?.wireMode);
  assert.deepEqual(menu.props.checkedValues.wireMode, [mode]);
  const button = nodes.find(node => node.props?.['aria-label'] === 'toolbar.wireMode');
  assert.equal(button.props.appearance, 'subtle');
  const choices = nodes.filter(node => node.props?.name === 'wireMode');
  assert.deepEqual(choices.map(node => node.props.value), ['90', '45', 'free']);
  choices.forEach(node => node.props.onClick());
  assert.deepEqual(actions, ['90', '45', 'free'].map(mode => ({ type: 'SET_WIRE_MODE', mode })));
}
console.log('Wire mode toolbar checks passed.');
