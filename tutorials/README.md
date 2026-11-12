# Simulation tutorials for TinyCAD

Start with [How to use these tutorials and open the bundled examples](00-how-to-use.md),
then continue to [SPICE: overview and your first simulation](spice/01-overview.md).
For event-driven logic, start with the separate [XSPICE and digital course](xspice/01-overview.md).

There is a shared introductory chapter, eleven SPICE chapters and six XSPICE
chapters. Each course keeps
its Markdown pages, runnable drawings and images together so that it can be
copied into a manual. All tutorial examples are bundled with TinyCAD; no
tutorial download is needed. Choose **Open Example** on the toolbar, select
**SPICE tutorial** or **XSPICE and digital tutorial**, select the example named
in the chapter, then choose **Open Drawing**. This opens an editable copy;
use **Save As** to keep your experiments and open the embedded example again
to start afresh. Drawings include embedded symbols, model definitions,
analysis settings and a retained reference acquisition.

## SPICE

1. [Overview and first run](spice/01-overview.md)
2. [DC voltage, current and power](spice/02-dc-measurements.md)
3. [Signal generators and stimuli](spice/03-signal-generators.md)
4. [Transient analysis and RC charging](spice/04-transients.md)
5. [Frequency response and filters](spice/05-frequency-response.md)
6. [Diodes, rectification and ripple](spice/06-nonlinear-circuits.md)
7. [Rebuilding AMP.DSN](spice/07-amplifier-bias.md)
8. [Amplifier gain and bandwidth](spice/08-amplifier-frequency-response.md)
9. [Amplifier output, clipping and power](spice/09-amplifier-power.md)
10. [Sweeps, noise and design investigations](spice/10-design-investigations.md)
11. [How TinyCAD implements SPICE: engines, symbols and workflow](spice/11-tinycad-spice.md)

## Desktop video walkthroughs

Five short videos demonstrate the steps where seeing the controls helps most.
Each uses the real Electron desktop app and native solver, with on-screen
captions and click highlights. There is no audio. Play them in the lesson's
embedded player, or use these links in a Markdown viewer:

| Lesson | Demonstration |
| --- | --- |
| 1 | [Open, run and change a divider](spice/videos/first-run.mp4) |
| 3 | [Source settings and waveform preview](spice/videos/source-settings.mp4) |
| 4 | [RC charging, timestep and time constant](spice/videos/rc-transient.mp4) |
| 5 | [AC magnitude, dB, phase and cutoff](spice/videos/ac-response.mp4) |
| 6 | [Measure settled rectifier ripple](spice/videos/rectifier-ripple.mp4) |

The videos supplement the written instructions and figures. Use the chapter
text for equations, assumptions and expected values. Native menus and window
appearance may differ on Windows or macOS.

## XSPICE and digital simulation

1. [Models, bridges and first run](xspice/01-overview.md)
2. [Gates and truth tables](xspice/02-gates.md)
3. [Propagation delay and hazards](xspice/03-timing.md)
4. [Flip-flops, clocks and reset](xspice/04-flip-flops.md)
5. [Counters and divided clocks](xspice/05-counters.md)
6. [Mixed-signal filtering and unknown states](xspice/06-mixed-signal.md)

XSPICE examples require TinyCAD Desktop's native engine. The ordinary SPICE
examples use analogue models, but numerical qualification of this bundle was
performed with bundled native ngspice 47. A successful native run is not a
claim that every browser/version combination has been tested.

Circuit figures are rendered from reopened TinyCAD drawings. Result figures
are plots of actual solver data, not hand-drawn expected waveforms. Captions
identify application screenshots separately. Small numerical differences from
the printed values are normal when model, temperature, timestep or engine
version changes.

See [verification and reproduction](VERIFICATION.md) for the checks and tooling.
