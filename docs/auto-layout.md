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
user's mental map, and is especially effective on the oversized teaching loops.
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
npm run layout:review -- --examples G01,G14,A38 --disturbance medium
npm run layout:review -- --input path/to/design.dsn --disturbance low
npm run layout:review -- --all-examples --output-dir build/layout-review-all
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

## Validation snapshot (12 November 2026)

`npm run test:layout`: 29 passing behavioural tests, covering eight parallel
signal paths stored as native segments, all eight symbol rotation/mirror states,
four-sided pin layouts, rotated ground artwork, label-stub extension, inline
centring, named-net attraction, ambiguous junctions, selection/locks, disturbance
limits, deterministic annealing, input immutability and saved simulation data.
The real-example checks also require A38's resistor/capacitor pairs to be
parallel and aligned, every CTRL label to remain at least 15 drawing units from
ground text, and A36's V1–V3 to form an ordered, equally spaced row. Grouping
locks and narrow-but-nonoverlapping annotation gaps have dedicated tests.
Artwork bounds and compact text placement are checked under all eight rotation/
mirror states with unequal axis scales. A36/A38 references and A38 capacitor
references/values must stay within five drawing units of their visible bodies.
`npm run typecheck` also passes.
Additional regressions cover horizontal/vertical and reversed-wire label centres,
clear end placement when the middle is blocked, labelled detours around fixed
components, component escape moves, and ground relocation with its lead. A36 must
have no wire/body collisions, and its A/CLK labels must avoid neighbouring wires.
Tests cover alignment from all four label orientations on both wire axes,
short rotated labels with electrical anchors inside their span, fixed-label
orientation, straight ground-lead extension and fixed terminal protection.
Additional cases cover straightening a labelled free tail across native
records, locked off-axis anchors, and common label columns with and without tight
pin pitch. G14's dangling LDR lead must stay straight; A38 must have no bends,
and A36/A38 must have zero label-column error. R1/R2 text groups must lie within
five drawing units of their visible resistor bodies. A36's U3 supply and both
V1 leads must stay straight after grouping, with no label overhangs.

Before the unlabelled-row spacing revision, the review runner processed all 214 bundled teaching drawings in medium mode,
with four passes and 2,500 acceptance evaluations per drawing. Every proposal
preserved electrical and physical connectivity, including after save/reopen.
All 1,503 saved labels retain their original text and shape; 604 rotate to
follow the supporting wire.
No sheet increased its measured body collisions, wire/body collisions,
crossings, overlaps, diagonals, pin-exit violations, text collisions or label
overhangs. The original example files were unchanged.

| Aggregate metric | Before | After |
| --- | ---: | ---: |
| Wire/body collisions | 70 | 54 |
| Pin-exit violations | 249 | 8 |
| Text collisions | 1,256 | 50 |
| Net-label overhangs or incorrect wire alignment | 1,503 | 23 |
| Wire length (drawing units, rounded) | 131,525 | 106,939 |
| Circuit bounding area (square drawing units, rounded) | 35,221,680 | 13,773,586 |
| Annotation clearance shortfall (drawing units, rounded) | 3,119 | 173 |
| Component pattern disorder (drawing units, rounded) | 39,170 | 0 |
| Label-column error (drawing units, rounded) | 1,180 | 0 |

G01 improved from 755 to 300 units of wire and from 122,578 to 26,325 square
units of circuit area, with zero detected text collisions, label overhangs or
pin-exit violations. Its existing dangling wire remains flagged; its intended
connection is not inferred from the corrected reference image.

These are measured improvements, not a claim that all drawings are finished:
46 runs converged, 132 reached the pass limit and 36 reached the evaluation
budget. Only 59 have no remaining diagnostics, which now also include annotation
crowding in addition to dangling endpoints and source-artwork conflicts. Many teaching drawings share
circuit templates. All proposals were rendered; representative G01, A38 and
A36 previews were visually inspected. The generated HTML/JSON reports under
`build/layout-review` and `build/layout-review-validation` contain the latest results.

In the revised medium-disturbance previews, A38 has R1/R2 on a shared vertical
centreline and C1/C2 on a shared horizontal baseline. Its closest CTRL/ground-0
text gap exceeds 15 drawing units. A36 has V1/V2/V3 on the same baseline with equal
pitch in reference order. Both examples finish with zero component-pattern
disorder. Connectivity is also checked on saved/reopened proposals; the
originals are not edited to obtain the result. U1 now sits next to the visible
chip body in both previews. C1/C2 references and values sit close to the capacitor
plates and align on their body-facing edge. These are general placement rules,
not adjustments to individual example files.

The obstruction-repair revision removes both A36 wire/ground-artwork collisions
(2 to 0). A and CLK now share a text column, with a small fan-out to provide
clearance at tight pin pitch. A38's left-side labels share a column and its stubs
are straight. G14's dangling lead has no elbow. IN/OUT follow their supporting spans and
R1/R2 fields are close to their bodies. A36 still has other dense-pin text diagnostics;
the review does not claim that every annotation in the sheet is resolved.

The wire-alignment revision rotates the vertical VCC/CLK/A supply labels in A36.
Its U3 supply lead is straight. Short labelled ground leads are extended along
their existing axis before obstacle routing is attempted. After component
grouping, a movable ground and its unbranched lead can straighten together if
the earlier obstruction has gone; fixed terminals, branches and remaining
clearance conflicts prevent that move. This also removes the leftover V1
ground detour without removing the necessary ground offsets below U1/U2.

The subsequent unlabelled-row regression checks both component faces with a
locked intervening ground connection. A36's U1/U2/U3 input columns must be clear
of wires, bodies and other text. The four representative previews were regenerated
and save/reopen connectivity rechecked: A36 text collisions drop from 9 to 6,
with zero input-column collisions, zero label-column error and zero overhangs.
A38 still has zero bends and text collisions. The aggregate table above records
the earlier full run, rather than claiming a new 214-drawing sweep for this change.

### Teaching drawing regeneration

The historical proposal measurements above precede repair of the teaching-file generator. The bundled drawings have now been explicitly regenerated: every routed leg is a native two-point wire, and the editor's split/merge routine places branch dots before and after medium-disturbance layout. The generator selects upright supply-pin orientation before wiring; auto-layout still preserves component orientation.

The generator enables `nativeWireJunctions`, which also checks the connections that the editor would make at wire endpoints and terminals. A proposal cannot introduce an accidental T connection that would short separate nets on cleanup. Saving/reopening verifies wire coverage as well as electrical and physical membership. SVGs and PNGs are rendered from the reopened drawings, including correctly transformed junction artwork inside rotated symbols.

The regenerated 214 drawings contain 2,773 native wires and 138 schematic junction dots, with zero diagonal or misplaced-junction diagnostics. All 201 simulations pass verification; 13 drawings are connection plans. See the current teaching review record for preview hashes and remaining layout diagnostics. The separate proposal CLI continues to leave its source drawings unchanged.
