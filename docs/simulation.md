# Simulation reference

Choose **Simulation → Simulate** to add a Simulation sheet to the drawing. All schematic sheets form one circuit; each Simulation sheet owns its analysis, parameters, attached model text, signals, instructions and run history. Run/Stop are available from the sheet and the chart panel. Duplicate setup copies definitions without acquisitions.

| Analysis | Use |
| --- | --- |
| Operating point | DC bias and scalar voltage/current readings. |
| Transient | Time-domain waveforms, switching and charging. |
| AC | Complex small-signal frequency response around the operating point. |
| DC sweep | Response as an independent source is varied. |
| Noise | Separate spectral and integrated result plots. |
| Transfer function | Small-signal gain and input/output resistance for a named source. |
| Pole-zero | Poles and zeros for the configured transfer. |

Edit placed components through Options/SPICE. Per-instance attributes override symbol defaults. Attach custom model text on the Simulation sheet; see the [engine input contract](spice-engine.md#deck-and-model-contract) for supported dependencies.

The toolbar **Simulation** menu contains **SPICE** insertion tools and **Lab Equipment**. Choose a tool and click to place; right-click cancels. Ground/probe tips snap to wires and split them at the connection. Inserting from a Simulation sheet switches to a schematic. These tools embed their definitions in the drawing.

Results identify their acquisition and circuit/settings fingerprint. Circuit edits require a rerun; retained data remains historical evidence. Charts can show completed, stopped and failed acquisitions with their actual availability. Numerical exports preserve all retained samples.

## Sources, probes and charts

### Sources

The bottom editor opens immediately after **Insert Source**, before placement.
Click a placed source's body to reopen it; the panel expands to expose its settings.
Use **Signal type** to switch a pulse to a sine wave or another waveform; sine
settings include amplitude, offset, frequency, phase, delay and damping, with the
preview updating as fields change. Choose voltage or current, then
DC, sine, square/pulse, triangle, piecewise-linear, exponential or FM. Fields
accept engineering prefixes, for example `1kHz`, `5ms`, `10us` and `1mA`.
Piecewise-linear input uses one time/value pair per line with increasing times.
AC amplitude and phase apply to frequency-response analysis; DC operating point
is separate from the transient waveform.

The waveform chart previews the actual numeric settings used in the generated
source statement, including delay, ramps, damping and modulation. Invalid settings
show an error and prevent simulation startup. Source type changes update the
reference prefix and symbol artwork. Standard component references remain editable.

The source symbol itself shows the selected signal type: sine, pulse, triangle,
piecewise-linear, exponential or FM. DC keeps the standard voltage/current mark;
time-varying current sources also retain a direction arrow. Changing Signal type
updates the schematic icon immediately, including sources from older drawings.

New sources and probes use an 8 mm terminal span, comparable to normal library
parts. Their reference/value labels retain normal text sizes. Older large controls
offer **Use compact symbol** in the bottom editor; this keeps the first terminal
anchored and extends existing connections to the resized terminals. The conversion
is a single undoable edit. Ordinary setting edits preserve an older symbol's size
until that conversion is requested.

Controlled sources offer a voltage-controlled voltage source (E) or
voltage-controlled current source (G). Output pins are +/− (1/2); control pins
are C+/C− (3/4). Their panel shows the configured transfer characteristic.

### Probes and ground

- **Voltage probe:** connect the single tip to a net; the reference is ground `0`.
- **Differential probe:** connect + and − to the two nets being compared.
- **Current probe:** insert in series. It is an ideal zero-volt source; positive
  current flows from + to −. Placing it across a source would short that source.
- **Ground:** inserts the existing Earth power symbol with value `0`.

Probe panels allow changing measurement type and reversing polarity. Select a
retained simulation acquisition to display its output; the latest available run
is selected initially. Complex signals support real, magnitude, dB and phase.
Scalar operating-point readings also show a numeric value. Changed circuits
require another run before a probe will display that acquisition. Removed results
or analyses without the required signal show an explanation.

### Charts and downloads

Result charts use Chart.js. Signals with different units receive separate labelled
axes, including left/right voltage/current axes. Click a legend entry to hide a
trace. Chart options include display mode, grid, logarithmic horizontal axis,
editable axis labels and numeric sample cursors.

Use the mouse wheel or pinch to zoom, drag to pan, or Shift-drag to zoom a region.
Buttons offer zoom, horizontal scrolling and Fit. Zooming refines the visible
samples; large results retain their peaks in the overview. Pinned compatible
baselines remain dashed overlays.

**Download CSV** exports every sample of the selected signals and their scale,
including imaginary values, independently of zoom and chart sampling. Main charts
also offer a PNG image download. Probe and source-preview charts provide CSV too.

### Charts beside the schematic

The right-hand **Simulation charts** panel is available in browser and Electron.
It opens for simulation drawings and automatically adds a chart for each probe.
Without probes, a simulation setup gets an output chart. **Simulation → Show charts**
opens the panel again after it is hidden. Drag its left edge to resize it.

Choose a simulation setup and acquisition, then use **Run** or **Stop** without
leaving the drawing. Charts update during acquisition. Saved acquisitions remain
selectable, and changed circuits show a rerun message instead of attributing old
values to the current wiring. Multi-plot analyses expose a result-plot selector.

Use **Add chart** for another probe view or a custom chart, **Choose signals** to
configure a custom chart, and its × button to remove it. Titles are editable.
Removing an automatic probe chart keeps it removed until explicitly added again.
Chart layout and panel width are kept for the current drawing session.

Each chart has a **Pop out chart** button (a box with an arrow pointing out) at
its top right, beside the remove button, in both browser and Electron. Multiple
charts can be detached independently and continue receiving the same results.
Closing the chart window with × returns it to the panel. The × inside a pop-out
also returns it to the panel; the × on a docked chart removes that chart.
Replacing its drawing or closing the owning app closes the detached view.
Pop-outs share the existing numerical buffers rather than copying results into
another drawing or starting another simulation.

## Circuit Explorer

Circuit Explorer lives in the right-hand chart panel in browser and Electron. Use **Simulation → Show charts**, then select a setup. Its analysis settings remain on the Simulation sheet.

### Examples and temporary tuning

Open [RC low-pass](../examples/simulation/rc-low-pass.dzn), then Run. The
**Measurements** tab reports the cutoff, gain at 100 Hz and phase at the ideal
corner. **Requirements** checks the nominal cutoff against 150–170 Hz.

In **Tune / sweep**, change R1 resistance with the slider or numeric input.
The analysis reruns after 500 ms without changing the saved resistor. **Reset**
restores its saved value and acquisition; **Undo tuning** restores the previous
temporary setting. **Apply** writes the temporary values into the drawing as
one normal, undoable edit. Optional dashed curves show the previous acquisition.

Expand **One-variable sweep** and Run sweep. The prepared five values are
1 kΩ, 2.2 kΩ, 4.7 kΩ, 6.8 kΩ and 10 kΩ. The panel shows gain overlays, cutoff
measurements for each resistance, and cutoff versus resistance. Expected cutoffs
are approximately 159.15, 72.34, 33.86, 23.41 and 15.92 Hz. The original R1 value
remains recoverable. Select an overlay signal or a named metric to compare.

Sweep definitions, group membership, values, units, statuses and metric results
are saved in the `.dzn` drawing. Choose **Saved sweep** to revisit a group.
Saved numerical results restore its curves; Save without results keeps the
measurement snapshots and group metadata. The table remains useful when the
underlying waveforms have been removed. An acquisition interrupted by closing
the application is labelled interrupted when reopened.

### Tuning controls

Selecting a schematic symbol preselects it in the component chooser. Choose a
numeric property and **Add tuning control**. Resistor, capacitor and inductor
values receive suggested units and bounds. Other numeric instance properties,
source waveform settings and named setup parameters can also be bound. Text,
arbitrary expressions and model-file contents are not slider targets. A numeric
instance property is useful for a model parameter when the SPICE template
actually references that property.

Controls have editable names, units, bounds and linear/logarithmic sliders.
SI input uses the existing quantity parser: for example `2.2kOhm`, `100nF`,
`1ms` and `1meg`. E12/E24/E96 snap slider and sweep values to preferred decades;
direct numeric entry remains available for exact values. Preferred decades
follow [Vishay's standard value table](https://www.vishay.com/docs/31001/dectable.pdf).

Sweeps accept 2–100 linear/logarithmic points or 1–100 explicitly listed values,
separated by spaces or semicolons. Preferred-series duplicates collapse to one
value. One solver runs at a time. Cancel stops scheduling further points and
preserves completed results; schematic edits cancel an active exploration.
The panel retains the last 100 sweep groups and the existing 1,000-run limit.
Numerical storage retains its existing 64 MiB/run and 256 MiB/document budgets.

Acquisitions with the same circuit/models, backend, analysis, parameters,
bindings, overrides, trace definitions, measurements and requirements are reused
within the renderer session. Removed results and runs outside the current sheet
history cannot be reused. The bundled engine identity is fixed for that session.

### Named measurements

Add a measurement, give it a name, choose its signal/component and expand its
settings. Component/probe sources bind to sheet identity plus reference, so
reopening the drawing does not depend on transient editor object IDs. Raw node
names and derived traces are also available. Missing or ambiguous references,
bad windows, mismatched units and absent crossings produce an explicit
unavailable result, never a fabricated zero.

| Measurement | Meaning |
| --- | --- |
| Value, min, max, peak-to-peak | Real signal component; Value interpolates at the chosen axis position, defaulting to the window start. |
| Mean, RMS, ripple RMS | Transient time-weighted quantities, including interpolated window endpoints. RMS integrates the square of the piecewise-linear waveform; ripple RMS removes its mean. |
| Integral | Transient integral; integrating W produces J. Select a component power signal for average/peak power or energy. |
| Rise/fall time | First complete 10–90% transition between explicitly entered low/high levels. |
| Period, frequency, duty cycle, pulse width | First complete rising-edge cycle/pulse; threshold is explicit or the window's midpoint between min and max. Duty cycle is a percentage. |
| Delay | First output rising crossing minus the reference's first rising crossing at the same threshold; units must match. |
| Overshoot/undershoot | Excursion past the declared final/initial level respectively, as a percentage of the declared step magnitude. Handles rising and falling steps. |
| Settling time | Last entry into the band around the declared final level, measured from the window start. Tolerance is a percentage of the initial-to-final step; an unsettled final sample is unavailable. |
| Time constant | First crossing of initial + (final − initial) × (1 − 1/e), measured from the window start. |
| AC gain/phase | Complex output/input ratio at the specified frequency; input/output units must match. Phase unwraps before interpolation. |
| Cutoff/bandwidth | −3.0103 dB relative to a specified linear gain (default 1), or `peak`. Cutoff requires exactly one crossing; bandwidth requires two. Frequency interpolation is logarithmic. |
| Resonance | Frequency of the largest sampled gain within the window; a peak at the acquisition boundary is unavailable. |

Transient metrics use the chosen From/To interval in seconds. Frequency metrics
use Hz. Blank bounds use the complete acquisition. Measurements do not assume
uniform time samples. Automatic min/max-based levels are deliberately limited to
cycle measurements; step measurements require the user's initial/final levels.
FFT, harmonic distortion and specialist noise metrics are unavailable.

Click a result or requirement status to open the evidence chart at its window
and navigate to the associated symbol/net using the existing find/highlight
mechanism. The Simulation sheet's Measurements tab also lists captured named
results; its older raw sample statistics remain separately labelled.

Each run captures algorithm version `tinycad-metrics-1`, metric/trace definitions,
requirements and evaluations, binding definitions and temporary overrides,
alongside the existing exact circuit/model hash, setup hash, timestamp,
analysis/temperature, parameters, backend and engine build identity. Editing a
definition does not rewrite the historical snapshot. The panel labels captured
results and changed circuits explicitly. Historical schematics/model text are
not independent document revisions; retain an original drawing when those inputs
must also be recoverable after later edits.

### Requirements

Add a named requirement linked to a metric. Choose inclusive Between, At least
or At most limits and the metric's exact unit. Limits accept SI prefixes. A
missing/invalid metric or incompatible unit produces unavailable; valid values
produce pass or fail with the value and limits. Export report saves current
definitions/evaluation and the acquisition snapshot as JSON. Export sweep report
saves each parameter value with the associated run and captured measurements.
The chart CSV download exports plotted numerical data at full resolution.

### DC schematic overlay

Open [Voltage divider](../examples/simulation/voltage-divider.dzn), run Operating
Point, then choose Voltages, Currents or Power in **DC overlay**. Voltages are
relative to node 0. Branch currents follow pin 1 → pin 2; consumed power is
signed, so a supplying source normally shows negative power. Ideal primitive
resistor current/power can be derived from V/R. Other components need real solver
branch vectors; unsupported readings are omitted rather than invented.

Annotations require a fresh, completed, unmodified operating-point acquisition.
Transient acquisitions and unapplied tuning results are not displayed as DC
annotations. A circuit edit immediately hides stale annotations. The panel and
annotation metadata identify temperature, time and engine build. Diagnostics
shows device operating-point vectors only when the solver supplies them;
transistor region classifications are not inferred.

## Virtual laboratory

Use **Simulation → Lab Equipment** to place instruments, then wire their labelled terminals and select a symbol to open its bottom panel. Electrical settings and loading are saved with the component. **Acquire / Measure** runs a recorded simulation of the entire circuit, creating a Laboratory sheet when needed. Display-only controls reuse samples; electrical changes require a new acquisition.

Electron offers **Pop out instrument** for scope and meter. Each window remains
open when another symbol is selected, updates the instrument it belongs to,
and closes independently. Dock returns control to the normal bottom panel.
Changing documents, deleting an instrument or closing the application closes
its window. Browser instruments stay in the bottom panel. Multiple instruments
share the application's single solver acquisition slot.

Open [Virtual laboratory](../examples/simulation/virtual-laboratory.dzn) for a
wired example: GEN1 drives an RC network through 50 Ω, the scope reads IN/OUT,
the meter reads IN against ground, and PSU1 powers a separate 1 kΩ load.
The example includes seeded R/C tolerances and 5 V/9 V bench test cases.

### Oscilloscope

Two differential channels use pins **1=A+**, **2=A−**, **3=B+**, **4=B−**. Both
negative terminals must be wired; the scope does not silently ground them.
The input model is 1 MΩ per channel by default. Time/div and independent
volts/div controls set a ten-by-eight-division graticule. Channel centres,
trigger source/edge/level and student/expert controls are available. Auto mode
shows a free-running record if no crossing is found; Normal/Single wait for a
valid crossing. An acquired Single record remains selected until another is
requested or explicitly selected.

DC coupling retains the signal. AC coupling subtracts its time-weighted mean
over the acquisition; this is a defined digital DC-removal operation, not a
model of a particular oscilloscope's analogue high-pass filter. GND displays
zero. Changing coupling does not remove the specified input load.

Readouts include peak-to-peak, true RMS, frequency and period over the visible
recorded interval. Expand **Chart options and cursors** for two time cursors,
voltage values and differences. Time/div and volts/div provide scope zoom;
CSV retains full-resolution physical values. Acquire requests ten horizontal
divisions at a maximum step of time/div ÷ 100. Increasing the displayed timebase
does not invent samples beyond the old record; acquire again for a longer one.

### Multimeter

DC/AC voltage and resistance use the **V Ω** and **COM** sockets. DC/AC current
uses the separate **A** and **COM** sockets; move the lead when changing input
type. The unused input is electrically open. Unused laboratory instrument
terminals do not produce unconnected-input DRC warnings. Voltage
modes model input resistance (10 MΩ default). Current modes insert an ideal
0 V sense source and the chosen burden resistance (1 Ω default), and must be
connected in series. AC reports DC-removed, time-weighted true RMS from a
transient window; DC uses an operating point or a transient mean. Manual ranges
show OL above range. Auto chooses an engineering range; the display has
100,000 counts while exports preserve solver precision. This is a measurement
model, without hardware calibration, noise, fuse or protection simulation.

**Run unpowered Ω test** creates a separate temporary circuit with the chosen
test current. It suppresses independent sources and disconnects other virtual
instruments. Only supported literal primitive R/C/L networks and ideal probes
are accepted. Capacitors are open and inductors short at DC, so the reading is
the connected network's resistance, not necessarily one component's marked
value. Active devices/unsupported templates are rejected. The test does not
modify the schematic, and its current and original-circuit fingerprint are
retained with the result. Powered acquisitions are never relabelled as ohms.

### Function generator and bench supply

The generator offers sine, pulse/square, triangle and arbitrary PWL with
frequency, peak amplitude, offset, duty and sine phase controls. Its preview is
the programmed open-circuit waveform; terminal amplitude depends on the load.
The default output resistance is 50 Ω. Output Off opens the port through a
1 TΩ leakage approximation. Small-signal AC amplitude remains separate from
transient amplitude, as for the existing independent source.

The bench supply provides voltage, output enable, current limit, output
resistance and optional ramp time. It uses an ngspice behavioural current
source with a smooth tanh limit and finite output resistance. It can source or
sink within the same limit; it is not a vendor switching-supply or thermal
model. The panel shows measured V/I and CV/CC status. A disabled supply uses
1 TΩ leakage. Ramping applies to transient analysis; its DC operating point
uses the programmed final voltage. In the example, reducing the limit below
5 mA causes the 1 kΩ load's voltage to fall.

Numeric generator/supply settings can also be bound in **Tune / sweep** and
used as temporary test-case conditions, without editing the saved component.

### Analysis lab

The right-hand Circuit Explorer's **Analysis lab** tab contains these workflows.

- **Frequency/amplifier response:** configure input/output, range and readout
  frequency, then run AC for gain/phase, cutoff/bandwidth, resonance, band-pass
  Q and group delay. Cutoff defaults to unity reference gain; edit the named
  metric for another reference. Band-pass Q explicitly means f₀ / half-power
  bandwidth. `.tf` reports small-signal gain and input/output resistance for an
  explicitly named independent stimulus. Impedance metrics require a deliberate
  port voltage/current test configuration. Arbitrary net ratios are not loop gain.
- **Tolerance studies:** uniform bounded ± tolerance or unbounded normal
  standard deviation, an explicit unsigned seed, 2–100 cases, and optional fully
  positively correlated groups. Groups use one standardised draw and one
  distribution type. Non-positive sampled physical R/C/L/frequency values are
  reported as failed cases. Corner search enumerates up to six independent
  variables (64 corners); it reports observed extremes, not a proof of a global
  optimum. It ignores Monte Carlo correlation groups. Histograms, mean, sample
  standard deviation and all-case requirement outcomes remain available.
- **Test cases:** capture analysis, parameters, metric/trace/requirement
  definitions and binding definitions independently of the current run. Edit
  per-case temperature and parameter/stimulus/load overrides, then run the
  suite. Current schematic/models are shared inputs, and every run records its
  exact hashes. JSON reports include conditions, case results and prior study
  history for comparison or external processing.
- **Power/efficiency/stress:** add explicit component peak-voltage, current or
  power limits. Mean, RMS and Integral named metrics provide average power,
  current RMS and energy. Efficiency/loss require a signed supplying input
  power boundary and a consuming useful-load boundary. Missing/unsupported
  device vectors produce unavailable results. User-entered limits do not
  establish thermal or pulse-rating compliance.

Named metrics also include passband ripple, stopband attenuation, magnitude of
port impedance and group delay. DC/transient R/C/L, diode and supported
three-terminal BJT power requests save the necessary supported device currents;
BJT power sums collector/base terminal contributions relative to emitter.
Unrecognised subcircuits/models and ambiguous current ports are not guessed.
Small-signal AC is not a physical transient stress test.

Studies are sequential and cancellable. Failed/nonconverged cases remain in
the table and report. A study with no evaluable requirements has no yield
estimate; incomplete/failed studies are marked explicitly. Any reported yield
is illustrative under the entered model/distribution assumptions. Definitions,
seed, conditions and group-to-run references persist in `.dzn`; numerical
retention uses the existing 64 MiB/run, 256 MiB/document and 1,000-run limits.
The last 100 study groups are retained. Duplicating a setup copies its
definitions/cases while clearing acquisitions. Removing raw results preserves
captured scalar measurements and report metadata.

## Implementation and limits

Core UI is in [src/components/simulation](../src/components/simulation). Measurement algorithms live in [metrics.ts](../src/simulation/metrics.ts) and [advancedMetrics.ts](../src/simulation/advancedMetrics.ts); bindings/sweeps/studies live in [bindings.ts](../src/simulation/bindings.ts), [exploration.ts](../src/simulation/exploration.ts) and [studies.ts](../src/simulation/studies.ts). Instruments and the separate resistance test are in [instruments.ts](../src/simulation/instruments.ts) and [resistanceTest.ts](../src/simulation/resistanceTest.ts).

FFT/harmonic analysis, automatic fault injection, unrestricted multidimensional sweeps, optimisation and cooperative Live/Pause are outside the implemented workflows. General two-way schematic probe highlighting is also incomplete. Read the [engine reference](spice-engine.md) for runtime capabilities and the [drawing format](drawing-format.md) for retention limits and compatibility.
