# TinyCAD PCB layout implementation

The [PCB layout specification](TinyCAD_PCB_Layout_Complete_Specification.md) governs scope and acceptance. This list follows its work packages and release gates. Check off an item when its stated behavior has been verified.

## WP0 · Repository audit and schema

- [x] Record the [schema, pin/package migration rules, capability matrix and portable project decision](pcb-format.md).
- [x] Trace schematic save/load, connectivity, package metadata, and undo.
- [x] Qualify schematic identity migration for new placements, legacy `.dsn` and `.dzn`, edits, and clipboard copies (PRJ-02, SYN-01).
- [x] Audit hierarchy, buses, scalar cross-sheet labels, hidden power, multipart units, and explicit no-connects against reference circuits. Document the initial flat scalar subset and the preflight checks.
- [x] Verify that unchanged net membership retains its UUID across renames and that split/merge proposals identify prior net IDs for review.
- [x] Prototype a versioned board document with stable board identity, ordered copper layers, and deterministic serialisation. Verify atomic outline/title edits, stale-command rejection, and undo/redo.
- [x] Reserve `.dpn` for native standalone PCB layouts.
- [x] Add source and entity identities, graphic layers, embedded device definitions, optional-field preservation, compatibility tests, and migration rules to the version 1 board schema (PRJ-02, PRJ-03, LAY-01, ARC-01–08).
- [x] Decide the portable project storage model and migration policy for embedded definitions and circuit snapshots (PRJ-01, PRJ-05).

### Repository findings

| Area | Existing behavior | PCB implementation work |
| --- | --- | --- |
| Identity | `src/io/ioXml.ts` persists document and sheet identity and now persists placed-unit and pin-definition UUIDs. Runtime `_id` values are allocated when XML is parsed. | Use the persisted IDs for the circuit compiler, multipart binding and reviewed ECOs. |
| Connectivity | `src/web-worker/netlist.ts` and `src/web-worker/netlistState.ts` feed the schematic netlist. `src/io/netlists/netlistGenerator.ts` exposes nodes, pin numbers, net hints, and sheet names. | Reuse circuit connectivity through a compiler adapter. Verify hierarchy and buses. Give intended nets durable identities, preserve membership across renames, and treat splits/merges explicitly. |
| Package metadata | `src/io/netlists/netlistFiles.ts` exports the per-instance `Package` field. `dsnPin.number` is a string. | Keep the legacy text as a resolution hint. Require a reviewed device and explicit signal-to-pad mapping, including unresolved and ambiguous cases. Preserve terminal labels such as `A1`. |
| Undo | `src/state/undo/undo.ts` uses time-grouped Redux history and explicit checkpoints for multi-object operations. | Implement atomic PCB commands with a revision precondition. Verify that undo and redo restore source geometry and that a stale command cannot apply after either operation. |
| Browser and desktop | Shared TypeScript/React renderer with Parcel entries for filesystem, Google, and Electron. Existing layout workers target schematic placement/routing. | Keep the PCB domain platform-independent. Measure PCB geometry, workers, and rendering in both environments with the same fixtures. |

## WP1 · G0 engineering experiments

- [x] Verify exact unit conversion and straight-outline predicates, including self-intersections and near-collinear vertices at the coordinate limit.
- [x] Add analytic arcs, real cutouts, offsets, and polygon operations behind tested geometry APIs.
- [x] Compare TypeScript and candidate WASM geometry on the mixed SMD/PTH, thermal, plated slot, and polygon pad fixture in Chromium and Electron. Record licensing, latency, worker memory, cancellation, and correctness.
- [x] Exercise explicit pad assignments with duplicate and alphanumeric labels and test top/bottom quarter-turn transforms on an asymmetric footprint (LIB-01).
- [x] Prototype embedded device mapping and placement with arbitrary orientation and physical padstacks. Test reviewed terminal equivalence separately from bare-board copper (LIB-02–07, LAY-04).
- [x] Test exact round-copper contact, seeded shorts/opens, and plated/non-plated interlayer joins on a bounded fixture.
- [x] Extend copper connectivity to drilled annuli, tracks, arbitrary pads, and zone geometry. Define net ties, jumpers, and equivalent terminals.
- [x] Prototype rule-aware obstacle routing and via placement. Use the measurements to choose the M1 router strategy.
- [x] Prototype Gerber/drill/profile writing and independent read-back. Detect edited or missing manufacturing geometry and verify browser/desktop equivalence.
- [x] Publish the [G0 supported-feature matrix, measured development-host results and stop/go decisions](pcb-g0.md) against §29.2.
- [x] Record the monitored G0 comparison on the agreed interim development host. Capture Chromium and Electron process CPU and memory usage and retain the reference-laptop procedure for M1 (§27.1).

Run the prototype tests with `npm run test:pcb` and the browser/desktop fixture with `npm run qualify:pcb-g0`. The fixture covers routed copper, plated slots, drill voids, thermals, and independent read-back. The manufacturing release needs qualification of the wider supported corpus.

## WP2–WP6 · M1 manufacturing release

- [ ] WP2 · Portable projects, recovery, embedded device/footprint revisions, reviewed legacy migration, footprint editing/import, curated parts, and atomic ECO with cross-probing (PRJ, SYN, LIB).
- [ ] WP3 · Split the browser shell into ES-module entry points for Circuit Design, PCB Design, and Circuit Design + Simulation (WEB-01). Load feature modules, workers and WASM on demand. Preserve edits and undo history when switching workspaces, and release resources owned by the workspace being left.
- [ ] WP3 · Board editor with one/two layers, outlines and cutouts, mechanical tools, component placement, snapping, manual rule-aware routing, plated/non-plated holes, and slots (GEO, LAY, UI, PLC, RTE).
- [ ] WP3 · Extend the existing TinyCAD window, toolbar, sheet tabs, panels and dialogues for PCB tools. Reuse the schematic editor's React/SVG sheet techniques for 2D PCB and footprint editing (UX-11, REN-01).
- [ ] WP3 · Use `.dpn` for PCB open/save dialogs and desktop file associations.
- [ ] WP4 · Deterministic zones/thermals, shared rules, reference fabrication profiles, physical connectivity, parity, DRC coverage and waivers (ZON, RULE, DRC).
- [ ] WP5 · Basic 3D inspection, frozen manufacturing/assembly outputs, independent read-back preview, release manifest, and KiCad subset export (MEC, OUT, interoperability).
- [ ] WP5 · Load the Three.js/WebGL 2 inspection viewer on demand within TinyCAD. Verify board transforms, viewer resource cleanup and SVG editing when WebGL 2 is unavailable (MEC, WEB-01).
- [ ] WP6 · Guided teaching workflow, offline use, accessibility, documentation, recovery and performance. Run the reference boards, §28 acceptance cases, independent CAM checks, and physical qualification.
- [ ] WP6 · Verify WEB-01 in the production browser builds. Trace modules, workers and asset requests for all three cold starts, exercise file opens and direct links, and record idle, peak and retained memory across repeated workspace switches.
- [ ] WP6 · Qualify PCB SVG performance on the classroom corpus and verify schematic-to-PCB tool, panel and dialogue continuity (AT-25).
- [ ] WP6 · Qualify release performance on the §27.1 reference school laptop and compare it with the monitored WP1 development-host baseline.

## WP7–WP8 · Advanced releases

- [ ] WP7 / M2 · Qualify push-and-shove and connected drag, 4/6/8/16-layer boards, richer footprint generation, STEP/DXF, layout reuse, assembly aids, IPC-D-356A, and router exchange.
- [ ] WP7 / M2 · Export bare-board and populated-assembly STL. Verify scale, origin, holes, cutouts, and component envelopes with an independent mesh import (MEC-08).
- [ ] WP8 / M3 · Qualify pair and length tools, engineering analysis, scoped placement/routing, reviewed AI/MCP changes, assembly variants, and panelisation.
- [ ] Keep the research capabilities in §29.5 outside the supported release matrix until separately qualified.
