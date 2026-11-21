# TinyCAD development guidance

For editor interface changes, start with the [TinyCAD UI skill](.agents/skills/tinycad-ui/SKILL.md) and the [v4.1.0 design contract](docs/tinycad-ui-design.md). Inspect the existing shared controls and command handlers before adding workspace UI.

Read the matching workspace skill for changes to [PCB Design](.agents/skills/tinycad-pcb-ui/SKILL.md), [Circuit Design](.agents/skills/tinycad-circuit-ui/SKILL.md) or [Simulation](.agents/skills/tinycad-simulation-ui/SKILL.md). For changes shared by workspaces, apply each affected workspace skill.

Use the [project specification](docs/project-specification.md) for project behavior and the [PCB specification](docs/TinyCAD_PCB_Layout_Complete_Specification.md) for board editing and manufacturing. Track verified redesign behavior in the [editor checklist](docs/TODO.md#editor-interface-redesign).
