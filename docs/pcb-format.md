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

| Input | Evidence from the schematic | PCB compiler contract |
| --- | --- | --- |
| Flat scalar wires and ordinary pins | `makeNetForSheet` joins scalar wire endpoints, visible pin hotspots, junctions and attached labels. The worker merges sheet snapshots on named labels. | Reuse the worker's scalar graph for unique sheet names and references. Bind terminals by UUID and retain label aliases. |
| Implicit hidden power | A hidden shape-4 pin supplies a named connection without a wire hotspot. | Compile it on its authored unit and scope its name to the schematic instance. A shown power pin follows its drawn connection. |
| Drawn no-connect | `NOCONNECT` is emitted as a separate node on the same net as the hotspot. | Persist an explicit no-connect on its terminal. Diagnose orphaned markers and markers that share a live connection. |
| Buses | Bus wires, entry slashes and bus names group signals visually. Scalar wires and their labels carry member connectivity. | Compile members independently using labels such as `DATA(0)` and `DATA(1)`. Diagnose a VHDL vector range such as `DATA(7:0)` when used as an electrical PCB wire label. [TinyCAD bus documentation](https://docs.tinycad.net/v4/Buses/) |
| Hierarchy | See the [project hierarchy contract](project-specification.md#hierarchical-project-schematics). | The PCB snapshot preserves the source document, sheet, placement path, unit and pin UUIDs. |
| Multipart symbols | Each placed symbol specifies its unit and pin definitions. | Use a reviewed package binding to combine units and retain each terminal's source UUIDs. |
| Duplicate references | Legacy exports use reference text. | Diagnose references that collide between physical components. Match units by their explicit binding. |

### Authoring PCB component intent

Use the symbol's placed attributes to specify physical intent. These fields are saved in both `.dsn` and `.dzn`.

| Attribute | Value |
|---|---|
| `PCB Role` | `electrical`, `dnp`, `virtual`, `off-board` or `net-tie`. Ordinary symbols default to electrical and built-in simulation controls default to virtual. Virtual and off-board symbols retain their schematic provenance and contribute no physical terminal memberships. Adding or removing them leaves the physical connectivity digest unchanged when the PCB nets are identical. Use a separate electrical connector for an off-board device's board interface. Author PCB-only components on the board. |
| `PCB Component` | Set the same reviewed UUID on each unit in a multipart package. Place each unit once and give all units the same reference, role and value. Supply a consistent package hint when available. The binding is scoped to the source document and hierarchy instance and preserves component identity across a rename. |
| `PCB Shared Pins` | An optional JSON list of pin numbers, such as `["EP"]`, on every unit of a reviewed package. Each listed pin must appear on at least two units with consistent pin definitions and one common net or explicit no-connect intent. Each shared signal retains every source terminal. |

`npm run test:pcb` exercises these fields and circuit snapshots through XML and compressed DZN saves. Net membership fixtures demonstrate ID retention across renames and identify which previous IDs need review after a split or merge.

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

## Reviewed device definitions

A reusable `.tcdevice.json` file describes one versioned device, its package aliases, reviewed pinout provenance, explicit terminal-to-pad assignments and full footprint. Optional nominal pitch and required body dimensions are in nanometres. Each electrical pad maps to a terminal UUID. Several lands may share a terminal UUID. NC, reserved and mechanical pads each carry an explicit role. Package names and display pin numbers have no effect on the map.

The file has `format: "tinycad-device"` and `version: 1`. The footprint's `definitionDigest` is the SHA-256 of its UTF-8 JSON with sorted object keys and without the digest field. TinyCAD checks the footprint digest and each STEP asset. Publish changed contents under a new revision of the same device UUID. [Device file reader and writer](../src/pcb/deviceLibrary.ts)

The board's `DEVICEDEFS` record embeds the resolved assignments. Its `LIBRARYSOURCE` records the catalogue device and footprint UUIDs, full device file digest, reviewer, evidence, licence and explicit binding from device terminal UUIDs to this component's schematic signal UUIDs. The embedded board definitions, including any STEP bytes, stay usable offline. A catalogue refresh previews changes by pad UUID and updates the selected component only after approval. Its footprint keeps its placement transform.

See the [project device review workflow](project-specification.md#reviewed-pcb-devices) for catalogue discovery and review.

## KiCad import persistence

For each supported KiCad feature, use the same versioned native fields and validation as for objects authored in TinyCAD. Keep PCB-relevant symbol fields, pin labels and footprint references in native `.tclib`, `.dsn` and `.dzn` data as applicable. Store reviewed device mappings, footprint graphics, padstacks and model attachments in native `.dpn` definitions. M2 board import uses the typed native entities for supported stackup, placements, routing, zones and rules. Keep unsupported items and unresolved asset references visible in the import report.

Store imported and generated STEP attachments with the footprint definition, using the model asset's SHA-256 ID, source, quality, local offset in nanometres, rotation in microdegrees and scale. Apply the attachment transform in footprint coordinates before placing the footprint on the board. Preserve resolved STEP bytes and their provenance in standalone `.dpn` saves and portable projects. Verify import by saving and reopening native files and checking geometry, model alignment and connectivity as applicable.

## Project integration

For the folder layout, `.tcproject` schema and project file lifecycle, see the [project specification](project-specification.md).
