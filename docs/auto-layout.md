# Schematic layout tools

## Design and rules

This is an opt-in layout library and offline review tool, not a rewrite of the
bundled examples or a new editor command. Inputs are existing TinyCAD sheets;
outputs are a proposed sheet, item changes, quality measurements and unresolved
diagnostics. A future selection command or MCP tool can preview the proposal and
apply all changes in one undo transaction.

Electrical correctness is a constraint, not a weighted aesthetic preference.
Compare canonical terminal/wire net membership using TinyCAD's own netlist
builder before accepting geometry changes. Include dangling wires, labels,
power ports and no-connects; disregard net numbering and redundant junction dots.
Also compare physical membership with named-net linking disabled, so a label
cannot conceal a broken wire. Never infer the intended circuit from a misplaced
junction: a nearby dot can move to an already-connected branch only if both
partitions are unchanged; flag ambiguous repairs instead of joining separate nets.

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

## Why staged optimisation

Use deterministic local geometry proposals with a hard connectivity gate, then
coordinate descent over discrete text candidates. Optional seeded simulated
annealing explores competing text placements, retaining the best solution.
Annealing the entire circuit from scratch would spend much of its budget on
invalid connectivity and destroy a user's existing organisation.

Compaction removes empty horizontal/vertical strips. Objects translate rigidly;
only wires spanning a strip shorten. This preserves orthogonal topology and the
user's mental map, and is especially effective on the oversized circuit loops.
Wire shortening and component movement remain separate, validated proposals.

### Labels and obstruction repair

`netLabelPosition` is a soft distance penalty for departing from centre/end
positions on fully supported labels; unfitted labels are counted separately by
`labelOverhangs`. It does not prevent compaction. When text conflicts with a neighbouring
wire or body, a free terminal stub can extend by a bounded amount and put the text
near its end. Connected endpoints, branch points and locked objects stay fixed.
Extending a stub must not introduce any new text/wire, text/body or text/text
collision pair, even if another collision would disappear at the same time.

Existing wire/body collisions take priority over wire length and area. A targeted
repair stage tries orthogonal detours beyond obstacle bounds, including room for
annotations, and reattaches movable plain labels in the same validated proposal.
If necessary, eligible components can escape to either side of the crossing wire.
A ground symbol can shift sideways together with its attached lead; moving a
ground with another terminal at its anchor is deliberately excluded. Routing-only
requests can detour around fixed objects but cannot move components or grounds.
Selection, locks, disturbance limits and both connectivity partitions still apply.
These are bounded local repairs, not a general maze router.

### Orientation, aligned columns and justified bends

Plain labels follow the axis of their supporting wire: horizontal on horizontal
spans and vertical on vertical spans. An already parallel reading direction is
retained. Locked or unselected labels and shaped port flags are unchanged.
Label geometry uses the same text clearance offset as the SVG renderer. The
minimum span includes both the visible text with clearance and its electrical
anchor; fitting the text alone can leave a rotated anchor just outside the wire.
Text remains centred where possible, or inset at a clear end. Straight spans can
cross several native wire records; a shared collinear vertex is not an overhang.

Free labelled stubs on the same component face are proposed jointly, with a
shared left text edge sized for the widest field. `labelAlignment` measures their
column error. Straight stubs are tried first. Where pin pitch is too tight for
the text, ordered fan-out proposals spread the outer rows at a common pitch;
these still preserve straight pin leads and electrical membership.
Related rows use the ordinary geometry clearance instead of the larger spacing
between unrelated annotations. Successfully aligned columns are protected from
subsequent independent centring of individual labels.

Unlabelled connections on the same component face reserve rows too. A grounded
reset between labelled inputs must not be lost from the spacing calculation.
An additional fan-out candidate spreads each labelled block between these fixed
rows, preserving pin order and the common text column. It leaves the unlabelled
wire and its terminal untouched, and declines the candidate when a bounded gap
cannot fit the required pitch. Collision and connectivity checks still apply.

Extra bends require a concrete improvement in collision counts, pin exits or
label support. Attraction, compaction and soft annotation spacing alone cannot
justify them. The score favours fewer bends before soft layout preferences.
An unoccupied free tail may follow its pin and straighten, carrying movable
labels with it; an isolated movable power terminal can follow too when placement
is enabled. Branches, fixed terminals, no-connects and locked labels remain
constraints. Original wire identities are retained by subdividing straight spans.
Text placement runs before obstruction repair, avoiding a wire detour when
sliding the label is sufficient. Empty displayed pin names reserve no text area,
allowing resistor references and values to sit close to their bodies.

### Regular groups and annotation separation

Independent attraction can scatter a group even while reducing its total net
distance. The placement stage therefore also proposes **joint** moves of
compatible component families. A family has the same reference prefix, body
size, orientation and opposed two-pin geometry; values and library UIDs may
differ. Only physically isolated components qualify, and every item in the
group must be eligible under the selection, locks and disturbance mode.

Candidate rows/columns use measured component-plus-stub-plus-text envelopes to
choose equal pitch. The search tries nearby existing centrelines and free space
beside other circuit blocks, checks page bounds and intervening geometry, then
applies the normal connectivity and collision gates. It evaluates up to 64
ranked candidates per group per call. This is a general placement rule, with no
example IDs or hard-coded destinations.

The score now favours annotation separation and regular component patterns
above small gains in wire length, area or individual component attraction.
`componentDisorder` measures centreline error, uneven pitch and excessive group
spacing. `annotationCrowding` measures the clearance shortfall between unrelated
text items, including net names and power text. Its preferred gap is the larger
of `annotationClearance` and the two font sizes. Fields belonging to the same
symbol are excluded so references and values can remain together. These are
soft preferences: existing dense layouts can retain reported crowding.

This is incremental beautification, not arbitrary netlist placement. ELK Layered
is a possible later backend for *new* circuits; its layer direction is less
appropriate for preserving an existing analogue feedback loop.

## Research

- [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html):
  orthogonal routing supports fixed port constraints. Preserve actual symbol
  ports rather than treating components as generic graph vertices.
- [Wybrow, Marriott and Stuckey, Orthogonal Connector Routing](https://people.eng.unimelb.edu.au/pstuckey/papers/gd09.pdf)
  and [libavoid options](https://www.adaptagrams.org/documentation/namespaceAvoid.html):
  separate route finding, centring/nudging and junction-aware improvement.
- [Christensen, Marks and Shieber, cartographic label placement](https://www.eecs.harvard.edu/~shieber/Projects/Carto/carto.html):
  competing finite label positions form a combinatorial optimisation problem;
  local search and annealing are useful without moving the underlying features.

These inform the algorithm; no third-party layout code or runtime dependency is
copied into TinyCAD.

## API and integration

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

An MCP wrapper can expose these functions and serializable options directly,
with its own document lookup, version check, preview/apply and ID allocation.
The server and editor menu are intentionally future integration work.

## Running and reviewing

```sh
npm run test:layout
npm run layout:review -- --input path/to/design.dsn --disturbance low
```

The CLI writes a standalone HTML before/after review, SVGs at matched scales,
JSON metrics/diagnostics and separate `*-proposal.dsn`/`.dzn` copies. It reopens
each saved proposal and verifies connectivity. It does not regenerate or replace
bundled examples. `--analyse-only` produces no proposed drawing. Headless previews
use TinyCAD's existing conservative font metrics; the editor uses its canvas
metrics. Exact text placement can consequently differ between platforms.

## Limits and next steps

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

Useful follow-ups are a worker preview/undo command, caller-specified route
groups and alignment constraints, obstacle-aware A* or libavoid routing,
incremental spatial indexing for large sheets, and whole-netlist placement for
new MCP-generated circuits. These can reuse the validator and quality contract.

## Validation

Run `npm run test:layout` and `npm run typecheck`. Behavioural checks cover
parallel routes, symbol rotation and mirroring, text placement, label alignment,
obstruction repair, regular grouping, selection and locks, disturbance limits,
deterministic annealing, input immutability and save/reopen connectivity.
Simulation metadata is checked using the standalone examples under
`examples/simulation`.

The curriculum teaching packs and their generation pipeline have been removed.
The layout library and drawing review CLI remain independent of those packs.
Historical teaching previews and measurements are available in Git history.

For generated native drawings, `nativeWireJunctions: true` additionally checks
the connections the editor would make at wire endpoints and terminals, rejecting
new accidental T connections during layout.
