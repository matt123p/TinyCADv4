---
name: tinycad-ui
description: Design or review changes to TinyCAD's editor shell, shared commands, toolbars, menus, panels, dialogs, drawing navigation, or cross-workspace interactions using TinyCAD v4.1.0 as the reference.
---

# Shared TinyCAD interface

Read the [TinyCAD editor design](../../../docs/tinycad-ui-design.md). Compare the relevant code at tag `v4.1.0` with the current branch. Use the recorded source paths in the audit to find equivalent controls. For a layout change, inspect both rendered editors at a comparable size.

- Extend the actual shared toolbar, menu definitions, command routing, resize handles, context-menu renderer, zoom and `Ruler`. Reuse the existing controls, icons, labels and focus behavior. Put workspace-specific availability and handlers behind the shared entry points.
- Keep the toolbar at the window top. Present dropdowns in the browser and native application menus in Electron. The active editor supplies the target for shared commands, including in side-by-side view.
- Let New, Open and project document tabs choose the editor. Keep simulation on schematic sheets and in View commands. Follow the shared design contract for New menu grouping and file-picker filters.
- Keep browsing and previews on the left and give the drawing the available space. Use the Circuit Design bottom-panel pattern: show navigation while idle, then replace it with the selected object's editor. Put commands in the shared menus. Use a temporary auxiliary panel only for a tool that needs to stay visible alongside the drawing.
- Trace the equivalent Circuit Design control from its shell to its rendered component before changing another workspace. Reuse `EditorSidePanel`, `EditorDrawingStack` and `DrawingViewportFrame` when the roles match. Use `LibrarySourceTabs` for library source navigation and `LibraryDragPreview` for dragging rendered previews. Pass workspace data, units and handlers through those components.
- Match the Fluent UI controls already in the editor. Use a checkbox for a persistent binary setting and a menu item or button for an action. Use the shared `ListModeMenuButton` in a compact grid header for bottom-panel list switching. Use the shared Fluent dialog components, aligned fields and consistent spacing. Set a stable, viewport-bounded surface for multi-step workflows and scroll the body when content grows. Keep the footer and primary action in place.
- Treat selection, placement previews, pan, zoom and ruler positions as interaction state. Commit edits through the document's Undo path. Invoke document writes through the established save commands and adapters.
- Verify the changed workflow in the owning editor and another workspace that shares the relevant component. Compare populated views at normal and narrow sizes. Exercise both platform menu entry points, scroll the actual drawing and dialog body, and check that changing a dialog step preserves its bounds. Follow the [editor checklist](../../../docs/TODO.md#editor-interface-redesign) for the PCB redesign.

Use the [PCB](../tinycad-pcb-ui/SKILL.md), [Circuit Design](../tinycad-circuit-ui/SKILL.md) or [Simulation](../tinycad-simulation-ui/SKILL.md) skill for workspace behavior.
