import { runRegression } from './run-regression.mjs';

await runRegression(`
import assert from 'node:assert/strict';
import { updateView } from './src/manipulators/updateView';
import { DocItemTypes } from './src/model/dsnItem';

const updater = new updateView();
const rectangle = { _id: 1, NodeName: DocItemTypes.Rectangle,
  point: [13.5, 17.25], point_b: [33.5, 37.25], line_width: 1 };
const other = { ...rectangle, _id: 2, point: [100, 100], point_b: [120, 120] };
const sheet = { items: [rectangle, other], details: { grid: 10, grid_snap: false } };
const view = { _selected_array: [1], _selected_handle: 0, hiddenItemIds: [],
  hover_obj: rectangle, hover_ids: [1], hover_pins: [], selected_sheet: 0 };

const hidden = updater.command_hide_selected(view, sheet);
assert.strictEqual(hidden.sheet, sheet, 'hiding must not modify saved drawing data');
assert.deepEqual(hidden.view.hiddenItemIds, [1]);
assert.deepEqual(hidden.view._selected_array, []);
assert.equal(hidden.view.hover_obj, null);
assert.equal(updater.is_inside(hidden.view, sheet, [13.5, 17.25], 0, false, false, false), null);
const boxed = updater.is_inside_rect(sheet, false, false, 0, false, [0, 0], [200, 200]);
assert.deepEqual(updater.selectItems(hidden.view, sheet, boxed, false)._selected_array, [2]);
const restored = updater.command_show_all({ ...hidden.view, hiddenItemIds: [1, 99] }, sheet);
assert.deepEqual(restored.view.hiddenItemIds, [99], 'show all affects only the current sheet');
assert.strictEqual(restored.sheet, sheet);
assert.ok(updater.is_inside(restored.view, sheet, [13.5, 17.25], 0, false, false, false));
assert.deepEqual(view.hiddenItemIds, [], 'commands must not mutate prior view state');
assert.equal(updater.getSelectedText(hidden.view, sheet), null);
assert.equal(updater.getSelected(hidden.view, sheet), null);

console.log('Issue #13 regression checks passed.');
`);
