# Changelog

## Unreleased

### Added

- Motors & Motion standard library with 66 original compact vector resources for robotics and automation: motors, steppers, servos, source-checked carrier boards, generic drivers, feedback, limits, solenoids, actuators and mechanical parts.

- Test & Measurement standard library with 78 original compact vector resources for laboratory power supplies/loads, instruments, acquisition, probes, thermal equipment, relays, controls, pumps and apparatus. Connection points distinguish individual conductors, complete cables and fluid hoses.

- Audio & Music standard library with 99 original compact vector resources for live sound, recording, podcasts, instruments/MIDI, speakers, amplification, stage routing, connectors and room/stage positions. Whole-cable connection points sit inside sockets; protocol and signal types are retained in component attributes.

- Solar power and batteries standard library with 52 supplied home-energy planning symbols for generation, storage, EV charging, supply/backup, protection, monitoring and loads.

- Embedded processors and smart home standard library with 44 original vector PCB views: ESP32/ESP8266 devkits, Raspberry Pi 3/4/5, Arduino Uno/Nano/Mega, 26 sensor/actuator modules and eight LCD/OLED/touch/e-paper displays with front/rear wiring views. Header contacts use physical pin layouts; sensor boards include function icons and source-checked revision-specific pin maps.

- Network layout standard library with 47 original vector symbols: consumer devices, matching 19-inch 1U rack panels, copper and SFP+ switches, PoE variants, routers, firewalls, access points and patch panels. Cable connections snap inside the sockets.
- An Examples collection containing the original transistor amplifier drawing and an editable small office network with stacked rack panels, patch leads and office cable runs.
- Reopen a loaded example's explanation in a resizable right-hand panel beside the simulation charts, with independent show/hide controls.
- Five captioned desktop video walkthroughs in the SPICE tutorials, with offline playback in the bundled example browser.

- Schematic auto-layout for the whole sheet or selected items, with High, Medium and Low strength settings and explanations beside each option.
- Run auto-layout in a background worker with cancellation, connection checks and a single Undo step to revert the result.

### Fixed

- Reduce embedded controller artwork to about one third of its previous dimensions and sensor/display modules to about one quarter, rebuilding readable labels and on-grid header pads while preserving all pin identities and electrical types. Representative A4 pages fit 18 components at native placement size.

- Show draggable component artwork directly in the library picker lists for Standard, My Libraries and Online results; fit and centre wide and tall symbols within their previews.
- Give the browser SPICE engine sufficient stack space for amplifier examples and detect stack overflows instead of reporting misleading component or out-of-memory errors.
- Show simulation error messages in red and immediately display a failure popup for runs started from sheets, charts or instruments.
- Open the failed run's diagnostics directly from its error message or popup, and retain solver errors even when a run produces no samples.
- Keep the example drawing preview visible while its description scrolls independently.
- Fully hide the simulation and explanation panels when closed, reclaiming their space for the drawing.
- Show the standard pop-out icon on each chart in both browser and Electron, with independent windows that return to the panel when closed with ×.
- Prevent hover and rectangle selection from crashing on example symbols with hidden or empty conditional attributes.

- Keep native simulation results subscribed until both streamed completion and solver cleanup arrive, including when their IPC messages arrive out of order.

- Remove unnecessary local down-and-up wire detours when shorter routes clear nearby objects, annotations and other wires, while preserving connections and fixed anchors.
- Treat hidden transistor pins as connection points rather than visible stems, preventing artificial return bends and repairing existing loops in the amplifier example.

### Maintenance

- Add reproducible motion-library generation, manufacturer pin-map provenance, native galleries, A4 placement reviews and real-editor wiring/save-load checks.

- Add reproducible laboratory library generation, native artwork galleries, A4 placement reviews and real-editor connectivity/save-load checks.

- Add reproducible audio library generation, per-category galleries, editable A4 size reviews and real-editor socket wiring/save-load regression checks.

- Add reproducible embedded/smart-home library generation, native artwork galleries and regression checks for pin maps, electrical types, physical pad wiring, placement, rotation and save/load.

- Add reproducible network library generation, artwork previews and checks for socket wiring, rack alignment, rotation, save/load and the bundled office network.
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
