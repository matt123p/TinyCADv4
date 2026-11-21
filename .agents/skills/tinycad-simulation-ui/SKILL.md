---
name: tinycad-simulation-ui
description: Implement or review the TinyCAD Simulation workspace UI, simulation sheets, charts, circuit explorer, SPICE controls and virtual instruments within the shared editor.
---

# TinyCAD Simulation interface

Apply the [shared UI skill](../tinycad-ui/SKILL.md). Read the [simulation reference](../../../docs/simulation.md) for workflow ownership and the [design audit](../../../docs/tinycad-ui-design.md#what-v410-does) for the released layout.

- Keep Simulation in the same drawing and shell. Use the Simulation sheet for analysis setup, the common insertion commands and schematic placement for sources and probes, and the selection-dependent bottom panel for SPICE and instrument properties.
- Use the existing right-hand `ChartWorkspace`, its resize and dismissal behavior, and the instrument window host for advanced views. Send Run and Stop to the same simulation session actions from each entry point.
- Keep file, edit, view, context-menu and ruler behavior in the shared editor. Keep the simulation engine and workers behind their existing workspace boundaries.
- Test source or probe insertion on the schematic, setup, Run/Stop, chart resizing and focus where affected. Verify that switching workspaces preserves the drawing and saved setups, and that live simulation resources follow the existing lifecycle.
