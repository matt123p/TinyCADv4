# TinyCAD: Advanced Circuit Analysis Beyond Basic ngspice Simulation

Implementation note (8 November 2026): the first P0 slice is implemented in Circuit Explorer.
See [the user guide and qualification scope](15-circuit-explorer.md) for tuning,
one-variable sweeps, persistent named measurements/requirements, DC annotations,
measurement semantics and remaining P1/P2 boundaries. This research document remains
the broader feature proposal; its later instruments, Monte Carlo, FFT and optimisation
recommendations are not claims of implemented functionality.

**Product research and feature recommendations**  
**Date:** 8 November 2026  
**Audience:** TinyCAD maintainers, contributors, educators and engineering users  
**Scope:** Added-value analysis, workflows and educational features beyond running SPICE simulations and plotting results

---

# Executive summary

TinyCAD already supports ngspice simulation and waveform plotting. The next opportunity is **not merely to expose more SPICE commands**, but to help users answer three increasingly valuable questions:

1. **What happened?** — Observe voltages, currents and waveforms.
2. **What does it mean?** — Extract gain, bandwidth, power, distortion, timing, tolerances and other engineering characteristics.
3. **What should I change, and will the design work?** — Tune components, check requirements, explore sensitivity, test faults, and assess robustness.

This distinction matters especially for TinyCAD's proposed focus on **GCSE (14+), A-level and undergraduate education**. Students want to understand circuits, compare measured outcomes with theory and complete meaningful design exercises. Engineers want to verify requirements, identify weak points and assess real-world performance. Basic simulation plots are a foundation, not the end product.

## Executive feature summary

Priority is a recommendation for TinyCAD rather than a measured market-demand ranking. Effort estimates are relative and assume that ngspice integration and waveform graphing already exist.

| Priority | Feature | What it adds beyond plotting | Main audience | Estimated effort |
|---|---|---|---|---|
| **P0** | **1. Interactive tuning and parameter sweeps** | Change components and immediately see how measurable behaviour changes; sweep one or more parameters | GCSE through undergraduate | Medium |
| **P0** | **2. Automatic measurements and reusable metrics** | Calculate rise time, gain, bandwidth, RMS, ripple, settling time and other engineering results | All levels | Medium |
| **P0** | **3. Results annotated on the schematic** | Display node voltages, currents, power and operating-point diagnostics where the user is looking | All levels | Low–medium |
| **P1** | **4. Virtual laboratory instruments** | Multimeter, oscilloscope, function generator and bench supply with familiar educational controls | GCSE, A-level, early undergraduate | Medium–high |
| **P1** | **5. Guided frequency-response and amplifier analysis** | Automatically find cutoff, resonance, gain, phase, bandwidth and impedance | A-level, undergraduate | Medium |
| **P1** | **6. Tolerance, Monte Carlo and worst-case analysis** | Determine whether a circuit works with real component variation and estimate yield | A-level, undergraduate | Medium–high |
| **P0/P1** | **7. Design requirements and pass/fail tests** | Turn circuit intent into automatically checked specifications and reports | All levels, teachers, engineers | Medium |
| **P1** | **8. Power, efficiency and component-stress analysis** | Identify wasted power, overloaded parts and electrical overstress | A-level, undergraduate, practical design | Medium |
| **P1/P2** | **9. Fault injection and troubleshooting** | Teach diagnosis by introducing opens, shorts, incorrect values and failed components | GCSE, A-level, early undergraduate | Medium–high |
| **P2** | **10. Sensitivity and design optimisation** | Identify influential components and calculate component values to meet a goal | Undergraduate, engineers | High |
| **P1/P2** | **11. FFT, harmonic and distortion analysis** | Explain waveform shape through its spectrum, harmonics and THD | A-level, undergraduate | Medium |
| **P2** | **12. Noise, stability and pole-zero analysis** | Support advanced analogue, feedback, sensor and amplifier design | Undergraduate | Medium–high |
| **P2** | **13. Guided explanations and circuit diagnostics** | Explain why a circuit behaves unexpectedly, using electrical rules and analysis results | All levels | Medium–high |

**Recommended first cohesive product:** a **TinyCAD Circuit Explorer** that combines live component tuning, named measurements, operating-point overlays, guided frequency-response analysis and pass/fail requirements. After that, add tolerance analysis and richer virtual laboratory workflows.

### What to build first

A sensible first release would include:

1. **Operating-point annotations** on the schematic, including voltages, currents and power where derivable.
2. **Named measurements** that persist with the design and produce a value and units, not merely a graph.
3. **Interactive component tuning** with immediate recalculation and optional comparison against previous results.
4. **One-variable sweeps** plus result tables and metric-vs-parameter plots.
5. **Guided filter and amplifier measurements**, especially −3 dB cutoff, gain and bandwidth.
6. **Requirements with pass/fail checks**, initially using a small number of trusted measurement types.

These share common infrastructure and should be more useful than six independent dialogs.

### Key design principles

- **Explain the outcome, not just the raw data.** Prefer “Cutoff frequency: 1.59 kHz” over requiring the user to infer it manually from a graph.
- **Keep advanced functionality approachable.** Offer beginner and advanced views backed by the same engine.
- **Preserve reproducibility.** Record the precise schematic revision, models, simulation conditions and component values behind a result.
- **Distinguish ideal simulation from physical assurance.** Real parts vary; simplified models cannot reliably prove thermal or manufacturing compliance.
- **Make measurements reusable.** The same measurement should power a readout, a sweep, a tolerance study and a pass/fail rule.
- **Use ngspice as the solver; make TinyCAD the analysis and educational interface.** A number of valuable features require orchestration, post-processing and presentation rather than changes to the solver.

---

# Part I — Detailed feature proposals

## 1. Interactive component tuning and parameter sweeps

### User problem

A student changes a resistor, reruns the circuit and inspects a waveform. To understand the trend, they repeat this many times. This is tedious, makes comparisons difficult and draws attention away from the electrical relationship being investigated.

### Proposed experience

**Live tuning**

- Select a resistor, capacitor, inductor or supported model parameter from the schematic.
- Open a compact slider/numeric editor with appropriate SI units.
- Change its value and automatically rerun the relevant analysis after an appropriate debounce interval.
- Optionally retain the previous curve as a faint comparison trace.
- Offer **Reset**, **Undo** and **Apply** so the original component value is never inadvertently lost.
- Support standard component value series (for example E12, E24 and E96) and continuous values.
- Display key metrics beside the control: for example “R = 2.2 kΩ; cutoff = 723 Hz”.

**Parameter sweeps**

- Choose a variable, range, step count or a list of values.
- Run the required simulations automatically.
- Overlay traces or produce a table of calculated measurements.
- Plot a **measurement versus parameter** rather than only overlaying waveforms.
- Later, support two-dimensional nested sweeps and heatmaps.

### Example: RC low-pass filter

For an ideal first-order filter,

\[
f_c = \frac{1}{2\pi RC}.
\]

With a 100 nF capacitor:

| Resistor | Theoretical cutoff |
|---:|---:|
| 1 kΩ | 1,592 Hz |
| 2.2 kΩ | 723 Hz |
| 4.7 kΩ | 339 Hz |
| 10 kΩ | 159 Hz |

These theoretical values give students a way to validate the simulator and explain the trend.

### Implementation approach

- Add named parameter bindings to editable schematic component properties.
- Keep the circuit document's persisted value distinct from a temporary tuning override.
- Generate appropriate ngspice netlists and run batches of analyses; do **not** assume that directives supported by other SPICE products (such as a particular `.step` syntax) behave identically in ngspice.
- Capture measured values into a structured results table with run ID, parameter values and units.
- Cache analyses using a key derived from the model, inputs, simulator settings and relevant component values.
- For costly transient analyses, debounce interactive updates and allow cancellation.

### Acceptance example

Open a provided RC circuit, sweep R over five values and automatically produce (a) an overlaid gain plot, (b) a table of cutoff frequencies and (c) a chart of cutoff frequency versus R. The original schematic value remains recoverable.

**Priority:** P0. **Audience:** all levels. **Dependency:** simulation orchestration and named measurements.

---

## 2. Automatic measurements and reusable circuit metrics

### User problem

A waveform is an intermediate result. Assignments and design reviews usually ask for specific characteristics: “What is the gain?”, “What is the rise time?”, “How much ripple remains?” or “What is the settling time?” Users should not have to manually estimate every number from plots.

### Proposed measurements

| Category | Candidate measurements |
|---|---|
| General signals | Minimum, maximum, average, RMS, peak-to-peak |
| Timing | Period, frequency, duty cycle, rise time, fall time, pulse width, propagation delay |
| Transient behaviour | Overshoot, undershoot, settling time, time constant |
| AC/frequency | Gain, phase shift, cutoff frequencies, bandwidth, resonant peak |
| Power/energy | Instantaneous power, average power, peak power, integrated energy |
| Power supplies | DC output, peak-to-peak ripple, RMS ripple, efficiency |
| Quality | Harmonic amplitudes, THD, noise over a defined bandwidth |

### Proposed experience

- The user creates a **named measurement** attached to a signal, component, or pair of signals.
- Each measurement has a definition, units and measurement interval where appropriate.
- Results appear in a dedicated table or as schematic annotations.
- Clicking a result opens the relevant trace and highlights measurement markers or time intervals.
- Measurements are stored with the document and can be reused without redrawing a graph.
- More advanced users may enter a mathematical expression using a controlled formula language.

### Critical measurement semantics

A measurement is incomplete without its context. For example:

- **Rise time** requires specified lower and upper percentages, often 10% and 90%, and a specified transition.
- **Settling time** requires a reference final value and tolerance band.
- **Average power** requires a defined time interval; including startup can produce a very different result from steady-state power.
- **Frequency-domain gain** requires clearly identified input and output signals and compatible reference definitions.
- **Ripple** may refer to peak-to-peak or RMS ripple and should be labelled explicitly.

### Implementation approach

Use ngspice `.meas` capabilities where suitable, but retain a TinyCAD measurement layer that can also calculate metrics from waveform arrays. It should hold typed values, physical units, uncertainty/validity states, selected windows and trace provenance.

A useful minimal model is:

```text
Measurement
  id
  name
  kind
  source_signals
  analysis_type
  interval_or_frequency_range
  configuration
  unit
  expression_or_algorithm_version
```

### Acceptance example

On a transistor amplifier, create persistent metrics for small-signal gain, output peak-to-peak voltage and distortion. Rerunning after changing the bias resistors updates all measurements, and clicking “gain” reveals how it was calculated.

**Priority:** P0. **Audience:** all levels. **Dependency:** result data model.

---

## 3. Schematic operating-point annotations and diagnostics

### User problem

Users can see results in a plot but still need to relate those values back to the actual circuit. DC voltages, component currents and power dissipation are often best understood in context on the schematic.

### Proposed experience

- An **Annotate Operating Point** toggle overlays DC net voltages and selected branch currents.
- Component readouts can display voltage drop and dissipated power.
- Clicking a transistor or op-amp opens an operating-point panel with relevant available model values.
- Highlight components whose predicted values appear outside user-defined ranges.
- Provide selectable levels of detail: **Voltages**, **Voltages + Currents**, **Power**, **Full diagnostics**.
- Show result freshness and the analysis condition; stale data should not look current after the schematic has changed.

### Examples

- A potential divider labels its midpoint voltage, making loading effects immediately visible.
- A BJT amplifier reveals its bias point and supports investigating cutoff or saturation.
- A resistor with a measured 0.31 W average dissipation and a user-specified 0.25 W rating is highlighted.

### Caveats

- Voltage is naturally associated with nets; branch currents are not directly available for every component in every ngspice output mode. Some may require appropriate saved vectors or model-specific mechanisms.
- Component operating-region indicators should use available device-model outputs and carefully documented classification rules.
- A displayed instantaneous transient current is not the same as a DC operating-point value.

### Implementation approach

Maintain a durable correspondence between schematic UUIDs, electrical nets, generated netlist device names and ngspice result vectors. A reliable **schematic-to-netlist-to-results mapping** is a foundational requirement for many later features.

**Priority:** P0. **Audience:** all levels. **Dependency:** stable identifiers and operating-point extraction.

---

## 4. Virtual laboratory instruments

### User problem

Students need to learn how to *measure* a circuit, not just how to obtain answers from a simulator. Familiar lab instruments provide an authentic workflow and can support classroom fault-finding exercises.

### Proposed instruments

**Multimeter**

- DC/AC voltage, current and resistance modes.
- Two connection terminals, range selection and optionally auto-ranging.
- Optional modelled input resistance, burden voltage or loading effect for realistic measurements.
- Resistance measurement should be treated as a distinct test setup with a controlled stimulus, **not** as a direct reading from an energised arbitrary circuit.

**Oscilloscope**

- Two channels initially, with a four-channel option later.
- Time-base, vertical scale, offset, trigger source, level and edge.
- AC/DC coupling with clearly defined simulated behaviour.
- Cursors and automatic amplitude/frequency/period measurements.
- A simplified “student mode” and a more complete instrument mode.

**Function generator**

- Sine, square, triangle, pulse and optionally arbitrary waveforms.
- Frequency, amplitude, offset, phase and duty cycle controls.
- Generated stimulus saved with the design or with a test case.

**Bench supply**

- Adjustable DC voltage, output on/off and current-limit behaviour.
- Optional series/output resistance and supply ramping.
- Current limiting requires a model or control strategy capable of representing it; an ideal independent voltage source alone does not provide real power-supply behaviour.

**Later additions**: frequency counter, logic analyser, spectrum analyser and wattmeter.

### Two experience modes

1. **Design mode:** direct probes and automatic extracted measurements; efficient for circuit design.
2. **Laboratory mode:** user-controlled instruments and wiring; useful for practical instruction and troubleshooting.

Both should use the same simulation backend, models and result pipeline.

### Educational example

Connect an oscilloscope to both sides of an RC filter. Use a virtual function generator to vary the excitation frequency, and compare the amplitude and phase at different settings. Explain the difference between oscilloscope time-domain readings and a direct AC sweep.

### Implementation considerations

Avoid spending excessive development time copying the exact appearance of a commercial instrument. Prioritise usable controls, correct measurement behaviour and consistent signal mapping. Instrument interaction should not accidentally modify the original schematic without a clear operation.

**Priority:** P1, with an early multimeter prototype. **Audience:** GCSE, A-level, early undergraduate.

---

## 5. Guided frequency-response, filter and amplifier analysis

### User problem

A basic Bode plot makes users manually derive the values they actually need. Frequency-domain analysis is central to filter and amplifier assignments, and automatic extraction would save time while making the electrical interpretation clearer.

### Candidate calculations

- Gain in linear units and dB.
- Phase shift at a specified frequency.
- Lower and upper −3 dB cutoff frequencies and bandwidth.
- Resonant frequency, peak response and quality factor where valid.
- Passband ripple and stopband attenuation.
- Input and output impedance, with an appropriate test configuration.
- Group delay.
- Gain margin, phase margin and crossover frequencies for properly defined feedback-loop measurements.

### Proposed experience

The user selects **Analyse → Frequency Response**, identifies the input stimulus and output signal, and chooses a frequency range. TinyCAD runs AC analysis and automatically presents the gain/phase plot plus a summary of extracted characteristics.

A separate **Analyse → Amplifier Characteristics** workflow can use operating-point linearisation and ngspice transfer-function calculations where applicable to provide small-signal gain and input/output resistance.

### Educational example

Compare the predicted and simulated cutoff frequency of an RC filter, then change its capacitor and repeat. Contrast a first-order passive filter with a higher-order active filter.

### Important limitations

- A −3 dB point must be defined relative to a specific reference gain; multiple crossing points are possible.
- Resonance and Q-factor formulas depend on topology and assumptions. Do not apply a universal Q formula to arbitrary responses.
- Gain/phase margin requires a valid loop-gain or return-ratio setup. Simply plotting the phase difference between arbitrary nets does not prove closed-loop stability.
- Small-signal `.ac` and `.tf` analysis are **linearised around the operating point**, not large-signal descriptions of clipping, slew rate or startup.

**Priority:** P1, but simple cutoff/gain calculations fit the first release. **Audience:** A-level and undergraduate.

---

## 6. Tolerance, Monte Carlo and worst-case analysis

### User problem

SPICE typically simulates nominal component values. Real resistors, capacitors and devices have manufacturing and operating variation. A circuit that passes at nominal values can fail when built.

### Proposed experience

**Tolerance envelope**

Specify allowed values for selected components, simulate variations and overlay resulting responses or show an envelope. For an AC filter, this can illustrate the likely spread of frequency response.

**Monte Carlo simulation**

- Assign probability distributions to component variations, such as uniform or Gaussian, with explicit parameters.
- Simulate many sampled designs.
- Show histograms of circuit metrics, summary statistics and illustrative yield.
- Preserve the random seed and model assumptions for reproducibility.

**Worst-case analysis**

- Search extreme combinations, or use sensitivity-guided sampling/search.
- Report the parameter combination associated with the worst observed metric.
- Distinguish **worst case found** from a mathematically proven global worst case.

### Example

A student designs a 1 kHz nominal filter and sets a requirement that its cutoff remain between 900 Hz and 1100 Hz. TinyCAD varies the relevant components and reports the percentage of simulations that pass, the observed range and the assumptions behind the distribution.

### Critical accuracy and modelling issues

- **Distribution assumptions matter.** A 5% tolerance does not by itself specify a probability distribution.
- **Correlated tolerances matter.** Components from the same manufacturing process or environment may vary together.
- **Tolerance is not temperature drift.** Temperature coefficients and bias-dependent component behaviour require additional models.
- **Monte Carlo yield is an estimate under a model**, not a manufacturing guarantee.
- Some parameter combinations may fail to converge; failures must be reported, not silently discarded.
- Brute-force combinations grow exponentially with the number of components; the search strategy must scale.

### Implementation approach

The most reusable path is a general analysis orchestrator that can substitute values, generate runs and feed named measurement outputs into statistical analysis. ngspice supports the necessary simulation and scripting primitives, while TinyCAD should own the workflow and result presentation.

**Priority:** P1. **Audience:** advanced A-level, undergraduate, engineering design. **Dependency:** sweeps, measurements, batch orchestration.

---

## 7. Requirements, automatic checks and test reports

### User problem

A user is often trying to satisfy a design requirement, not merely generate a curve. In teaching, this also creates a natural basis for objective feedback and assessment.

### Proposed experience

Each circuit can include saved **Test Cases**, each with:

- An analysis setup, stimulus and environmental/parameter conditions.
- Named measured values.
- A set of limits or Boolean assertions.
- A pass/fail result with a diagnostic explanation and link to supporting evidence.
- A generated summary suitable for coursework or a design review.

### Example amplifier test suite

*Illustrative values only; not derived from an actual TinyCAD simulation.*

| Requirement | Target | Example result | Status |
|---|---:|---:|---|
| Voltage gain | 9–11× | 10.2× | Pass |
| Bandwidth | ≥20 kHz | 24.5 kHz | Pass |
| Output clipping | None at specified input | Detected | Fail |
| Supply current | ≤30 mA | 22 mA | Pass |
| Total harmonic distortion | <1% | 1.4% | Fail |

Clicking a failed test should open the measurement, waveform and relevant schematic objects.

### Educational benefits

- **GCSE:** “Divider output must be between 2.4 V and 2.6 V.”
- **A-level:** “Amplifier gain must be within the specified range without clipping.”
- **Undergraduate:** “Filter must meet gain, bandwidth, distortion and power limits.”
- **Teachers:** Distribute starter circuits with locked or hidden tests, where appropriate.

### Advanced extensions

- Run the same tests under multiple supply voltages, loads or temperatures.
- Compare a design's test history across revisions.
- Produce machine-readable output for external continuous integration or grading systems.
- Define a reusable library of test-case templates.

### Implementation considerations

A **Test Case** should be a document-level object independent of its current simulation result. Assertions need typed comparisons and units. Teachers should have a deliberate mechanism for hiding answers; hiding a visible UI label alone is not secure against determined students inspecting a local file.

**Priority:** P0/P1. **Audience:** all levels and educators. **Dependency:** named measurements and reproducible runs.

---

## 8. Power, efficiency and component stress

### User problem

For power supplies, switching circuits and output stages, the important design questions often concern dissipation, energy loss and component ratings rather than just output voltage.

### Proposed metrics

- Instantaneous and average component power.
- Total input power and identified useful output power.
- Efficiency and loss breakdown.
- Startup energy or energy within a chosen time window.
- RMS, peak and average currents.
- Peak voltage stress.
- Peak resistor or semiconductor dissipation, with caveats about transient ratings.
- Rating comparisons where the user has supplied component limits.

For a properly defined input/output power boundary:

\[
\eta = \frac{P_{\mathrm{out}}}{P_{\mathrm{in}}} \times 100\%.
\]

### Proposed experience

- Show **Power Overlay** on the schematic.
- Offer a ranked table of dissipating components.
- Highlight parts that exceed defined voltage/current/power limits.
- Provide efficiency versus load or efficiency versus supply-voltage sweeps.
- Include measurement windows to separate startup behaviour from steady state.

### Example

A smoothing resistor dissipates 0.31 W on average, while its entered rating is 0.25 W. TinyCAD flags it and links to the underlying current and voltage waveform.

### Important caveats

- Electrical power analysis does not in itself calculate junction or ambient temperature.
- A single average power figure may not capture pulse or transient limits.
- Component ratings must be explicitly provided or reliably obtained from metadata; do not invent ratings.
- Power-source sign conventions should be handled consistently so efficiency is not negative due to polarity conventions.

**Priority:** P1. **Audience:** A-level, undergraduate and practical engineering design.

---

## 9. Fault injection and guided troubleshooting

### User problem

Most simulators help users design circuits that work. Teaching benefits from circuits that **do not work**, because students must connect theory, symptoms and measurements to find the fault.

### Candidate faults

- Open-circuit resistor or connection.
- Short-circuited resistor or connection.
- Wrong resistor or capacitor value.
- Reversed diode or LED.
- Incorrect transistor connection.
- Open or shorted capacitor under an explicitly chosen failure model.
- Missing supply or excessive load.
- Other simplified device-failure modes with clear assumptions.

### Two modes

**Investigation mode:** Choose a fault and observe its effect on voltages, currents, waveforms and instrument readings.

**Challenge mode:** TinyCAD secretly introduces one of a prepared set of faults. The student uses virtual instruments to identify the component or connection responsible, and then submits a diagnosis.

### Educational example

A common-emitter amplifier unexpectedly has negligible gain. The student checks supply voltage, DC bias and input/output waveforms. The fault is an incorrect base-bias resistor value. TinyCAD can provide progressive hints without immediately revealing the answer.

### Implementation concerns

- Fault injection should operate on a temporary netlist or an explicitly forked circuit, not silently destroy the student's design.
- Some failures are represented by simple substitution; semiconductor faults require documented approximations.
- A hidden-fault exercise needs a deliberate reset, scoring and hint model.
- Not every generated fault yields a unique diagnosis; curate exercises so they have a valid expected solution.

**Priority:** P1/P2. **Audience:** GCSE, A-level and early undergraduate. **Dependency:** schematic mapping, virtual instruments, test cases.

---

## 10. Sensitivity analysis and design optimisation

### 10A. Sensitivity: which components matter most?

When a metric is outside limits, the user needs to know which component changes have the biggest effect.

For a metric \(y\) that depends on parameter \(x\), the normalised local sensitivity is:

\[
S_x^y = \frac{x}{y}\frac{\partial y}{\partial x}.
\]

A local sensitivity of 0.8 means a small 1% change in \(x\) gives an approximately 0.8% change in \(y\), assuming the local linear approximation remains valid.

**Proposed experience:** Choose a metric, such as cutoff frequency or amplifier gain, and receive a ranked list of component sensitivities. Highlight influential components on the schematic. Allow users to click a component to view its measured response to a ±1% or ±5% change.

ngspice has native sensitivity analyses for certain quantities; more general derived measurements, such as transient overshoot or efficiency, may require finite-difference runs coordinated by TinyCAD.

### 10B. Optimisation: what should the component values be?

**Proposed experience:** Set a design objective and adjustable components, then allow TinyCAD to search for values.

Examples:

- “Find R for an RC cutoff of 500 Hz.”
- “Adjust these two resistors so gain is 10× and quiescent current is below 5 mA.”
- “Choose E12 values giving the closest match to the target bandwidth.”

A minimal implementation can search one or two components and one target metric. More complex optimisation needs constraints, mixed discrete/continuous component values, suitable algorithms, multiple objectives and non-convergence handling.

### Critical cautions

- Local sensitivity is not the same as global tolerance impact.
- Some measurements are discontinuous or undefined for certain parameter values.
- Optimising only nominal performance can produce a fragile design; add tolerance-aware optimisation later.
- The interface must distinguish a candidate solution from proof of a global optimum.

**Priority:** P2. **Audience:** undergraduate and engineering users. **Dependency:** metric engine, parameter sweeps and orchestration.

---

## 11. FFT, harmonics and distortion

### User problem

Clipping, oscillation and nonlinear distortion are difficult to understand solely by looking at a waveform. Users need to see its frequency content and quantify unwanted harmonics.

### Proposed results

- FFT spectrum of a selected waveform.
- Fundamental frequency and amplitude.
- Harmonic amplitudes and relative levels.
- Total harmonic distortion (THD).
- Optional signal-to-noise and intermodulation measurements with well-defined test conditions.

### Educational example

Increase the input amplitude of a transistor amplifier until the output clips. Show its waveform beside the FFT spectrum and automatic THD measurement. Explore how biasing changes the onset of distortion.

### Implementation considerations

- Use a clearly defined analysis window, ideally after transient settling.
- Sampling rate, time-step accuracy, windowing and frequency resolution all affect spectra.
- Report whether harmonics align with FFT bins and what correction/windowing assumptions apply.
- ngspice Fourier and distortion facilities can be used where suitable, but TinyCAD may benefit from its own FFT/measurement layer for consistent presentation.
- Small-signal distortion analysis may have model support constraints; transient FFT is more broadly useful but not infallible.

**Priority:** P1/P2. **Audience:** A-level and undergraduate.

---

## 12. Noise, stability and pole-zero analysis

These are important to advanced analogue design but less pressing for first-release educational workflows.

### 12A. Noise analysis

Questions: What is the output noise? How much noise is referred to the input? Which component or device contributes noise? How does noise change across frequency?

**Proposed UI:** Select an output and the relevant input-source configuration; run a noise analysis, show noise spectral density and integrate it over a user-specified bandwidth.

**Caution:** Noise outputs depend on model support, units, frequency limits and assumptions. Summing or integrating noise incorrectly can produce materially misleading numbers.

### 12B. Feedback and stability

Questions: Is a feedback amplifier stable? What are gain margin, phase margin and crossover frequency? Does the transient response ring excessively?

**Proposed UI:** Guide the user through a supported loop-gain measurement configuration, plot gain/phase and calculate margins. Add transient step-response metrics as complementary evidence.

**Caution:** Correct return-ratio/loop-gain measurement matters. Arbitrary closed-loop signal ratios are not substitutes for proper stability analysis.

### 12C. Pole-zero analysis

Questions: Where are the relevant poles and zeros of a linearised circuit, and what do they imply about its dynamic response?

**Proposed UI:** Show poles and zeros in the complex plane with explanatory notes and links to the frequency response.

**Caution:** ngspice's pole-zero analysis has applicability and numerical limitations, so failed or incomplete calculations must be communicated explicitly.

**Priority:** P2. **Audience:** undergraduate and advanced engineers.

---

## 13. Guided explanations and diagnostic assistance

### User problem

Beginners may know that a circuit does not behave as expected but not understand why. Raw simulations cannot bridge this reasoning gap by themselves.

### Proposed experience

A dedicated **Explain Result** panel combines:

- The relevant schematic topology.
- DC operating-point values.
- Signal properties and measured characteristics.
- The user's stated requirements.
- A set of documented electrical heuristics and explanatory templates.

Example explanations:

> “The transistor's simulated operating point suggests insufficient collector-emitter headroom for the requested output swing. Check the base-bias and collector resistor values.”

> “The selected resistance and capacitance give a larger time constant than required, which reduces the filter cutoff frequency.”

### Recommended implementation path

1. Begin with **rule-based diagnostics** for well-understood circuit classes: dividers, basic RC filters, transistor biasing, clipping and supply loading.
2. Show the evidence for every explanation, including relevant measured values and equations.
3. Clearly distinguish facts from hypotheses, especially when the circuit has many plausible failure modes.
4. Consider optional language-model-assisted explanation later, but do not rely on a model to invent electrical reasons from raw plots.

### Education-specific controls

Offer **Hint**, **Show reasoning** and **Full explanation** levels. This keeps the simulator useful for guided discovery and formal exercises without automatically giving away the answer.

**Priority:** P2, with a small rules engine potentially introduced earlier. **Audience:** all levels.

---

# Part II — Educational use cases and product positioning

## How the feature emphasis changes by educational level

| Education level | Best initial features | Typical questions |
|---|---|---|
| **GCSE, ages 14–16** | Component tuning, schematic voltages, multimeter, faults | “Why is the LED brighter?” “Why did the divider output change?” |
| **A-level, ages 16–18** | Oscilloscope, automatic timing, amplifier/filter metrics, function generator, FFT | “What is the gain?” “What is the cutoff frequency?” “Why is the signal clipped?” |
| **Undergraduate Year 1** | Bias, transient response, sweeps, comparison with equations | “Does the simulated result match theory?” |
| **Undergraduate Years 2–3** | AC response, tolerance, power, sensitivity, FFT, noise, stability | “Will it meet specification across operating conditions?” |
| **Undergraduate projects** | Automated tests, Monte Carlo, optimisation, realistic models, reports | “Is the design robust enough to build?” |

An educational UI need not become a set of hard-coded “GCSE mode / A-level mode / undergraduate mode” restrictions. A better approach is progressive disclosure, with easy-to-understand workflows visible first and advanced analyses available when needed.

## Worked example circuits to ship with the feature set

| Demonstrator | Analyses | Core learning objective |
|---|---|---|
| Potential divider, loaded and unloaded | DC annotation, tuning, pass/fail | Ohm's law and loading |
| RC low-pass filter | Transient, AC, cutoff extraction, sweep | Time constant and frequency response |
| RLC resonant circuit | Sweep, resonance, damping, Q | Resonance and transient damping |
| Common-emitter amplifier | Operating point, gain, clipping, FFT | Transistor bias and nonlinear behaviour |
| Op-amp amplifier | Gain, bandwidth, large-signal limits, stability | Ideal versus practical amplifier behaviour |
| Rectifier and smoothing capacitor | Ripple, load variation, diode current | AC-to-DC conversion and design trade-offs |
| Transistor switching an inductive load | Transient stress, power, fault | Switching, inductive spikes and protection |
| Active filter | Tolerance, sensitivity, optimisation | Practical component selection |

Each demonstrator can double as (a) a teaching example, (b) a regression test for the simulator and (c) an acceptance test for its derived measurements.

## Comparison with existing software approaches

The main inspiration is the **workflow**, not a literal copy of another application's UI:

- **NI Multisim** illustrates the educational value of virtual instruments, fault insertion, parameter studies and advanced statistical analyses.
- **KiCad** demonstrates how operating-point information and SPICE interaction can be integrated with a schematic editor.
- **LTspice** provides established workflows for parameter stepping, waveforms and measurements.
- **ngspice** already includes a substantial repertoire of underlying analysis methods and a control language, making higher-level orchestration practical.
- **University SPICE laboratories** show the educational importance of biasing, transient response, frequency response and validating theory with simulation.

The recommended differentiation for TinyCAD is to bring these together into an approachable, **measurement- and requirements-first** design experience.

---

# Part III — Proposed TinyCAD architecture

## Overall architecture

```text
TinyCAD schematic and document
  ├─ Component definitions and values
  ├─ Instruments and measurement probes
  ├─ Named measurements
  ├─ Test cases / requirements
  └─ Analysis definitions
                │
                ▼
Analysis orchestrator
  ├─ Schematic ↔ netlist ↔ result identifiers
  ├─ Parameter substitution and scenario generation
  ├─ Simulation queue / cancellation / cache
  ├─ ngspice execution and result capture
  └─ Reproducibility metadata
                │
                ▼
ngspice solver
  ├─ Operating point / DC
  ├─ Transient
  ├─ AC and transfer function
  ├─ Noise / sensitivity / pole-zero, where supported
  └─ Other supported analyses
                │
                ▼
Measurement and analysis layer
  ├─ Typed measurements with units
  ├─ Signal timing and waveform metrics
  ├─ Filter / amplifier characteristics
  ├─ FFT / distortion metrics
  ├─ Statistical tolerance analysis
  ├─ Requirements / assertions
  └─ Explanations and diagnostics
                │
                ▼
TinyCAD presentation
  ├─ Schematic overlays
  ├─ Interactive plots
  ├─ Virtual instruments
  ├─ Analysis tables and comparisons
  └─ Pass/fail reports
```

## Important cross-cutting components

### A. Stable mapping between schematics and results

A component or net should retain a durable identifier independent of the generated ngspice name. This enables consistent annotations, fault injection, probes, saved measurement definitions and comparisons across schematic revisions.

### B. Reusable analysis definitions

Instead of storing only raw SPICE scripts, store semantic objects such as:

```text
SweepAnalysis
  parameter: R1.resistance
  values: [1k, 2.2k, 4.7k, 10k]
  base_analysis: ac_filter
  outputs: [cutoff_frequency, gain_at_1k]
```

The orchestrator generates the necessary ngspice operations. Advanced users may still need access to directives, but the regular interface should not require memorising simulator syntax.

### C. Named, typed measurements

Measurements are the central abstraction connecting almost every feature. A good measurement system needs units, validity states, source vectors, analysis type, conditions and algorithm/configuration version.

### D. Provenance and reproducibility

Every recorded result should include at least:

- Document/circuit revision or content hash.
- Component overrides and parameter values.
- Model references and relevant versions.
- ngspice version and simulation options.
- Stimulus, selected analysis, time step or frequency sweep.
- Measurement definitions and selected analysis windows.
- Random seed for stochastic studies.
- Convergence status, warnings and failed-run information.

### E. Honest error reporting

A failed simulation, an undefined cutoff frequency or an invalid measurement should be an explicit result state. Do not silently emit 0, NaN without explanation, or a misleading pass/fail assessment. Suppress claims that depend on missing or unsupported model information.

### F. Performance and orchestration

Interactive tuning and Monte Carlo can generate many solver runs. Use cancellation, debouncing, bounded parallelism where supported, progress reporting and result caching. Benchmark the target desktop and web/Electron deployment environments separately; not every ngspice integration mechanism behaves identically across native and WebAssembly environments.

---

# Part IV — Development roadmap

## Phase 1: Circuit Explorer foundation

**Goal:** Turn existing simulation plots into useful measurements and real-time feedback.

Deliver:

1. Schematic ↔ netlist ↔ results mapping.
2. DC operating-point overlays.
3. Named and persistent measurements.
4. Interactive component editing/tuning.
5. One-parameter sweep orchestration.
6. Guided RC filter and basic amplifier characteristic summaries.
7. Basic named requirements with pass/fail evaluation.
8. A small multimeter prototype to validate instrument connections.

**Success measure:** A student can open a supplied filter, vary its parts, read its cutoff frequency, compare theory with simulation and check a saved requirement without manually interpreting multiple graphs.

## Phase 2: Robust design analysis

**Goal:** Answer whether the circuit is practical and meets its specification.

Deliver:

1. Monte Carlo analysis and tolerance assignments.
2. Initial worst-observed-case search.
3. Component stress and power reporting.
4. Efficiency versus load/supply sweeps.
5. FFT and harmonic measurements.
6. Expanded test cases and reports.
7. Two-variable sweep and measurement heatmaps.

**Success measure:** A design can be tested over realistic parameter ranges and produce an understandable report of passes, failures and assumptions.

## Phase 3: Educational laboratory and advanced analysis

**Goal:** Add differentiated teaching features and deeper undergraduate capability.

Deliver:

1. Full multimeter, oscilloscope, function generator and bench supply workflows.
2. Fault-injection teaching mode and diagnostics.
3. Sensitivity explorer and basic optimisation.
4. Noise analysis and carefully guided feedback-stability workflows.
5. Pole-zero display and advanced amplifier analysis.
6. Rules-based explanations, hints and graded troubleshooting exercises.
7. Reusable teaching experiments and optional external assessment export.

**Success measure:** A teacher can distribute a circuit-based exercise where students make measurements, diagnose a defect and demonstrate that their design meets stated requirements.

## Suggested initial implementation order within Phase 1

The order matters because later features benefit from the earlier abstractions:

```text
Result vector mapping
        ↓
Named measurements ────────┐
        ↓                  │
Schematic overlays          │
        ↓                  │
Parameter overrides         │
        ↓                  │
Sweep orchestrator          │
        ↓                  ▼
Metric-vs-parameter charts + pass/fail requirements
        ↓
Guided filter / amplifier analysis panels
```

Building the measurement and orchestration layers first avoids implementing each analysis as a separate one-off integration.

---

# Part V — Detailed implementation and validation checklist

Before considering the analysis suite production-ready, validate these behaviours:

- [ ] A schematic edit invalidates or clearly marks outdated result annotations.
- [ ] Changes from a tuning control can be reset without corrupting the saved schematic.
- [ ] Measurements report both numeric values and physical units.
- [ ] Undefined metrics (for example, a nonexistent −3 dB crossing) are distinguished from valid numeric results.
- [ ] Automated tests link to their input conditions, measurement definition and evidence.
- [ ] Failed or non-converged Monte Carlo runs are counted and reported.
- [ ] Monte Carlo runs can be repeated using a stored seed and identical model conditions.
- [ ] Complex values and frequency-response units are handled consistently.
- [ ] Power calculations use an explicit sign convention and a defined measurement window.
- [ ] Feedback stability results are only enabled for a supported, properly defined test arrangement.
- [ ] Fault injection never silently overwrites the original circuit.
- [ ] Instrument inputs have documented loading behaviour rather than assuming all instruments are ideal.
- [ ] Large sweeps can be cancelled and do not block the editor indefinitely.
- [ ] The same analysis and measurement definitions can be stored in TinyCAD documents and reopened later.
- [ ] Example circuits have independently calculable reference results where practical.

---

# Part VI — Research sources and further reading

The following public material provides background on ngspice capabilities, educational simulation workflows and the analyses used in commercial teaching/design tools. These are product and tutorial references, not a statistically representative survey of user requests; the priorities in this report are reasoned product recommendations.

1. **ngspice documentation and reference manual** — simulation analyses, measurements and supported commands.  
   https://ngspice.sourceforge.io/docs.html

2. **ngspice control-language tutorial** — running analyses in loops, changing parameters, extracting measurements and building custom analysis workflows.  
   https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html

3. **KiCad 9 Schematic Editor and Simulator documentation** — operating-point integration, plot interaction and graphical simulation workflows.  
   https://docs.kicad.org/9.0/en/eeschema/eeschema.html

4. **NI: SPICE Analysis Fundamentals** — tutorials and overview of circuit-analysis techniques.  
   https://www.ni.com/en/shop/electronic-test-instrumentation/application-software-for-electronic-test-and-instrumentation-category/what-is-multisim/spice-analysis-fundamentals.html

5. **NI: Multisim and Ultiboard Academic Features** — virtual instruments, educational capabilities and additional analyses.  
   https://www.ni.com/en/support/documentation/supplemental/10/ni-multisim-and-ultiboard-academic-features.html

6. **NI: Parameter Sweep tutorial** — example of changing component values to explore RLC damping.  
   https://knowledge.ni.com/KnowledgeArticleDetails?id=kA03q000000YH8FCAW

7. **NI: Worst Case Analysis tutorial** — design sensitivity to component tolerances.  
   https://knowledge.ni.com/KnowledgeArticleDetails?id=kA03q000000YG5eCAG&l=en-US

8. **MIT: Introduction to SPICE laboratory** — introductory university workflow for SPICE and comparison between theoretical and simulated circuit behaviour.  
   https://pcb.mit.edu/labs/lab_02/

9. **Texas Instruments: PSpice for TI** — practical analogue simulation and design verification with device models.  
   https://www.ti.com/tool/PSPICE-FOR-TI

10. **Analog Devices: LTspice** — industry-standard circuit experimentation and parameter stepping reference.  
    https://www.analog.com/en/resources/design-tools-and-calculators/ltspice-simulator.html

The most useful follow-up research would be hands-on testing of the exact current ngspice release and the TinyCAD integration API: especially `.meas` capabilities, saved branch-current vectors, sensitivity outputs, Monte Carlo scripting approaches and the differences between native and browser deployment.

---

# Conclusion

The highest-value direction for TinyCAD is a **Circuit Explorer** organised around the user's design questions rather than around raw SPICE analysis commands. Begin with interactive tuning, automatic measurements, schematic operating points and saved requirements. These are directly useful to students and engineers and form the platform for tolerance analysis, optimisation, virtual instruments and fault-finding exercises.

The long-term differentiation is straightforward: TinyCAD should not only show **what a simulated circuit does**, but help users understand **why it does it, whether that result is acceptable, how it changes with component choices and how robust the design is likely to be**.
