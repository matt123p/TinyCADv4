import { runRegression } from './run-regression.mjs';

await runRegression(`
import assert from 'node:assert/strict';
import { updateView } from './src/manipulators/updateView';
import { Snap } from './src/manipulators/snap';
import { DocItemTypes } from './src/model/dsnItem';

const updater = new updateView();
const rectangle = { _id: 1, NodeName: DocItemTypes.Rectangle,
  point: [13.5, 17.25], point_b: [33.5, 37.25], line_width: 1 };
const other = { ...rectangle, _id: 2, point: [100, 100], point_b: [120, 120] };
const sheet = { items: [rectangle, other], details: { grid: 10, grid_snap: false } };
const view = { _selected_array: [1], _selected_handle: 0, hiddenItemIds: [],
  hover_obj: rectangle, hover_ids: [1], hover_pins: [], selected_sheet: 0 };

for (const grid of [5, 10, 23.5]) {
  for (const enabled of [false, true]) {
    const configured = { ...sheet, details: { grid, grid_snap: enabled } };
    const moved = updater.command_move_selected_grid(view, configured, 1, -1);
    const step = enabled ? grid : 1;
    assert.deepEqual(moved.sheet.items[0].point, [13.5 + step, 17.25 - step]);
    assert.strictEqual(moved.sheet.items[1], other);
    const snapped = new Snap(grid, enabled).snap(rectangle.point);
    if (!enabled) assert.deepEqual(snapped, rectangle.point);
  }
}

console.log('Issue #25 regression checks passed.');
`);
