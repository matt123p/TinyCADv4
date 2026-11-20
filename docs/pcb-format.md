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

Moving, rotating, renaming and renumbering a native item preserve its UUID. Symbol replacement preserves the placed-unit UUID and adopts the replacement pin definitions, which need renewed device-map review. Clipboard paste assigns new IDs to placed units and individually copied pin objects. Instances that share a symbol definition keep its pin-definition IDs. Save As and operating-system file copies retain schematic identity. See [project revision lineage](project-specification.md#document-lifecycle-and-recovery).

## Connectivity capability matrix

| Input | Evidence from the current netlist | Initial PCB compiler contract |
| --- | --- | --- |
| Flat scalar wires and ordinary pins | `makeNetForSheet` joins scalar wire endpoints, visible pin hotspots, junctions and attached labels. The worker merges sheet snapshots on named labels. | Reuse the worker's scalar graph for unique sheet names and references. Bind terminals by UUID and retain label aliases. |
| Implicit hidden power | A shape-4 pin is emitted with a label and no physical hotspot in the netlist. The hidden-power pass deduplicates by reference within each sheet. | Preserve its intended named connection in the flat subset. Review common power pins when resolving multipart units. |
| Drawn no-connect | `NOCONNECT` is emitted as a separate node on the same net as the hotspot. | Retain the explicit marker as intent. Warn on a no-connect marker that also joins other terminals. An isolated pin without a marker has no explicit NC intent. |
| Buses | `BusWire`, `BusSlash`, and `BusLabel` are represented in XML and the editor. The scalar netlist has no member expansion pass. | Detect and stop PCB compilation until the bus expansion is available. |
| Hierarchy | See the [project hierarchy contract](project-specification.md#hierarchical-project-schematics). | The PCB snapshot preserves the source document, sheet, placement path, unit and pin UUIDs. |
| Multipart symbols | The generator emits each placed unit with its `part` and unit-specific pins. It uses reference text in its hidden-power handling. | Keep unit UUIDs and per-unit pins. Require a physical component binding and review repeated references and common pins before compiling. |
| Duplicate sheet names and duplicated references | The worker keys sheet snapshots by display name. Legacy exports emit component rows from reference text. | Report conflicts before PCB compilation. No reference-based automatic merging. |

`npm run test:pcb` exercises native XML/DZN migration, clipboard copy, cross-sheet scalar labels, explicit no-connects, hidden power, and detection of hierarchy, buses and multipart units. Net membership fixtures demonstrate ID retention across renames and identify which previous IDs need review after a split or merge. The schematic-to-board compiler and ECO workflow are WP2 deliverables.

## Standalone board format

Production `.dpn` is a single UTF-8 XML document modelled on TinyCAD's `.dsn` format. Use a TinyCAD-prefixed root, uppercase names for domain elements and lowercase attributes for identifiers and values. Follow the `.dsn` pattern of embedding reusable definitions once and referencing them by local ID from placements, as `SYMBOLDEF` and `SYMBOL` do. Keep stable UUIDs for board objects and preserve editable names, references and pad labels as text. See the [XML board example](TinyCAD_PCB_Layout_Complete_Specification.md#263-board-xml-example).

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

Standalone PCB editing in the desktop and filesystem-only browser builds follows the [Single File workflow](project-specification.md#single-file-and-project-modes).

Version 1 is the first persisted board format. `DPNIDENTITY`, `COORDINATES`, `TITLE`, `REQUIREDFEATURES` and `COPPERLAYERS` describe every board. An `OUTLINE` contains ordered integer `POINT` records. A `PROFILE` has an `OUTLINE` of ordered `EDGE` records and a `CUTOUTS` collection. Each edge carries `START` and `END`. Arcs also carry `CENTRE` and a `clockwise` flag.

`FOOTPRINTS` references `COMPONENTDEFS` and `DEVICEDEFS` by embedded UUID. Devices reference `FOOTPRINTDEFS` by UUID and map their `SIGNALS` to pad IDs in `ASSIGNMENTS`. Pads reference `PADSTACKDEFS` by a positive file-local integer ID. Identical stacks share a single definition. Each stack defines face geometry in `COPPER`, optional `MASK` and `PASTE`, and an optional `DRILL` with separate endpoints and an explicit plating flag. Component definitions carry schematic unit and sheet UUIDs where available. Component signal bindings reference UUIDs in `NETS`, and `RULES` stores board-wide routing widths and clearances in nanometres.

`MODELASSETS` stores canonical base64 in each `MODELASSET` record. Its ID is the lowercase SHA-256 hex digest of the decoded bytes. TinyCAD verifies the digest on read and write. An attachment with an asset ID must resolve in the file. An attachment with only a source and transform records an unresolved model. The codec does not fetch external files. Each model asset is limited to 32 MiB, with 64 MiB for all assets and 128 MiB for the complete XML file.

The writer orders known record fields consistently and retains authored list order. Optional XML attributes and child elements on domain records survive edits. Unknown properties in the in-memory board model use named `PROPERTY` elements. Structural lists accept their declared item type. An unsupported required feature or format version prevents loading. The version 1 field map is maintained in the board codec. [Board codec](../src/pcb/boardCodec.ts)

Board operations apply atomically against an expected revision. Undo and redo restore content with a fresh revision. Future features add typed entity collections for tracks, vias, zones and mechanical objects. Those collections need implementation-specific checks and required feature identifiers before use. Filled copper, meshes, spatial indexes and live DRC are rebuildable data and stay out of authoring files.

## KiCad import persistence

For each supported KiCad feature, use the same versioned native fields and validation as for objects authored in TinyCAD. Keep PCB-relevant symbol fields, pin labels and footprint references in native `.tclib`, `.dsn` and `.dzn` data as applicable. Store reviewed device mappings, footprint graphics, padstacks and model attachments in native `.dpn` definitions. M2 board import uses the typed native entities for supported stackup, placements, routing, zones and rules. Keep unsupported items and unresolved asset references visible in the import report.

Store imported and generated STEP attachments with the footprint definition, using the model asset's SHA-256 ID, source, quality, local offset in nanometres, rotation in microdegrees and scale. Apply the attachment transform in footprint coordinates before placing the footprint on the board. Preserve resolved STEP bytes and their provenance in standalone `.dpn` saves and portable projects. Verify import by saving and reopening native files and checking geometry, model alignment and connectivity as applicable.

## Project integration

For the folder layout, `.tcproject` schema and project file lifecycle, see the [project specification](project-specification.md).
