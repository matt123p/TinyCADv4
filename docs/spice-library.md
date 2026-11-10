# SPICE essentials

Select **SPICE essentials** from the library selector on the **Standard Libraries** tab. The bundle is read-only and loads when selected, in both browser and desktop builds. Its symbols are shown as a flat list.

Use **Simulation → Components** for quick access to a resistor, capacitor, inductor, diode, red LED, NPN/PNP transistors, and a 741 op-amp. These shortcuts select and load the standard SPICE library and attach its symbol to the cursor. Click on the schematic to place it; right-click cancels. **More…** selects SPICE essentials, opens the left-hand Standard Libraries panel, and clears its search so you can browse the full library.

The physical component drawings come from **onetransistor** in the legacy SQL collection. Existing SPICE templates, sources, and definition symbols come from **aryajur**. [The recipe](../library-recipes/spice.json) describes every selection and adaptation. [The provenance report](../bundled-libraries/spice/spice.provenance.json) records original component IDs, attribution, and drawing hashes. [The extraction guide](library-from-sql.md) explains how to build other bundles.

## Contents

| Category | Symbols and defaults |
| --- | --- |
| Passive / Resistors | Resistor 1k; potentiometer and trimmer resistor 10k, wiper 0.5 (adjustable from 0 to 1). |
| Passive / Capacitors | Capacitor 100n; electrolytic 10u; trimmer capacitor 20p. |
| Passive / Inductors | Inductor and core inductor, 1m H. |
| Passive / Magnetics | Four-terminal coupled-inductor transformer, 10m H per winding, coupling 0.999. |
| Passive / Resonators | Quartz crystal 8 MHz; ceramic resonator 4 MHz. |
| Semiconductors / Transistors | NPN, PNP, enhancement NMOS, and enhancement PMOS. |
| Semiconductors / Diodes | Diode and nominal 5.1 V zener. |
| Semiconductors / LEDs | Red, green, blue, and yellow LEDs, with matching drawing colours. |
| Integrated circuits | 741 op-amp, five functional terminals. |
| SPICE sources | Independent DC / AC voltage and current sources, initially 5 V and 1 mA. |
| SPICE definitions | End, operating point, DC sweep, and transient analysis. |
| SPICE definitions | Comment, parameter list, diode model, subcircuit definition, and arbitrary model/directive text. |

There are 36 entries, including US zigzag versions of the fixed resistor, potentiometer and trimmer resistor. The original unqualified names retain the European rectangular body. Both styles use the same 2 × 5.2 mm body envelope, 1.4 mm end leads, terminal positions and SPICE attributes. The blue/yellow LEDs, PMOS, and quartz crystal are explicit adaptations of the source drawings because separate suitable originals were absent. Potentiometer wipers, transformer secondary terminals, and 741 pins had duplicated source numbering; the recipe repairs them without moving their connection points. The transformer center tap is removed to make a four-terminal component. Its two windings and polarity dots are mirrored to match the default 1:1 model. Electrolytic plates and diode bodies are centered between their terminals with matching lead contacts.

All connection points use the standard 1 mm grid. The resistor body is centered on its terminal axis, with equal top/bottom leads; directional features such as transistor arrows, LED emission arrows, and polarity marks retain their intended asymmetry. Placement snaps the insertion anchor after centering so odd-sized outlines cannot shift terminals half a grid step. Regression checks cover the original drawing coordinates and actual placement in all rotated and mirrored orientations.

## Using the models

Place components, set their `Value` or model fields, wire the circuit, and provide a ground. Add the desired analysis symbol and generate a SPICE netlist. Hidden `$$SPICE` attributes travel with placed symbols and saved drawings. Definition-only symbols emit a comment in the component section and their configured text in the prolog or epilog.

Use SPICE units: `1k`, `10u`, `100n`, and `1Meg`. In SPICE, `m` means milli; use `Meg` for mega. Capacitor `Initial Voltage` is an optional initial-condition field inherited from the source template; defaults are zero. Sources have optional AC magnitude/phase fields.

Transistor, diode, and LED `Model` / `Model Name` fields select a model. Leaving `Model File` empty emits the bundled generic model. To use an external model, set its model name and file path; the netlist emits `.include "path"` instead of the generic definition. The simulator must be able to resolve that path. A **SPICE model / directive** symbol can instead embed a custom multiline `.model` or `.subckt` definition. For the 741, set `Model` and use that directive symbol to emit a custom definition or `.include`. Match the device type and terminal order when substituting a model.

Definition controls retain the existing collection's conventions, with corrections for this exporter: parameter definitions precede models, model definitions go in the prolog, and subcircuit endings precede the final `.END`. The subcircuit control supports up to nine named formal terminals. It emits a definition boundary, so place the intended contents and analysis directives with care when using it to author a whole subcircuit. Multiline text is retained without the source database's 255-character attribute limit.

## Terminal mapping and approximations

| Component | Terminal mapping / model |
| --- | --- |
| BJT | Drawing pins 1 base, 2 emitter, 3 collector; emitted in SPICE collector/base/emitter order. |
| MOSFET | Drawing pins 2 gate, 3 drain, 4 source. Emits four SPICE nodes, with bulk tied to source. PMOS arrow is reversed. |
| Diode, zener, LED | Pin 1 anode, pin 2 cathode. |
| 741 | Pin 3 IN+, 2 IN−, 7 positive supply, 4 negative supply, 6 output. Offset-null pins are not represented. |
| Potentiometer | Ends 1/2; wiper 3. Two resistors divide the total value, with a 1 micro-ohm lower bound at either end. |
| Transformer | Primary 1/2, secondary 3/4. Ideal magnetic coupling between two inductors; no saturation or winding resistance. |
| Resonators | Two-terminal motional series RLC branch in parallel with shunt capacitance. Motional inductance derives from the configured series frequency and capacitance. |

The diode, BJT, MOSFET, LED, and resonator models are generic teaching approximations. LED colour changes drawing colour and model parameters; it does not imply a calibrated brightness or manufacturer forward-voltage curve. Electrolytic polarity is shown graphically; its ideal capacitor model does not enforce polarity. The core-inductor drawing uses an ideal linear inductor model.

The 741 uses an original behavioral subcircuit with approximate 200,000 open-loop DC gain, 2 Megohm differential input resistance, a 5 Hz dominant pole, 0.5 V/µs slew limit, 75 ohm output resistance, and rail clipping with 2 V headroom. It is intended for basic demonstrations at typical dual supplies. It does not model input bias/offset, valid common-mode range, temperature, noise, short-circuit current, or all real-device stability effects. Use a manufacturer model for circuit qualification.

Syntax and terminal order follow the [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf). The 741 pin assignment and selected typical characteristics were checked against the [TI UA741 data sheet](https://www.ti.com/lit/ds/symlink/ua741.pdf). These references do not constitute validation of the supplied generic models.
