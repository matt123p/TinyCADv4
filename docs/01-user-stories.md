# User stories and journeys

## User stories

These are proposed needs inferred from TinyCAD's audience and documented workflows in other simulators. They have not yet been validated through interviews or usability sessions. Priorities are defined in the [overview](README.md).

These stories assume the required SPICE symbols are available and can be placed through the editor. Symbol sourcing, browsing, import, selection, and library maintenance are handled in a separate branch. The journeys here begin with placed components or a prepared drawing.

All journeys use one TinyCAD drawing file and its sheet tabs. Schematic sheets contain the circuit; non-drawing Simulation sheets hold setup, parameters, instructions, instruments, and results. An experiment means a configured analysis within this drawing, not a project or a separate file.

| ID | As a… | I want to… | So that… | Priority | Observable success |
| --- | --- | --- | --- | --- | --- |
| US01 | newcomer or student | open an example and take a measurement immediately | I can learn by changing a circuit | P0 | From the example, run and show a labeled voltage without entering SPICE text. |
| US02 | existing TinyCAD user | simulate my current drawing | I can keep using my drawing and editing workflow | P0 | See what is ready, what needs a model, and what can be explicitly excluded before running. |
| US03 | learner | configure supplies and waveforms with familiar units and a preview | I know what stimulus I am applying | P0 | Set a 5 V supply or a 1 kHz sine wave and see its offset, peak amplitude, and period. |
| US04 | circuit designer | click a wire or component to inspect voltage or current | I can connect circuit behavior to the drawing | P0 | The selected trace and schematic target highlight together, with reference and current direction. |
| US05 | technician | see DC voltages and currents on the drawing | I can check bias and find wiring mistakes | P0 | Run Operating Point and read a tidy overlay and sortable values table. |
| US06 | Multisim user | connect and operate a scope and signal generator | I can explore a circuit like a lab exercise | P1 | Wire channels, set scales and trigger, and change a control without losing the circuit view. |
| US07 | learner or technician | use a meter without learning waveform expressions | I can answer simple electrical questions | P0 | Select two nodes and read DC voltage; unsupported or incomplete readings have an explanation. |
| US08 | analog designer | measure gain and phase over frequency | I can assess a filter or amplifier | P0 | Pick input and output, configure a range, and obtain a labeled Bode plot of their ratio. |
| US09 | designer | sweep a source, component, parameter, or temperature | I can understand sensitivity to change | P1 | See the run count before starting and identify each resulting curve by its values. |
| US10 | experimenter | adjust a component with a slider or exact number | I can find a useful value quickly | P1 | See which trial value produced the result and explicitly apply or discard it. |
| US11 | engineer | compare a changed design with a previous run | I can judge whether it improved | P0 | Pin a baseline and overlay compatible results with revision and parameter labels. |
| US12 | circuit designer | configure and verify the simulation model of a placed component | I can simulate my drawing confidently | P0 | Review the model, map the existing symbol's pins to model terminals, and save the configuration with the drawing. |
| US13 | newcomer | understand why a run failed and where to fix it | I can recover without reading a raw engine log first | P0 | A problem names the part or net, offers a relevant action, and retains the full diagnostic text. |
| US14 | returning user | save schematic and simulation sheets together | I can continue the lesson or experiment later | P0 | Reopen one drawing file and recover setup, parameters, probes, and connections even when waveform data was not retained. |
| US15 | educator or team member | share one drawing containing the circuit, setup, and instructions | someone else can reproduce and discuss my work | P1 | Save a copy of the drawing with its Simulation sheets; export readable results separately when needed, with dependency status and provenance. |
| US16 | migrating Multisim or SPICE user | understand what I can bring across and what needs attention | I can rebuild an experiment without false compatibility expectations | P1 | A compatibility report distinguishes supported models and netlists from unsupported native design formats. |
| US17 | digital learner | view logic transitions alongside analog signals | I can examine a mixed-signal circuit | P1 | Configure logic interfaces and inspect 0, 1, unknown, and high-impedance states where supported. |
| US18 | engineer | vary tolerances and inspect outcome distributions | I can estimate robustness and yield | P2 | Set distributions and seed, see failed samples, and export the experiment definition. |
| US19 | analog specialist | inspect spectrum, noise, and other advanced results | I can investigate beyond basic waveforms | P1/P2 | Find the analysis by the question it answers and see its prerequisites and units. |
| US20 | SPICE expert | inspect generated circuit text and add advanced directives | I can use capabilities beyond the forms | P1 | Understand which settings take precedence and which custom commands cannot be represented graphically. |
| US21 | keyboard, touch, or assistive technology user | operate setup, probes, plots, and instruments without precision mouse gestures | I can complete the same experiment | P0 | Searchable signal lists, numeric controls, focus order, and a data table provide equivalent access. |
| US22 | user with a large drawing | follow results and problems across sheets | I can work with a whole TinyCAD design | P0 | Selecting a trace or issue opens the correct sheet and highlights its target. |
| US23 | user running a long analysis | see progress, stop safely, and keep useful partial data | I stay in control of the application | P0 | Stop remains available, incomplete results are marked, and the editor stays usable. |
| US24 | schematic-only user | continue drawing without configuring simulation | TinyCAD remains a lightweight editor | P0 | Simulation panels appear on demand and can be closed without altering the circuit. |
| US25 | learner or educator | operate switches, buttons, and adjustable controls and observe indicators | I can explore cause and effect in a running circuit | P1 | Controls show their applied state and simulated time; indicators explain their modeled quantity and cannot conceal missing or stale data. |
| US26 | student or educator | use ordinary sheet tabs for both the circuit and simulation setup | I can keep a lesson together without learning project management | P0 | Add, name, duplicate, and switch between schematic and Simulation sheets in one drawing; setup sheets do not contribute circuit elements. |
| US27 | student or engineer | export numerical results, measurements, and plots independently | I can analyze or archive the recorded answers outside TinyCAD | P0 | Choose runs/signals/intervals and export full retained data with units and result status; failed export leaves the drawing unchanged. |
| US28 | educator or user with a large drawing | remove stored results or save a copy without them | I can keep a smaller drawing without losing the circuit or experiment setup | P0 | Preview affected runs, including pinned data; remove generated payloads while preserving instructions, parameters, probes, and measurement definitions. |
| US29 | returning TinyCAD user | open compressed and existing XML drawings through the same Open command | I can benefit from smaller files without learning a new file workflow | P0 | The `.dsn` extension stays the same; format detection is automatic and both forms preserve document meaning. |

US19 is P1 for spectrum and noise, P2 for the specialist analyses listed in the [feature catalogue](03-feature-sets.md#analysis-catalogue).

## People and design priorities

The primary first-run audience is a student, hobbyist, or existing TinyCAD user who understands a simple circuit but may not know SPICE syntax. The recurring audience includes educators, repair technicians, and engineers. Experts need depth and transparency through the same workspace.

Use a shared interface with progressive disclosure. Avoid requiring people to declare themselves a beginner or expert. A person may be confident with a scope and unfamiliar with model mapping.

The first design review should establish whether these three outcomes are achievable:

1. A new user can get a believable first result and explain its units and reference.
2. An experienced user can reach a deep feature without repeatedly passing through introductory guidance.
3. A person who only wants to draw can ignore simulation comfortably.

## Journey A: first successful measurement

**Covers US01, US03, US04, US05, US07, US13.**

1. Choose **Simulate** in an empty drawing. The welcome panel offers **Open an example** and **Set up this drawing**.
2. Open **Voltage divider**. Its `Circuit` schematic sheet contains the configured 5 V supply, two 1 kΩ resistors, reference ground, and `OUT` node. Its `DC checks` Simulation sheet offers **Measure DC** and a short instruction.
3. Select **Run**. The setup summary names Operating Point. A result table and optional schematic badges show `OUT = 2.50 V relative to Ground`.
4. Choose **Voltage probe**, then select `OUT`. A meter card shows the same reading. Ground remains visible as the reference.
5. Change the lower resistor to 2 kΩ. The previous reading changes to **Out of date — R2 changed**. Select **Run again** to see approximately 3.33 V.
6. Remove the ground in a deliberate error exercise. Run opens a problem card: **Choose a simulation ground**. Selecting the action starts reference selection; it does not silently ground the circuit.

The example teaches the normal workflow. It does not introduce a separate tutorial-only editor.

## Journey B: inspect a changing signal

**Covers US03, US04, US06, US07, US23, US25.**

1. Open the RC charging example or an existing circuit with a placed pulse source.
2. Choose **Over time**, set **Duration = 5 ms**, and probe input and output. Suggested duration is editable and its basis is shown when inferred.
3. Run and view both traces. Use **Fit**, then two cursors to inspect the charging interval. Measurement cards name the selected time interval.
4. Open **Instruments → Oscilloscope**. Its channels select the same measured signals and can also be connected using visible terminals.
5. Choose **Live**. The scope displays simulated time and acquisition status. Turn a supported control; the UI reports whether it continues the current experiment or starts a new acquisition.
6. Pause, inspect, resume, and stop. A circuit rewiring action requires stopping and restarting the live experiment; the prior acquisition remains available.
7. In a switching example, use **Operate controls** to toggle a modeled switch or press a momentary button. Observe the corresponding trace and modeled LED-current indicator. Return to **Edit drawing** to move or rewire the part.

The finite **Over time** run is available before the live instrument workflow. “Live” never implies guaranteed wall-clock real-time simulation.

## Journey C: evaluate a filter

**Covers US08, US09, US10, US11, US14.**

1. Add a **Simulation** sheet named `Frequency response`, choose that analysis, pick `IN` and `OUT`, and review the excitation source.
2. Set 10 Hz–100 kHz and 100 points per decade. The summary says **Small-signal gain OUT / IN**. If AC excitation is missing, offer an explicit source setup action.
3. Run. View gain in dB and phase in degrees on synchronized panes.
4. Pin the run as **Baseline**. Add a cutoff measurement relative to a specified passband reference.
5. Use **Tune R1**. Trial values appear beside the saved design value; new results have separate labels. Choose **Apply values to drawing** or **Discard trial**.
6. Add a three-value capacitor sweep. Review **3 runs**, execute, and compare the three cutoff measurements.
7. Save the drawing as **Low-pass.dsn**. Reopening restores both schematic and Simulation sheets, including input, output, setup, probes, and saved comparison references.

## Journey D: make an existing drawing simulatable

**Covers US02, US12, US13, US16, US20, US22.**

The drawing already contains its symbols. This journey concerns simulation readiness and configuration of those placed components.

1. Choose **Simulate → Check readiness**. A cross-sheet inventory lists models, sources, reference ground, exclusions, and imported legacy controls.
2. Resolve **U1 needs a model** by choosing a local SPICE file and a model inside it. Map symbol pins to named model terminals, including supplies.
3. Mark a mechanical connector **Exclude from simulation** after reviewing the effect on connections. Exclusion never means that its pins are electrically shorted together.
4. Review any existing RUN symbol or custom analysis directives. Choose whether to retain them in **Custom analysis** or convert a supported setup to a guided analysis.
5. Fix a problem on another sheet by selecting it in the list. Return to the same analysis after fixing it.
6. Run. If the model is incompatible, show the named dependency and diagnostic rather than replacing it with an ideal device.

## Journey E: teach and share

**Covers US01, US14, US15, US17, US21.**

An educator saves `RC lesson.dsn` with a `Circuit` schematic sheet and `Charging experiment` Simulation sheet containing instructions, setup, a reference result, and optional target measurements. A learner opens a copy, switches between those sheet tabs, changes values, and exports a plot and measurement table carrying setup and run identity. A recipient can inspect settings without rerunning. Missing models or unavailable capabilities produce a specific readiness report. Editing the learner's drawing copy does not change the original lesson. No project creation, workspace folder, or separate setup file is required.

## Journey F: keep multiple questions in one drawing

**Covers US14, US22, US26.**

1. Start with `Circuit` and `Power` schematic sheets in the same drawing.
2. Use the existing sheet bar's **+ → Simulation** action to add `DC checks`. Choose Measure DC and add a short instruction.
3. Add `Frequency response` as another Simulation sheet with independent analysis parameters and selected signals. Both analyses use the shared circuit across the two schematic sheets.
4. Run from `Frequency response`, then locate `OUT` on `Circuit`. The run strip still names the Simulation sheet receiving the probe and results.
5. Duplicate a Simulation sheet to try another setup. The circuit is shared; duplication does not create an independent schematic copy.
6. Save once and reopen the same drawing file with all four sheets. Renaming or reordering tabs preserves their connections.

## Journey G: export answers and keep a compact lesson

**Covers US14, US15, US27, US28, US29.**

1. Open a lesson `.dsn` through normal Open. TinyCAD detects whether it is compressed or existing XML from the file contents.
2. On its Simulation sheet, choose **Export results…**, select the recorded runs and interval, and export JSON/CSV or an SVG plot with units and state. Exporting does not remove anything.
3. Choose **Remove stored results…** and review the scope, affected runs, pinned baselines, and size estimate. Confirm removal, then Save to reduce the drawing's stored payloads. The setup, circuit, and instructions remain ready for another run.
4. Alternatively choose **Save a copy without results…** to create a compact lesson while keeping the original open drawing and results intact.
5. Reopen the compact copy. Its Simulation sheets say **Results removed** or **Results not retained**, with parameters, probe definitions, and instructions available. It does not display leftover cached readings as current results.

## Explicit boundaries

Multisim familiarity is a workflow goal, not a promise of identical layout, model libraries, numerical results, or native file compatibility. Circuit animation can support learning later, but numbers, traces, and clear units must stand on their own. Project management, multi-file hierarchy, linked schematic documents, PCB layout, physical instrument control, MCU firmware simulation, and classroom administration are outside this version's scope.

Continue to [UI design](02-ui-design.md).
