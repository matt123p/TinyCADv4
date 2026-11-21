---
name: tinycad-pcb-ui
description: Implement or review TinyCAD PCB Design and footprint-editor UI, including footprint browsing and placement, board drawing interaction, routing controls, and PCB inspection workflows.
---

# TinyCAD PCB interface

Apply the [shared UI skill](../tinycad-ui/SKILL.md). Read the [branch audit and editor contract](../../../docs/tinycad-ui-design.md) before moving controls. Use the [PCB specification](../../../docs/TinyCAD_PCB_Layout_Complete_Specification.md) for board behavior.

- Route Open, Save, Undo, Zoom, Rulers and other equivalent commands through TinyCAD's existing controls and menu system. Put PCB libraries and unplaced parts in the left area, component and circuit navigation below, and advanced PCB features on the right.
- Use the schematic library's draggable preview pattern. Dropping into the drawing arms the tool. A board click commits the snapped placement and clears its preview. Derive preview state from the active tool and its pending target. For an explicit queue, arm the next unplaced part only. Support Escape and right-click cancellation.
- Trace `BoardWorkspaceSession.place` and group placement when changing placement. Commit to board history and mark dirty. Document writes belong to explicit save commands. Keep recovery and revision guards on their existing paths.
- Adapt board coordinates to the shared `Ruler`, pointer transform, zoom and hit-testing conventions. Verify both pointer markers and the axis direction. Use shared context-menu presentation with PCB-specific target actions.
- Requalify placement in browser and Electron with picker and write counts, visible committed geometry, pointer movement after commit, Undo, and explicit save/reopen. Use the classroom LED and connector examples for populated and asymmetric placements. Verify manufacturing separately where the edit affects authoritative board geometry.
