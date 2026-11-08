# Circuit Explorer

Circuit Explorer is in the right-hand chart panel in both browser and Electron.
Use **SPICE → Show charts** if the panel is hidden. Choose a Simulation setup at
the top; its analysis settings still live on the Simulation sheet. You can keep
the schematic visible throughout tuning, measurement and comparison.

## Try the examples

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

## Tuning controls

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

## Named measurements

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
FFT, harmonic distortion and specialist noise metrics are later priorities.

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

## Requirements

Add a named requirement linked to a metric. Choose inclusive Between, At least
or At most limits and the metric's exact unit. Limits accept SI prefixes. A
missing/invalid metric or incompatible unit produces unavailable; valid values
produce pass or fail with the value and limits. Export report saves current
definitions/evaluation and the acquisition snapshot as JSON. Export sweep report
saves each parameter value with the associated run and captured measurements.
The chart CSV download exports plotted numerical data at full resolution.

## DC schematic overlay

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

## Automated qualification

`scripts/tests/simulation-explorer.test.mjs` checks analytical transient metrics,
complex AC measurements, typed limits, immutable bindings, preferred values,
native five-value RC sweeps, caching, cancellation, DZN round trips and native
divider annotations. `scripts/tests/qualify-chart-windows.mjs` checks actual
Chart.js/Fluent controls in hidden Electron windows, tuning/reset/apply,
restored sweep groups, metric plots, requirements and stale-overlay suppression.
Its UI solver events are deterministic fixtures; the separate native regression
uses the bundled ngspice engine. These are automated checks, not installed-app
or classroom usability acceptance.
