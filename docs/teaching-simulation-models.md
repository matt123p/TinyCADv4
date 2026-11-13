# Teaching simulation models

Digital logic, Functional blocks and Sensors and interfaces embed configurable educational models directly. SPICE essentials supplies its device models.

The six editor/connectivity features and the built-in instruments/sources continue to use native TinyCAD implementations. Test points and connectors emit explicit comment-only templates: they add no load and do not short independent contacts. They need no artificial electrical device.

These are configurable educational equivalents, not manufacturer-qualified devices. The MCU/FPGA/PLC models implement declared behaviour rather than executing firmware or HDL. Power consumption, propagation time, sensor calibration, analogue limits and electromechanical parameters are simplified as described below.

## Running a circuit

Select a library, place its components, edit their model fields, wire the circuit and add reference ground. Choose the analysis and signals on a Simulation sheet. `$$SPICE` and any `$$SPICE_PROLOG` definitions are embedded in each library entry and retained in saved drawings; no model download is required.

All teaching models use portable analogue SPICE primitives, behavioural sources and internal storage subcircuits. They require no XSPICE A devices, external code-model modules, files or control scripts. This avoids the browser engine's XSPICE limitation. The syntax follows the [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf). Numerical qualification uses ngspice; engine-package qualification remains separate.

Digital symbols' hidden native Power pins connect to named **VCC** and **VSS** nets. Wire those rails to actual supplies. VSS is not implicitly node 0. Functional and sensor symbols expose their supply/reference terminals for explicit wiring. The exporter resolves hidden power pins as well as visible pins.

Use SPICE numeric suffixes (`1k`, `10u`, `1Meg`). Stimulus/expression fields may contain ngspice behavioural expressions, for example `0.01*sin(2*pi*100*time)` for magnetic flux. Model names and internal nodes are instance-specific so multiple symbols can coexist.

## Digital logic

- Gates implement their truth tables with a threshold at half the applied supply difference and a finite 50-ohm output resistance. Output levels follow VCC/VSS. They are generic logic, not TTL/CMOS timing or power models.
- The full adder computes sum/carry. The decoder has an active-high enable. The encoder gives the **highest asserted input priority**, with VALID low if no input is asserted. The multiplexer selects D1 when SELECT is high.
- BCD counters wrap at 10; binary counters wrap at 8. ENABLE is active-high, UP_DOWN high counts up, RESET high resets. The asynchronous binary counter clocks successive stages from the preceding stage; the synchronous counter shares one clock. The Johnson counter cycles `0,1,3,7,15,14,12,8`. The shift register moves DATA into Q0 then Q1 then Q2.
- Rising/falling variants select the corresponding clock edge. SET_N/RESET_N are active-low; other set/reset controls are active-high. Reset has priority over set. Level-sensitive D latches track while ENABLE is high and hold when it is low. R-S latch state follows set/reset.
- `InitialState` supplies the initial bit or integer state. Storage uses master/slave switched capacitors with approximately 1 ns acquisition and very long finite leakage, rather than a vendor event/timing model. Use input setup/hold margins and a suitably small transient maximum step; the numerical tests use 5 ns for 1 MHz clocks. No metastability model is claimed.

## Functional interfaces

| Interface | Configurable behaviour |
| --- | --- |
| ADC | Samples a 4-bit code on its selected edge: `floor(16*Vin/Vref)`, clipped to 0–15. VREF and COMMON are explicit. Digital output level defaults to `LogicHigh=5`. |
| DAC | Weighted 4-bit input code, with `Vout=Vref*code/16` relative to COMMON. Logic threshold is 2.5 V. |
| PCM encoder | Four-phase, least-significant-bit-first serialization of D0–D3. Phase 0 is the initial state; every selected clock edge advances the phase. Keep parallel input data stable over a four-clock frame. |
| Sample-and-hold | Tracks while CLOCK exceeds 2.5 V, holds otherwise. `HoldCapacitance` defaults to 1 nF; finite switch resistance and leakage model acquisition/droop. REF is explicit. |
| TDM multiplexer | CLOCK low selects CHANNEL0, high selects CHANNEL1. |
| Channel/transmitter/receiver | `Gain` (default 1) and a first-order `Bandwidth` pole (default 100 kHz), with a buffered output. Single-ended interfaces reference circuit ground. This is a baseband equivalent, not an RF carrier/channel model. |
| Output transducer | The same gain/bandwidth equivalent; PHYSICAL_OUT is an electrical proxy for the declared physical quantity. |
| Data logger | Differential input loading (`InputResistance`, default 10 Megohm), supply current and an internal `_<ref>_record` voltage equal to input difference times `Gain`. Inspect that signal in the waveform data; it does not emulate a storage device or communications protocol. |
| State machine | Two state bits and two inputs. `Next0`/`Next1` are 16-bit next-state truth tables, indexed by `state0 + 2*state1 + 4*INPUT0 + 8*INPUT1`. Initial state is zero; RESET is active-high. Defaults retain state. Set 21845/26214 for an unconditional two-bit counter. |

### MCU, FPGA and PLC

`Truth0`…`Truth7` (PLC: Truth0/Truth1) are four-bit truth masks. Index `input0 + 2*input1` chooses the corresponding bit. Masks 10 and 12 respectively copy input0 and input1; mask 8 is AND, 14 is OR, 6 is XOR and 15 is constant high.

The MCU uses GPIO0/1 as inputs by default; the FPGA uses IO0/1, and the PLC uses IN0/1. `DirectionMask` enables output drivers: bit 0 controls the first output, etc. MCU/FPGA default 252 leaves the first two GPIOs as inputs; PLC default 3 enables both outputs. Disabled drivers have high input impedance. `OutputResistance` defaults to 50 ohms.

`Clocked=0` selects combinational behaviour on MCU/FPGA. Set it to 1 to latch the truth-table outputs on rising CLOCK edges. MCU RESET_N is active-low; FPGA RESET is active-high. On the MCU, `Input0FromADC`/`Input1FromADC` select thresholded AIN0/AIN1 instead of GPIO0/1, with configurable `ADCThreshold` (default 2.5 V). These parameters provide configurable lab behaviour without suggesting that a generic block implements a particular processor or FPGA device.

## Sensors and analogue models

| Type | Parameters / equivalent |
| --- | --- |
| Hall | `MagneticFlux` in tesla, `Sensitivity` in V/T, `ZeroFieldRatio`; default zero-field output is half the supply. |
| Light voltage sensor | `Illuminance`, `Responsivity` in V per declared illuminance unit and `DarkVoltage`. |
| Pressure voltage sensor | `Pressure` in kPa; output/supply = `OffsetRatio + Sensitivity*Pressure`. Defaults are illustrative. |
| Temperature voltage sensor | `Offset + Sensitivity*Temperature`; default 10 mV/°C and 25°C. |
| Powered sensors | Output is clipped to the supplied rails, with `OutputResistance` and `SupplyCurrent` fields. |
| Piezo | Current from the derivative of `ChargeSensitivity*Force`, in parallel with `Capacitance` and `LeakageResistance`. Constant force produces no sustained piezo signal. |
| pH | `Slope*(ReferencePH-PH)` with `SourceResistance`; defaults are 59.16 mV/pH, reference pH 7, and 100 Megohm source resistance. Meter loading matters. |
| Thermocouple | Linear Seebeck equivalent using `HotTemperature`, `ColdTemperature`, `Seebeck` and `SourceResistance`. |
| NTC | Beta-law `R25*exp(Beta*(1/T-1/298.15))`, with Temperature in °C. |
| LDR | Dark/minimum resistance and illuminance/scale parameters. |
| Moisture | Dry/wet resistance and a clipped 0–1 `Moisture` fraction. |
| Strain gauge / bridge | Nominal resistance, gauge factor and strain; four independently configurable bridge arm resistances. |
| Photodiode / solar cell | Diode plus light-dependent photocurrent and leakage. Illumination units follow the chosen responsivity calibration. |
| Switches | Finite on/off resistance and configurable `State` or differential control threshold/hysteresis. State 1 closes SPST; on SPDT it selects terminal 1–2, otherwise 1–3. |
| Relay | Coil R/L and voltage threshold controlling COM–NO/NC; pickup/release dynamics and mechanical bounce are omitted. |
| Seven-segment displays | Eight diode branches to a shared common anode/cathode. Use external current-limiting resistors. |
| Lamp | Cold resistance, positive temperature coefficient and a thermal R/C driven by electrical power. This gives heating, nonlinear resistance and thermal inertia, with illustrative calibration. |
| Speaker/buzzer | Electrical voice-coil R/L and parallel motional RLC equivalent. It loads the circuit and exposes electrical response; it does not produce audio or a calibrated sound-pressure signal. |
| 555 | Divider, threshold/trigger latch, reset and discharge switch. Simplified output rails and drive. |
| AM | `Gain*(CarrierBias + ModulationIndex*message)*carrier`. Default bias 1 retains the carrier; bias 0 gives suppressed-carrier multiplication. Differential carrier/message/output terminals remain separate. |

Values are intentionally editable; default sensor coefficients are illustrative rather than a claim of calibration to the manufacturer sources used for artwork research. Discrete devices and the original 741 retain the [SPICE essentials models and limitations](libraries.md#spice-essentials) where reused. Comparator, Darlington, JFET and SCR interfaces use separate generic equivalents.


## Implementation and verification

[scripts/lib/teaching-models.mjs](../scripts/lib/teaching-models.mjs) is the shared model source. Library provenance records artwork and model hashes. The generated `.tclib` entries carry the executable templates.

`npm run test:teaching` checks portable model contracts and native tool configurations. The `test:digital`, `test:functional` and `test:sensors` suites check the corresponding bundled libraries, including terminal mappings, rotations and persistence. Numerical checks use the bundled native manifest when available; `NGSPICE_BIN` can override the executable. Without either engine, numerical tests are skipped, so a passing run alone does not establish numerical coverage.

Numerical cases cover truth tables, carry/priority logic, counter/shift sequences, clock edges/reset, sensor transfer values, ADC/DAC conversion, switching and AM carrier bias. They establish the tested educational behaviour, rather than qualification of every parameter combination or vendor device. See [libraries and provenance](libraries.md) and the [engine reference](spice-engine.md).
