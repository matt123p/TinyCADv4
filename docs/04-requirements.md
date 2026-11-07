# Requirements and acceptance criteria

These requirements describe observable product behavior. They are intended to make the proposed UI reviewable before implementation. **Must** is required within the stated priority; **should** is a design target to validate. P0/P1/P2 scope is defined in the [feature sets](03-feature-sets.md). No criterion below claims that a simulator or prototype has already passed it.

**Branch boundary:** Assume SPICE symbols can already be obtained, selected, and placed through the editor. Symbol providers, catalogue/search/filter/import/selection/placement UI, and symbol-library maintenance are outside these requirements. Model configuration below applies to components already in the drawing. Prepared examples can supply the required symbols and metadata for UI validation.

**Document boundary:** Use one TinyCAD drawing file with schematic and non-drawing Simulation sheets. Setup, parameters, lesson instructions, instrument views, and retained results belong to that document. No project file/folder, linked schematic documents, separate workbook, or required setup/results sidecar is introduced in this version. Existing model dependencies remain inputs.

## Entry, readiness, and models

| ID | Priority | Requirement and acceptance criterion |
| --- | --- | --- |
| R01 | P0 | **Simulation through sheet tabs.** Simulate must be available in browser and desktop UI and open or create a Simulation sheet in the current drawing. Returning to a schematic preserves its selection and view. A schematic-only user can complete normal drawing workflows without adding Simulation sheets. |
| R02 | P0 | **Configured examples.** Supplied divider, RC charging, and RC low-pass examples must each open as one drawing with schematic and configured Simulation sheets, including instructions, models/sources/reference, and a named question. Starting one cannot silently replace an unsaved drawing. Symbol sourcing and selection remain outside this work. |
| R03 | P0 | **Task-led setup.** Operating Point, Transient, and AC must have plain-language task labels, defaults, and a technical-name explanation. A user can complete the configured first example without editing raw circuit text. |
| R04 | P0 | **Preflight.** Run must check included model assignments, required terminals/dependencies, explicit reference, source prerequisites, analysis values, and known connectivity issues. Blocking issues open a focused list; warnings remain inspectable. Passing checks must not be labeled a guarantee of convergence or physical validity. |
| R05 | P0 | **Issue location and scope.** An issue with an identifiable circuit target must name its reference/net and schematic sheet, open that sheet, and highlight the object. Every analysis uses all schematic sheets in the drawing. Non-drawing sheets must not contribute circuit elements. Selecting a sheet alone cannot change connectivity or circuit scope. |
| R06 | P0 | **Models for placed parts.** For a component already in the drawing, a user must be able to inspect/configure its built-in or external model, select a model definition, review dependencies, and map the existing symbol's pins to model terminals. This does not select or replace its symbol. Changes apply to the drawing instance; Cancel restores the previous assignment. |
| R07 | P0 | **Pin and device identity.** Required terminals, hidden supplies, and uncertain/duplicate mappings must be reviewable. An invalid required mapping blocks Run. Multi-unit symbols must represent the intended single physical model; mapping cannot be inferred solely from matching pin counts. |
| R08 | P0 | **Legacy controls and exclusions.** Existing model templates and RUN/control text must be detected and preserved. Conflicting analysis owners block execution with a resolution action. Exclusion must be explicit, visible, and reversible; it must neither ignore a missing model silently nor imply a short between excluded pins. Guided/custom conversion is P1. |
| R09 | P0 | **Stimulus editor.** DC, sine, and pulse forms must show quantity units, polarity, explicit amplitude convention, and waveform preview. AC magnitude/phase is a distinct section. Inconsistent pulse timing or invalid numeric input must be caught before run. |

## Analyses, probes, and results

| ID | Priority | Requirement and acceptance criterion |
| --- | --- | --- |
| R10 | P0 | **Operating Point and Transient.** Operating Point must produce a labeled value table and optional overlays. Transient must separate duration, initial-state policy, solver maximum step, output sampling, and retained interval. Hidden advanced fields still appear in the effective-settings summary. |
| R11 | P0 | **Frequency response.** Gain must identify positive/reference input and output nodes and use a defined ratio. Source setup must show the selected AC excitation and other active AC sources. Plot gain and phase with units and frequency range. Undefined/zero input produces an invalid measurement, not an infinite or zero success value. |
| R12 | P1/P2 | **Additional analyses.** Each released analysis must have a complete form, prerequisites, validation, meaningful result view, export behavior, and failure state. A catalogue label alone does not satisfy support. Priority follows the analysis catalogue. |
| R13 | P0 | **Probe meaning.** Voltage probes must state reference; differential probes state polarity and offer Swap. Current probes must name the branch/terminal and positive direction. A wire click cannot assert a uniquely defined wire current. Unsupported quantities must explain their absence. |
| R14 | P0 | **Cross-probing.** Schematic selection must focus the corresponding reading/trace, and trace selection must locate the circuit target. Add/remove actions must work through visible controls and signal lists. Repeated selection cannot create unintended duplicates. |
| R15 | P0 | **Probe availability.** Adding a probe after a run must either display retained data or offer a new run to record it. Deleted/replaced targets must become unresolved or require reviewed remapping; reused net numbers cannot silently retarget a saved probe. |
| R16 | P0 | **Complete viewer.** Results must offer trace visibility, Fit, labeled axes, exact limits, zoom navigation, numeric cursors, measurements, and data table. Operating Point needs no plot. Missing signals, empty data, and successful unplotted results must be distinguishable. |
| R17 | P0 | **Measurement definition.** Each value must identify run, signal, units, interval, and method. Full retained record is the explicit default interval. Zoom does not alter measurements unless the user chooses Use visible interval. Invalid, incomplete, or unavailable values cannot be rendered as plausible zeroes. |
| R18 | P1 | **Transforms and expressions.** Spectrum must expose record interval, window, sampling/resampling, frequency resolution, and scaling convention. Expressions must report invalid units/data. These operations must preserve the source result and indicate when more recorded data or a new run is needed. |
| R19 | P0 | **Model assumptions.** A generic, ideal, or externally assigned part must be identified accordingly. Choosing a real part number cannot silently activate a generic substitute. Main parameter, assignment origin, and dependency status must be inspectable from the placed symbol. |

## Instruments and execution

| ID | Priority | Requirement and acceptance criterion |
| --- | --- | --- |
| R20 | P0 | **Meter.** The initial meter must select positive and negative nodes, show the selected Operating Point voltage and sign/reference, and identify its run/state. An unconnected terminal says Not connected. Default loading must be described as ideal measurement. At P1, time-record DC means the labeled interval average; instantaneous sampling is an explicit separate mode. |
| R21 | P1 | **Bench instruments.** Scope, generator, Bode, and expanded meter must offer both terminal connections and searchable pickers. Every knob has numeric entry. Closing a face retains its connections. Scope/Bode/meter views must disclose acquisition identity and use shared results/settings where applicable. |
| R22 | P1/P2 | **Instrument electrical contract.** Each mode must state whether it observes data or changes the test circuit. AC RMS states its treatment of DC. Resistance/continuity requires an explicit unpowered test. Generator impedance is visible. Realistic loading is an explicit P2 configuration; ideal observations do not insert undisclosed circuit elements. |
| R23 | P0 | **Run lifecycle.** Checking, Running, Stopping, Complete, Stopped, and Failed must have distinct visible states. Cancel applies to checking; Stop applies to execution. Only one experiment can execute per drawing. Running another analysis requires an explicit stop/switch action. |
| R24 | P0 | **Stop and partial data.** Stop must preserve useful available data with a partial-state label and requested-versus-completed extent. If stopping cannot finish promptly, offer Abort with consequences. A new Run creates a new execution; it cannot masquerade as continuation of a stopped one. |
| R25 | P0 | **Snapshot and freshness.** Runs must keep the circuit/setup identity they used. Circuit values, wiring, active models, source, analysis, or relevant numerical-setting edits mark affected results Out of date. Layout-only edits do not. A changed drawing during a finite run cannot rewrite that run's identity. |
| R26 | P1 | **Live acquisition.** Live must display simulated time and acquisition state. Pause/Resume is offered only when same-experiment continuation is supported. Supported live controls record their values/times. Topology/model changes require stop/restart; trial tuning creates a new acquisition. Playback is explicitly distinguished from execution. |

## Experiments, history, and portability

| ID | Priority | Requirement and acceptance criterion |
| --- | --- | --- |
| R27 | P1 | **Sweeps.** Show base analysis, variables, units, values, nesting, total run count, and estimated data implications before Run. Results identify each combination. Stopped or failed members remain visible and do not count as complete successful samples. A large request requires an informed start action. |
| R28 | P1 | **Tuning.** Trial and saved values must remain separately visible. Apply to drawing must be explicit and undoable; Discard restores the design value. Results retain the trial values that produced them. Choosing trial values never rewrites a pinned baseline. |
| R29 | P2 | **Statistical experiments.** Monte Carlo must preserve distributions, tolerance meaning, correlations, seed, sample count, and pass/fail criteria. Counts distinguish success, failure, and cancellation. Yield uses a disclosed denominator; uncertainty and invalid samples cannot be hidden. Corner studies name their tested combinations and never claim an exhaustive worst case without evidence. |
| R30 | P0 | **History and compare.** Each run belongs to a Simulation sheet and identifies its analysis, revision, effective settings, state, and retained data. Compare selects runs within the current drawing. Users can pin a baseline and compare compatible results with clear labels; incompatible results remain separate. Retention limits are visible, pinned data is protected, and deleting retained data preserves a labeled setup record. |
| R31 | P0 | **Save and reopen one drawing.** Save/Open must preserve schematic and Simulation sheets, their types/names/order, setup, parameters, instructions, model assignments/references, probes, measurements, exclusions, and supported instrument connections in one `.dsn` drawing. Retained results, when selected, stay in that file. Setup-only saving and missing dependencies have distinct reopen states. Legacy-compatible exports must disclose any loss of non-drawing content and retain the complete original. Versioned XML records and migrations are specified in the implementation plan; a project/workbook or setup sidecar is not a preserving alternative for this version. |
| R32 | P0 | **Result export.** Export recorded numerical data as CSV or self-describing JSON, measurements as CSV, and plots as SVG, with explicit run/sheet identity, units, interval, and partial/stale/trial state. Numerical export uses retained samples rather than plot decimation; complex values and invalid readings have explicit representations. A user can preview scope and size. Export cancellation/failure leaves results intact; an unobservable browser download completion cannot trigger automatic removal. |
| R33 | P1 | **Lesson sharing and migration.** Save a copy must share one drawing with its schematic and Simulation sheets and report existing model dependencies and retained-result choices. Optional result/netlist exports are not required to reopen it. Supported netlist/model inputs require a compatibility report; native Multisim projects remain unsupported in this version. No experiment-package or project-management workflow is required. |
| R34 | P1 | **Expert controls.** Custom analysis, directives, and numerical settings must show effective values and precedence. Unsupported GUI round trips cannot discard custom text. Applying a recovery setting creates a traceable new execution. Read-only generated text and complete diagnostics are required at P0. |
| R35 | P1 | **Digital and mixed signal.** Supported logic states must be displayed with a legend; unknown/high-impedance states cannot be collapsed to zero. State details beyond the basic display remain inspectable. Analog/digital boundaries require explicit compatible interfaces and thresholds. Unsupported model/platform cases explain the limitation before run. |
| R36 | P1 | **Interactive controls and indicators.** Operate controls must be visibly distinct from drawing edits. Supported switch/button actions must record applied simulated time or a visible pending acquisition change. Keyboard/touch must preserve press/release semantics. Indicators must identify their modeled quantity, acquisition, and display rule; stale data cannot look live, and decorative brightness cannot imply a physical thermal/damage model. |
| R37 | P0 | **Non-drawing Simulation sheets.** The ordinary sheet bar must offer Schematic and Simulation types. A Simulation sheet contains one analysis, its parameters, short instructions, instruments, and result views in the main area. A compact panel/docked result while probing must show those same settings and name the owning sheet. Shared circuit values and sheet-specific trial/sweep overrides must be distinguishable. No project creation or separate setup document is required. |
| R38 | P0 | **Sheet lifecycle and run ownership.** Add, rename, reorder, duplicate, and delete use normal sheet actions. Duplication copies setup and instructions without generating/copying run data or duplicating the shared circuit. Rename/reorder preserves references. Deleting setup/results needs an explicit warning and undo path; deleting a running analysis's sheet requires explicitly stopping it first. Switching tabs cannot start/stop a run or change its owning sheet; running status and probe destination remain clear on every sheet. |

## Runtime and distribution

| ID | Priority | Requirement and acceptance criterion |
| --- | --- | --- |
| R39 | P0 | **Backend selection.** Browser modes must run local ngspice WASM in an isolated worker; Electron must use its bundled native engine in a supervised helper process. Both use the shared run/result contract and capability reporting. A missing/corrupt engine is a startup diagnostic, not a silent system-engine, remote-solver, or WASM fallback. Stop must work even when a browser solve cannot service worker messages, preserving accepted complete chunks and reporting the stop method honestly. |
| R40 | P0 | **Qualified bundles.** Engine source/toolchains/patches must be locked and built or obtained as verified build-ID artifacts through the common CI path. Every declared app architecture needs matching helper/libraries/dependencies/modules, notices, manifest, real numerical tests, and installed-package verification. Missing or untested payloads must fail release. Build/signing/dependency requirements are specified in [Engine builds and bundling](08-engine-build-and-bundling.md). |

## Result removal and DSN encoding

| ID | Priority | Requirement and acceptance criterion |
| --- | --- | --- |
| R41 | P0 | **Compressed DSN and detection.** New drawings default to a standard ZIP-based `.dsn` beginning with ZIP's local-header signature at offset zero, with a TinyCAD manifest/version and document/result entries. Detect ZIP versus existing XML from input bytes, then validate the detected format. Both representations preserve the same document model; ordinary Save remembers an opened file's representation, and Save as allows explicit conversion. A damaged or unrelated ZIP must not fall back to XML. |
| R42 | P0 | **Remove stored results and compact copy.** Offer selected runs, the current Simulation sheet, or all sheets, with affected counts, size estimate, and a visible pinned-baseline review. Explicit removal clears raw/derived data, cached values/previews, acquisitions, and generated logs while preserving setup, instructions, circuit, probes, measurement definitions, and compact run metadata marked Results removed. Stop affected active runs first. Removal is one bounded undoable document action; Save a copy without results leaves the original intact. Export first never implies automatic deletion. |
| R43 | P0 | **Binary-safe persistence and bounded archives.** All DSN storage/open/rendering paths must use the shared byte-based codec. Save a fresh archive containing only reachable payloads and updated checksums; no obsolete result bytes or dangling references may survive stripping. Enforce archive/decoded-result limits, version checks, path and checksum validation. Cancelled/failed writes preserve the original and correct dirty state. Details are in [DSN format and result management](09-dsn-format-and-results.md). |

## Numeric and electrical meaning

The following policies apply to guided controls. Imported raw SPICE retains its engine interpretation; these are distinct input surfaces. The conventional suffix distinction is documented in the [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf).

| Input or quantity | Required guided behavior |
| --- | --- |
| `1 kΩ`, `1k`, `1e3` in a resistance field | Normalize visibly to 1 kΩ after commit. |
| `1 MΩ` or `1 meg` | Interpret as 1,000,000 Ω; show the resolved value before run. |
| Bare `1M` | Ask for inline disambiguation: mega or milli. Do not silently accept one interpretation. |
| `1m` in a resistance field | Interpret as 0.001 Ω, with the field's unit visible. |
| `10u`, `10µ`, `10μ` in a capacitance field | Resolve consistently to 10 µF. |
| `1,5` in a decimal-comma locale | Accept as 1.5 with an unambiguous normalized preview. Reject ambiguous grouped values such as `1,000` until clarified. |
| A time entered into resistance | Reject with an example of the expected quantity. |
| Raw model text containing `1M` | Preserve raw semantics; surface inspection/help rather than rewriting the model. |
| Current | State terminal/branch direction; use a visible arrow and signed value. |
| Power | Distinguish absorbed/delivered power and average/instantaneous definition. |
| AC result | Distinguish magnitude, phase, real/imaginary, absolute level, and gain ratio. |
| Decibels | Identify the reference and whether the quantity is an amplitude or power ratio. |
| Time and frequency sampling | Distinguish adaptive solver points, retained/display samples, and any resampling. |

Expressions need a separate syntax explanation and normalized preview where evaluable. Scalar fields must not accept arbitrary trailing text as if it were a valid unit. Advanced display precision never implies that every displayed digit is physically meaningful.

## Quality and usability requirements

These are proposed acceptance targets, to be measured during prototype and product validation. Performance targets concern UI feedback; they are not guarantees about solver completion time. A test machine, dataset, browser, and screen-reader matrix must be recorded before performance or conformance claims.

| ID | Priority | Requirement / target |
| --- | --- | --- |
| Q01 | P0 | **Accessible operation.** Target WCAG 2.2 AA for simulation controls, forms, navigation, tables, and result alternatives. Test keyboard-only operation and screen-reader labels/status. A plot or circuit gesture must have a usable list/table equivalent. This is a target, not a completed accessibility claim. [W3C reference](https://www.w3.org/WAI/WCAG22/quickref/). |
| Q02 | P0 | **Legibility.** Distinguish trace/state information with text and line/marker style in addition to color. Support light/dark contrast, visible focus, 200% UI text zoom, reduced motion, and exact numeric entry. Target 44 × 44 CSS pixel touch controls where space allows. |
| Q03 | P0 | **Space and continuity.** Review at 1366 × 768 and 1440 × 900. Toolbar and Stop remain reachable when panels overflow. Target a 600 × 300 schematic viewport with docked results at 1366 × 768; otherwise offer a clear single-view layout. Preserve selected analysis/trace when switching views. |
| Q04 | P0 | **Equivalent input.** Complete setup, differential probing, cursor placement, model mapping, and stop/retry with keyboard and without hover. Preserve touch loupe and two-finger navigation. Panel/lead dragging has a button/picker alternative. |
| Q05 | P0 | **Language and locale.** User-visible labels/messages must support translation. Allow long translated labels, decimal-comma entry policy, SI prefixes, and local date/time presentation while preserving reproducible numeric meaning and raw command syntax. |
| Q06 | P0 | **Responsive feedback.** Target visible control feedback within 100 ms and run-start acknowledgement within 1 second on the agreed reference environment. Show elapsed/stage information for long work. Stop acknowledges immediately; after 5 seconds without completion, show continued status and the Abort option. Never invent a progress percentage. |
| Q07 | P0 | **Data control.** Disclose retained results and their size before operations that materially enlarge saved work. Bound automatic history retention; protect pinned runs. Unsaved setup or failed export must be recoverable without losing the drawing or previous successful results. |
| Q08 | P0 | **Platform honesty.** Use consistent names and experiment semantics across desktop/browser. Capability or file-access differences must be explained at the point of use. Browser execution is local WASM and Electron execution is bundled native ngspice; a cloud account must not be presented as necessary for local solving. Optional features such as mixed-signal modules or Pause/Resume require per-backend qualification. |
| Q09 | P0 | **Honest presentation.** Prototype fixtures must always be labeled Sample results. Product views must distinguish waiting, disconnected, missing data, invalid measurement, failed, partial, trial, out-of-date, and complete. Decorative animation cannot be the only status indicator. |

## Acceptance scenarios

These scenarios can first be exercised with a UI prototype and labeled fixtures. Later numerical integration validation is a separate activity.

| ID | Given / action | Expected outcome | Requirements |
| --- | --- | --- | --- |
| A01 | Open the divider example; Run; probe OUT | Read 2.50 V relative to Ground; locate OUT from the reading. No SPICE text required. | R02, R03, R10, R13–R17, R20 |
| A02 | Change the lower resistor to 2 kΩ after A01 | Prior run is visibly out of date; a new run yields about 3.33 V in the ideal example and preserves the old run. | R25, R30 |
| A03 | Open a two-sheet drawing with one missing model and no reference | Both blockers are clear; selecting the model issue opens the correct sheet; fixing ground is explicit. | R04–R08 |
| A04 | Assign a model with a different pin order | Review terminal mapping, including supplies; invalid required mapping prevents execution; Cancel preserves previous data. | R06, R07, R19 |
| A05 | Configure the low-pass AC example | Input/output ratio, AC source, range, gain and phase are visible; a missing/zero input is explained. | R09, R11, R16 |
| A06 | Add a current probe and a differential voltage probe | Both have direction/reference labels; Swap reverses differential sign; unsupported wire current is explained. | R13–R15 |
| A07 | Start a long run, edit the drawing, then Stop | Responsive UI, preserved run snapshot, partial extent and changed-drawing indicator; restart makes a new run. | R23–R25, Q06 |
| A08 | Enter `1M`, `1 MΩ`, a micro symbol, a decimal comma, and a wrong unit | Ambiguity is resolved inline; normalized values are visible; wrong dimensions are rejected. | R09, numeric policies, Q05 |
| A09 | Complete a run with no selected trace; then add an unrecorded signal | Empty-plot guidance appears; new signal requests a rerun and does not invent data. | R15–R17 |
| A10 | Save/reopen setup without results and with a missing model file | Setup and probes return; result-retention and dependency messages are distinct; original assignment survives. | R30, R31 |
| A11 | Connect a scope and generator; run Live; pause; change a model | Shared acquisition is clear; numeric controls work; model change requires restart; no fake continuous trace. | R21, R22, R26 |
| A12 | Sweep, tune, pin a baseline, compare, and export | Run count and trial values are clear; failed members remain visible; export preserves units and result status. | R27–R30, R32 |
| A13 | Open legacy RUN controls and a native Multisim design | Existing custom text is preserved and conflicts explained; unsupported formats receive a specific compatibility response. | R08, R33, R34 |
| A14 | Complete key tasks at 200% zoom and with keyboard/touch alternatives | Setup, readings, Stop, and recovery remain accessible; no operation depends only on color or dragging. | Q01–Q06 |
| A15 | Operate a switch and momentary button in Live, then pause and stage a change | Drawing objects remain in place; applied/pending times are clear; release behavior is accessible; indicator data and stale state are inspectable. | R26, R36, Q02, Q04 |
| A16 | Add `DC checks` and `Frequency response` Simulation sheets beside two schematic sheets; save and reopen | All four sheets, parameters, instructions, probes, and selected retained results return in one drawing file. Both analyses use the shared circuit; non-drawing content adds no circuit elements. No project or sidecar is required. | R05, R31, R37 |
| A17 | Run from one Simulation sheet; probe a schematic; select another setup; rename, duplicate, and delete a setup sheet | Run ownership and probe destination stay clear; tab switching does not execute anything. Rename preserves references; duplicate copies setup only; deletion warns about data loss and can be undone. | R23, R30, R37, R38 |
| A18 | Run the same supported divider/RC/AC fixtures in the built browser app and Electron app | Browser reports the qualified WASM build; Electron reports its bundled native build. Results meet fixture-specific tolerances; worker/native failures and Stop preserve the drawing and accepted partial data. | R24, R39, Q08 |
| A19 | Install each release target on a clean compatible system without ngspice installed; serve both final browser builds under nested paths | Matching engine and enabled modules initialize and run real fixtures. Missing dependencies, incorrect architecture, corrupt assets, or invalid manifests fail qualification before release. | R40 |
| A20 | Export selected full/interval data and plots from partial, stale, and trial results; cancel/fail an export or start an unverified browser download | Units, scope, complex data, and status are preserved; raw export uses retained samples. Original data remains unchanged and no automatic stripping occurs. | R17, R32 |
| A21 | Remove selected results including a reviewed pinned baseline, then save; alternatively save a copy without results | Removed payloads/caches/logs are absent and metadata says Results removed. Setup and circuit survive. Undo follows the declared budget; a compact copy leaves the original intact. | R30, R31, R42, R43 |
| A22 | Open old XML and ZIP-based drawings with the same extension; convert both ways and reopen | Header/content detection selects the decoder; IDs, sheets, setup, samples, and provenance round-trip. New drawings default to compression and existing files retain their representation on ordinary Save. | R31, R41 |
| A23 | Open corrupt/unrelated/oversized/path-traversal ZIPs; cancel/fail compression or saving | Specific bounded failures without XML fallback, extraction, unbounded allocation, orphan result payloads, or loss of the original drawing. Binary storage works in browser, Drive, Electron, and intended rendering consumers. | R41, R43 |

Continue to [UI review and validation](06-ui-validation.md).
