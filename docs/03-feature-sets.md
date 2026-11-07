# Feature sets and priorities

The goal is a full circuit workbench with a small first-run surface. Priority controls delivery scope; progressive disclosure controls visual complexity. This catalogue describes intended UI behavior, not confirmed runtime support. Story IDs refer to [User stories](01-user-stories.md); requirement IDs refer to [Requirements](04-requirements.md).

SPICE symbols are supplied and selected through work in a separate branch. Feature priorities below cover simulation of placed components; they do not require symbol providers, a component catalogue, symbol search/import/selection UI, or library maintenance.

The document boundary is fixed: one `.dsn` drawing with schematic and non-drawing Simulation sheets. A Simulation sheet holds one saved analysis, its parameters/instructions, instrument views, and results. All analyses use the shared circuit across schematic sheets. This version adds no project manager, linked schematic files, or separate simulation workbook.

## Feature groups

| ID | Feature set | P0 — foundation | P1 — full workbench | P2 — specialist | Stories / requirements |
| --- | --- | --- | --- | --- | --- |
| F01 | Entry and discovery | Simulate entry; three configured examples; common task cards; contextual help | More examples; searchable analysis/instrument catalogue; migration guide | User-authored example collections | US01, US24 / R01–R03 |
| F02 | Readiness | Models, ground, source, pin-map, and setup checks; locate issues; explicit exclusions | Bulk model configuration for placed components; dependency review and compatibility reports | Advanced model validation reports | US02, US12, US13, US22 / R04–R08 |
| F03 | Placed components and stimuli | Values/settings for placed R/L/C and DC/sine/pulse sources; supplied diode/transistor/switch/ideal-amplifier examples; drawing-level model configuration | Richer source editor; controlled/behavioral source forms; operated switches/buttons and modeled indicators | Specialized device configuration and testbenches | US03, US12, US25 / R06–R09, R19, R36 |
| F04 | Core analyses | Operating Point, Transient, AC small-signal | DC sweep; noise; transfer function; single-frequency AC | Pole-zero, sensitivity, small-signal distortion, RF | US05, US08, US09, US19 / R10–R12 |
| F05 | Probes | Voltage, differential voltage, supported device current; direction/reference; two-way highlighting | Device power; persistent measurement badges; advanced expressions | Specialized device quantities | US04, US21, US22 / R13–R15 |
| F06 | Result viewer | Plot, measurements, data; axes, Fit, cursors; operating-point table/overlay | Rich waveform expressions; multiple synchronized panes; spectrum; extended measurements | Smith/Nyquist and other specialized views | US05, US08, US19 / R16–R18 |
| F07 | Bench instruments | Simple ideal DC voltage meter card | Scope, signal generator, DC supply, expanded meter, Bode plotter, logic analyzer | Spectrum, impedance/IV tools; optional realistic instrument models | US06, US07, US17 / R20–R22 |
| F08 | Run control | Run, preflight, Stop, progress, fixed run identity, partial results | Live, Pause/Resume where supported, Single acquisition, recorded live control changes | More advanced acquisition and triggering | US06, US23 / R23–R26 |
| F09 | Experiments | Named Simulation sheets; duplicate setup within the drawing | Parameter and temperature sweeps; trial tuning; explicit apply/discard | Monte Carlo, selected worst-case corners, optimization | US09, US10, US18 / R27–R29 |
| F10 | Comparison and history | Run list; pin baseline; compatible overlays; change summary; freshness | Sweep-family filtering; measurement comparisons | Statistical distributions and envelopes | US10, US11, US18 / R25, R28–R30 |
| F11 | Saving, results, and sharing | Save schematic/Simulation sheets together; export CSV/JSON data, measurements, SVG plots; remove stored results; save a compact copy; preserve setup/probes/assignments | Additional export/report formats; SPICE export with provenance | Report templates within the drawing | US14–US16, US26–US29 / R30–R33, R37, R41–R43 |
| F12 | Expert tools | Read-only generated circuit text and technical diagnostics | Custom analysis/directives; model templates; numerical settings; explicit precedence | Custom experiment scripts with a clear supported boundary | US13, US20 / R08, R34 |
| F13 | Digital and mixed signal | Recognize an unsupported digital model with an actionable explanation | Supported logic models, clocks, bridges, timing traces, buses, state legend | Protocol decoding and specialist digital workflows | US17 / R35 |
| F14 | Inclusive interaction | Keyboard and touch equivalents; tables; readable states; localization-ready text | Extended instrument accessibility and small-screen bench layouts | Additional specialized accessible views | US21 / Q01–Q05 |
| F15 | Multi-sheet document | Schematic and non-drawing Simulation tabs; setup, parameters, and short instructions; add/rename/reorder/duplicate/delete; shared circuit; same-file save | Richer instruction and instrument content within Simulation sheets | Additional specialized content within the same document model | US14, US22, US26 / R05, R31, R37–R38 |
| F16 | Runtime and distribution | Browser WASM and bundled Electron native engine; shared protocol; pinned source builds; target/package verification | Qualified optional module and cooperative-control profiles | Additional verified engine capabilities | US14, US23 / R39–R40 |
| F17 | Compact DSN format | ZIP-based `.dsn`, header-based ZIP/XML detection, binary result entries, existing XML read/write, safe conversion and save | Additional measured compression improvements within the same one-file contract | Future container versions with explicit compatibility handling | US14, US28, US29 / R31, R41, R43 |

P0 scope includes **UI designs and representative prototype states** for its features. It does not imply ngspice integration has already been selected or implemented. Features from later priorities can be sketched now without appearing as nonfunctional toolbar controls in a first product release.

## Analysis catalogue

The distinction in the **Kind** column is a user-facing conceptual distinction, not an implementation prescription. It keeps an ordinary analysis, a repeated experiment, and a transformation of existing data from being presented as interchangeable.

| Task label / technical name | Priority | Kind | Required setup | Primary answer |
| --- | --- | --- | --- | --- |
| Measure DC / Operating Point | P0 | Circuit analysis | Reference and valid models | Net voltages and supported device currents; optional power |
| Over time / Transient | P0 | Circuit analysis | Time-dependent stimulus or initial state; duration | Voltage/current versus simulated time |
| Frequency response / AC small-signal | P0 | Circuit analysis | Bias point, AC excitation, input/output, frequency range | Gain and phase, with explicit ratio |
| DC sweep | P1 | Circuit analysis | Eligible swept quantity and range | Output versus swept DC quantity |
| At one frequency / AC point | P1 | Circuit analysis preset | AC setup and one frequency | Complex gain, magnitude, phase |
| Noise | P1 | Circuit analysis | Output/reference, input source, range | Spectral density and integrated noise with separate units |
| Transfer function | P1 | Circuit analysis | Named input source and output | Small-signal DC gain and applicable input/output impedance |
| Spectrum / FFT | P1 | Result processing | A retained time-domain record and explicit interval | Frequency content; window and sampling shown |
| Harmonics / Fourier measurements | P1 | Result measurement | Time record, fundamental, interval, harmonics | Harmonic amplitudes and defined distortion measurement |
| Parameter / temperature sweep | P1 | Repeated experiment | Base analysis, variables, values, nesting | Labeled families of runs and measurement table |
| Live bench | P1 | Acquisition workflow | Supported time-domain circuit and instruments | Successive acquisitions and instrument readings |
| Pole-zero | P2 | Circuit analysis | Supported transfer definition and ports | Poles/zeros and optional complex-plane display |
| Sensitivity | P2 | Circuit analysis or explicit perturbation experiment | Target measurement and eligible parameters | Change in output per change in parameter; method identified |
| Small-signal distortion | P2 | Circuit analysis | Supported source/tone and device setup | Defined small-signal distortion quantities |
| Tolerance / Monte Carlo | P2 | Repeated experiment | Distributions, correlation, seed, sample count, measurement limits | Distributions, pass/fail counts, and failed samples |
| Selected worst-case corners | P2 | Repeated experiment | Declared corner combinations and limits | Outcomes for those corners, not a global worst-case guarantee |
| RF / S-parameters | P2 | Capability-dependent analysis | Supported port models, impedances, range | S-parameters and compatible RF views |
| Custom | P1 | Explicit advanced workflow | Supported commands, outputs, dependencies | Named results with preserved custom setup |

Engine analysis capabilities are documented by [ngspice](https://ngspice.sourceforge.io/docs.html); repeated-run workflows are illustrated in its [control-language tutorial](https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html). The proposed catalogue adds a task-oriented UI. Every entry must be gated against the actual supported capabilities before release, including model and platform restrictions.

An unavailable feature remains explained in discovery/help when relevant, with the reason and a supported alternative if one exists. Do not advertise a working Run action for an unsupported analysis. Do not copy another simulator's command syntax and assume identical behavior.

## Instrument progression

The early meter is a concise reading card. The full workbench adds familiar lab faces as optional views. Keep channels, connections, control values, units, and acquisition status prominent; ornamental hardware detail is secondary.

| Instrument | Minimum complete behavior at its priority | Explicit boundary |
| --- | --- | --- |
| DC voltage meter — P0 | Positive/negative node picker, sign, reference, reading state, Locate | Ideal measurement; open terminal is not a zero reading |
| Expanded meter — P1 | Supported current, AC RMS, resistance, continuity modes; interval and mode explanations | Resistance requires a dedicated unpowered test; current needs a valid branch/sensor |
| Scope — P1 | Multiple channels, numeric scales/offsets, trigger source/edge/level, Run/Pause/Single, cursors, acquisition identity | No arbitrary claim of hardware sampling, loading, or real-time speed |
| Signal generator — P1 | DC offset, explicit amplitude convention, waveform, frequency, duty, output terminals, output enable/impedance | Shares a visible circuit stimulus; duplicate views cannot create conflicting sources |
| DC supply — P1 | Voltage, output enable, terminals, and measured current | Current limiting and CV/CC indications require a supporting model; a simple ideal voltage source does not imply them |
| Bode plotter — P1 | Input/output references, small-signal excitation, frequency range, gain/phase/cursors | Opens the shared frequency-response analysis |
| Logic analyzer — P1 | Supported states and buses, timing view, thresholds/bridges, trigger and state legend | Available only for supported mixed-signal setup |
| Spectrum / IV / impedance tools — P2 | Explicit measurement method, prerequisite setup, units, and shared result export | Each needs a separate interaction review; catalogue placement is not a support promise |

All instruments require an explicit connection state and consistent acquisition selection. A paused scope, a meter reading a complete record, and a new Live run must not silently show values from unrelated experiments.

## Placed components and simulation configuration

Assume the required symbols and their initial simulation metadata are available through the separate symbol branch or prepared examples. This work consumes those placed components, exposes their values and simulation settings, and reports missing or invalid configuration. It does not determine the library contents or how components are found and selected.

Generic semiconductors and amplifier examples must say **Generic** or **Ideal** in the simulation UI. A part number or familiar symbol appearance never justifies silently choosing an unrelated generic model.

Drawing-level model configuration remains a foundation feature. For an existing component, the UI must handle model definitions, dependent includes, terminal mapping, unsupported/encrypted content, hidden supply pins, and drawing-level overrides. Compatibility status describes demonstrated behavior, not a blanket claim that PSpice or LTspice models work.

P1 adds batch model configuration for placed components, controlled-source settings, behavioral expressions, piecewise-linear waveform import, and more source controls. P2 covers specialized model/device configuration only when a clear user task justifies it. Reusable symbol-library assignments remain with the separate branch.

## Scope boundaries and later investigation

Native Multisim project import is **outside this version's scope**. P1 migration guidance and compatibility reporting must identify exactly which netlist/model inputs are accepted; they must not imply reconstruction of a proprietary schematic, instrument layout, comments, or model licences. Existing TinyCAD and KiCad symbol workflows remain distinct from circuit and model import.

Project files/folders, project management, multi-file hierarchical schematics, linked schematic documents, separate simulation workbooks, and required setup/results sidecars are outside this version. Saving and sharing operate on the drawing and its sheets. Existing external model dependencies do not require a project system. Physical NI/LabVIEW instruments, PCB layout, HDL/MCU firmware workflows, cloud collaboration, automatic grading, and classroom management are also outside this specification. Model library size is not a proxy for supported simulation coverage.

P2 is deliberately selective. A useful full workbench comes from completing the model, measurement, instrument, comparison, and recovery workflows while keeping advanced solver settings contextual.

Continue to [Requirements](04-requirements.md).
