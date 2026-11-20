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
- [ ] Add analytic arcs, real cutouts, offsets, and polygon operations behind tested geometry APIs.
- [ ] Compare TypeScript and candidate WASM geometry on the specification’s mixed SMD/PTH, thermal, plated slot, and polygon pad fixture. Record licensing, performance, cancellation, and correctness.
- [x] Exercise explicit pad assignments with duplicate and alphanumeric labels and test top/bottom quarter-turn transforms on an asymmetric footprint (LIB-01).
- [ ] Extend mapping and placement to embedded devices, arbitrary orientation, padstacks, and reviewed terminal equivalence (LIB-02–07, LAY-04).
- [x] Test exact round-copper contact, seeded shorts/opens, and plated/non-plated interlayer joins on a bounded fixture.
- [ ] Extend copper connectivity to drilled annuli, tracks, arbitrary pads, and zone geometry. Define net ties, jumpers, and equivalent terminals.
- [ ] Prototype rule-aware obstacle routing and via placement. Use the measurements to choose the M1 router strategy.
- [ ] Prototype Gerber/drill/profile writing and independent read-back. Detect edited or missing manufacturing geometry and verify browser/desktop equivalence.
- [ ] Publish the G0 supported-feature matrix and stop/go decisions against §29.2.

Run the prototype fixtures with `npm run test:pcb`. They use round copper discs and explicit interlayer joins. Production connectivity also needs drill voids, routed copper, zones, and validation from independent manufacturing read-back.

## WP2–WP6 · M1 manufacturing release

- [ ] WP2 · Portable projects, recovery, embedded device/footprint revisions, reviewed legacy migration, footprint editing/import, curated parts, and atomic ECO with cross-probing (PRJ, SYN, LIB).
- [ ] WP3 · Board editor with one/two layers, outlines and cutouts, mechanical tools, component placement, snapping, manual rule-aware routing, plated/non-plated holes, and slots (GEO, LAY, UI, PLC, RTE).
- [ ] WP3 · Use `.dpn` for PCB open/save dialogs and desktop file associations.
- [ ] WP4 · Deterministic zones/thermals, shared rules, reference fabrication profiles, physical connectivity, parity, DRC coverage and waivers (ZON, RULE, DRC).
- [ ] WP5 · Basic 3D inspection, frozen manufacturing/assembly outputs, independent read-back preview, release manifest, and KiCad subset export (MEC, OUT, interoperability).
- [ ] WP6 · Guided teaching workflow, offline use, accessibility, documentation, recovery and performance. Run the reference boards, §28 acceptance cases, independent CAM checks, and physical qualification.

## WP7–WP8 · Advanced releases

- [ ] WP7 / M2 · Qualify push-and-shove and connected drag, 4/6/8/16-layer boards, richer footprint generation, STEP/DXF, layout reuse, assembly aids, IPC-D-356A, and router exchange.
- [ ] WP7 / M2 · Export bare-board and populated-assembly STL. Verify scale, origin, holes, cutouts, and component envelopes with an independent mesh import (MEC-08).
- [ ] WP8 / M3 · Qualify pair and length tools, engineering analysis, scoped placement/routing, reviewed AI/MCP changes, assembly variants, and panelisation.
- [ ] Keep the research capabilities in §29.5 outside the supported release matrix until separately qualified.
