# Sources, probes and charts

The toolbar **Simulation** menu offers **Simulate** and chart visibility controls.
Its **SPICE** sub-menu contains **Insert Probe**, **Insert Source**,
**Insert Ground**, differential/current probes and controlled sources.
Its **Lab Equipment** sub-menu contains the oscilloscope, multimeter,
function generator and bench supply.
Choose a tool, move its preview onto the schematic, and click to place it.
Right-click cancels. Ground and probe tips snap to wires and split them at the
connection point. Components are embedded in the drawing; no symbol-library
download is required. When inserting from a Simulation sheet, the editor switches
to a schematic sheet.

## Sources

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

## Charts beside the schematic

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

Automated regression checks cover native waveform/preview parity, current
direction, controlled-source gain, embedded component persistence, wire insertion,
unit axes, complex data and full-resolution CSV. A hidden Electron qualification
(`node scripts/tests/qualify-chart-windows.mjs`) also verifies two independent
windows, actual Chart.js canvas rendering and unit axes, updated values and
returning a closed window to its panel. Interactive usability acceptance remains
separate from these automated checks.
