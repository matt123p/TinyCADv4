# Changelog

## Unreleased

### Added

- Markdown formatting in drawing text boxes, including headings, emphasis, lists, tables, links, images, task lists and fenced code blocks, with sanitized embedded HTML.
- Live Markdown source formatting while editing: headings, bold, italic, strikethrough and links retain their editable markers. Formatting follows the chosen base font and size, with matching caret placement, selection and wrapping.
- Formatted text boxes in SVG exports, browser printing and PDF exports.
- Compact toolbar selector for 90°, 45°, and free wire modes, with original TinyCAD 45° angle constraints. Selecting a mode activates the wire tool and preserves an active wire preview.

### Fixed

- Display file-handle library names correctly when no library title is available.
- Stop Google sign-in initialization cleanly when the Google API is unavailable.
- Show the loupe button only after touch input on the drawing canvas, keeping it hidden on touchscreen PCs until touch is used.

### Maintenance

- Resolve the outstanding TypeScript errors across UI components and platform integrations, add browser API type declarations, and provide an `npm run typecheck` command.

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
