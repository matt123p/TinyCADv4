# Sources, probes and charts

The toolbar **SPICE** menu offers **Simulate**, **Insert Probe**, **Insert Source**
and **Insert Ground**, plus differential/current probes and controlled sources.
Choose a tool, move its preview onto the schematic, and click to place it.
Right-click cancels. Ground and probe tips snap to wires and split them at the
connection point. Components are embedded in the drawing; no symbol-library
download is required. When inserting from a Simulation sheet, the editor switches
to a schematic sheet.

## Sources

Select a source to edit it in the bottom panel. Choose voltage or current, then
DC, sine, square/pulse, triangle, piecewise-linear, exponential or FM. Fields
accept engineering prefixes, for example `1kHz`, `5ms`, `10us` and `1mA`.
Piecewise-linear input uses one time/value pair per line with increasing times.
AC amplitude and phase apply to frequency-response analysis; DC operating point
is separate from the transient waveform.

The waveform chart previews the actual numeric settings used in the generated
source statement, including delay, ramps, damping and modulation. Invalid settings
show an error and prevent simulation startup. Source type changes update the
reference prefix and symbol artwork. Standard component references remain editable.

Controlled sources offer a voltage-controlled voltage source (E) or
voltage-controlled current source (G). Output pins are +/− (1/2); control pins
are C+/C− (3/4). Their panel shows the configured transfer characteristic.

## Probes and ground

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

## Charts and downloads

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

Automated regression checks cover native waveform/preview parity, current
direction, controlled-source gain, embedded component persistence, wire insertion,
unit axes, complex data and full-resolution CSV. Interactive UI acceptance was
excluded from the current automated-only validation.
