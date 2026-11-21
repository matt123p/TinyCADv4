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
| Source circuit | Optional schematic document UUID, circuit revision and SHA-256 connectivity digest. An applied ECO embeds the corresponding circuit in `APPLIEDCIRCUIT`. The board's own nets and pad assignments support standalone PCB work. |
| Routed copper | Tracks store endpoints, width and layer. Through vias store a position, diameter and drill. Routes may retain their geometry with no net assignment. `reviewRequired` flags copper affected by an ECO. |
| Component, device and footprint definitions | Embed each used definition and padstack once per revision. Devices reference a footprint and explicitly assign every pad ID. Placements reference the embedded definitions and store their stable identities, transforms and lock state. |
| Physical padstacks | Store copper, mask and paste per face, with an optional round or straight-slot drill and explicit plating. Bottom placement mirrors geometry and swaps face assignments. |
| Model attachments and assets | Embed resolved STEP bytes once per SHA-256 ID as base64 XML data, with media type and provenance. Model attachments reference that ID and carry the local transform. |
| Optional XML extensions | Preserve unknown optional elements and attributes where possible. Define deterministic output ordering for known elements and attributes while preserving meaningful order such as the layer stack. |
| Unsupported version or required feature | Report a compatibility error before editing. The required-feature list identifies geometry and behavior that a reader must understand. |

A standalone board embeds the definitions, models, nets and rules required to reopen, edit, inspect and regenerate supported outputs without the original schematic, library, project folder or sidecar files. The linked schematic and circuit snapshot are project documents used for cross-probing and ECOs.

Standalone PCB editing in the desktop and filesystem-only browser builds follows the [Single File workflow](project-specification.md#single-file-and-project-modes).

On a board without a source circuit, **Board connections…** edits the native net list and component signal bindings. Assigning **Unassigned** removes the signal's net binding. Changing a routed pad's assignment reviews the resulting copper topology and flags affected routes for design checks. Imported reviewed devices with the same revision digest share the embedded device, footprint and model definitions across component placements.

Version 1 is the first persisted board format. `DPNIDENTITY`, `COORDINATES`, `TITLE`, `REQUIREDFEATURES` and `COPPERLAYERS` describe every board. An `OUTLINE` contains ordered integer `POINT` records. A `PROFILE` has an `OUTLINE` of ordered `EDGE` records and a `CUTOUTS` collection. Each edge carries `START` and `END`. Arcs also carry `CENTRE` and a `clockwise` flag.

`FOOTPRINTS` references `COMPONENTDEFS` and `DEVICEDEFS` by embedded UUID. Devices reference `FOOTPRINTDEFS` by UUID and map their `SIGNALS` to pad IDs in `ASSIGNMENTS`. Pads reference `PADSTACKDEFS` by a positive file-local integer ID. Identical stacks share a single definition. Each stack defines face geometry in `COPPER`, optional `MASK` and `PASTE`, and an optional `DRILL` with separate endpoints and an explicit plating flag. Component definitions carry schematic unit and sheet UUIDs where available. Component signal bindings reference UUIDs in `NETS`, and `RULES` stores board-wide routing widths and clearances in nanometres.

`APPLIEDCIRCUIT` stores the exact compiled components, signals, net members, no-connects and instance provenance for an applied ECO. Its identity and revision match `SOURCECIRCUIT`, and the reader verifies its physical connectivity digest. The circuit and board layout commit in a single version-guarded board write. A net rename can keep its UUID and copper. When a net is retired, its tracks and vias retain their geometry and IDs, and affected routes with unresolved assignment open with the review flag set.

`MODELASSETS` stores canonical base64 in each `MODELASSET` record. Its ID is the lowercase SHA-256 hex digest of the decoded bytes. TinyCAD verifies the digest on read and write. An attachment with an asset ID must resolve in the file. An attachment with only a source and transform records an unresolved model. The codec does not fetch external files. Each model asset is limited to 32 MiB, with 64 MiB for all assets and 128 MiB for the complete XML file.

STEP coordinates are in millimetres after decoding. A native attachment scales locally, rotates about X, Y and Z in that order, and adds its offset in the footprint frame. The board mount mirrors local X and reverses local Z on the bottom face before applying the board rotation. KiCad stores clockwise model rotations, which the importer converts to the native counter-clockwise convention. [KiCad 9.0.0 model transform](https://github.com/KiCad/kicad-source-mirror/blob/9.0.0/3d-viewer/3d_rendering/opengl/render_3d_opengl.cpp#L964-L986)

The writer orders known record fields consistently and retains authored list order. Optional XML attributes and child elements on domain records survive edits. Unknown properties in the in-memory board model use named `PROPERTY` elements. Structural lists accept their declared item type. An unsupported required feature or format version prevents loading. The version 1 field map is maintained in the board codec. [Board codec](../src/pcb/boardCodec.ts)

`MECHANICALHOLES` stores standalone drills and routed slots. Each `HOLE` has an ID, centreline endpoints, a finished width and an explicit plating flag. A plated hole has a copper land width on the board’s physical layers. Extra routing clearance is measured outside the drill opening. Round holes have equal endpoints. The `mechanical-holes` feature distinguishes these objects from outline cutouts, footprint padstacks and vias.

In **Hole or slot…**, an optional screw-head diameter on a round hole reserves copper clearance on the top, bottom or both sides. **Extra component clearance** extends the reserved area for footprints beyond the screw head. TinyCAD checks placed courtyards on the selected sides and reports origin-only coverage for footprints without a closed courtyard. Routing and copper zones avoid the screw head, and design checks report existing copper that touches it. The saved `screwHeadDiameterNm`, `screwHeadSide` and `bodyClearanceNm` fields control the keep-outs. The fabrication drill file uses the hole's finished dimensions. KiCad export preserves the hole and reports the clearance settings for review.

The `copper-zones` feature adds `ZONES`. Each `ZONE` has a stable ID, net, layer, polygon outline and optional polygon cutouts. It records priority, clearance, separate pad and via connection modes, thermal spoke width and gap, and what to do with islands. Higher priorities fill first. Equal priorities use ascending UUID order. A lower-priority zone on another net honours the greater of the two clearances. Zones whose nets have been retired keep their definitions and require reassignment before they fill.

**Cancel zone fill** clears the displayed fill and preserves the zone definitions and unsaved board edits. Choose **Refill zones** to compute the current PCB revision or **Retry zone fill** after a worker error. The manufacturing preview computes its own fill from the current board.

Design checks compare zone copper to the effective minimum width for its net. They locate narrow webs between opposing boundaries and report joins that disappear when the filled copper is inset by half the required width. The check considers adjoining same-net copper on the same layer and subtracts drill openings. Thermal spokes have separate checks. If the geometry check exceeds its comparison budget, the diagnostic CAM remains available and manufacturing release is blocked.

Design checks measure each generated east, north, west and south thermal spoke against the greater of the zone’s configured spoke width and the board’s effective minimum copper width. A directional finding distinguishes a missing bridge from a narrowed bridge and includes the measured and required widths. The measurement tests a continuous path across the filled gap with a 0.2 µm geometry tolerance. Manufacturing review inherits the same findings. Measuring a spoke leaves the generated copper unchanged.

`FABRICATION` stores board thickness in nanometres and an optional versioned fabrication profile. **Fabrication settings** edits the base routing rules and displays the selected profile limits. Routing and DRC take the higher minimum where both define a limit. The profile also checks finished drill and slot sizes, opening spacing, pad rings, mask webs, paste apertures and legend strokes and clearances. The 3D renderer uses the saved thickness. The generic profiles provide design starting points for FR-4 with one-ounce outer copper and green solder mask. Confirm process limits with the selected fabricator. [Fabrication capability reference](https://jlcpcb.com/capabilities/pcb-capabilities)

The generic profiles allow a 1:1 solder mask opening. When a pad defines a mask opening on a copper layer, the opening must expose the whole land. A paste opening must have a matching copper land, meet the minimum stencil aperture size and cover at least 50% of its land area. TinyCAD measures the actual overlap on the mounted side, so offset paste that extends beyond the land gets credit only for the overlap. The 50% threshold is a TinyCAD screening limit. Stencil design and paste targets for a specific package depend on the assembly process. Omitted openings remain valid for tented pads and pads without stencil paste. [Fabrication capability reference](https://jlcpcb.com/capabilities/pcb-capabilities) [Stencil opening reference](https://jlcpcb.com/help/article/opening-process-standard-of-stencil)

`CHECKWAIVERS` stores the reason and geometry/rule fingerprint for acknowledged floating-copper and disconnected-zone findings. A changed fingerprint leaves the waiver visible as inactive and reopens the finding. The check report records both active and inactive waivers.

Board operations apply atomically against an expected revision. Undo and redo restore content with a fresh revision. Filled copper, meshes, spatial indexes and live DRC are rebuildable data and stay out of authoring files.

## Board and footprint navigation

This section describes the current branch while the editor is being revised. The [shared editor design](tinycad-ui-design.md#drawing-interaction) defines the target zoom, rulers and context menus.

Scroll over the PCB or footprint drawing to zoom around the pointer. Drag with the middle mouse button to pan. In the PCB editor, **Fit board** frames the outline and dimensions. **Fit selection** frames the selected pad, component, placement group, track or via. In **PCB design checks**, activate a located finding to bring it into view and highlight it. Use Tab and Enter to reach these controls and activate findings.

In the footprint editor, select pads directly in the preview or use the Pad selector. **Fit footprint** resets the drawing view. **Export 1:1 SVG** uses the complete footprint and includes the 10 mm calibration mark.

## Board outlines and cutouts

**Board outline…** and **Add cutout…** offer rectangle, rounded rectangle, circle and polygon templates. Choose **Custom lines and arcs** to edit individual start and end points. Circular arcs also specify a centre and direction as viewed from the top. Edit a saved cutout from the inspector. The draft preview locates gaps, duplicate edges, intersections and invalid cutout placement before the profile is saved.

Saved contours require coincident endpoints at every junction. **Close small gap** moves an adjoining straight endpoint by at most 1 µm to reach its neighbour. Adjust larger gaps and arc-to-arc junctions in the coordinate fields. The profile uses analytic arcs in the native file and Gerber. The 2D geometry checks and read-back preview approximate arcs within the curve tolerance.

## Dimensions and measurement datum

**Measure distance** snaps near pads, track endpoints, vias, hole centres or slot endpoints, jumper ends and authored profile vertices. Other points use the board grid. Pick two points and choose **Save measurement as dimension…**, or enter the endpoints through **Dimensions and datum**.

Save aligned, horizontal or vertical annotations with a line offset, an optional label and a millimetre or mil display. Coordinate entry accepts millimetres, mils and nanometres and stores exact integer nanometres. Set a measurement datum to enter dimension endpoints relative to that point. The native board stores the datum and dimensions in `ANNOTATIONS`. Editing an annotation preserves the board profile. Fabrication and placement output use the board origin, and KiCad subset export lists the native annotations in its loss report.

## First board guide

Open **First board guide** from the PCB toolbar to keep the steps beside the board while you work. Review schematic parts and their device mappings, set the outline and fabrication profile, place footprints, route by following the airwires, and run design checks. The guide opens the regular editing commands and CAM read-back preview. Select a step to return to it while checking a finding or preparing a manufacturing review.

Choose **Beginner** under **PCB view** to open the guide and show the placement, routing, zone and review commands. The teaching route starts at 0.50 mm track width, 0.40 mm via drill and 0.80 mm via diameter. TinyCAD increases these dimensions when the board rules or selected fabrication profile require it. Choose **Engineering** for manual route dimensions, detailed fabrication rules, measurements and advanced editing. The view is remembered in the app. Both views use the same board data, design checks and release review.

The [classroom LED exercise](../examples/pcb/led-classroom/README.md) includes an unplaced practice board and a routed reference. Both project folders open offline with their native schematics, reviewed mappings and embedded assets.

## Sequential placement

Open **Unplaced** in the footprint panel, select a component, and drag its preview onto the board. **Place on board** starts the same tool from the keyboard. Click a valid board position to commit the snapped location. Escape or right-click cancels the preview. An active placement queue advances to the next unplaced package after each commit. **Library** previews the board’s embedded footprints and opens the footprint editor, which also browses the bundled library.

For an exact location, enter X and Y below the board and choose **Place at coordinates**. Use **Move on board** in the footprint’s context menu to reposition an existing footprint. Each placement or move is one undoable edit. Use **Save**, **Save As** or **Save All** to write the board. The browser opens its file picker on the first explicit save of an untitled board. [Shared placement contract](tinycad-ui-design.md#placement-and-persistence).

In a project schematic, select multiple symbols and choose **Place selected schematic components…** in the project browser. Choose a linked board to queue its matching unplaced packages with reviewed devices. Multiple schematic units of the same package are queued once. A selection inside a repeated hierarchical instance resolves to that instance on the parent board or to the corresponding local components on a board linked directly to the child schematic.

While the placement or move tool is active, dashed purple guides follow the preview pads. Each guide connects a preview pad to the nearest placed pad of another footprint on the same net. **Show straight-line estimates** displays the distance for each guide. The placement or move commit ends the active preview.

## Footprint locks

In a placed footprint’s **Position** panel, **Lock position** holds its X and Y coordinates and **Lock rotation** holds its angle. **Lock component** also freezes the mounting side. Unlocking the component restores its individual lock settings. The native board saves these flags on the footprint instance. An alignment may use a position-locked anchor when the anchor stays fixed, and a group change that would violate any member’s lock is rejected as a whole. The KiCad export preserves complete footprint locks and lists individual lock settings it cannot transfer in the export report.

## Group placement

Select placed footprints using the checkboxes in **Placed components** or Shift-click them on the board. **Placement group** moves the selection by an exact offset, rotates it about the first selected footprint, aligns the origins to that footprint on one axis, or distributes three or more origins evenly between their current extremes. Group operations preserve each component’s mounting side. A move that would displace a locked member, put an origin outside the outline or into a cutout, or affect existing routed copper is rejected. The [shared placement contract](tinycad-ui-design.md#placement-and-persistence) treats a group change as one document edit. **Undo** restores all positions together.

## Placement areas

Use **Add placement area…** to name a polygon, choose **Keep in** or **Keep out**, and apply it to the top, bottom or both assembly sides. Enter one X, Y pair in millimetres per line. Keep-in polygons on each side combine into the permitted area. A keep-out flags any touching courtyard on its side. **Run design checks…** checks transformed courtyard shapes and uses the mounting origin when a footprint has no closed courtyard. The report identifies this limited coverage. Select a finding to locate the component.

The native `.dpn` stores the regions in `PLACEMENTAREAS`. These are assembly placement rules. KiCad export lists them in its omission report.

## Schematic parity in design checks

The circuit update review keeps the net ID when only its name changes. A membership change lists the previous and proposed nets by name, identifies affected tracks and vias, and reports shorts between the proposed nets and new groups of disconnected terminals. The preview compares filled copper and fitted jumpers before and after the update. Routes whose former net has retired keep their geometry and are marked for reassignment. Run full design checks after reviewing and repairing the affected copper.

Design checks flag same-net copper that relies on isolated point contacts. The finding locates the contact and blocks manufacturing release. A shared edge, overlapping copper or another continuous path can provide connectivity without that finding.

For a linked PCB, **Run design checks…** recompiles the associated project schematic and its hierarchy. The check uses the active editor copy when a source schematic is open, and checks file versions for sources read from the project. It compares the compiled reference designators, component roles and values, and signal-to-net assignments with the board. A pending schematic update appears in the findings even when the physical geometry is unchanged. The report records the schematic document UUID and a SHA-256 of the compiled circuit content. CAM previews carry the same evidence.

For standalone boards, parity can compare against an embedded applied circuit, when present. If a linked source cannot be compiled or changes during the check, the report records unavailable project parity and identifies the failure. The board and schematic stay editable, and a fresh check can run after the source is restored.

## Editing routed tracks

While routing, move the pointer over assigned copper on the active layer. The snap marker shows the connection point on a pad, track, via or jumper land. Rotated and off-grid pads use their placed copper coordinates. Drilled lands snap to the surrounding copper. Click empty space to add a grid-snapped corner. Changing layers at a same-net plated connection shared by both layers reuses the existing barrel.

The route preview uses horizontal, vertical and 45-degree legs. In Engineering view, choose **Route bend** to put the straight or diagonal segment first. A red preview marks a blocked path. Clicking it keeps the last accepted corner so you can choose another waypoint. **Finish route** checks the whole route against the current board and fabrication rules.

**Cancel route**, **Cancel track edit** or Escape while focused in the PCB editor discards the draft, including while the worker is preparing the result. Previously committed edits stay in the board and its undo history.

The route controls announce when clearance is being prepared. If preparation fails, **Retry route preview** recomputes clearance and keeps any existing waypoints. For keyboard routing, select a net, expand **Enter route coordinates**, enter X and Y in millimetres and press Enter or choose **Add waypoint**. The fields accept the browser locale’s decimal separator. The editor uses the coordinates directly and announces the last accepted point. The route uses the same bend, layer and clearance rules as the canvas. **Finish route** commits the draft.

In **Fabrication settings**, Engineering view can set the board's minimum, preferred and maximum track widths. The selected fabrication profile can raise the effective minimum. In **Manual route**, choose the minimum or preferred width or enter a custom value. On a two-layer board, choose Compact, Preferred or Custom through-via dimensions. Both via presets respect the effective annular ring and profile drill limits. The native board stores the configured widths, and design checks report existing tracks outside the effective range.

Select an unlocked through-via in Engineering view and use **Via solder mask** to tent both sides, tent just the top or bottom, or expose both sides. Both sides are tented by default. Exposure adds a mask opening around the via land on that side, with the selected fabrication profile's minimum expansion. Tenting settings are saved with the native via, shown in 3D and exported in Gerber solder mask and editable KiCad boards. On a board with vias, Gerber includes a mask layer with no openings if that side is fully covered.

In **Net rules**, create a class, then select each PCB net to assign the class or set individual limits. Blank fields inherit their values. Hard limits combine with the board and fabrication limits. The highest minimum and lowest maximum apply, and a net preference takes precedence over its class preference. Spacing between two different nets uses the higher clearance of the pair in both directions. Routing, zone fills and design checks use these rules. The native board saves class definitions in `NETCLASSES` and assignments and overrides in `NETS`. The manufacturing review manifest records the configured and effective net rules.

Choose **New clearance rule** to set a minimum spacing between two net classes, copper object types, or a combination of both. Each side can match pads, tracks, vias or zones. The order of the two sides has no effect. The largest applicable clearance wins, and design-check findings list the matching rules. The board stores the rules in `CLEARANCERULES` and includes them in manufacturing review.

### Routing regions

In Engineering view, choose **Add routing region** to draw a polygon from board coordinates. Apply it to one or both layers, with an optional net-class filter. A region can exclude tracks, vias or zone copper, or set a minimum or maximum track width. A track crossing the outline must satisfy the width limits wherever its copper touches the region. A through-via must satisfy exclusions on both layers. Zone fills leave excluded areas clear. Design checks identify the region and affected copper, including violations in an opened board. Contradictory width limits are rejected when you edit the rules. The board stores these polygons and limits in `ROUTINGREGIONS`.

**Copper clearance** adds a local minimum for different-net copper. The rule applies to the portion of either matching object inside the region, including spacing to copper just outside the boundary. Copper farther along the same track uses the applicable board, net and pair rules. Routing, zone fills and design checks use the same region boundary.

### Editing existing tracks

In Engineering view, select a track to split it, start a branch, reroute it or drag the segment. **Branch from track** starts a route on the existing centreline with the track's net, layer and width. **Drag segment** moves the selected segment and adds short joins to its original endpoints. At a junction shared by two tracks on the same net and layer, **Move start corner** or **Move end corner** edits both tracks together.

Drag the on-board handle or enter its coordinates. **Apply track edit** checks track width, edge and drill clearance, and contact with other copper. The edit also checks that existing connections to tracks, pads and vias survive the change, including connections through zone fills. A failed check leaves the saved geometry available for another attempt. Each successful edit is one undo step.

### Deleting routed copper

Select a track or via and choose **Delete selected copper…** to remove that object. **Delete connection…** follows the selected run of tracks through unbranched joints and through-vias. It stops at pads, branches and ambiguous copper contacts. On a track that spans a junction, click the side of the junction you want to remove. **Delete routed net…** selects all unlocked tracks and vias assigned to that net.

**Delete region…** accepts two corners from the board or from coordinate fields. It previews unlocked tracks and vias fully enclosed by the rectangle. Choose a copper layer or all layers. The preview marks any selected through-via, which spans both sides. The highlighted copper is removed in one undoable edit when you confirm.

### Cleaning up a routed net

In Engineering view, select a net and choose **Clean up routed net…**. TinyCAD proposes merging compatible collinear tracks, removing exact duplicates and pruning redundant runs in cycles formed by routed tracks and vias. It rebuilds zone fills and checks required terminal connectivity and shorts before offering a change. The preview highlights the copper removed from loops. Apply the preview as one undoable edit.

Routing skips repeated points and collapses collinear waypoints on the same layer. Select a track or via and choose **Lock track** or **Lock via** to protect its geometry during editing, deletion and cleanup. Locks are saved in the native board. Cleanup also preserves tracks flagged for review and leaves the vias in place. KiCad subset export records the locks in its loss report.

## Wire jumpers

On a single-layer board, use **Add wire jumper…** to assign a net and position two drilled lands. Start or finish a track by clicking either land. The dashed line shows the hand-fitted wire on the face opposite the copper. Clear **Fit jumper** to keep both lands and drill holes while leaving the wire out of the assembly.

Design checks report openings in bare copper separately from openings after fitting the jumper. The BOM, assembly drawing and `jumpers.csv` identify fitted and DNP wires. The machine placement CSV omits hand-fitted jumpers. CAM and home-etch outputs contain their copper lands and non-plated drill holes. Use the assembly drawing or jumper table to locate the wire itself. KiCad export reports these objects as omissions.

## Home-etch print templates

In **CAM read-back preview**, expand **Home-etch print templates** on a single-layer PCB. Choose the transfer orientation, then download the copper artwork and drill template. Use the same orientation for both. A mirrored sheet reflects X across the board bounds. Black in the copper artwork denotes copper to retain. The drill template shows the outline, cutouts, hole centres and slot endpoints at the same scale.

Print both SVGs at 100% and measure the 10 mm mark with a ruler. Check the orientation against an asymmetric feature before transfer. The templates assume unplated openings. The suggested 0.50 mm track and gap dimensions are teaching starting points to verify against a process sample. The board’s own fabrication rules remain active.

## Diagnostic CAM preview

The preview archive identifies the board revision, hashes its files and reports mapped and checked geometry. It includes copper, profile, plated and non-plated drill files and the solder mask, paste and vector legend layers defined by the board. Visible footprint legend text plots with TinyCAD’s versioned stroke font. The footprint preview, printable footprint SVG, Gerber and design checks share the stroke geometry. Width, height, alignment, rotation and mirroring follow the footprint’s text settings. Use `${REFERENCE}` and `${VALUE}` for the placed component fields. KiCad reference and value imports use the same fields. The font covers printable ASCII and a set of electronics characters including Ω, µ, μ, β, ° and ±. An unsupported character or invalid stroke is reported against the whole text item. A negative-polarity mask file represents openings in the mask. The preview reads the plotted Gerber and drill files back to verify geometry, file roles and polarity.

The board BOM and assembly CSV include fitted, DNP and unplaced parts. The top and bottom assembly SVGs show placed references, DNP markings, holes and authored courtyards. Fitted parts with a saved assembly marker show it at the selected pad, and their assembly notes appear below the drawing. The bottom SVG is a mirrored assembly-side view. Both sheets include a 10 mm calibration mark. The placement CSV includes fitted placements and uses millimetres from the board origin, with X right, Y up and positive rotation counter-clockwise in the top-view frame. The manifest records the coordinate convention. These archives carry the status **NOT RELEASED**. [Ucamco Gerber specification](https://www.ucamco.com/en/gerber/downloads/)

The PCB BOM carries optional schematic attributes named **Manufacturer**, **MPN** or **Manufacturer Part Number**, **Supplier**, **Supplier Part Number** or **Supplier SKU**, **Voltage Rating**, **Power Rating**, and **Tolerance**. Names are case-insensitive. Conflicting entries on units of the same package require correction in the schematic. **Review schematic changes** transfers purchasing details to the board. The BOM groups only matching values, device definitions, population states and purchasing details. CAM and release archives use spreadsheet-safe text. A [PCB CSV project recipe](project-specification.md#generated-project-files) can export raw text for machine import.

To mark a component do not populate, set its schematic **PCB Role** attribute to `dnp` on each unit of the package, then use **Update PCB from Schematic…**. The pad map, copper, drills and electrical checks still apply. The fitted BOM (`bom-fitted.csv`) and placement file exclude DNP and unplaced components. The fitted BOM includes hand-fitted jumpers. The full BOM (`bom.csv`) and assembly CSV retain population states, and assembly drawings identify DNP positions.

The independent CAM qualification uses an asymmetric two-sided coupon with a circular cutout, plated slot and non-plated mounting hole. Gerbonara 1.6.3 reads the Gerber and XNC files downloaded from the production filesystem workspace. The checker compares their roles and geometry against fixed dimensions, verifies the XNC plating attributes, and checks assembly placement, scale and every payload hash, including the design check report. [Gerbonara 1.6.3](https://pypi.org/project/gerbonara/1.6.3/) · [Ucamco XNC specification](https://www.ucamco.com/en/gerber/downloads/)

With Playwright Chromium and Python 3.12 or later with Gerbonara 1.6.3 installed, run these commands from the repository root.

```sh
npm run build:fs
node scripts/pcb/cam-preview-fixture.mjs /tmp/tinycad-cam.dpn
node scripts/pcb/qualify-workspaces.mjs --cam-board=/tmp/tinycad-cam.dpn --cam-bundle=/tmp/tinycad-cam.zip
python3 scripts/pcb/check-cam-preview.py /tmp/tinycad-cam.zip
```

## Manufacturing review archive

In **CAM read-back preview**, expand **Manufacturing review** to see unresolved findings and incomplete check coverage. Mark the layers and drill files you inspected, then select **Download release review…**. The archive records those selections against one board revision. It includes the native `.dpn`, the verified Gerber and XNC bytes, the design check report, the fabrication and assembly drawings, and CSV tables. The manifest identifies the project when linked and records the input, output, device, footprint, rule and process evidence.

The fabrication SVG plots the exported outline and openings at 1:1. Separate drill tables list actual XNC tool numbers, finished widths, plating, slot endpoints and round-hole positions from the read-back files. In **Fabrication settings**, expand **Fabrication drawing details** to record the surface finish, notes and optional ± tolerances for thickness, outline, and plated and non-plated openings. TinyCAD saves those settings in the board and records them in the archive manifest and drawing. The XNC files still express nominal finished dimensions. TinyCAD applies no tooling or plating compensation.

In Engineering view, expand **Board stackup** to record substrate material, dielectric thickness, relative permittivity, loss tangent and copper thickness per side. Blank values remain unknown, even when a fabrication profile is selected. The sum of known layer thicknesses must fit within the finished board thickness. The native board, check report and manufacturing manifest record the supplied values, and the fabrication drawing labels missing values as **Unknown**. KiCad export transfers the finished board thickness and lists the stackup properties as an omission in its interchange report.

From **Manufacturing review**, select **Download 1:1 fabrication PDF…** to get a vector drawing from the open CAM preview. Print at actual size and measure the 10 mm scale bar on the print. **Normalize archive timestamps for reproducible builds** makes repeated ZIP archives byte-for-byte identical for the same board data, checked output and review selections. Source changes or payload changes require a fresh review. The review archive carries **NOT RELEASED** status.

**Release and download…** becomes available after all Gerber and drill files are reviewed and the blocker list is empty. TinyCAD rereads saved project schematics, rebuilds zone copper and checks, regenerates the files, and compares them with the reviewed snapshot. Review the preview again if the board, circuit evidence or output changed. The release ZIP records **RELEASED** status, embeds the native board and check evidence, and includes a content identifier in its filename. The archive preserves that revision while editing continues in the board file.

Board edits mark earlier design checks as stale. Opening design checks or CAM read-back runs a fresh check. If you cancel the editor's zone fill, the workspace continues to show its stale fill status until you refill it. CAM and release still rebuild copper from the current board, including clearance and outline changes, and require a new layer review.

In Engineering view, open **Manufacturing revisions…** and choose a release ZIP for the current PCB. TinyCAD checks the manifest identifier and every payload hash before using the archived board. The comparison lists changes to components and placements, pad definitions, nets, copper and board geometry, rules, and generated output files. Output comparison uses exact bytes, so a drawing with a new revision label appears as changed.

**Create revision** loads the archived design into the current editor as a new, undoable working revision. Save the PCB to persist the parent release identifier, its revision, and the archived board hash. A later release includes that parent in its manifest. The original release ZIP remains the record of the earlier design.

To exercise the manufacturing review in the production filesystem build and independently verify the payloads, run these commands from the repository root with Playwright Chromium installed.

```sh
npm run build:fs
node scripts/pcb/cam-preview-fixture.mjs /tmp/tinycad-cam.dpn
node scripts/pcb/qualify-workspaces.mjs --cam-board=/tmp/tinycad-cam.dpn --cam-bundle=/tmp/tinycad-cam.zip --release-review=/tmp/tinycad-review.zip
python3 scripts/pcb/check-manufacturing-review.py /tmp/tinycad-cam.zip /tmp/tinycad-review.zip
```

## Editable KiCad export

In the PCB workspace, **Export KiCad board…** previews translations and omissions before downloading a bundle. Extract the board and its matching `.kicad_dru` into the same directory. The JSON report identifies the source board revision and names every omitted object or translated setting. TinyCAD targets KiCad 9.0 board format `20241229` and writes its own generator identifier. [KiCad board format](https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/)

The bundle carries editable outline lines and arcs, two-sided footprints and pads, tracks, through vias, holes and slots, and supported zones. Field values, nets, locks, DNP and board thickness are preserved where supplied. The rules file carries effective track width, copper clearance, edge clearance and via annular width. Independently shaped mask and paste openings become filled footprint artwork. A one-layer board opens with KiCad’s two-layer stack. Refill exported zones in KiCad and review the resulting connections and clearances. Embedded board footprints remain editable. KiCad can flag their library locator until a local library is assigned.

The report identifies unsupported asymmetric drilled padstacks, unmapped zone policies, model attachments, net-class assignments, per-net limits, pair clearance rules, routing regions, and TinyCAD schematic links. TinyCAD keeps the native `.dpn` as the source board. The interchange bundle is for editable continuation and has no manufacturing approval.

To reproduce the browser download and read it through KiCad 9.0.9 with its `pcbnew` Python module and CLI installed, run from the repository root.

```sh
npm run build:fs
node scripts/pcb/cam-preview-fixture.mjs /tmp/tinycad-cam.dpn
node scripts/pcb/kicad-export-fixture.mjs /tmp/tinycad-cam.dpn /tmp/tinycad-kicad.dpn
node scripts/pcb/qualify-workspaces.mjs --kicad-board=/tmp/tinycad-kicad.dpn --kicad-bundle=/tmp/tinycad-kicad.zip
python3 scripts/pcb/check-kicad-export.py /tmp/tinycad-kicad.zip
```

The check covers a bottom-side custom pad, electrical connectivity from a pad through a via, a plated slot and mounting hole, a circular cutout, one editable zone, one declared omission, and an enforced custom track-width rule. It saves and reopens the board with KiCad before rechecking the same geometry.

## Reviewing KiCad via spans

In the Engineering PCB editor, choose **Review KiCad board…** and select a `.kicad_pcb` file. The review identifies blind vias, buried vias, microvias and unrecognized layer spans. KiCad uses the same type marker for blind and buried vias, so the review uses the declared copper layers and the via's endpoints to distinguish them. [KiCad track-via format](https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/index.html#_track_via)

**Download via report…** saves the source file hash, layer stack, coordinates in KiCad's X-right/Y-down frame and the original source expression for every flagged via. The command produces a diagnostic report. Production export requires an editable, validated TinyCAD board.

## Reviewed device definitions

A reusable `.tcdevice.json` file describes one versioned device, its package aliases, reviewed pinout provenance, explicit terminal-to-pad assignments and full footprint. Optional nominal pitch and required body dimensions are in nanometres. Each electrical pad maps to a terminal UUID. Several lands may share a terminal UUID. NC, reserved and mechanical pads each carry an explicit role. A mechanical-only device such as a mounting hole has an empty terminal list and assigns all pads as mechanical. Package names and display pin numbers have no effect on the map.

The file has `format: "tinycad-device"` and `version: 1`. The footprint's `definitionDigest` is the SHA-256 of its UTF-8 JSON with sorted object keys and without the digest field. TinyCAD checks the footprint digest and each STEP asset. Publish changed contents under a new revision of the same device UUID. [Device file reader and writer](../src/pcb/deviceLibrary.ts)

The board's `DEVICEDEFS` record embeds the resolved assignments. Its `LIBRARYSOURCE` records the catalogue device and footprint UUIDs, full device file digest, reviewer, evidence, licence and explicit binding from device terminal UUIDs to this component's schematic signal UUIDs. The embedded board definitions, including any STEP bytes, stay usable offline. A catalogue refresh previews changes by pad UUID and updates the selected component only after approval. Its footprint keeps its placement transform.

See the [project device review workflow](project-specification.md#reviewed-pcb-devices) for catalogue discovery and review.

## Native footprint drafts

The Project Browser's **Footprint editor** opens `.kicad_mod` and `.tcfootprint.json` files. The native draft stores editable pad geometry and UUIDs, graphic layers, import diagnostics, and unresolved or embedded model references. The editor supports pad arrays and alignment, independent copper, mask, paste and drill edits, footprint artwork and model transforms, origin changes, and distances between pad centres. Unsupported electrical geometry blocks import. Imported drafts carry unreviewed provenance. In **STEP models**, supply a local file for each imported model reference to keep its KiCad offset, rotation and scale. Use **Add STEP model** to attach a local file directly with an identity transform. Identical bytes are embedded once. Set the model licence before exporting a reviewed device, and resolve or remove any missing attachments. A board that embeds the device can show its models without the source library. **Export 1:1 SVG** writes physical dimensions in millimetres and includes a 10 mm calibration mark. Print at actual size.

**Map as device** records an explicit assignment for each pad and requires review evidence, package dimensions and licensing metadata. Exported devices use the same reusable format as the Project Browser's device catalogue. KiCad symbol import retains the original footprint locator and also supplies its package name as a search hint. Symbol import preserves KiCad board and BOM flags and reports unsupported pin and artwork features in the importer.

In the footprint editor, expand **Assembly drawing** and select a mark and physical pad where the package drawing specifies one. Options include pin 1, cathode, positive and negative. Leave **No marker** for symmetric footprints and unreviewed imports. Optional assembly notes and the marker travel with the exported footprint, mapped device and embedded board. They add assembly documentation without changing copper or silkscreen.

On a routed board, use **Update PCB from Schematic…**, choose a component, and select **Review replacement device**. The preview shows previous and proposed pad positions in footprint coordinates and the finished dimensions and plating of changed openings. Stage the device to see the affected tracks and vias by net, layer, and board coordinates before applying. Applying preserves the footprint placement and flags affected routes for review. Resolve any opens or route-review findings before manufacturing release.

The same preview shows previous and proposed schematic assignments by signal name. Across independent footprint definitions, a unique matching pad label gives the reviewer a direct comparison even when the definitions use different pad UUIDs. Ambiguous labels appear as separate additions and removals. If a land and its assignment both stay the same, a new library UUID alone leaves its route unchanged.

## KiCad import persistence

For each supported KiCad feature, use the same versioned native fields and validation as for objects authored in TinyCAD. Keep PCB-relevant symbol fields, pin labels and footprint references in native `.tclib`, `.dsn` and `.dzn` data as applicable. Store reviewed device mappings, footprint graphics, padstacks and model attachments in native `.dpn` definitions. M2 board import uses the typed native entities for supported stackup, placements, routing, zones and rules. Keep unsupported items and unresolved asset references visible in the import report.

Store imported and generated STEP attachments with the footprint definition, using the model asset's SHA-256 ID, source, quality, local offset in nanometres, rotation in microdegrees and scale. Apply the attachment transform in footprint coordinates before placing the footprint on the board. Preserve resolved STEP bytes and their provenance in standalone `.dpn` saves and portable projects. Verify import by saving and reopening native files and checking geometry, model alignment and connectivity as applicable.

## Project integration

For the folder layout, `.tcproject` schema and project file lifecycle, see the [project specification](project-specification.md).
