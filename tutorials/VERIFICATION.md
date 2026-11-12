# Verification and reproduction

The bundle contains a shared introductory chapter, eleven SPICE lessons and
six XSPICE lessons. The accompanying
drawings use embedded symbols and models; no external model download is required.
The XSPICE course requires TinyCAD Desktop and the native code-model libraries.

## Checks

All 28 tutorial drawings have been processed with the merged auto-layout tool
at high disturbance, with native-junction connectivity checks enabled. Total
wire length fell from 25,830 to 17,632 drawing units (about 32%). The final
layouts have no reported collisions, pin-exit violations, label overhangs or
junction issues. `layout-verification.json` records the before/after metrics.
Circuit PNGs and SVGs were regenerated from the saved drawings, and every
simulation was rerun to refresh its retained reference acquisition.

All 28 drawings passed 284 checks, including 115 local Markdown links.
The repository TypeScript typecheck also passed. All 48 PNG figures were
visually reviewed, including three screenshots from TinyCAD Desktop.

`verification.json` records the checked drawing hashes, engine build identifiers,
sample counts and measured reference quantities. The verification script checks:

- every drawing reopens with a complete retained acquisition matching its circuit hash;
- generated wires use native two-point segments, and generation preserves connectivity across save/reopen;
- every transient reaches its requested end time;
- divider voltages and source-current sign, source ranges, RC charging and frequency response;
- amplifier bias, small-signal RMS and asymmetric clipping;
- rectifier ripple, RC noise integral, DC transfer and pole location;
- NAND truth-table states, a delay hazard, D-flip-flop capture/reset, all sixteen counter states;
- PWM filtering, unknown-state mapping and controlled-source gain;
- every local Markdown link resolves to an included file.

Results were generated with the bundled native ngspice 47 engine. Browser/WASM
numerical equivalence is not claimed by this check. The diagrams and plots are
reference experiments, not manufacturer characterisations or hardware-rating
certifications.

## Reproduce from the repository root

```powershell
node scripts/generate-tutorials.mjs
# To lay out the existing drawings instead of rebuilding their circuit definitions:
# node scripts/generate-tutorials.mjs --existing
# Electron must run as an application, not in its Node compatibility mode:
$env:ELECTRON_RUN_AS_NODE = $null
node node_modules/electron/cli.js scripts/tutorials/render-figures.cjs
node scripts/verify-tutorials.mjs
node scripts/package-examples.mjs
node scripts/package-tutorials.mjs
```

Generation uses the existing native engine under `build/engines/native`. Build
that engine first if it is absent. `--only amp-ac` regenerates an individual
drawing; rerun the figure and verification steps afterwards. The generator
exports `.cir` netlists alongside `.dzn` files and stores full numerical JSON
under the ignored `build/tutorials/results` directory. Retained acquisitions
also travel inside the drawings.

Generation applies the shared auto-layout engine before saving and simulating.
It checks physical and electrical connectivity before and after layout and
again after save/reopen. The layout step preserves the Simulation sheet; the
following solver run refreshes the acquisition for the newly exported netlist.
Matched-scale before/after SVGs are written to `build/tutorials/layout` for review.

`catalog.json` registers the two tutorial groups in TinyCAD's **Open Example**
browser. The normal `examples:package` build step includes the drawings,
chapter descriptions and images directly from this directory. Both development
and installed desktop builds read the packaged catalogue in `dist/bundled-examples`.
The SPICE group's introduction displays the TinyCAD implementation chapter;
the divider entry retains the first practical lesson.
The first **Start here — using the tutorials** entry displays the shared
introductory guide and opens the existing divider drawing.
The ZIP is a manual/source distribution convenience; users open the embedded
examples in TinyCAD and do not need to download it.

Result figures use the installed Chart.js and Electron, with real solver data.
Circuit images use TinyCAD's own SVG renderer after reopening the saved drawing.
Application screenshots were captured from the actual desktop frontend with an
isolated documentation profile. They are not UI mockups. The capture helper
serves an existing Electron build from `dist` on loopback port 1235 and does not
change the normal development server on port 1234.

```powershell
node node_modules/electron/cli.js scripts/tutorials/capture-app.cjs `
  tutorials/spice/circuits/rc-ac.dzn `
  tutorials/spice/images/tinycad-ac-setup.png simulation
```

The screenshot helper needs a current desktop frontend build in `dist`.
Rendered figure styles and application chrome may differ between releases.

## Amplifier provenance

The amplifier preserves the topology, R1–R6 and C1/C2 values of the user's
`D:\Projects\TinyCAD\examples\AMP.DSN`. The original credits Matt Pyne, 1995.
The SPICE essentials library supplies the resistor, capacitor, potentiometer and
transistor artwork/models. Both original transistor names are explicitly
replaced with the generic embedded `TC_NPN`; the speaker becomes an 8 Ω resistor;
the potentiometer uses an electrical 0.5 split. These assumptions and their
consequences are explained in chapter 7.

## Research sources

- [Official ngspice tutorial index](https://ngspice.sourceforge.io/tutorials.html)
- [Beginner tutorial](https://ngspice.sourceforge.io/ngspice-tutorial.html)
- [Control-language tutorial](https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html)
- [Reference manual and documentation](https://ngspice.sourceforge.io/docs.html)
- [XSPICE introduction](https://ngspice.sourceforge.io/xspice.html)
- [XSPICE HOWTO and example links](https://ngspice.sourceforge.io/xspicehowto.html)

Exact digital port orders and parameters were checked against the bundled
ngspice 47 `adc_bridge`, `dac_bridge`, `d_dff` and gate interfaces. The lesson
prose, circuits and result figures are original tutorial material; upstream
tutorial screenshots were not copied.
