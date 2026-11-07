# UI review and validation

This document defines what the UI prototype must demonstrate. The [implementation architecture](07-implementation.md) and [engine bundling plan](08-engine-build-and-bundling.md) now define the separate integration/build work. No usability, numerical integration, or packaged-engine test is claimed to have passed merely because it is described here.

Use prepared drawings with the required SPICE symbols already placed. Symbol sourcing, browsing, import, selection/placement, and library maintenance are validated in the separate branch and are not completion criteria for this work. Simulation configuration of placed components remains part of these sessions.

Use a single `.dsn` drawing containing schematic and non-drawing Simulation sheets. Project support, linked schematic files, separate workbooks, and required setup/results sidecars are excluded from this version. This boundary is fixed, not an open prototype decision.

## Prototype milestones

### Milestone 1: a complete first experiment

Cover P0 end to end: open a one-file example, switch from its schematic to its Simulation sheet, configure a source/analysis, take a measurement, inspect a waveform, encounter and fix a problem, change a value, compare with a baseline, and save/reopen the same drawing. Review adding, renaming, reordering, duplicating, and deleting sheets, including parameters and lesson instructions on non-drawing sheets. Include all relevant empty, loading, error, partial, and stale states. A screen that only shows successful plots is insufficient for review.

Use labeled sample results and deterministic fixtures so interaction feedback can be evaluated independently of numerical work. The fixture label remains visible in screenshots and exports. No choice of ngspice runtime, hosting, bridge, schema, or solver integration is required for design review.

### Milestone 2: the full bench

Review scope/generator connections, multiple instrument views, Live/Pause/Single acquisition behavior, DC sweep, parameter experiments, tuning, spectrum/noise, mixed-signal timing, sharing, and custom-analysis precedence. Use scripted states to demonstrate unsupported capabilities and restarts. Show that these tools remain discoverable without expanding the first-run surface.

### Milestone 3: specialist depth

Validate statistical studies, advanced analyses, realistic loading, RF views, and specialist instrumentation with people who use those workflows. Promote a feature only when its setup, result interpretation, failures, and accessibility are coherent. Catalogue presence is not sufficient.

## Screen and state inventory

| Screen or component | States to review | Story / acceptance coverage |
| --- | --- | --- |
| Simulate entry and welcome | Empty drawing, configured example, unsaved work | US01, US24 / A01 |
| Multi-sheet shell | Schematic/Simulation tabs, main setup view, docked results, wide/short/narrow layouts, long translated labels | US21, US24, US26 / A14, A16, A17 |
| Readiness and Problems | Ready, warning, blocker, unknown diagnostic, cross-sheet location | US02, US13, US22 / A03, A07 |
| Model editor for a placed component | Existing component, model definitions, bad pin map, missing include, hidden supplies | US12 / A04 |
| Source editor | DC, sine, pulse, AC excitation, invalid units/timing | US03, US08 / A05, A08 |
| Analysis setup | Operating Point, Transient, AC, effective defaults and advanced fields | US05, US08 / A01, A05 |
| Meter/probe | Reference selection, current direction, unresolved target, no retained data | US04, US07 / A06, A09 |
| Results | Numerical table, plot, no trace, no data, invalid measurement, partial, out of date | US05, US11, US23 / A01, A02, A07, A09 |
| History and compare | Baseline, changed parameters/models, incompatible axes, removed data | US11, US14 / A02, A10, A12 |
| Save/export | Header-detected ZIP/XML, one-file save/reopen, setup-only, retained results, CSV/JSON/SVG export, failures, missing dependencies, legacy export loss | US14–US16, US26–US29 / A10, A12, A13, A16, A20, A22, A23 |
| Stored-result cleanup | Selected/all runs, pinned baseline review, active-run stop, Results removed, undo budget, compact-copy save | US28 / A21 |
| Sheet lifecycle | Add/rename/reorder/duplicate/delete, shared circuit, run/probe ownership during tab changes | US22, US26 / A16, A17 |
| Bench | Unconnected terminals, acquisition/trigger state, paused, trial, restart required | US06, US07 / A11 |
| Circuit controls | Edit/operate distinction, momentary press/release, paused pending change, stale indicator | US25 / A15 |
| Experiments and expert tools | Run-count preview, failed members, custom-control conflict | US09, US10, US18, US20 / A12, A13 |
| Logic view | Unknown/high-impedance, bridge configuration, unsupported model | US17 / R35 |

The authoritative pass criteria are the [requirements](04-requirements.md). This inventory ensures that prototype review includes failure and recovery behavior as well as layout.

## Review fixtures

Use simple circuits with independently understandable expected behavior. These are analytic reference values for mock screens; they are not measured ngspice results or integration tolerances.

| Fixture | Definition | Expected sample content |
| --- | --- | --- |
| Divider | Ideal 5 V supply; R1 = R2 = 1 kΩ; midpoint OUT | OUT = 2.50 V; series current = 2.50 mA. Changing lower R2 to 2 kΩ gives OUT ≈ 3.33 V. |
| RC charging | 0→5 V step through 1 kΩ into 1 µF; zero initial capacitor voltage; 5 ms record | Time constant = 1 ms; output about 3.16 V at 1 ms and 4.97 V at 5 ms. |
| RC low-pass | R = 1 kΩ; C = 100 nF; ideal AC drive; measure OUT/IN | Cutoff ≈ 1.59 kHz; gain ≈ −3.01 dB and phase ≈ −45° at cutoff. |
| Real-part mapping | Illustrative amplifier model with declared terminal order different from symbol numbering | A visible supply-pin mismatch and corrected mapping; no claim about a particular manufacturer's part. |
| Broken drawing | No reference; missing U1 model on second sheet; disconnected meter terminal | Three distinct explanations and actions, with no fabricated reading. |
| Long experiment | Three sweep members: complete, failed, not started | Accurate member counts, partial status, retained baseline, and responsive Stop. |
| Logic transition | Scripted 0/1/X/Z sequence plus a disclosed analog interface threshold | State legend, timing readout, and transition details without treating X/Z as zero. |
| Education document | One `RC lesson.dsn` with two schematic sheets and `DC checks` / `Charging experiment` Simulation sheets | Same-file save/reopen; instructions/parameters visible; shared circuit; tab navigation and clear run ownership without project setup. |
| Compact drawing | Equivalent XML and ZIP-based lesson files; full results and setup-only variants | Automatic detection, smaller retained payload after removal, preserved setup, and unchanged original when saving a compact copy. |
| Damaged archive | Truncated ZIP, wrong TinyCAD identity, unsupported version, unsafe path, or decoded-size overflow | Specific bounded error without XML fallback or replacing the open drawing. |

## Usability sessions

Recruit an initial small group spanning electronics learners, existing TinyCAD users, experienced simulator users, and educators. Include keyboard-only and touch sessions and at least one assistive-technology review. A small formative sample is for finding problems, not claiming statistical proof.

Give tasks as goals, without naming buttons:

1. “Find the output voltage, then change the lower resistor and explain what changed.”
2. “Show how the capacitor charges and measure a time interval.”
3. “Find where this filter's gain falls by 3 dB relative to its passband.”
4. “Make this existing drawing ready to simulate; identify the amplifier's supply pins.”
5. “Compare two experiments and tell me which circuit and settings produced each curve.”
6. “Stop this long experiment and explain what data is still usable.”
7. At P1: “Connect a scope and generator, freeze the display, then change a model.”
8. At P1: “Send someone enough information to reproduce this experiment.”
9. “Add a second simulation setup to this lesson, then save and reopen the drawing. Tell me which circuit each setup uses.”
10. “Export these answers, then make a smaller lesson copy without stored results. Show me what remains in each drawing.”

Observe task completion, time to first meaningful result, wrong turns, assistance needed, and interpretation errors. Ask the participant to explain reference, units, current direction, run freshness, and partial-result status. Record any case where a plausible-looking number is mistaken for a valid current measurement.

Initial targets to test, not established performance claims:

- At least 80% of first-time participants complete a prepared example measurement within two minutes without assistance.
- At least 80% correctly identify the voltage reference and an out-of-date result.
- Experienced users can find a named advanced analysis within 30 seconds through navigation or search.
- Every critical task has a working keyboard route and a route without dragging or hover.
- No participant should have to read raw SPICE text to complete the prepared foundation tasks.

Investigate failures by workflow, rather than averaging a serious model-mapping or status-interpretation problem into an acceptable overall score.

## Decisions to settle through UI review

The specification makes provisional choices so prototypes can proceed. These questions need evidence, not a blocking setup interview.

| Decision | Working choice | Evidence that could change it |
| --- | --- | --- |
| Default first question | Measure DC for a static example; Over time for a configured dynamic example | New users repeatedly expect an oscilloscope-style first result. |
| Instruments versus general plots | Views within the owning Simulation sheet, optionally docked while viewing a schematic | Users cannot tell whether an instrument and plot show the same acquisition. |
| Panel layout | Existing sheet bar; main Simulation sheet view; optional left/bottom dock; no project tree | Setup and schematic references become hard to use at laptop size. |
| Live trial tuning | New acquisition; explicit Apply/Discard | Users confuse trial and saved values despite labels and history. |
| Guided unit entry | Explicit quantity units, normalized previews, ambiguity resolution | Users repeatedly misread prefixes or cannot enter familiar values efficiently. |
| Result retention | Explicit export/removal/compact-copy commands; setup preserved; XML .dsn by default, ZIP .dzn for large retained results; both ZIP and XML readable | Users confuse compression with result removal, lose answers unexpectedly, or cannot predict reopen behavior. |

Migration review can clarify supported model/netlist inputs within the current scope. It cannot expand this version into native project import or project management.

## Completion gate for UI design

Design is ready to inform implementation when the P0 screens and acceptance paths are reviewable, critical user journeys work in the prototype, users can interpret measurements and result states, accessibility issues have an action plan, and unresolved product decisions have named outcomes or explicit deferrals. The full bench milestone additionally requires a coherent instrument/acquisition walkthrough.

Numerical accuracy, convergence behavior, supported engine builds, model compatibility, and cross-platform execution require the real-engine tests defined in the [implementation architecture](07-implementation.md#10-implementation-sequence-and-gates) and [bundling release gates](08-engine-build-and-bundling.md#9-verification-and-release-gates). Keep those claims separate from passing a UI review.

The [DSN codec and result-management tests](09-dsn-format-and-results.md#6-required-verification) additionally cover format detection, numerical export fidelity, result stripping, binary-safe storage, and failed-save recovery. A mock file-size display does not establish codec correctness or actual compression savings.
