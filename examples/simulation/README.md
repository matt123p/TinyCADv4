# Simulation teaching drawings

Open a drawing using TinyCAD's normal **File → Open** command, select its
Simulation sheet and choose **Run**. These files contain the circuit, embedded
symbol definitions, editable component values, SPICE templates, analysis setup
and instructions. Each uses the built-in configurable source, IN/OUT voltage
probes, a series-current probe and Earth ground valued `0`. They are ZIP `.dzn` drawings even without saved
or sample results, because they contain simulation components and setup.

| Drawing | Simulation | Expected result |
| --- | --- | --- |
| [Voltage divider](voltage-divider.dzn) | Operating Point | OUT = 2.50 V relative to node 0; VP1 = +2.50 mA and V1 branch current = −2.50 mA. Changing R2's Value to `2k` gives approximately 3.33 V after another run. |
| [RC charging](rc-charging.dzn) | Transient, 5 ms | A 1 V step charges 1 µF through 1 kΩ. OUT reaches approximately 0.632 V at 1 ms. |
| [RC low-pass](rc-low-pass.dzn) | AC, 10 Hz–100 kHz | Cutoff near 159.15 Hz: gain approximately −3.01 dB and phase −45°. The configured derived trace is OUT / IN. |

Select **V1** on the Circuit sheet to edit its source settings and see a waveform
preview in the bottom panel. **Signal type** changes between pulse, sine and the
other waveforms; the fields below it control amplitude, timing and frequency.
These examples use compact symbols at normal library scale.
The charging example uses a 0–1 V pulse with a 1 µs
rise, 10 ms width and 20 ms period; its first pulse covers the 5 ms simulation.
The low-pass example sets AC amplitude to 1 V in the source panel.

Select **PR1** for IN voltage, **PR2** for OUT voltage or **VP1** for series current.
After running, their bottom panels show the selected acquisition. VP1's positive
direction is from IN towards R1. Transient/AC plots select voltage and current
signals to demonstrate the separate unit axes.

Select a resistor or capacitor and edit **Value** in its properties. Its **SPICE**
tab shows the instance's model template. Ground uses node `0`; source
branch-current sign follows the SPICE terminal order.
These components are ideal teaching models, not claims about a manufacturer's
part. Use **SPICE → Insert Probe** to place a voltage probe, then select it to
see its result in the bottom panel after running. Differential and series-current
probes are also available. **SPICE → Insert Source** creates an editable source
with a waveform preview; **Insert Ground** places node `0`. See the
[controls guide](../../docs/14-spice-controls-and-charts.md).

Changing a value makes previous results out of date. Run again to obtain a new
acquisition; the previous one remains in history. Save preserves the drawing and
its simulation setup. **File → Save without results** creates a separate copy
for sharing without replacing the open drawing or its retained results.

Repository copies are in `examples/simulation/`. Packaged applications carry
copies in `resources/examples/simulation/` beside the bundled engine resources.
Opening an example uses the existing unsaved-changes workflow; save your current
drawing before replacing it. No symbol download or external model file is needed.

Regenerate these fixtures with `npm run generate:simulation-examples`. Run
`node --test scripts/tests/simulation-examples.test.mjs` to verify save/reopen,
connectivity and setup; when a native runtime is available, this also checks the
actual numerical results. This does not replace visual UI verification.
