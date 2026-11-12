# Auto-layout

Use the **Auto-layout** toolbar button while editing a schematic. The dialog
explains the operation and offers **Whole sheet** or **Selected Items**. Selected
Items is disabled unless the selection includes a supported circuit item.
When a selection is available, it is the default scope.

Choose how much the existing layout can change:

- **Low** keeps large components fixed.
- **Medium** allows at most two large components to move.
- **High** allows all eligible components to move.

Small components, wires, and labels can be adjusted at every level. The tool
tidies symbol text and net labels, repairs and simplifies routing, and compacts
placement. It preserves electrical connections and keeps items outside the
selection fixed. These are bounded improvements to an existing schematic;
some layouts may have no improvements available.

Routing also checks local down–across–up and sideways reversals, even when
obstacles prevent rerouting the entire wire. A shorter corner is accepted only
if it preserves connections and fixed anchors, respects pin exits, and maintains clearance
from artwork, annotations, and other wires. Necessary detours remain in place.
Hidden connection points do not acquire artificial pin stems or inward lead
requirements; their native symbol metadata is preserved.

Click **Go** to run. Computation runs in a dedicated worker; **Cancel** closes
the dialog and stops the worker without applying changes. A successful result
is applied in one undo step. If the source sheet changes during computation,
the result is discarded. New wire segments and junctions receive editor-wide
unique IDs before being applied.

The algorithm is ported from `e77127d` on `feature/spice`, without its teaching
examples or simulation features. The pure API is exported from `src/layout`:
`optimiseLayout(sheet, { disturbance, selectedIds })` returns proposed item
changes and before/after metrics. Both electrical and physical connectivity
are checked before returning a result. The editor owns worker cancellation,
snapshot validation, ID allocation, and undo history.

Run the test suites from the repository root:

```sh
npm run test:layout
```

This runs the algorithm, dialog, worker, text-measurement, and editor integration
tests with Node's test runner. The dialog tests isolate browser services while
executing the real component. Worker tests exercise the real optimizer and font
initialization. Editor tests cover global ID allocation, stale snapshots, source
immutability, selection, and undo/redo, including the first edit after opening.

For the browser suite, install Chromium once:

```sh
npx playwright install --with-deps chromium
npm run test:layout:browser
```

The browser suite builds an optimized filesystem app in a temporary directory;
it does not replace `dist` or the development server's cache. Tests use the real
toolbar, dialog, Redux state, fonts, drawing parser, saver, and compiled worker.
Only the file picker is supplied by the fixture. It checks all levels, both
scopes, objects outside the selection, no-op results, cancellation, dismissal,
stale results, first-edit undo/redo, and saving/reopening. Browser traces and
screenshots from failures are stored under `.tmp/layout-browser-results`.

Run `npm run test:layout:all` to execute both suites. Browser tests require
Chromium and its OS libraries; the Node suites have no browser requirement.
Both suites also run in the **Auto-layout Tests** GitHub Actions workflow on
pull requests to main and pushes to main or production.
