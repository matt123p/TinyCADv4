# Virtual laboratory and P1 analysis

P1 adds placeable instruments and the Analysis lab workflows. Fault injection,
FFT/harmonics, hidden challenges, optimisation and advanced noise/stability
analysis are deferred to P2. No P2 controls are included.

## Place and operate an instrument

Use **SPICE → Lab Equipment** to insert an Oscilloscope, Multimeter, Function
Generator or Bench Supply. Wire the symbol's labelled terminals, then select it
to operate its instrument face in the bottom panel. Controls, stimulus and
electrical loading are stored with the component. These drawings always save
as `.dzn`.

The panels use separate screens, rotary-style sliders, numeric editors and
student/expert controls. **Acquire / Measure** runs an analysis of the whole
circuit. When necessary it creates a Laboratory simulation sheet without
switching away from the schematic. Results identify their acquisition and are
checked against the circuit/settings fingerprint. Editing electrical settings
requires another acquisition; display-only controls reuse the retained samples.
These are recorded acquisitions, not a continuously running hardware interface.

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

## Oscilloscope

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

## Multimeter

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

## Function generator and bench supply

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

## Analysis lab

The right-hand Circuit Explorer's **Analysis lab** tab contains the P1 workflows.

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

## Verification

Windows automated tests cover native generator/meter/supply loading, current
limiting, scope trigger/coupling, a fully wired laboratory, parameter variations,
5 V/9 V conditions, deterministic distributions, failed-case classification,
advanced metric formulae and DZN persistence. Hidden Electron DOM/canvas checks
cover two persistent instrument windows, targeting, independent closure,
independent scope scales and study execution. UI solver events are fixtures;
the separate numerical tests execute bundled native ngspice. Installed-app and
classroom usability acceptance remain separate.

Behavioural source syntax follows the [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf).
