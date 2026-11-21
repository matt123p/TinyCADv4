---
name: tinycad-circuit-ui
description: Implement or review TinyCAD Circuit Design, schematic sheet, symbol editor, library and component property interactions while preserving the v4.1.0 editing workflow.
---

# TinyCAD Circuit Design interface

Apply the [shared UI skill](../tinycad-ui/SKILL.md). Use the [v4.1.0 audit](../../../docs/tinycad-ui-design.md#what-v410-does) to find the library preview, sheet interactions, property table and contextual commands.

- Keep the library search and preview on the left, drawing and sheet strip in the centre, and symbol/net navigation or selected properties below. Reuse the existing property table, style and pin panels, and modal document properties.
- Start symbol placement through the existing library preview and sheet drop handler. Use the same add, snap, commit, selection and cancel paths for equivalent tools. Keep .dsn and .dzn open and save behavior available in Single File mode.
- Preserve the user's sheet selection, symbol identity, terminal connections and undo history when changing interactions. In Project mode, separate document tabs from sheets and route shared commands to the active editor.
- Verify an existing drawing on real controls, including library drag, placement, object properties, right click, zoom and rulers when touched. Include the PCB or Simulation pane when changing shared shell behavior.
