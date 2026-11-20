# PCB schema and schematic migration

This document records the WP0 decisions for native PCB files and the schematic inputs they can use. The [complete specification](TinyCAD_PCB_Layout_Complete_Specification.md) defines the subsequent manufacturing release requirements.

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
| Hierarchy | XML retains a `HierarchicalSymbol` sheet. The existing drawing netlist has no hierarchical instance or port expansion. | Detect and stop PCB compilation until instance and port expansion is available. |
| Multipart symbols | The generator emits each placed unit with its `part` and unit-specific pins. It uses reference text in its hidden-power handling. | Keep unit UUIDs and per-unit pins. Require a physical component binding and review repeated references and common pins before compiling. |
| Duplicate sheet names and duplicated references | The worker keys sheet snapshots by display name. Legacy exports emit component rows from reference text. | Report conflicts before PCB compilation. No reference-based automatic merging. |

`npm run test:pcb` exercises native XML/DZN migration, clipboard copy, cross-sheet scalar labels, explicit no-connects, hidden power, and detection of hierarchy, buses and multipart units. Net membership fixtures demonstrate ID retention across renames and identify which previous IDs need review after a split or merge. The schematic-to-board compiler and ECO workflow are WP2 deliverables.

## Standalone board format

`.dpn` is UTF-8 JSON with `format: "tinycad-pcb"`, an integer `schemaVersion`, a board UUID, a non-negative revision, and a required-feature list. Version 1 uses integer nanometres and integer microdegrees. In top view, X runs right, Y runs up, and positive angles are counter-clockwise. Bottom placement mirrors local X before the board rotation. In source files, IDs are references and labels remain editable text.

| Version 1 field | Contract |
| --- | --- |
| `outline` | Closed straight polygon, using an implicit final edge from last to first vertex. Integer coordinates within ±500 mm, no zero-length edges, overlap or self-intersection. The `straight-outline` feature is required for this reader. |
| `copperLayers`, `graphicLayers` | Ordered physical top and optional bottom copper. Graphic layers have UUIDs, explicit role and side, and editable names. Graphic layer IDs cannot serve as physical copper layer IDs. |
| `sourceCircuit` | Optional source document UUID, circuit revision and SHA-256 connectivity digest. A board without a source is an independent board. The digest is checked against the accompanying circuit snapshot when the project is loaded. |
| `footprintDefinitions`, `deviceDefinitions`, `footprints` | Embedded revisioned definitions and per-board placements, declared together with `embedded-devices`. Definitions have IDs and content-digest fields. Devices reference a footprint and explicitly assign every pad ID. Placements reference a device and component UUID and store integer transforms and lock state. |
| Unknown optional fields | Preserve JSON data at every nesting level when editing or saving. Object keys are sorted on serialization. Geometry or behavior needed to interpret a board must also have a required feature identifier. |
| Unsupported version or required feature | Reject explicitly before editing. Version 1 files written by the initial straight-outline prototype are accepted without migration. A future migration writes a new candidate, validates it and preserves the original. |

Board operations apply atomically against an expected revision. Undo and redo restore content with a fresh revision. Future features add typed entity collections for tracks, vias, zones, cutouts, padstacks and mechanical objects. Those collections need implementation-specific checks and required feature identifiers before use. Filled copper, meshes, spatial indexes and live DRC are rebuildable data and stay out of authoring files.

## Portable project decision

Use a ZIP container identified by a versioned `manifest.json`, with `.tcproject` as the provisional extension. A source-control directory uses the same logical entries. Store schematic source as native `.dsn` or `.dzn`, PCB source as `.dpn`, and circuit snapshots and output recipes as UTF-8 JSON. Include resolved asset bytes when required for offline use. Keep authoring files and frozen release bundles separate.

| Entry | Content |
| --- | --- |
| `manifest.json` | Project UUID, project revision UUID, optional parent revision UUID, schema version, title, required features and entry list with path, kind, content hash and document identity where applicable. |
| `schematics/<id>.dsn` or `schematics/<id>.dzn` | Recoverable native circuit source. Keep original legacy bytes in the backup when upgrading identities. |
| `circuits/<id>.json` | Circuit UUID and revision, stable components/units/signals, explicit physical roles, terminal bindings, and intended nets. Retain UUIDs from the previous snapshot when terminal membership is unchanged. |
| `boards/<id>.dpn` | Board source with frozen device/footprint definitions and the source snapshot identity, revision and connectivity digest. |
| `rules/<id>.json`, `recipes/<id>.json` | Versioned constraints and output configuration with their own stable IDs. |
| `assets/<sha256>` | Content-addressed supporting bytes such as 3D models, with provenance, media type and license in the corresponding asset metadata. |

Write and validate a staged archive before replacing a saved project. Require unique relative paths, a size budget and verified entry hashes at load. Open a migrated copy, retain the source, and block editing when a required feature is unknown. An explicit library refresh replaces dependencies only through a reviewed change set. Implementing archive I/O, digest verification, revision comparison and recovery is part of WP2/WP6.
