# Editor tools

## Auto-layout

Use the **Auto-layout** toolbar button beside **Simulation** while editing a schematic, or **Tools → Auto-layout** in Electron. The dialog
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

The editor and offline tools share the layout engine. The pure API is exported from `src/layout`:
`optimiseLayout(sheet, { disturbance, selectedIds })` returns proposed item
changes and before/after metrics. Both electrical and physical connectivity
are checked before returning a result. The editor owns worker cancellation,
snapshot validation, ID allocation, and undo history.

### Connectivity and geometry constraints

The layout library also supports offline review.
Inputs are existing TinyCAD sheets; outputs are a proposed sheet, item changes,
quality measurements and unresolved diagnostics. The editor applies accepted
changes in one undo transaction.

Electrical correctness is a constraint, not a weighted aesthetic preference.
Compare canonical terminal/wire net membership using TinyCAD's own netlist
builder before accepting geometry changes. Include dangling wires, labels,
power ports and no-connects; disregard net numbering and redundant junction dots.
Also compare physical membership with named-net linking disabled, so a label
cannot conceal a broken wire. Never infer the intended circuit from a misplaced
junction: a nearby dot can move to an already-connected branch only if both
partitions are unchanged; flag ambiguous repairs instead of joining separate nets.

Every routing proposal also checks the contacts made by the editor's wire cleanup.
A wire endpoint, bend, socket/pin or power terminal touching the middle of another
wire forms a connection, even without a stored junction dot. Shortcuts must preserve
these native electrical and physical partitions as well as the literal netlist.
This protection is always enabled, including for zero-length physical socket pins.

Rules, in priority order:

1. Preserve symbol identity, pin numbers, orientation, scale, values, hidden
   fields and simulation data. Preserve net-label content and shape. Preserve connections and selected-region boundary
   connections. Objects outside the selection and locked objects stay fixed.
2. Keep wires orthogonal. Leave a straight, outward, grid-sized lead after a pin
   before bending. Do not introduce body intersections, wire crossings or
   overlaps. A crossing without a dot is not permission to join nets.
3. Keep visible symbol fields together, near their symbol, clear of bodies,
   pins, wires and other text. Search sides and corners, including symbols with
   pins on all sides. Measure proximity to visible artwork, not the outer pin
   envelope. Align each field towards the body: right-aligned on the left,
   left-aligned on the right, individually centred above/below. Preserve hidden
   fields and text content.
4. Place plain net labels wholly along an adequate wire span, above horizontal
   wires or beside vertical ones, with the electrical anchor on that wire and
   their text rotated parallel to the supporting span. Retain an already parallel
   reading direction. Prefer common text columns for related pin
   stubs, then centred or inset end positions for standalone labels.
   Position measured text bounds exactly; rounding an anchor to the drawing grid
   can otherwise make a short label overhang a perfectly adequate wire.
   Extend an unoccupied terminal stub when needed; a movable ground terminal can
   extend with its lead when placement is enabled. Never stretch a symbol.
5. Centre an inline two-pin component between its neighbouring wire ends when
   there is room. Shorten removable doglegs and empty routing corridors while
   preserving ordering, branch points and fixed geometry.
6. Route related wires between the same symbol pair as ordered parallel tracks
   in a common corridor. This has a higher score priority than shortest wire.
   Recover paths from native wire segments; retain each wire's identity. Do not
   force incompatible endpoint order into a crossing-free bundle.
7. Bias connected components towards each other, including connections through
   matching net labels. Reduce the influence of high-fanout supply nets. Move a
   component with its local stubs/labels when it has no physical neighbour;
   otherwise reroute its physical connections. Prefer smaller area, fewer bends,
   shorter wires and balanced inline placement at the original symbol scale.
8. Keep repeated isolated components in a regular pattern: vertical two-pin
   devices side by side, horizontal devices in parallel rows, with shared body
   centrelines and equal pitch. Preserve reference order, orientation and pin
   polarity. Move each component together with its attached stubs and labels.

### Layout API

Import from `src/layout`:

- `analyseLayout(sheet, options)` reports metrics and item-specific diagnostics.
- `autoPlaceSymbolText(sheet, options)` adjusts visible symbol text only.
- `compactLayout(sheet, options)` places text, centres/attracts components and
  removes empty strips.
- `repairWiring(sheet, options)` proposes shared corridors, simpler routes,
  straight pin exits, adequate net-label stubs and redundant visual junctions.
- `optimiseLayout(sheet, options)` runs all stages. `phases` can restrict them.

All tools leave their input unchanged. Optimisation returns `sheet`, `changes`
(before/after item pairs), `wireOrigins`, before/after analysis, evaluation count,
stop reason and a connectivity result. No editor state, files, undo history or
simulation parameters are written. For an editor command, take a snapshot of the
sheet, run in a worker, preview changes and diagnostics, check that the source
sheet is still current, then apply the changes as one undoable transaction.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `disturbance` | `medium` | `low`: only small components; `medium`: at most two large components; `high`: all eligible components |
| `selectedIds` | omitted | Omitted means all supported circuit items; `[]` means none |
| `lockedIds` | `[]` | Explicit locks protect geometry **and** text |
| `largeSymbolIds` | automatic | Override size classification for the UI/MCP caller |
| `grid` | sheet grid | Movement step; existing off-grid attachment points are retained |
| `pinLead` | 2 grid steps | Minimum outward pin lead |
| `clearance` | half a grid step | Text/geometry separation |
| `annotationClearance` | 3 grid steps | Preferred gap between unrelated annotations, with a font-size minimum |
| `corridor` | 6 grid steps | Target space between rigid objects during compaction |
| `maxPasses` | 4 | Bounded local improvement passes |
| `maxEvaluations` | 2500 | Candidate acceptance-evaluation limit |
| `annealingSteps` | 0 | Optional bounded symbol-text exploration |
| `seed` | 1 | Reproducible annealing seed |
| `cancelled` | omitted | Cooperative cancellation callback; retain the best proposal |

Automatic classification treats more than two visible pins, or a pin-envelope
area greater than four times the median two-pin area, as large. Medium chooses at
most two eligible large components by pin count, then ID, **once for the entire
run**. The remaining large components retain their positions; their text can
still improve. Small-component classification is geometric, not a part-name
guess. Large instruments and unusual library symbols can use the override.

Returned rerouted wires are native two-point segments. The first segment retains
the original ID; additional IDs are allocated above the sheet maximum and mapped
through `wireOrigins`. A caller with document-wide IDs must remap **new** IDs via
its allocator before inserting them. Use
`sameConnectivity(original, result.sheet, result.wireOrigins)` for independent
verification. The checker ignores net numbers but includes wire membership, even
for dangling wires. DSN reload assigns new session IDs; the review CLI aligns
IDs by saved item order for its round-trip check.

### Review and limits

The `layout:review` npm command accepts `--input path/to/design.dsn --disturbance low`. It writes standalone HTML/SVG before-and-after views, JSON metrics and separate proposal drawings, then reopens proposals to verify connectivity. `--analyse-only` produces no proposed drawing. Headless font metrics can differ from the editor's canvas metrics.

This is a bounded local optimiser, not a global optimality guarantee. A longer
wire can be the correct result when it fixes a pin exit, makes room for a label
or keeps a signal group coherent. Invalid starting geometry may retain reported
conflicts; unsafe or unproductive proposals are rejected. Routing and other
components' text use conservative symbol envelopes including pins. A symbol's
own fields use its visible artwork bounds, internal text and individual pin
keep-outs, allowing references and values to sit close to the body. Pin text
keep-outs remain approximate; dense or unusual library artwork can retain
reported conflicts. Symbols without recognised artwork fall back to the full
envelope.

Routing currently enumerates simple orthogonal alternatives and shortcuts,
rather than a complete obstacle-maze search. Bundles require identifiable paths
between the same two symbols; arbitrary multi-drop nets and bundles between
regions need an explicit group/hyperedge model. Shaped port flags, buses, library
pin artwork, note boxes and page furniture are not redesigned. Misplaced
junctions are reported, not automatically moved to join previously separate
nets. The original electrical topology is always the authority.

`npm run test:layout` checks the algorithm, dialog, worker and editor integration. `npm run test:layout:browser` exercises the real browser UI, worker and save/reopen path with Chromium; failure artifacts are under `.tmp/layout-browser-results`. The suites cover disturbance/scopes, selection/locks, cancellation, stale snapshots, ID allocation, undo/redo, input immutability, endpoint/socket shorts and connectivity after native wire cleanup. The legacy `nativeWireJunctions` option is deprecated; it cannot disable this protection.

## Markdown text boxes

Drawing text boxes use a small Markdown subset rendered entirely as SVG text and
shapes. The drawing canvas, SVG export, browser printing and PDF export use the
same component. PDF text stays vector-based; there is no HTML layout or screenshot
conversion in the export path.

Supported formatting:

- Headings, bold, italic and strikethrough.
- Paragraphs and ordinary line breaks.
- Numbered lists, bullet lists and read-only task lists.
- Quotations and horizontal rules.
- Inline code, fenced code blocks and indented code blocks.

Tables, links, images and raw HTML display as literal text. They do not create
tables, clickable links, embedded HTML or image requests. Code preserves whitespace
without syntax colouring. All text uses the selected base font family, weight and
italic settings, with heading sizes scaled relative to the base font size.

Select the text for editing to see styled source, including the Markdown markers.
Caret placement, selection and wrapping follow that styling. Click away to see
the formatted note. The original source is saved, so undo, copy/paste and reopening
a drawing preserve it. Resize a text box to fit the note; the formatted view clips
to its rectangle. Rotation is supported.

````markdown
# RC filter
**Time constant:** τ = R × C

- R1: 10 kΩ
- C1: 100 nF

- [x] Circuit wired
- [ ] Measurements recorded

~~~python
tau = 10_000 * 100e-9
~~~
````

Net labels, component fields and pin names keep their existing text behaviour.
Task lists use `- [x]` for checked and `- [ ]` for unchecked boxes, with an
optional label. Edit the marker to change its state; boxes are drawn as vectors
on screen and in exports.
Parsing uses [Marked](https://marked.js.org/) (MIT); rendering uses native SVG.
