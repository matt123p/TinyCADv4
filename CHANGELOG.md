# Changelog

## Unreleased

### Added

- Image properties for fixed aspect ratio, restoring original proportions and clipping each edge in source pixels, preserved per image in TinyCAD XML.
- Import images from File → Import → Image, alongside image paste and drag-and-drop. Other browser-supported formats, including GIF and WebP, are converted to still PNG images.
- Integrated AI chatbot in browser and desktop builds, opened from the toolbar, with Markdown replies, file attachments and expandable thinking, tool-call and image activity.
- Bring-your-own-key connections for OpenAI, Anthropic, Google Gemini and compatible providers, plus locally hosted Ollama. Guided setup keeps API keys hidden after entry and restores saved connections and settings on restart, with model and thinking controls directly in chat. Desktop credentials use OS-backed encryption, with memory-only storage when secure storage is unavailable.
- Sign in with ChatGPT using an eligible paid subscription in desktop and local browser builds, with account usage controls and online search with source citations. Production browser builds offer API-key setup.
- Direct AI tools to inspect the current unsaved drawing, metadata, netlist and SVG/PNG previews, search bundled libraries, and create, place or edit circuitry with revision checks and Undo/Redo. Library searches preserve original artwork and SPICE attributes.
- PDF and image reference imports for creating editable circuits and symbols, including a compact IC generator. Generated symbols can be placed ready to wire or added individually or in batches to the active library.
- Automatic circuit layout and wire tidy-up, with shorter routes around objects, annotations and other wires, support for hidden transistor pins, and preservation of connections and fixed anchors.

- Integrated local ngspice simulation in browser and desktop builds, with Simulation sheets for operating point, transient, AC, DC sweep, noise, transfer-function and pole-zero analyses. Desktop also supports event-driven XSPICE models.
- Configurable voltage/current sources, controlled sources, voltage/differential/current probes and virtual oscilloscopes, multimeters, function generators and bench supplies.
- Circuit Explorer for temporary tuning, parameter sweeps, named measurements, requirements, DC overlays, frequency-response investigations, tolerance studies, test cases and power/stress reports.
- Compressed `.dzn` drawings containing schematics, embedded symbols, simulation setups, model attachments and optional retained results, with run history, CSV/PNG exports, independent pop-out chart windows and Save without results. Solver diagnostics are retained even when a run produces no samples.
- Eleven-chapter SPICE and six-chapter XSPICE courses with 28 distinct runnable drawings, model definitions, analysis settings and retained reference acquisitions.

- Bundled standard libraries for SPICE essentials, digital logic, functional blocks, and sensors and interfaces, with configurable simulation models.
- Bundled standard libraries for motors and motion, test and measurement, audio and music, solar power and batteries, embedded processors and smart home, and network layouts. Libraries include compact vector artwork, physical pin layouts, source-checked pin maps and connection points for individual conductors, complete cables and fluid hoses.

### Fixed

- Apply the Background Colour setting to the drawing page with rulers on or off, including the touch loupe (#33).
- Remove unnecessary local down-and-up wire detours when shorter routes clear nearby objects, annotations and other wires, while preserving connections and fixed anchors.
- Treat hidden transistor pins as connection points rather than visible stems, preventing artificial return bends and repairing existing loops in the amplifier example.
- Prevent hover and rectangle-selection crashes on symbols with hidden or empty conditional attributes.

### Maintenance

- Expand the online manual with bundled-library and example guides, SPICE/XSPICE courses, simulation and `.dzn` references, layout tidy-up guidance and browser video walkthroughs, with updates to all eight manual translations.
- Add reproducible library generation, pin-map provenance, artwork galleries, A4 placement reviews and media capture for documentation and verification.
- Expand regression tests for chatbot providers, authentication, streaming and editor tools; library search, placement, wiring, rotation and save/load; and layout algorithms, dialogs, workers and browser behavior, with automated CI coverage and documented test commands.

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
