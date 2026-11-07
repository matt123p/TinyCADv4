# Changelog

## Unreleased

### Added

- Local plugin development from loopback HTTP servers or selected folders, with manual reloads, cached snapshots, rollback, and a CORS-enabled development server command.
- Compact toolbar selector for 90°, 45°, and free wire modes, with original TinyCAD 45° angle constraints. Selecting a mode activates the wire tool and preserves an active wire preview.
- Plugin manager for selecting individual plugins from GitHub repositories or the curated starter list, with release-based automatic updates, version pinning, and rollback.
- Plugin descriptions, Markdown changelogs, and versioned full documentation available before installation and from cached packages.
- Isolated plugin runtime and APIs for left/bottom panels, symbol editor tabs, main pages, menus, commands, toolbars, component libraries, and plugin data in design/library files.
- Local plugin caching in Electron and browser package caching with installed-version tracking.
- Bundled Circuit Inspector and Project Home examples, independent document sessions with separate undo/save state, and plugin authoring documentation, schemas, and release packaging tools.

### Fixed

- Show the loupe button only after touch input on the drawing canvas, keeping it hidden on touchscreen PCs until touch is used.
- Keep the first edit after loading a document undoable.
- Preserve symbol-definition identities and plugin metadata when placing, copying, editing, and saving library symbols.

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
