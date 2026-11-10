# BTEC HNC Electrical and Electronic Engineering for England: electronics experiments

Research checked: **10 November 2026**.

## Course and source mapping

Course: **Pearson BTEC Level 4 Higher National Certificate in Electrical and Electronic Engineering for England (2024)**, qualification **610/1220/8**. This is the HNC, not a catalogue of Level 5 HND options.

Sources: [qualification page][course], [programme specification, Issue 2, June 2026, section 6.2.1, printed p. 27][programme], and [Engineering Suite unit descriptors, Issue 6, October 2025, Unit 4019, printed pp. 144–151][units]. The programme structure names **4019: Electrical and Electronic Principles** as a mandatory specialist unit. The unit bank also contains many other units that are not automatically part of this particular HNC: do not import the old 2017 Unit 19/20/22 structure or assume 4020/4022 are mandatory here.

The proposals below map primarily to **4019 LO1–LO4**. Design/test documentation can additionally support the selected project context, but does not itself fulfil all requirements of the course's other units. **Both** means drawing plus electrical simulation; **Both, model needed** requires a supplied compatible device/equivalent model; **Diagram** means documentation rather than complete simulation.

## Experiment catalogue

The LO references below are to [Unit 4019][units]. Mechanical machines, installation testing and power-system design are excluded from this electronics-only catalogue.

| ID | Experiment and reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| H01 | Nodal and loop checks; LO1 | Both | Choose a multi-branch DC network, predict node potentials and signed currents, then compare simulation residuals with hand calculations. |
| H02 | Source superposition; LO1 | Both | Solve a two-source circuit with each independent source deactivated in turn. Compare the sum of voltage/current contributions with the complete circuit. Do not sum power contributions as though power were linear. |
| H03 | Thevenin and Norton equivalents; LO1 | Both | Obtain an equivalent at a selected port, then compare original and equivalent circuits under several finite loads. Avoid using a physical short as a measurement method. |
| H04 | Maximum power transfer; LO1 | Both | Vary a resistor load against a source with explicit resistance. Compare load power and efficiency; maximum delivered power is not maximum efficiency. |
| H05 | Dividers and measurement loading; LO1 | Both | Compare loaded/unloaded divider outputs and introduce finite meter input resistance. Quantify the measurement's influence. |
| H06 | Sinusoidal measurements; LO2 | Both | Compare peak, RMS, frequency and phase using complete captured cycles. State whether an offset is included in the chosen RMS quantity. |
| H07 | RC and RL impedance; LO2 | Both | Sweep frequency and compare the magnitude/phase of voltage and current with calculated impedances. Include source resistance and coil resistance where appropriate. |
| H08 | First-order transient response; LO2 | Both | Capture RC and RL responses to a step. Change one component at a time and compare fitted time constants with the declared circuit. |
| H09 | RLC resonance and damping; LO2 | Both | Compare time-domain decay with frequency response for different resistances. Measure resonance, bandwidth and Q using a stated criterion. |
| H10 | Passive filter response; LO2 | Both | Compare RC low-pass/high-pass networks with the same source and load. Relate AC response to pulse-shape changes from transient runs. |
| H11 | Power factor in a small RLC load; LO2 | Both | Compare average instantaneous power with apparent power calculated from RMS readings. Export values for complex-power calculations if required. |
| H12 | Half/full-wave rectification and smoothing; LO2–LO3 | Both | Use low-voltage sources and explicit diode mappings. Vary load/capacitance and compare ripple and mean output. Treat transformer input as a declared source unless a suitable coupled model is supplied. |
| H13 | Diode and Zener behaviour; LO3 | Both, model needed | Sweep current-limited circuits and compare operating voltage and dissipation. A Zener model must include the intended breakdown characteristic. |
| H14 | LED operating conditions; LO3 | Both, model needed | Evaluate limiting resistors for several supplies using an identified LED model. Predict electrical current, not luminous intensity. |
| H15 | BJT switch and amplifier; LO3 | Both, model needed | Compare switching and small-signal operation of a chosen transistor. Record DC bias before measuring gain and output range. |
| H16 | JFET/MOSFET comparison; LO3 | Both, model needed | Compare gate-controlled current using appropriate models and separately stated operating conditions. Do not infer an interchangeable pinout or threshold. |
| H17 | Amplifier source/load interaction; LO4 | Both, model needed | Vary source and load resistances around a prepared amplifier model. Measure gain and bandwidth under each condition. |
| H18 | Introductory op-amp feedback circuit; LO4 | Both, model needed | Choose a simple inverting/non-inverting stage and compare predicted gain with captures. Supply rail limits and a model adequate to the measurement. |
| H19 | Voltage logic and simple gate networks; LO4 | Both, model needed | Verify small combinational functions and state the logic-level conventions. Use appropriate gate models; neither firmware nor HDL execution is implied. |
| H20 | Signal-chain and test-plan drawing; LO4; project application | Diagram | Draw a sensor-equivalent source, conditioner and receiving stage, with test points and loading assumptions. The physical sensor and any PLC program remain outside the simulation. |

## What a course file should contain

Use one declared circuit model, the analytical prediction, the actual simulated result and a plan for physical comparison. Keep an audit of component models and test conditions. A simulation supports investigation but is not evidence that an actual circuit was assembled or an instrument operated competently.

The HNC also includes non-electronic and manufacturing content. This document deliberately does not imply that TinyCAD provides PLC programming, machine/mechanical simulation, manufacturing-process control or compliance testing. Where a project includes these, it can document and test an electronic interface only.

For software capabilities and backend differences see [implementation status](10-implementation-status.md). For recorded scope/meter operation see [the laboratory guide](16-virtual-laboratory-and-p1-analysis.md). Proposed circuits requiring models are not already packaged examples.

[course]: https://qualifications.pearson.com/en/qualifications/btec-higher-nationals/electrical-electronic-engineering-for-england-2024.html
[programme]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Higher-Nationals/electrical-electronic-engineering-for-england/2024/specification/9781292448480-btec-hn-l4-l5-electric-electron-engin-engl.pdf#page=35
[units]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Higher-Nationals/engineering-for-england/2024/unitdescriptors/btec-hncd-unit-descriptor-engineering-suite-2024.pdf#page=160
