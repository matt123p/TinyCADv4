---
name: tinycad-ui
description: Design or review changes to TinyCAD's editor shell, shared commands, toolbars, menus, panels, dialogs, drawing navigation, or cross-workspace interactions using TinyCAD v4.1.0 as the reference.
---

# Shared TinyCAD interface

Read the [TinyCAD editor design](../../../docs/tinycad-ui-design.md). Compare the relevant code at tag `v4.1.0` with the current branch. Use the recorded source paths in the audit to find equivalent controls. For a layout change, inspect both rendered editors at a comparable size.

- Extend the actual shared toolbar, menu definitions, command routing, resize handles, context-menu renderer, zoom and `Ruler`. Reuse the existing controls, icons, labels and focus behavior. Put workspace-specific availability and handlers behind the shared entry points.
- Keep the toolbar at the window top. Present dropdowns in the browser and native application menus in Electron. The active editor supplies the target for shared commands, including in side-by-side view.
- Keep browsing and previews on the left, the drawing central, navigation and direct properties below, and advanced tools on the right. Use the existing dialog pattern for focused decisions.
- Treat selection, placement previews, pan, zoom and ruler positions as interaction state. Commit edits through the document's Undo path. Invoke document writes through the established save commands and adapters.
- Verify the changed workflow in the owning editor and another workspace that shares the relevant component. Include normal and narrow sizes for layout changes and both platform entry points for menu changes. Follow the [editor checklist](../../../docs/TODO.md#editor-interface-redesign) for the PCB redesign.

Use the [PCB](../tinycad-pcb-ui/SKILL.md), [Circuit Design](../tinycad-circuit-ui/SKILL.md) or [Simulation](../tinycad-simulation-ui/SKILL.md) skill for workspace behavior.
