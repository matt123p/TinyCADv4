# TinyCAD PCB Design UI and UX review

PCB Design needs a clearer toolbar, a drawing that dominates the window, and forms sized for the work they contain. The editor already shares much of the schematic shell, but it makes users work harder to find basic commands and understand the current tool. Start with the path from a schematic to a placed footprint, a routed connection, and a design-check finding.

## What we reviewed

The review used Chromium on branch revision `10132cc`, with the bundled `AMP.dsn`, the classroom LED exercise and routed reference boards opened as standalone files, and a new PCB. The primary comparison used 1440 × 900, with a PCB layout check at 900 × 700. The review exercised footprint placement, entry to routing, a blocked route preview, and locating a finding from the design-check list. It also measured three rendered dialogs after their opening animations and reviewed the released v4.1.0 schematic source. Electron runtime behavior, linked-project transfer, and first-time user performance remain unverified in this review.

This is a follow-up to the earlier PCB shell recovery. The current branch already has the window-top toolbar, rulers, shared drawing stack, footprint preview, selection feedback, and clickable design-check findings. Reuse those controls and editing conventions as the default view changes. [Shared editor design contract](tinycad-ui-design.md) · [PCB interaction requirements](TinyCAD_PCB_Layout_Complete_Specification.md#13-editor-interface-and-interaction-contract)

## What makes schematic capture easier

| Task | Circuit Design | PCB Design |
| --- | --- | --- |
| Find the next tool | Wire sits with the other drawing tools and has a recognizable icon. | The visible **Routing** button draws a routing region. **Route track** begins at x=1700 px in a 1440 px window and is absent from the **Copper** menu. |
| Browse and place | The library browser gives search, results, and the draggable preview predictable locations. | The unplaced tray mixes bullet markers, queue checkboxes, part buttons, and wrapping package names. Selecting a part reveals **Place on board** in the sidebar and a more prominent **Place at coordinates** below. |
| Read the drawing | The schematic has a clear background, distinguishable wires and symbols, and a compact command row. | The pale green board fill and muted colors give the routed example the appearance of a static preview. Pads, traces, and board references need stronger differentiation, and the side panels take priority over the canvas at narrow widths. |
| Edit a selection | Selection properties have a predictable home below the drawing. | Component properties also appear below, but their layout varies by object. The routing form and some copper editing controls appear in **Board tools** beside the drawing. |
| Review a problem | The drawing and lower panel provide a consistent place to inspect results. | Selecting a PCB finding locates its object or area and keeps the report open. **Run design checks** is buried under **Copper**, and the fabrication menu calls its preview **CAM read-back preview** while the guide calls it a manufacturing preview. |

[Schematic toolbar](../src/components/toolbar/toolbar.tsx) · [Schematic bottom panel](../src/components/panel/BottomPanel.tsx) · [PCB workspace](../src/components/pcb/BoardWorkspace.tsx) · [Unplaced components tray](../src/components/pcb/BoardPlacementTray.tsx)

## P0 · Make the core workflow obvious

### Rebuild the default toolbar

**Routing**, **Placement**, and **Copper** visually promise broad editing tools, but they create a routing region, a placement area, and a copper zone. Several commands show essentially the same square. The **Copper** menu shares its name with the copper zone split button. Cutouts and holes have both drawing and numerical entry points, with labels that give little indication of which interaction will start. The toolbar runs off the right edge at ordinary desktop width and puts essential commands on the same scrolling strip as rarely used tools. [PCB shape commands](../src/components/pcb/BoardShapeTools.tsx) · [Shared toolbar](../src/components/toolbar/EditorToolbar.tsx)

The proposed browser toolbar uses these groups in order.

| Group | Default controls |
| --- | --- |
| Menus | File, Board, Copper, Fabrication |
| File and history | Shared Save, Undo, and Redo icons, plus Save All when applicable |
| Drawing | **Route track**, **Draw ▾**, Measure |
| Navigation | **Fit board**, Zoom, Rulers |
| Review | **Check board** |

Use a distinctive track icon, a visible **Route track** label, and a clear pressed state. Put the same command under **Copper** and in the context menu for a routable pad. Put **Routing region**, **Placement area**, **Copper zone**, **Cutout**, **Hole or slot**, and **Text** under **Draw**, retaining their shape choices and shared drawing tools. Distinguish numerical commands as such where both entry points are useful. Give overflow a named menu and keep **Route track**, **Fit board**, and **Check board** visible at 900 px. Keep the browser dropdowns and Electron native menus backed by the same actions.

### Tell the user what to do next

A new board currently shows an empty outline beside **All board components are placed**. The same text appears on a populated board after placement. The guide directs standalone users toward a project even though the Board menu supports standalone import.

- On a standalone board with no parts, say **No components yet** and offer **Import schematic or netlist**. Keep manual board setup available for users who start with the outline.
- In a project, make **Create PCB from Schematic** discoverable from the active schematic and surface **Update PCB from Schematic** on linked boards. Preserve explicit review and apply.
- When parts are ready, show the count and offer **Place first component**. For a missing mapping, identify the affected part and link to the applicable mapping workflow.
- Use the first-board guide as optional help from the empty state, with later access from Help. Show task-specific instructions as the user encounters each tool. [Project transfer workflow](project-specification.md#creating-and-updating-a-linked-pcb) · [First board guide](../src/components/pcb/FirstBoardGuide.tsx)

### Make routing state visible beside the drawing

The unplaced LED exercise allowed entry to routing even though there was no placed copper to click. After placing one part, a blocked preview showed a red dashed path and an X without identifying the obstacle at the point of failure. The right-hand route instructions and via settings clipped horizontally at 1440 px. [Routing controls and clearance handling](../src/components/pcb/BoardWorkspace.tsx) · [Board rendering](../src/components/pcb/BoardCanvas.tsx)

Use a compact route strip alongside the canvas. When no usable pad is available, explain how to get one. At route start, show **Click a pad to start**. Once started, show the source pad, net, active copper layer, width, and the next gesture. Indicate when reaching same-net copper will complete the route and expose the existing finish and cancel actions. Mark the obstacle in a blocked preview and give the reason beside it. Include measured and required clearance when available. Put bend, via, and numerical overrides in an expandable group. Keep advanced manual routing entry points available.

## P1 · Improve the visual hierarchy

- **Give the board room.** At 900 × 700 the PCB canvas was 313 px wide, with large unused areas in both sidebars. Keep browsing on the left, properties and results below, and Layers on the right. Give Layers a compact collapsed state at narrow widths and check the usable space in side-by-side mode.
- **Make the canvas easier to read.** Try a near-neutral canvas, a restrained board fill, and a crisp outline. Give active copper and pad lands the strongest contrast. Dim non-active copper during routing while keeping context visible. Distinguish airwires, hover, selection, and blocked previews through stroke or shape as well as color. Keep reference labels and pad numbers legible at working zoom. Use consistent copper swatches across the drawing, Layers, and route controls.
- **Simplify Layers.** Put copper, silkscreen, and board edges first. Group mask, paste, adhesive, and auxiliary or fabrication artwork in collapsible sections. Align the eye and lock controls, keep their actions independent and accessible, and identify the active routing layer without changing what the eye and lock mean.
- **Use the schematic browser pattern for footprints.** Use aligned rows for reference, value, and footprint status. Give the preview a stable home and make **Place on board** its primary action. Put queueing and coordinate entry behind secondary actions. When placement is armed, show the commit and cancel gestures beside the board.
- **Make checking and manufacturing discoverable.** Show whether the current revision has been checked and whether it needs attention. Keep findings in the lower panel, with clickable geometry and clear text for findings such as an unplaced part. Use **Manufacturing preview** consistently across the menu and guide, with read-back details inside the preview. [Layers panel](../src/components/pcb/BoardLayersPanel.tsx) · [Design checks panel](../src/components/pcb/BoardChecksPanel.tsx) · [Manufacturing preview](../src/components/pcb/BoardCamDialog.tsx)

## P1 · Make forms look and behave as one system

### Fit the form to its location

At 1440 × 900, the default rectangle in **PCB Size & Shape** opened an **832 × 672 px** surface for five fields. The dialog body had about **360 px** of unused height below the last row. **Import schematic or netlist** opened at **544 × 512 px**, with about **260 px** of unused height before review. **Add hole or slot** used the same 544 × 512 px surface and left about **120 px** below its fields. The stylesheet gives standard and wide PCB dialogs fixed heights. Its responsive field rule also follows window width, even though the space an inline form gets depends on the panel. [PCB dialog styles](../styles/circuit.scss) · [Schematic design details](../src/components/dialogues/designDetailsDlg.tsx)

| Surface | Proposed pattern |
| --- | --- |
| Live tool controls | Use a compact strip at the drawing for the actions and values relevant to the current tool. Size numeric inputs to their values and keep longer preset text within the available width. |
| Selection properties | Reuse the schematic’s Fluent field and property controls below the drawing. Pair X and Y, keep units visible, and group side, rotation, and locks logically. Wrap or stack fields according to actual panel width. |
| Simple edits | Fit the content within viewport limits. For a rectangle, pair Width with Height and Origin X with Origin Y. For a hole or slot, lead with type, dimensions, and plating. Reveal slot direction where applicable and group screw-head and extra clearance fields under **Advanced**. Keep the footer close to the fields. |
| Reviews and complex editors | Give custom outlines, change reviews, and manufacturing previews space proportional to their tables or previews. Keep the title and footer stationary across steps and scroll the body as content grows. Use the additional width for a preview, aligned fields, or a table. |

Use consistent label alignment, control sizes, section spacing, and inline validation. Keep related fields together. Check long units, preset names, and errors in a narrow pane, where a single long value can otherwise stretch the form out of view. [Size & Shape](../src/components/pcb/BoardProfileDialog.tsx) · [Hole or slot](../src/components/pcb/BoardHoleDialog.tsx)

### Standardize the footer and Back behavior

Use one visually primary action. Place it consistently at the trailing end of the footer. **Back** moves to the previous step and preserves the draft. **Cancel** exits an edit without committing that draft. **Close** dismisses a read-only view. Tabs switch views directly. Use the same labels and action order in comparable forms.

| Workflow | Footer |
| --- | --- |
| Single edit | **Cancel**, then a specific commit action such as **Apply outline** or **Add hole**. |
| Import source selection | **Cancel**, then **Review circuit**. Put Review in the footer, where the current form shows a disabled **Apply to PCB** while Review sits in the body. |
| Import review | **Back**, **Cancel**, then **Apply to PCB**. Back returns to the source choice with the file selection intact. Restore focus to the step title or first relevant field when the step changes. |
| Read-only viewer | **Close**. Give export actions explicit names where available. |
| First-board guide | Use **Back**, **Next**, and a consistent dismiss action. Retain direct step selection if user testing shows people use it to jump ahead. |

Keep Enter and Escape behavior appropriate to the current surface, bring focus to validation errors, and return focus to the invoking control after dismissal where feasible. [Standalone import dialog](../src/components/pcb/BoardCircuitSourceDialog.tsx) · [First board guide](../src/components/pcb/FirstBoardGuide.tsx)

## Delivery and acceptance

1. **Prototype the new board and the LED board mid-route.** Reorder the toolbar, simplify Layers, add the correct starting action, and show route state beside the canvas. Compare at 1440 × 900 and 900 × 700 with the schematic open at the same size.
2. **Fix the placement and form workflow.** Apply the browser pattern to unplaced parts. Redesign Size & Shape and Hole or slot as compact edits, Import as a review flow, and routing controls as an inline form. Check actual populated content, long names, conditional fields, errors, and keyboard focus.
3. **Verify the path with schematic users.** Ask a few people who know TinyCAD schematic capture to start a board, place a footprint, route between two pads, recover from a blocked preview, and locate a design-check finding. Observe where they first look for each tool and where they hesitate or need help. Repeat with browser menus, Electron native menus, and a focused PCB pane in side-by-side view.

The first pass is ready when the three core commands are visible at 900 px, the drawing is the dominant surface, and active tools make their next gesture clear. Placement and routing must preserve snapped previews, predictable cancellation, and one Undo entry per committed edit. Check that common forms fit their contents, long forms scroll inside stable bounds, and Back preserves draft input. Record verified changes in the [editor redesign checklist](TODO.md#editor-interface-redesign).

## Implementation verification

- In Chromium at 900 × 700, the collapsed Layers panel gave the LED board a 501 px drawing viewport, up from 313 px in the original review. The narrow browser regression checks that **Route track**, **Fit board**, **Check board**, and **More PCB commands** fit.
- At 1440 × 900, the default rectangular Size & Shape form measured **448 × 312 px** and the import source step measured **448 × 223 px**. The Protel import regression checks that Back preserves the file and that its review can still be applied.
- The browser regression passed for creating a board from the active project schematic, placing bundled footprints, and reopening the board offline. A focused production Electron test exercised the native menus through board outline editing, Save As, design checks, and manufacturing preview. The Electron host reported that WebGL 2 was unavailable.
- The classroom README now points to **First board guide** under **More PCB commands**. The linked classroom exercise placed and routed the parts and reached design checks. Its report showed the four silkscreen-to-mask findings seen when the routed reference was opened standalone, so the exercise still needs a clean reference before it can qualify a manufacturing release. [Classroom exercise and reference](../examples/pcb/led-classroom/README.md)
