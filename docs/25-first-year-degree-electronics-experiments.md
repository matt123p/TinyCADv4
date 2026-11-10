# First-year electronics degrees: experiments supported by TinyCAD

Research checked: **10 November 2026**.

## Representative syllabuses

This is a proposed first-year electronics/electrical-and-electronic engineering catalogue, not a national syllabus or a list of experiments guaranteed at every institution. The primary sources are published university modules:

| Reference | Source and topic coverage |
| --- | --- |
| **E-CAD** | [Leeds ELEC1130 Circuit Analysis and Design, 2026/27][leeds]: circuit analysis, measurement/loading, semiconductors and amplifier design. |
| **E-CIR** | [Southampton ELEC1311 Circuits, 2026/27][circuits]: linear circuits, reactive response, phasors and time-domain analysis. |
| **E-DIG** | [Southampton ELEC1313 Digital Systems, 2026/27][digital]: combinational/sequential design, timing and programmable hardware. |
| **E-YEAR** | [Southampton Electronic Engineering degree, year-one module list][degree]: programme context. The public prospectus page currently describes 2027/28 entry; the technical module references above are the dated 2026/27 versions. |

These sources establish relevant subject areas. The circuit choices and experiment plans below are our proposals, not reproductions of departmental lab scripts. Detailed semiconductor fabrication, electromagnetics, software and non-electronic machinery are outside scope.

**Both** = schematic plus electrical simulation; **Both, model needed** = compatible device/subcircuit models must be supplied; **Diagram** = useful circuit/interface documentation without simulating the central process. A supplied model must be checked against the chosen backend and measurement goal.

## Passive circuits and measurement

| ID | Experiment and syllabus reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| E01 | Nodal and mesh analysis; E-CAD, E-CIR | Both | Solve the same network by two analytical methods and compare each node/current with the numerical solution. Use signed reference arrows. |
| E02 | Source superposition; E-CAD, E-CIR | Both | Run separate single-source conditions and the full circuit. Compare voltages/currents, and explain why powers cannot simply be superposed. |
| E03 | Thevenin/Norton models; E-CAD | Both | Derive a port equivalent and compare original/equivalent circuits across a load sweep. Record port definitions and reference direction. |
| E04 | Sources, loads and power; E-CAD | Both | Vary a finite load against explicit source resistance. Compare delivered power and internal dissipation without assuming that maximum power means maximum efficiency. |
| E05 | Meter loading and generator impedance; E-CAD | Both | Compare theoretical unloaded values with the actual virtual instruments attached. Include function-generator output resistance and meter burden/input resistance. |
| E06 | RC/RL complete step response; E-CIR | Both | Compare initial condition, forced response and final state. Choose capture duration and step from the fastest/slowest relevant time constants. |
| E07 | Impedance and phase; E-CAD, E-CIR | Both | Sweep frequency and calculate complex impedance from voltage/current results. Compare magnitude and phase with the analytical prediction. |
| E08 | Resonant network; E-CIR | Both | Use a declared RLC topology and vary damping. Compare frequency response with its transient ringing and measure the relevant bandwidth. |
| E09 | Passive filters; E-CAD, E-CIR | Both | Compare low/high-pass response using AC analysis, then apply pulses in transient analysis. Explain the effect of loading on the nominal cutoff. |
| E10 | Energy storage and loss; E-CAD | Both | Integrate current or component power over a stated interval. Check the energy balance for a capacitor or inductor network against analytical calculations. |

## Devices and analogue circuits

| ID | Experiment and syllabus reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| E11 | Diode characteristic and operating point; E-CAD | Both | Compare a chosen SPICE diode with an ideal/piecewise analytical approximation. Examine where the approximation produces an unacceptable error. |
| E12 | Rectification and smoothing; E-CAD | Both | Compare half/full-wave circuits and load-dependent ripple with a low-voltage sine source. Include real diode models and use transient analysis. |
| E13 | Transistor bias and load line; E-CAD | Both, model needed | Predict DC operating point, run the model and repeat for component tolerances. Export device readings for a load-line comparison. |
| E14 | BJT amplifier gain and resistance; E-CAD | Both, model needed | Measure small-signal gain and infer input/output resistance using controlled source/load changes. Compare with a small-signal equivalent. |
| E15 | FET characteristics and switching; E-CAD | Both, model needed | Compare selected gate/drain conditions with a device model. Investigate gate-drive and load effects rather than assuming every FET is an ideal switch. |
| E16 | Op-amp feedback stages; E-CAD | Both, model needed | Compare inverting and non-inverting gain, input loading and output range. Distinguish an ideal analytical block from a model with rails and frequency limits. |
| E17 | Active filter; E-CAD | Both, model needed | Measure a prepared op-amp filter's gain/phase and pulse response. Compare component changes with the predicted poles/cutoff using an appropriate amplifier model. |

## Digital design and interfaces

| ID | Experiment and syllabus reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| E18 | Logic functions and minimisation; E-DIG | Both, model needed | Test a truth table against two alternative gate implementations. Do the Boolean/Karnaugh-map reasoning separately and compare all input combinations. |
| E19 | Multiplexer, decoder and encoder; E-DIG | Both, model needed | Use compatible component models or a gate-level circuit. Capture outputs while enumerating data/select inputs. |
| E20 | Latch versus edge-triggered flip-flop; E-DIG | Both, model needed | Apply a defined clock/data sequence and compare stored state. State timing assumptions; ideal models do not establish real setup/hold limits. |
| E21 | Counter and shift register; E-DIG | Both, model needed | Verify reset and output sequences and compare synchronous/asynchronous operation where delay models permit. |
| E22 | Logic-family loading and propagation; E-DIG | Both, model needed | Vary capacitance/fan-out within a valid device model. Measure edge and propagation timing. A zero-delay Boolean model is insufficient. |
| E23 | Adder and overflow indication; E-DIG | Both, model needed | Implement a small gate-level arithmetic example and enumerate operand combinations. Explain signed/unsigned interpretation outside the circuit. |
| E24 | State-machine I/O plan; E-DIG | Diagram | Draw the input/output, clock/reset and state-register interfaces for a small controller. A separate HDL tool is needed to implement, synthesise and verify SystemVerilog. |
| E25 | FPGA/microcontroller interface schematic; E-DIG | Diagram | Record supplies, connectors, pull resistors and external driver stages. TinyCAD does not program an FPGA, execute firmware or replace the course's digital development environment. |
| E26 | Integrated design/test exercise; E-CAD, E-YEAR | Both, model needed | Combine a defined input, conditioner and output stage. Save analytical targets, model identities, captures, loading assumptions and a plan for bench comparison. The project brief is our proposal, not an institution-prescribed assignment. |

## Selecting the right tool and evidence

TinyCAD is suitable for schematic capture and electrical models with valid SPICE data. It is not a substitute for PCB layout/fabrication, a device programmer, HDL synthesis or physical laboratory assessment. For mixed-signal logic models, check native XSPICE support and browser limitations before selecting a lesson.

Use DC operating point before small-signal AC analysis of biased devices. Use transient analysis for clipping, switching and rectification. Keep real measurements and simulations labelled separately and export for custom plots, regressions or truth-table reporting. The scope records simulated data, not hardware input.

For practical software details see [implementation status](10-implementation-status.md), [Circuit Explorer](15-circuit-explorer.md) and [laboratory instruments](16-virtual-laboratory-and-p1-analysis.md). The existing example drawings are starting circuits, not a completed first-year laboratory course.

[leeds]: https://catalogue.leeds.ac.uk/Module/UG/ELEC/1130/202627
[circuits]: https://www.southampton.ac.uk/courses/modules/elec1311
[digital]: https://www.southampton.ac.uk/courses/2026-27/modules/elec1313
[degree]: https://www.southampton.ac.uk/courses/electronic-engineering-degree-beng
