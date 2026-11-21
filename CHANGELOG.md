# Changelog

## Unreleased

### Added

- Browse bundled SPICE models offline in the symbol editor and on placed components. The picker shows descriptions, source links and optional model text. The desktop AI assistant can search, inspect and attach models from the same catalog.
- Import supported SPICE definitions from KiCad symbol libraries, including embedded models and external model files supplied with the import. TinyCAD preserves pin mappings and parameter overrides in editable Custom definitions.

### Changed

- All 29 SPICE essentials components start with a compatible bundled model and preset pin mapping. The catalog includes 20 TinyCAD Basic models, and the LM358 and LM324 default to OpenJellyBean package models.
- Library symbols link to shared model definitions. Stock parts in the SPICE and XSPICE tutorials use those links and retain their original simulation results.

### Fixed

- Show the editable Name field by default on newly placed standard library symbols and remove duplicate name captions from their artwork.
- Demonstrate Markdown formatting in the notes on bundled equipment and network drawings.


## v4.1.1 — 2026-11-20

### Fixed

- Bundle the Electron runtime libraries required to launch the Linux Snap and use XWayland on Wayland desktops.

## v4.1.0 — 2026-11-18

### Added

- Desktop AI chat with Markdown, attachments, online search and tools to inspect and edit circuits, drawings and libraries with Undo/Redo. Supports provider API keys, local Ollama and eligible ChatGPT sign-in, with secure credential storage.
- PDF/image references and an IC generator for creating editable circuits and library symbols.
- Image import from files, paste and drag-and-drop, with clipping, fixed aspect ratio and proportion reset saved in TinyCAD XML.
- Local ngspice simulation, desktop XSPICE, configurable sources, probes and virtual bench instruments.
- Circuit Explorer with tuning, sweeps, measurements, requirements, tolerance studies and power/stress reports.
- Compressed .dzn drawings with simulation setups, models, retained results, run history and CSV/PNG exports.
- SPICE/XSPICE courses, runnable examples and expanded standard component libraries.
- Automatic circuit layout and wire tidy-up that preserve connections and fixed anchors.
- About TinyCAD shows the full TinyCAD license and required third-party notices in one picker.

### Fixed

- Apply page background colour with or without rulers, including the touch loupe (#33).
- Fix hidden-pin selection crashes and unnecessary wire detours around transistor pins.

### Maintenance

- Expand translated manuals, tutorials, library generation and regression coverage.

## v4.0.11

### Added

- SVG Markdown text boxes: headings, emphasis, strikethrough, lists, tasks, quotations, rules and code blocks. Tables, links, images and HTML remain literal text.
- Live Markdown source formatting while editing: headings, bold, italic and strikethrough retain their editable markers. Formatting follows the chosen base font and size, with matching caret placement, selection and wrapping.
- One vector renderer for Markdown on the drawing, in SVG exports, browser printing and PDF exports, without rasterizing text boxes.
- Toolbar selector for 90°, 45°, and free wire modes. Selecting a mode activates Wire and preserves the active preview and TinyCAD's 45° constraints.

### Fixed

- Render Markdown task checkboxes without duplicate literal markers, including checked and unchecked boxes without labels.
- Display file-handle library names correctly when no library title is available.
- Stop Google sign-in initialization cleanly when the Google API is unavailable.
- Show the loupe button only after touch input on the drawing canvas, keeping it hidden on touchscreen PCs until touch is used.

### Maintenance

- Generate Microsoft Store “What's new” automatically from the changelog entry matching the application version, preserving other listing languages and submission metadata.
- Fix TypeScript errors, add browser API declarations and provide `npm run typecheck`.

## v4.0.10 — 2026-11-06

This is a small bugfix release that keeps the editor toolbar visible when editing symbols and schematics.

### Fixed

- Keep the editor toolbar visible when library or schematic panels need more vertical space (#31).

## v4.0.9 — 2026-11-04

### Added

- Touch support for schematic editing, including a touch loupe.
- Resizable library panel and sorting of symbol search results.
- Temporary hiding and restoring of selected objects.
- Polish translation and translations for the Replace Symbol dialog.

### Fixed

- Touch loupe usability with a stable larger lens, labeled touch controls, editor hover updates, and reliable gesture and drag handling.
- Grid visibility and snap-to-grid toggles, including keyboard movement when snapping is disabled.
- Bitmap rendering in placed library symbols.
- Escape cancellation of editing actions, including when toolbar controls have focus.
- Application quit remaining pending after cancelling the unsaved-changes dialog.
- Browser zoom compounding canvas pinch zoom.
- Desktop application and macOS About dialog behavior.

### Maintenance

- Removed the Linux ARMv7 package target because Electron 44 provides Linux binaries only for x64 and ARM64.
- Updated dependencies to address npm audit vulnerabilities.
