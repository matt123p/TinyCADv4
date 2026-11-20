# TinyCAD PCB layout implementation

The [PCB layout specification](TinyCAD_PCB_Layout_Complete_Specification.md) and [project specification](project-specification.md) govern scope and acceptance. This list follows their work packages and release gates. Check off an item when its stated behavior has been verified.

## WP0 · Repository audit and schema

- [x] Record the [PCB schema, pin/package migration rules and capability matrix](pcb-format.md) and the [project folder contract](project-specification.md#project-folder-and-settings-file).
- [x] Trace schematic save/load, connectivity, package metadata, and undo.
- [x] Qualify schematic identity migration for new placements, legacy `.dsn` and `.dzn`, edits, and clipboard copies (PRJ-02, SYN-01).
- [x] Audit hierarchy, buses, scalar cross-sheet labels, hidden power, multipart units, and explicit no-connects against reference circuits. Document the initial flat scalar subset and the preflight checks.
- [x] Verify that unchanged net membership retains its UUID across renames and that split/merge proposals identify prior net IDs for review.
- [x] Prototype a versioned JSON board document with stable board identity, ordered copper layers, and deterministic serialisation. Verify atomic outline/title edits, stale-command rejection, and undo/redo.
- [x] Reserve `.dpn` for native standalone PCB layouts.
- [x] Add source and entity identities, graphic layers, embedded device definitions, optional-field preservation and compatibility tests to the version 1 prototype board schema (PRJ-02, PRJ-03, LAY-01, ARC-01–08).
- [x] Document the [project folder and settings model](project-specification.md#project-folder-and-settings-file) (PRJ-01, PRJ-05).

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

- [ ] WP2 · Project folders, hierarchical schematics, recovery, embedded device/footprint revisions, reviewed legacy migration, footprint editing/import, curated parts, and atomic ECO with cross-probing (PRJ, SYN, LIB).
  - [x] Implement project folders with a root XML `.tcproject` settings file, validated root-relative links and ordinary native source files (PRJ-01, PRJ-05).
  - [x] Update the project browser in Electron and Google Drive mode to create, identify and open project roots and navigate the tree. Save edits to the native document, copy the tree on Save As, compare revisions by relative path and verify recovery against saved documents. Preserve independent Libraries visibility and verify that filesystem-only builds omit Projects (PRJ-04, PRJ-06, PRJ-09, AT-21, AT-29).
  - [x] Specify and implement the standalone UTF-8 XML `.dpn` codec using `.dsn` naming and embedded-definition conventions. Embed used component, device, footprint and padstack definitions and resolved model assets. Verify an offline round trip (§26 and the codec portion of AT-28).
  - [x] Implement [hierarchical project schematics](project-specification.md#hierarchical-project-schematics). Read both v3 XML spellings, resolve child files under the project root, and add interface-sheet editing, child placement and instance navigation (SYN-11).
  - [x] Expand repeated and nested child instances and bind named ports before building circuit snapshots. Verify v3 connectivity parity and path-stable identities. Use the expanded graph for ERC, BOMs, netlists and PCB cross-probing/ECOs (SYN-01, SYN-11, AT-30).
  - [x] Compile bus, hidden-power, multipart and no-connect fixtures into stable circuit snapshots, with explicit physical roles and terminal provenance (SYN-01, SYN-08).
  - [x] Resolve legacy package hints through reviewed versioned devices, validate explicit mappings, and support embedded dependencies and reviewed library refresh (LIB-01–10).
  - [ ] Preview and apply revision-guarded ECOs atomically, preserve unaffected layout, report impacted copper, and cross-probe board terminals and schematic pins (SYN-02–07).
  - [ ] Implement [direct schematic-to-PCB transfer](project-specification.md#creating-and-updating-a-linked-pcb) for first board creation and later updates, with automatic compilation, explicit approval and visible sync status (SYN-01, AT-33–34).
  - [ ] Implement [forward and back annotation of reference designators](project-specification.md#schematic-and-pcb-synchronisation) and qualify the round trip, repeated instances and multipart components (SYN-09, AT-31–32).
  - [ ] Add the TinyCAD SVG footprint editor and dimensional checks. Extend KiCad symbol and footprint import to preserve supported PCB metadata, geometry and model attachment references in native TinyCAD files, with a loss report and save/reopen fixtures (FPT-01–06, §22).
  - [ ] Define the [starter package catalogue](TinyCAD_PCB_Layout_Complete_Specification.md#102-curated-supplied-library) and write reproducible Python generators that emit matched TinyCAD footprints and STEP models from the same dimensions. Cover multiple sizes and pin counts across the listed surface-mount and through-hole families (FPT-07, FPT-09).
  - [ ] Review and bundle the generated assets for the PCB engine. Verify the catalogue and embedded asset codec work offline (FPT-09, AT-16).
- [ ] WP3 · Keep Circuit Design, PCB Design, and Circuit Design + Simulation inside one existing TinyCAD shell (UX-11, WEB-01). Load workspace feature modules, workers and WASM on demand. Preserve edits and undo history when switching workspaces, and release resources owned by the workspace being left.
  - [ ] Connect the shared project browser to PCB Design in Electron and Google Drive mode. Register standalone PCB Design in the filesystem-only browser build and verify direct `.dpn` opens (PRJ-09, WEB-01, AT-28).
- [ ] WP3 · Board editor with one/two layers, outlines and cutouts, mechanical tools, component placement, snapping, manual rule-aware routing, plated/non-plated holes, and slots (GEO, LAY, UI, PLC, RTE).
- [ ] WP3 · Reuse and extend the shared window layout, menus, toolbar, sheet tabs, panels, dialogues, commands, and document lifecycle for PCB tools. Reuse the schematic editor's React/SVG sheet infrastructure for 2D PCB and footprint editing (UX-11, REN-01).
- [ ] WP3 · Use the standalone XML `.dpn` codec in PCB open/save dialogs, desktop file associations and project board I/O. Verify that a copied board opens offline with its embedded components and model data (AT-28).
- [ ] WP4 · Deterministic zones/thermals, shared rules, reference fabrication profiles, physical connectivity, parity, DRC coverage and waivers (ZON, RULE, DRC).
- [ ] WP5 · Basic 3D inspection, frozen manufacturing/assembly outputs, independent read-back preview, release manifest, and KiCad subset export (MEC, OUT, interoperability).
- [ ] WP5 · Implement [project output generation](project-specification.md#generated-project-files) (OUT-07, AT-29).
- [ ] WP5 · Load the Three.js/WebGL 2 inspection viewer on demand within TinyCAD. Verify board transforms, viewer resource cleanup and SVG editing when WebGL 2 is unavailable (MEC, WEB-01).
- [ ] WP5 · Import STEP models from KiCad libraries, including models referenced by imported footprints. Use asymmetric top/bottom placements to test scale, offset and rotation, missing-model reporting and offline reopen. Exercise bundled generated STEP models through the same 3D placement checks (MEC-09, AT-27).
- [ ] WP6 · Guided teaching workflow, offline use, accessibility, documentation, recovery and performance. Run the reference boards, §28 acceptance cases, independent CAM checks, and physical qualification.
- [ ] WP6 · Verify WEB-01 in the production browser builds. Trace modules, workers and asset requests for all three cold starts, exercise file opens and direct links, and record idle, peak and retained memory across repeated workspace switches.
- [ ] WP6 · Qualify PCB SVG performance on the classroom corpus and verify schematic-to-PCB tool, panel and dialogue continuity (AT-25).
- [ ] WP6 · On a clean installation, run the end-to-end checks for bundled and imported models, copied standalone boards and project folders, generated project outputs, and v3 hierarchy migration and cross-probing (AT-26–30).
- [ ] WP6 · Qualify release performance on the §27.1 reference school laptop and compare it with the monitored WP1 development-host baseline.

## Project browser follow-up

- [ ] Implement the expanded [project browser workflow](project-specification.md) and verify the [project acceptance cases](project-specification.md#project-acceptance-cases).
- [ ] Preserve the TinyCAD v4.1.0 [Single File workflow](project-specification.md#single-file-and-project-modes). Add the startup preference and in-window transition to Project mode.
- [ ] Add the vertical [sidebar activity bar](project-specification.md#sidebar-activity-bar) in Project mode and desktop and Drive [drag-and-drop import](project-specification.md#drag-and-drop-into-the-project).
- [ ] Integrate [Git source control](project-specification.md#git-source-control) in Electron and verify interoperability with command-line Git.
- [ ] Support [one PCB per board folder and an optional system schematic](project-specification.md#board-sources-and-multi-board-projects). Verify independent board updates and cross-board connector mappings.

## WP7–WP8 · Advanced releases

- [ ] WP7 / M2 · Qualify walk-around, push-and-shove and connected drag, 4/6/8/16-layer boards, expanded footprint/STEP generation, layout reuse, assembly aids, IPC-D-356A, and router exchange.
- [ ] WP7 / M2 · Qualify manual 3D model alignment, STEP assembly export, and DXF mechanical exchange (FPT-08, MEC-04–06).
- [ ] WP7 / M2 · Implement [back annotation of component values](project-specification.md#schematic-and-pcb-synchronisation) (SYN-12).
- [ ] WP7 / M2 · Import the supported KiCad board subset as editable `.dpn`, optionally linked into a project folder through its `.tcproject` settings. Expand library and model import alongside newly supported PCB features and verify native round trips, connectivity and reported losses (§22).
- [ ] WP7 / M2 · Export bare-board and populated-assembly STL. Verify scale, origin, holes, cutouts, and component envelopes with an independent mesh import (MEC-08).
- [ ] WP8 / M3 · Qualify pair and length tools, engineering analysis, scoped placement/routing, reviewed AI/MCP changes, assembly variants, and panelisation.
- [ ] Keep the research capabilities in §29.5 outside the supported release matrix until separately qualified.
