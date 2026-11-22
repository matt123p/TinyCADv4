---
name: tinycad-pcb-ui
description: Implement or review TinyCAD PCB Design and footprint-editor UI, including footprint browsing and placement, board drawing interaction, routing controls, and PCB inspection workflows.
---

# TinyCAD PCB interface

Apply the [shared UI skill](../tinycad-ui/SKILL.md). Read the [branch audit and editor contract](../../../docs/tinycad-ui-design.md) before moving controls. Use the [PCB specification](../../../docs/TinyCAD_PCB_Layout_Complete_Specification.md) for board behavior.

- Route Open, Save, Undo, Zoom, Rulers and other equivalent commands through TinyCAD's existing controls and menu system. Put PCB libraries and unplaced parts on the left. Keep the board free of a permanent right inspector. Put board setup, analysis and fabrication commands in menus.
- Read the [Circuit Design skill](../tinycad-circuit-ui/SKILL.md) when changing selection or bottom-panel behavior. Switch between Components and Netlist using Circuit Design’s `ListModeMenuButton` at the right edge of the compact grid header. Show the corresponding editor automatically when a component is selected. Open Board tools from the Board menu. Reuse the schematic compact grids with board-specific rows and selection handlers.
- Use the schematic library's draggable preview pattern. Dropping into the drawing arms the tool. A board click commits the snapped placement and clears its preview. Derive preview state from the active tool and its pending target. For an explicit queue, arm the next unplaced part only. Support Escape and right-click cancellation.
- Trace `BoardWorkspaceSession.place` and group placement when changing placement. Commit edits to in-memory board history and use the title-bar asterisk for dirty state. Persist PCB edits through explicit save commands and keep the revision guards on those writes. Reopening a board loads the last explicit save.
- Adapt board coordinates to the shared `Ruler`, pointer transform, zoom and hit-testing conventions. Verify both pointer markers and the axis direction. Use shared context-menu presentation with PCB-specific target actions.
- Provide working horizontal and vertical drawing scrollbars through the same camera as wheel pan, zoom and rulers. With no tool active, preview the pointer target using a visible outline, mark committed selection with a distinct shape or stroke, and let a drag from empty drawing select the objects enclosed by the schematic-style rectangle. Use the click hit-test for the hover preview.
- Follow Circuit Design click-away behavior. Clicking empty drawing clears the board selection and the selected net. Keep the Netlist visible so the next net can be selected from the same list.
- Drag a placed, unlocked footprint directly from its visible geometry. Preserve the grab offset and show the snapped preview throughout the gesture. Release to make one validated Undo entry. Keep the board revision unchanged during the preview, on cancellation and for locked footprints.
- Requalify placement in browser and Electron with picker and write counts, visible committed geometry, pointer movement after commit, Undo, and explicit save/reopen. Use the classroom LED and connector examples for populated and asymmetric placements. Verify manufacturing separately where the edit affects authoritative board geometry.
