# Changelog

## Unreleased

### Added

- Reopen a loaded example's explanation in a resizable right-hand panel beside the simulation charts, with independent show/hide controls.
- Five captioned desktop video walkthroughs in the SPICE tutorials, with offline playback in the bundled example browser.

- Schematic auto-layout for the whole sheet or selected items, with High, Medium and Low strength settings and explanations beside each option.
- Run auto-layout in a background worker with cancellation, connection checks and a single Undo step to revert the result.

### Fixed

- Keep the example drawing preview visible while its description scrolls independently.
- Prevent hover and rectangle selection from crashing on example symbols with hidden or empty conditional attributes.

- Keep native simulation results subscribed until both streamed completion and solver cleanup arrive, including when their IPC messages arrive out of order.

- Remove unnecessary local down-and-up wire detours when shorter routes clear nearby objects, annotations and other wires, while preserving connections and fixed anchors.
- Treat hidden transistor pins as connection points rather than visible stems, preventing artificial return bends and repairing existing loops in the amplifier example.

### Maintenance

- Add layout algorithm, dialog, worker, editor and browser regression suites, including the original amplifier and a captured layout with pin loops, with automated CI coverage.
- Document auto-layout behavior and commands for running the test suites.

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
