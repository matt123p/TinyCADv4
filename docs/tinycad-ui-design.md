# TinyCAD editor design

Use the released TinyCAD v4.1.0 editor as the design reference. Circuit Design, PCB Design and Simulation share its window, commands and drawing conventions. This document owns the shared interface contract. The [project specification](project-specification.md) owns project navigation, modes and file tabs. The [PCB specification](TinyCAD_PCB_Layout_Complete_Specification.md) owns board editing and manufacturing requirements. The [redesign checklist](TODO.md#editor-interface-redesign) tracks delivery.

## What v4.1.0 does

The reference is Git tag `v4.1.0` at `0c107ff46544aaefdd21a4b53304734f679822a7`. Inspect the tag when auditing, since current files include branch changes. For example, run `git show v4.1.0:src/components/svg/Sheet.tsx`.

| Area | Released behavior | Reuse in the current tree |
| --- | --- | --- |
| Top toolbar | A single window-top bar groups compact icon buttons and dropdowns, with dividers, translated labels, tooltips and enabled states. Save uses `SaveRegular`. Open uses `FolderOpenRegular` where the build exposes it. Text, zoom and ruler tools keep their established icons. | [Toolbar](../src/components/toolbar/toolbar.tsx), [toolbar container](../src/state/containers/toolbarContainer.tsx) and existing locale entries. |
| Platform menus | Browser menus open from toolbar dropdowns using Fluent Menu. Electron uses its native application menu and forwards commands to the renderer. Open Recent and View menu entries use shared menu construction within Electron. | [Electron menu definitions](../electron/drawingMenus.js), [Electron renderer bridge](../src/components/pages/mainAppElectron.tsx) and [file and menu commands](../src/io/files.tsx). |
| Left panel and drawing | The left panel is a collapsible, resizable library browser with search, compact source tabs and a draggable symbol preview. The centre contains the drawing and its sheet strip. Left width is saved under `tinycad.sidePanelWidth`. | [Design shell](../src/components/pages/designApp.tsx), [Libraries panel](../src/components/libraryPanel/LibrariesPanel.tsx), [symbol preview](../src/components/libraryPanel/SymbolView.tsx) and [resize handle](../src/components/panel/ResizeHandle.tsx). |
| Bottom and right panels | The resizable bottom panel changes with selection. Its idle view navigates symbols or nets. It also hosts symbol, pin, style, instrument and DRC panes. The right side opens for features such as simulation charts or the example explanation. Chart width can be resized and the panel can be dismissed. | [Bottom panel](../src/components/panel/BottomPanel.tsx), [symbol properties](../src/components/panel/SymbolPanel.tsx), [editable property table](../src/components/controls/EditablePropertyTable.tsx) and [chart workspace](../src/components/simulation/ChartWorkspace.tsx). |
| Placement and contextual commands | The library preview drags into the sheet. The sheet drop handler resolves drawing coordinates and starts the add tool. A left click commits the snapped symbol and selects it. The add tool clears its preview and restores the cursor. Right click cancels a pending placement, or opens the object-specific context menu in selection mode. | [Sheet event handling](../src/components/svg/Sheet.tsx), [drawing interaction state](../src/manipulators/updateView.ts) and [schematic context-menu binding](../src/state/containers/contextmenuContainer.tsx). |
| Zoom and rulers | Zoom In and Zoom Out are toolbar commands and Electron View menu entries. Shift-wheel uses the zoom steps and Ctrl-wheel or trackpad pinch applies a factor around the pointer. Ordinary scrolling pans. When enabled, the horizontal ruler is above the drawing and the vertical ruler is on the right. Both rulers mark the pointer and follow zoom and scroll. | [Sheet viewport](../src/components/svg/Sheet.tsx), [Ruler](../src/components/controls/Ruler.tsx) and the shared toolbar commands. |
| Dialogues and component editing | Document-wide properties open in a focused Fluent dialogue with confirmation and cancellation. Selection properties use the lower context pane and its editable property table. Simulation sources and instruments use the same selection pattern. | [Design details dialogue](../src/components/dialogues/designDetailsDlg.tsx), [bottom panel](../src/components/panel/BottomPanel.tsx) and [simulation control pane](../src/components/panel/SpiceControlPanel.tsx). |

## PCB branch findings before recovery

I compared development builds in Chromium at 1440 × 900 using the v4.1.0 voltage-divider schematic and the branch's routed classroom LED board. The released toolbar occupied a 42 px row across the whole window. The PCB toolbar was 81 px tall, started after the 289 px library column, and clipped commands at the right edge. The released editor had the schematic navigation table below the drawing, pointer rulers on its edges and simulation charts in the right pane. The PCB had a 279 px stack of controls beside the drawing and no bottom pane. Its window header still read `tCad1.dsn` while the board pane showed `LED.dpn`. Platform menu behavior was traced in the v4.1.0 Electron source.

At the time of the audit, the shell hid the shared schematic toolbar in PCB Design. [BoardWorkspace](../src/components/pcb/BoardWorkspace.tsx) supplied a second toolbar with prominent text buttons. It also rendered a continuous right-hand inspector containing the placement tray, selected-object properties, routing forms, zones and manufacturing controls. On the left, the shell hosted schematic Libraries instead of putting the PCB footprint library and unplaced components where a TinyCAD user expects to browse and start placement. The PCB branch of the shell left out the existing bottom pane. Side-by-side mode retained the two sets of controls. [Design shell](../src/components/pages/designApp.tsx), [workspace styles](../styles/circuit.scss).

The board click handler recorded draft coordinates and left the active target selected. **Place and save** and **Move and save** then ran placement through `BoardWorkspaceSession.place`. That session wrote through the storage adapter before publishing the committed history. Group placement also wrote through the adapter. This coupled an ordinary edit to a filesystem picker or project write. The preview followed the selected footprint and viewport pointer after a placement attempt. [PCB workspace](../src/components/pcb/BoardWorkspace.tsx), [board session](../src/io/boardWorkspace.ts), [board canvas](../src/components/pcb/BoardCanvas.tsx).

The PCB SVG had pointer-centred wheel zoom and fit commands of its own. Its viewport consumed ordinary wheel events for zoom and had no shared ruler rails. It also lacked the schematic context-menu renderer, even where its actions overlap with Circuit Design. The left, right and bottom panel behaviors were different as well as their appearance. [PCB canvas](../src/components/pcb/BoardCanvas.tsx), [SVG viewport](../src/components/svg/SvgViewport.tsx).

Geometry, validation, undo, document tabs and fabrication tests are evidence about those behaviors. They do not establish that the current layout is suitable. The overlapping-object picker was interrupted during development. Its last TypeScript run reported two errors in the silkscreen target layer type.

## PCB editor recovery

The board and Circuit Design share the scrollable toolbar, File menu trigger, Save and history controls, view buttons, and [anchored context-menu renderer](../src/components/controls/AnchoredContextMenu.tsx). Browser File commands open from the toolbar. Electron dispatches from its native menus to the active editor. The browser header and tab title and the Electron window title identify the active board and mark unsaved changes. Side-by-side mode keeps each editor’s controls with its drawing and routes native commands by active pane.

The left footprint panel has **Unplaced** and **Library** tabs. Project mode keeps the project tree and source control in the shell’s left rail. PCB and Circuit Design share the [sidebar and drawing stack](../src/components/panel/EditorLayout.tsx), including the resize handles and bottom-panel height. The bottom panel uses the same [list-mode dropdown](../src/components/panel/ListModeMenuButton.tsx) as Circuit Design in the right side of the compact grid header. It switches between Components and Netlist. Selecting a footprint opens its editor in the same panel. The Board menu opens Board tools. Board, Copper and Fabrication commands use the browser dropdowns and Electron native menus. Schematic and PCB share the [viewport frame](../src/components/svg/DrawingViewportFrame.tsx) and ruler placement. Both PCB scrollbars and trackpad pan follow the drawing camera. Shift-wheel zooms in steps, Ctrl-wheel zooms around the pointer and the board ruler uses positive Y upward. [Milestone and verification](TODO.md#editor-interface-redesign).

## Shared editor contract

### One toolbar and command system

- Keep the toolbar at the top of the window. Extend the existing toolbar system with the current workspace's tools. Use its icon buttons, dividers, tooltips, translations, split buttons, disabled states and compact grouping. Reuse the actual Open, Save, Save As, Undo, Redo, Text, Zoom and Ruler controls wherever the action exists.
- Register shared commands once. The active document and selection determine the handler and enabled state. The browser toolbar dropdowns, Electron native application menu, context menu and shortcuts invoke those commands. Workspace-specific tools supply their own actions to the same system. In side-by-side mode, editor focus selects the command target.
- Show the active document name and its unsaved state in the common window header and tabs.
- Open the editor that matches the document being created or opened. Group schematic and symbol-library creation separately from PCB and footprint-library creation in **File → New**. Show `.dsn`, `.dzn` and `.dpn` together in the design file picker. Use project document tabs for open files and schematic sheets or **View → Show Charts** for simulation.
- Use the existing Fluent dialogue components and focus behavior for properties, confirmations or workflows that need a dialogue. Keep frequently edited selection properties in the bottom pane.

### Shared panel layout

| Region | Common purpose | PCB Design |
| --- | --- | --- |
| Left | Browse project files and library content. Search, preview and start adding an item. Reuse the shell's collapse, resize and tab behavior. | Projects in Project mode, footprint library, and the project's unplaced components with draggable footprint previews. In Single File mode, keep the footprint tools available. |
| Centre | Give the drawing the available space. Use the existing drawing area, rulers, viewport controls and file/sheet navigation. | Expose the board, active placement or route preview and selection marks. |
| Bottom | Navigate the circuit or object list when idle. Show direct properties and editing controls for the current selection. Keep the shared vertical resize handle. | Navigate components and nets, edit selected components, and locate design-check findings from the results pane. |
| Right | Open auxiliary tools that need to remain visible alongside the drawing, such as simulation charts. | Show Layers and open Board Tools in the shared right-side container. Launch analysis and manufacturing workflows from menus. |

Keep ordinary selection and placement on the drawing. Move advanced settings out of the main editing path. Use the established panel sizes, styles, borders, and density as the starting point. Review the actual rendered window at regular and narrow sizes.

Keep **Route track**, **Fit board**, and **Check board** visible at 900 px. Group PCB drawing commands under **Draw** and put secondary view commands in **More PCB commands** at narrow widths. Use the shared drawing tools and shape choices for the commands in **Draw**. Show active routing controls beside the canvas and group manufacturing and auxiliary layers behind disclosures. [PCB UI and UX review](pcb-ui-ux-review.md)

### Placement and persistence

1. Select a component or footprint in the left panel and drag its picture onto the drawing. Reuse the preview drag and sheet drop pattern. Provide a keyboard entry into the same placement tool.
2. The active placement tool shows one snapped preview. Click on the board to commit immediately as one undoable document edit. The committed footprint appears at that position, leaves the unplaced list and becomes selected. Movement of the pointer after commit follows the normal selection tool. An explicit placement queue may arm only the next unplaced component.
3. Escape or right click cancels the pending preview or move. Keep previous committed edits and undo history. An invalid point leaves the placement tool ready for another point and gives a reason.
4. Moving, rotating, flipping, group operations and numeric property edits use the same in-memory document history. Use Save, Save As and Save All to persist PCB edits. An untitled browser document opens a picker only when the user requests a save. The asterisk in the window title identifies a dirty board.

### Drawing interaction

- Use the same named Zoom In, Zoom Out and Ruler actions across the drawing editors. Use the [shared wheel zoom policy](../src/util/editorZoom.ts) for the schematic, simulation drawing and PCB. Ordinary wheel input pans the editors. Shift-wheel uses the toolbar zoom steps and Ctrl-wheel zooms around the pointer. Horizontal Shift-wheel input leaves the zoom unchanged. Footprint and CAM previews retain wheel zoom without a modifier. Board-fit and selection-fit commands use the same viewport service. Changes to viewport, layer display and ruler visibility are display state.
- Mount the existing `Ruler` on both drawing edges in PCB Design. Feed it the viewport origin, scale, scroll or pan offset, and current pointer position. Convert PCB nanometres to the displayed units at the adapter. Verify the PCB Y direction as well as X, including pointer indicators after pan, zoom, resize, unit changes and toggling the rulers.
- Share the anchored context-menu renderer. Each workspace supplies applicable actions for the current object or empty drawing. Common actions use the same labels, icons and command IDs. Right click during a tool operation follows that tool's cancel behavior. Support keyboard invocation from the focused drawing.
- Share viewport transforms, snapping integration, selection feedback and overlay infrastructure where the behavior is equivalent. Workspace adapters provide the board or schematic geometry, units and editing constraints. Extend an existing shared component when it needs a capability. Keep separate renderers only for domain-specific geometry or tools, with common controls above them.
- Circuit Design and PCB Design use the same rectangle, ellipse and closed-line manipulators, SVG components and selection handles. PCB supplies snapped nanometre coordinates, appearance, corner radii and board operations through an adapter. The board model retains authored shapes and derives fabrication geometry from them.
- Use the same hit test for pointer preselection and click selection. Draw a dashed outline around the hover target and a solid outline for selected PCB objects. Drag on empty drawing to select objects enclosed by the shared schematic marquee. Shift adds to the selection. Drag a placed footprint to preview its snapped destination, then release to commit one undoable move.
- Clicking empty drawing clears the selection and net highlight. The current navigation list stays open.
- In PCB Design, pick objects across all visible, unlocked layers. The eye and lock controls act independently. The Layers panel header offers Show All and Lock All / Unlock All. Layer locks and visibility are editor state, and routing has its own layer control.
- Visible, unlocked holes, slots and cutouts use the shared schematic hover and selection outlines, just like objects on other layers. Locked objects let pointer hits pass through to eligible objects underneath.
- Keep every placed object in the Components grid. Use aligned columns for applicable layers, with a layer name and the Layers panel's eye and lock icons in each populated cell. Keep the status indicators visible and accessible when picking is disabled.
- Size simple PCB forms to their contents and bound them to the viewport. Use a larger surface for previews, custom outline editing, and change reviews. Keep each surface's title and action footer visible while the body scrolls. Align fields and stack them when space is limited. Use checkboxes for persistent flags such as position, rotation and routing locks. Use **Back** for previous steps, **Cancel** for exiting a draft, and **Close** for dismissing a viewer.
- Use the existing SVG unit conversion when drawing nanometre geometry with native SVG shapes. Check a board on both sides of the drawing origin to verify that rendering, rulers and pointer actions agree at large coordinates. [Large-coordinate PCB rendering](pcb-performance.md#large-coordinate-pcb-rendering)

## Acceptance evidence

Compare the running redesign with v4.1.0 using the same window size. Include an ordinary schematic, a populated PCB and an open simulation chart. Exercise browser dropdowns and Electron native menus separately. Check that the drawing remains the dominant surface, the preview can be dragged from the left panel, direct properties appear below, advanced tools open where expected, and window and panel resizing preserve access to the drawing.

Verify the browser and Electron placement sequence from an untitled board and a saved board. Count saves and file pickers while placing, moving, cancelling and undoing. Verify the committed position after subsequent pointer motion and an explicit save/reopen. Exercise right click and keyboard context-menu invocation, pointer-anchored zoom, ruler tracking, and active-document routing in side-by-side view. Keep these interaction checks separate from the existing electrical and CAM evidence.

The recovery verification compared the released v4.1.0 window with the PCB editor
at 1440 × 900 and checked the PCB layout at 900 × 700. The [browser editor
cases](../scripts/tests/layout-browser/pcb-workspace.spec.mjs) cover placement,
undo, explicit save, wheel pan and zoom, the pointer rails, panel resizing and
keyboard context menus. The [classroom and workspace cases](../scripts/tests/layout-browser/project-hierarchy.spec.mjs)
cover focus-based commands in side-by-side view, independent tabs, explicit saving,
drawing-to-board transfer and the classroom export.

The [portable board case](../scripts/tests/layout-browser/portable-pcb.spec.mjs)
runs in Chromium and against the production Electron renderer. It drags a
footprint preview onto the drawing and verifies that one click commits it, the
placed footprint stays fixed after pointer movement, and the board remains
unwritten through placement, undo and redo. In Electron it also verifies native
menu Zoom In, Save and Open, counts picker calls and reopens a board explicitly
saved from an untitled document. The LED release and asymmetric connector preview
were read independently with [the Gerbonara checker](../scripts/pcb/check-cam-preview.py).

The portable board cases also exercise Board, Copper and Fabrication commands
through browser dropdowns, the desktop renderer bridge and the native Electron
application menu. They check the Fluent surface and footer bounds as outline
parameters, fabrication details and rule-inspection tabs change. The native
case also moves a placed footprint directly on the board, then uses Undo to
verify that it returns to the original position without a file write.

The shared wheel policy was checked in the classroom schematic and standalone
PCB. The tests compare Ctrl-wheel zoom and its pointer anchor in both editors,
and verify that horizontal Shift-wheel input keeps the zoom level. The
footprint editor and connector CAM preview test ordinary wheel zoom. The native
Electron portable-board test also passed after the change.
