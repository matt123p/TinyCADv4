# Teaching drawing review

All 214 curriculum activities have an individual rendered PNG. Every drawing was examined in 36 contact sheets; complex and corrected circuits were also inspected at full size. The adjacent `review.json` records the reviewed drawing/PNG hashes, contact-sheet number and numerical outcome for each activity.

The review corrected clipped Markdown, long formula captions, pin-label collisions, the compact 555 body, display-pin fan-out, ground placement beside amplifier inputs, sampling-chain references and the strain bridge's separate sense terminals. Pins remain on the 5-unit grid and wires are orthogonal. Equal net labels intentionally connect separated stages; the student notes explain this convention.

The 12 November regeneration also fixes lost wire legs: the generator now emits every segment of a routed wire, rather than passing a polyline to a format that stores only its first segment. The editor's own split/merge rules produce branch dots before and after auto-layout. All 214 saved drawings preserve complete wire coverage and terminal connectivity; they contain 2,773 native wire segments and 138 schematic junctions, with no diagonal wires or misplaced-junction diagnostics. Supply-pin orientation is chosen before wiring, including VCC above and ground below the potentiometers. Junction artwork inside rotated/mirrored symbols now follows the same transform as its wires, fixing the displaced thermocouple dot.

All 201 saved simulations were reopened, netlisted and solved with bundled ngspice 47. The verifier checks transient end time and convergence errors, rather than accepting the solver's completion notification alone. All 13 connection plans reopen as ordinary DSN drawings without simulation models. Chromium found no Markdown clipping or circuit text outside its allocated area.

SVGs and 1800×1200 PNGs are rendered from reopened drawings. Review records include remaining auto-layout diagnostics rather than claiming every annotation is perfect. Numerical regressions additionally check the restored wire-resistance and series-circuit return paths against their expected divider voltages.

Numerical regression checks cover continuous 555 oscillation, monostable pulse width, the modulo-five sequence, ADC/DAC output range and bridge polarity. They caught instantaneous-feedback failures: the 555 now has finite comparator response, and the counter reset has an explicit RC/hysteresis stage. The shared native/WASM bridge source now classifies convergence-abort messages as failures. An intentionally unstable circuit verifies the native failure path.

These are student investigation starting points. Value changes, alternative topologies, real apparatus, physical geometry, firmware and HDL remain part of the tasks described in the notes. Numerical qualification used the native engine; the WASM binary was not rebuilt in this review.

After changing a drawing or its rendering, regenerate the PNGs, review the affected images and update the hashes in `review.json`. Generated contact sheets and detailed solver logs stay under the ignored `build/teaching-examples` directory.
