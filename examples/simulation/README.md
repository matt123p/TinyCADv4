# Simulation teaching drawings

Open a drawing using TinyCAD's normal **File → Open** command, select its
Simulation sheet and choose **Run**. These files contain the circuit, embedded
symbol definitions, editable component values, SPICE templates, analysis setup
and instructions. They contain no saved or sample results.

| Drawing | Simulation | Expected result |
| --- | --- | --- |
| [Voltage divider](voltage-divider.dsn) | Operating Point | OUT = 2.50 V relative to node 0; V1 branch current = −2.50 mA. Changing R2's Value to `2k` gives approximately 3.33 V after another run. |
| [RC charging](rc-charging.dsn) | Transient, 5 ms | A 1 V step charges 1 µF through 1 kΩ. OUT reaches approximately 0.632 V at 1 ms. |
| [RC low-pass](rc-low-pass.dsn) | AC, 10 Hz–100 kHz | Cutoff near 159.15 Hz: gain approximately −3.01 dB and phase −45°. The configured derived trace is OUT / IN. |

Select a component on the Circuit sheet and edit **Value** in its properties.
The **SPICE** tab shows the instance's model template. Use node `0` as the
explicit reference; source branch-current sign follows the SPICE terminal order.
These components are ideal teaching models, not claims about a manufacturer's
part. The DC meter and interactive schematic probes remain separate planned UI.

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
