# PCB schema and schematic migration

This document records the native PCB file contract, the WP0 prototype decisions and the schematic inputs a board can use. The [complete specification](TinyCAD_PCB_Layout_Complete_Specification.md) defines the manufacturing release requirements.

## Schematic identity and migration

| Existing data | PCB meaning and migration |
| --- | --- |
| `DSNIDENTITY` and sheet `id` | Keep the drawing and sheet identities already stored by TinyCAD. A legacy file receives them when opened and persists them on its next native save. Schematic titles, filenames and sheet positions remain labels. |
| `SYMBOL` numeric `id` and runtime `_id` | The XML ID selects an embedded symbol definition. The runtime ID supports editor selection and is recreated on load. `unit_uuid` identifies the placed unit independently of either. |
| `SYMBOL` `part`, definition `PPP`, `HETEROGENEOUS`, and outline | Preserve the source unit and outline. A multipart physical component needs a reviewed binding of unit UUIDs to one component UUID. A shared reference provides evidence for review. |
| `Ref`, `Name`, value and other `FIELD` values | Keep them as editable attributes. Blank or duplicate references require resolution. Renaming metadata preserves the unit UUID. |
| `Package` | Preserve the placed field exactly, including case and punctuation. A library default becomes a placed field when the symbol is created. A nonempty value is a search hint for a versioned device/footprint. Missing, blank, ambiguous and conflicting hints require review. A package name supplies no pin mapping. |
| `PIN` `number`, text, and `part` | Keep the number and name as strings, including `01`, alphanumerics, punctuation and repeated numbers. `pin_uuid` identifies one pin definition within an outline. A placed terminal is referenced by its unit UUID and pin UUID. Distinct pins can share a display number without sharing a signal. |
| `PIN` `elec` | Preserve the native 0–11 electrical category (input, output, tristate, open collector, passive, I/O, NC, free, unspecified, power input, power output, open emitter). An NC type and a drawn `NOCONNECT` remain distinct pieces of evidence. Use the raw pin category for migration. The legacy netlist’s type counters use different numbering for some extended types. |
| `PIN` `which` and `SYMBOL` `show_power` | Pin shape `4` supplies legacy named power behavior when hidden. Pin shape `5` hides artwork while keeping the hotspot electrical. An explicitly shown power pin uses the ordinary pin path. Shape and type do not imply package-pad numbers. |
| `PIN` `pos`, `direction`, `length`, `number_pos`, `centre_name`, and `show` | Keep source artwork and hotspot coordinates for cross-probing. Rotation and scaling affect the schematic hotspot. Number/name visibility, numbering offset, centring and stem length carry no PCB land geometry. |
| `HINT` net numbers, labels and wires | Hints, labels, and local wire geometry are input to the connectivity audit. Persist PCB logical nets by UUID and member terminals. An unchanged member set keeps its UUID across a rename or recompile. A split or merge requires explicit review. |
| Simulation controls and instruments | Explicitly mark known schematic-only controls as excluded in the circuit snapshot. Apply the same reviewed role system for off-board parts, DNP, mechanical features and net ties. |

Opening legacy drawings in the editor assigns unit/pin UUIDs in memory. Saving as `.dsn` or `.dzn` persists them. The standalone drawing service preserves provided UUIDs and leaves legacy identity allocation to the editor. Malformed UUIDs and duplicate placed-unit UUIDs fail parsing. Distinct pin IDs are checked per selected outline during PCB preflight, which allows shared outlines and common power pins.

Moving, rotating, renaming and renumbering a native item preserve its UUID. Symbol replacement preserves the placed-unit UUID and adopts the replacement pin definitions, which need renewed device-map review. Clipboard paste assigns new IDs to placed units and individually copied pin objects. Instances that share a symbol definition keep its pin-definition IDs. Save As and operating-system file copies retain schematic identity. Creating an independent project revision will use explicit project lineage and a fresh revision identity.

## Connectivity capability matrix

| Input | Evidence from the current netlist | Initial PCB compiler contract |
| --- | --- | --- |
| Flat scalar wires and ordinary pins | `makeNetForSheet` joins scalar wire endpoints, visible pin hotspots, junctions and attached labels. The worker merges sheet snapshots on named labels. | Reuse the worker's scalar graph for unique sheet names and references. Bind terminals by UUID and retain label aliases. |
| Implicit hidden power | A shape-4 pin is emitted with a label and no physical hotspot in the netlist. The hidden-power pass deduplicates by reference within each sheet. | Preserve its intended named connection in the flat subset. Review common power pins when resolving multipart units. |
| Drawn no-connect | `NOCONNECT` is emitted as a separate node on the same net as the hotspot. | Retain the explicit marker as intent. Warn on a no-connect marker that also joins other terminals. An isolated pin without a marker has no explicit NC intent. |
| Buses | `BusWire`, `BusSlash`, and `BusLabel` are represented in XML and the editor. The scalar netlist has no member expansion pass. | Detect and stop PCB compilation until the bus expansion is available. |
| Hierarchy | XML retains a `HierarchicalSymbol` sheet. The existing reader and netlist lack placed child-design support and port expansion. | Implement project-backed hierarchy in M1. Until then, reject hierarchy in place of generating an incomplete PCB snapshot. |
| Multipart symbols | The generator emits each placed unit with its `part` and unit-specific pins. It uses reference text in its hidden-power handling. | Keep unit UUIDs and per-unit pins. Require a physical component binding and review repeated references and common pins before compiling. |
| Duplicate sheet names and duplicated references | The worker keys sheet snapshots by display name. Legacy exports emit component rows from reference text. | Report conflicts before PCB compilation. No reference-based automatic merging. |

`npm run test:pcb` exercises native XML/DZN migration, clipboard copy, cross-sheet scalar labels, explicit no-connects, hidden power, and detection of hierarchy, buses and multipart units. Net membership fixtures demonstrate ID retention across renames and identify which previous IDs need review after a split or merge. The schematic-to-board compiler and ECO workflow are WP2 deliverables.

## Hierarchical project schematics

### TinyCAD v3 behavior

In v3, the child drawing has a special symbol sheet with artwork and named pins. The parent places that saved drawing as a symbol, with a reference designator, a transform and wire connections. A parent pin connects to matching labels in the child by name. Each drawing can have several normal circuit sheets, and a child can contain further child placements. The parent can open the child drawing or reload its symbol after an edit. [TinyCAD v3 manual](https://docs.tinycad.net/v3/Using-multiple-sheet-schematics/#using-hierarchical-designs) · [C++ symbol editor and XML codec](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/DrawHierarchicalSymbol.cpp)

The child stores its interface in a `HierarchicalSymbol` sheet under `TinyCADSheets`. The parent stores a `HIERARCHICAL_SYMBOL` placement with a `file` attribute, position, rotation, scaling and `FIELD` records. v3 writes the child path relative to the containing drawing when possible and falls back to the original path. Its readers accept the historical spellings `HierachicalSymbol` and `HIERACHICAL_SYMBOL`. [C++ symbol XML codec](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/DrawHierarchicalSymbol.cpp#L59-L66) · [C++ path handling](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/TinyCadDoc.cpp#L1868-L1904)

The C++ netlister gives each placement its own instance index, expands all sheets in that instance, and links the parent pin's hotspot to the child instance's label of the same name. Same-name labels can join across sheets within an instance. Two placements of the same child keep their internal nets separate. Legacy flattened references include the designator path, for example `H2_H1_R1`. The FAQ records failures involving missing instance references and duplicate port pin numbers, even though users wire ports by name. [C++ traversal and port binding](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/NetList.cpp#L1026-L1068) · [C++ instance-scoped labels](https://github.com/matt123p/TinyCAD/blob/b503a7b1ee8acef937b00c3a99267cd2d25614db/src/Net.h#L104-L135) · [TinyCAD v3 FAQ](https://docs.tinycad.net/v3/FAQ/)

### M1 implementation contract

1. **Authoring and navigation.** Open a project from its root `.tcproject`, select a root schematic, edit a child's interface sheet, and place that child from the project tree. Support wiring, rotation, repeated placements, and navigation from a placement to its child and back through the instance path. Show where a child is used and report port changes that affect connected placements. The interface sheet supplies artwork and ports. Compile electrical circuitry from the normal sheets.
2. **Native persistence and migration.** Keep parents and children as ordinary `.dsn` or `.dzn` files. Preserve the legacy sheet and placement tags on import, accept both historical spellings and write the corrected spellings. Store the reference and transform, child document identity and a project-relative locator for new links, and stable placement and port IDs. Resolve legacy relative paths against the containing schematic first. Resolve or copy legacy absolute and out-of-project targets explicitly during migration, then record the project-relative link. Report missing or ambiguous children and preserve unresolved placements for repair. Verify that a copied project tree opens with its links intact.
3. **Connectivity and identity.** Build the circuit from the selected root and expand each reachable child placement along its full instance path. Reuse the sheet-local connectivity builder and bind parent hotspots to the matching labels across the child's normal sheets. Use names for legacy port matching and retain the resulting stable binding for edits. Qualify power and hidden-pin scope against legacy fixtures and define deliberate global connections explicitly. Scope ordinary labels to their instance. Give physical units and terminals stable identities based on the placement UUID path and native unit/pin IDs. Use readable designator paths for display and export, and diagnose missing or conflicting references and ambiguous port definitions. Detect cycles by tracking the active document chain, so repeated use in different branches remains valid.
4. **Shared consumers and diagnostics.** Feed the expanded graph into ERC, project netlist/BOM generation and PCB synchronisation. Carry instance, document, sheet and pin provenance through to PCB cross-probing and ECO previews. Hierarchy placements provide connectivity through ports. Physical component rows come from the instantiated circuit sheets. Block PCB compilation and netlist generation on unresolved children, cycles or ambiguous port bindings and locate the affected placement or port.

Compare v3 and v4 net membership on a legacy fixture with a multi-sheet child placed twice, a nested grandchild, identical internal labels in each branch, named ports, and power and hidden-power pins. Add cases for historical XML spellings, relocatable project links, renamed designators with stable PCB identities, duplicate ports, a missing child and a cycle. Compare connectivity and physical component counts using v3 output and an explicit expected graph.

## Standalone board format

Production `.dpn` is a single UTF-8 XML document modelled on TinyCAD's `.dsn` format. Use a TinyCAD-prefixed root, uppercase names for domain elements and lowercase attributes for identifiers and values. Follow the `.dsn` pattern of embedding reusable definitions once and referencing them by local ID from placements, as `SYMBOLDEF` and `SYMBOL` do. Keep stable UUIDs for board objects and preserve editable names, references and pad labels as text. See the [proposed XML header](TinyCAD_PCB_Layout_Complete_Specification.md#263-proposed-board-header-example).

The board stores its schema version, revision, required features and authoritative geometry. Coordinates use integer nanometres and rotations use integer microdegrees. In top view, X runs right, Y runs up, and positive angles are counter-clockwise. Bottom placement mirrors local X before the board rotation.

| XML data | Contract |
| --- | --- |
| Board profile | Store a closed straight polygon with an implicit final edge or an ordered analytic line/arc profile with closed cutouts. Coordinates remain within ±500 mm. Curve tessellation is derived and the Gerber profile emits analytic edges. |
| Copper and graphic layers | Store copper in physical stack order. Graphic layers have UUIDs, explicit role and side, and editable names. |
| Source circuit | Optional schematic document UUID, circuit revision and SHA-256 connectivity digest. A project checks the link against its circuit snapshot. The board's own nets and pad assignments support standalone PCB work. |
| Component, device and footprint definitions | Embed each used definition and padstack once per revision. Devices reference a footprint and explicitly assign every pad ID. Placements reference the embedded definitions and store their stable identities, transforms and lock state. |
| Physical padstacks | Store copper, mask and paste per face, with an optional round or straight-slot drill and explicit plating. Bottom placement mirrors geometry and swaps face assignments. |
| Model attachments and assets | Embed resolved STEP bytes once per SHA-256 ID as base64 XML data, with media type and provenance. Model attachments reference that ID and carry the local transform. |
| Optional XML extensions | Preserve unknown optional elements and attributes where possible. Define deterministic output ordering for known elements and attributes while preserving meaningful order such as the layer stack. |
| Unsupported version or required feature | Report a compatibility error before editing. The required-feature list identifies geometry and behavior that a reader must understand. |

A standalone board embeds the definitions, models, nets and rules required to reopen, edit, inspect and regenerate supported outputs without the original schematic, library, project folder or sidecar files. The linked schematic and circuit snapshot are project documents used for cross-probing and ECOs.

The G0 and WP0 prototype codec uses JSON. Add a migration path for supported prototype boards and project entries. Keep the original and validate the resulting XML before saving a converted copy.

Board operations apply atomically against an expected revision. Undo and redo restore content with a fresh revision. Future features add typed entity collections for tracks, vias, zones, cutouts, padstacks and mechanical objects. Those collections need implementation-specific checks and required feature identifiers before use. Filled copper, meshes, spatial indexes and live DRC are rebuildable data and stay out of authoring files.

## KiCad import persistence

For each supported KiCad feature, use the same versioned native fields and validation as for objects authored in TinyCAD. Keep PCB-relevant symbol fields, pin labels and footprint references in native `.tclib`, `.dsn` and `.dzn` data as applicable. Store reviewed device mappings, footprint graphics, padstacks and model attachments in native `.dpn` definitions. M2 board import uses the typed native entities for supported stackup, placements, routing, zones and rules. Keep unsupported items and unresolved asset references visible in the import report.

Store imported and generated STEP attachments with the footprint definition, using the model asset's SHA-256 ID, source, quality, local offset in nanometres, rotation in microdegrees and scale. Apply the attachment transform in footprint coordinates before placing the footprint on the board. Preserve resolved STEP bytes and their provenance in standalone `.dpn` saves and portable projects. Verify import by saving and reopening native files and checking geometry, model alignment and connectivity as applicable.

## Project folder and settings file

A TinyCAD project is a root folder and its entire subtree. A versioned UTF-8 XML `<name>.tcproject` file at the root identifies the folder as a project and holds its shared settings, similar to a Visual Studio `.csproj`. Keep design documents and generated files as ordinary files in the tree. The layout below is an example. Users can organise and name subfolders to suit the design.

```text
Sensor Board/
  Sensor Board.tcproject
  Circuit.dsn
  Board.dpn
  assets/
  outputs/
    BOM.csv
    Circuit.net
    Circuit.snapshot.json
  releases/
```

The settings file records the project UUID, title, schema version, required features, revision lineage, primary documents and schematic-to-board associations. It also stores project-wide design settings, library and asset settings, and output recipes, including their destinations, or root-relative references to shared settings files. Use stable document identities for links and root-relative paths to locate the files. A folder can contain supporting files and subfolders without listing each one in `.tcproject`. Copy or move the whole tree to another location to carry the project with it.

Schematic `.dsn` or `.dzn` and board `.dpn` files remain the editable sources. Generated BOMs, netlists and circuit snapshots are ordinary project files, typically under `outputs/`. Their recipes and source revisions determine freshness. They can be regenerated from the design. Frozen manufacturing releases have their own output and provenance records.

For the M1 workflow, Projects in Electron and Google Drive mode recognises the root settings file and navigates the folder tree. Opening the settings file loads the project context. Saving an edited design writes the design file, and saving project settings writes `.tcproject`. Save As copies the tree and records revision lineage. Revision comparison uses the saved project settings and file contents. Recovery checks for edits to the saved document before restoring an autosave.

Version 1 uses a `TinyCADProject` XML root with one `SETTINGS` element for identity, lineage and primary documents. `FILE` elements link document IDs to folder-relative paths. `ASSOCIATION` elements link schematic and PCB IDs. TinyCAD validates that referenced paths resolve within the project tree and reports missing files, ambiguous names and unsupported required features. Schematic saves retain the format of their linked `.dsn` or `.dzn` file.
