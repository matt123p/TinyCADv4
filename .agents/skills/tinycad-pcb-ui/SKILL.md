---
name: tinycad-pcb-ui
description: Implement or review TinyCAD PCB Design and footprint-editor UI, including footprint browsing and placement, board drawing interaction, routing controls, and PCB inspection workflows.
---

# TinyCAD PCB interface

Apply the [shared UI skill](../tinycad-ui/SKILL.md). Read the [branch audit and editor contract](../../../docs/tinycad-ui-design.md) before moving controls. Use the [PCB specification](../../../docs/TinyCAD_PCB_Layout_Complete_Specification.md) for board behavior.

- Keep one PCB editing workflow. Route Open, Save, Undo, Zoom and Rulers through the shared controls. Use Board, Copper and Fabrication menus for PCB commands. Check command availability when switching between schematic and PCB tabs and when changing focus in side-by-side view. Check Electron's native menu as well as the browser dropdowns.
- Put footprint browsing and unplaced parts in the same left sidebar as Projects and schematic Libraries. Use the existing right-side shell container for persistent Layers and on-demand Board Tools. Open Board Tools from the Board menu or when an active tool needs controls beside the drawing.
- Read the [Circuit Design skill](../tinycad-circuit-ui/SKILL.md) when changing selection or bottom-panel behavior. Keep Components and Netlist in the shared `ListModeMenuButton` at the right edge of the compact grid header. Reuse the shared grids with PCB rows and selection handlers. Selecting a component brings up its editor in the bottom panel.
- Put **PCB Size & Shape** and circuit source commands in the Board menu. Use **Import schematic or netlist** for standalone files and **Update PCB from Schematic** for registered project boards.
- Use the schematic library's draggable preview pattern. Dropping into the drawing arms the tool. A board click commits the snapped placement and clears its preview. Derive preview state from the active tool and its pending target. For an explicit queue, arm the next unplaced part only. Support Escape and right-click cancellation.
- Trace `BoardWorkspaceSession.place` and group placement when changing placement. Commit edits to in-memory board history and use the title-bar asterisk for dirty state. Persist PCB edits through explicit save commands and keep the revision guards on those writes. Reopening a board loads the last explicit save.
- Adapt board coordinates to the shared `Ruler`, pointer transform, zoom and hit-testing conventions. Verify both pointer markers and the axis direction. Use shared context-menu presentation with PCB-specific target actions.
- Provide working horizontal and vertical drawing scrollbars through the same camera as wheel pan, zoom and rulers. With no tool active, preview the pointer target using a visible outline, mark committed selection with a distinct shape or stroke, and let a drag from empty drawing select the objects enclosed by the schematic-style rectangle. Use the click hit-test for the hover preview.
- Follow Circuit Design click-away behavior. Clicking empty drawing clears the board selection and the selected net. Keep the Netlist visible so the next net can be selected from the same list.
- Run DRC in the shared bottom drawing stack. Selecting a finding locates and marks its geometry without dismissing the report.
- Use a checkbox per layer, including copper, manufacturing artwork, and non-printing layers. Keep visibility independent of routing-layer selection and export content. When checking visibility, cover authored board artwork, artwork on flipped footprints, and generated pad and via openings. Verify manufacturing changes through CAM readback.
- Finish routing with End or by reaching same-net copper. Double-click routed copper to select the connected run. Apply copper deletion in one Undo entry as soon as the target is chosen.
- Drag a placed, unlocked footprint directly from its visible geometry. Preserve the grab offset and show the snapped preview throughout the gesture. Release to make one validated Undo entry. Keep the board revision unchanged during the preview, on cancellation and for locked footprints.
- Requalify placement in browser and Electron with picker and write counts, visible committed geometry, pointer movement after commit, Undo, and explicit save/reopen. Use the classroom LED and connector examples for populated and asymmetric placements. Verify manufacturing separately where the edit affects authoritative board geometry.
