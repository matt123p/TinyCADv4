# BTEC First Certificate in Engineering: electronics experiments

Research checked: **10 November 2026**.

## Course and source mapping

This document covers the **Pearson BTEC Level 1/Level 2 First Certificate in Engineering**, qualification **600/6628/3**, in the 2012 suite. The detailed reference is **Unit 8: Electronic Circuit Design and Construction**, learning aims A–D. This is a selected electronics unit, not a claim that every Engineering learner takes it. The same unit also appears in larger awards in the suite.

Sources: [Pearson qualification page][course] and [specification, Issue 7, August 2020, Unit 8, printed pp. 119–129][unit]. The filename still contains an older issue number; the document's internal issue is the reference used here. The qualification page lists registration and certification dates by nation; an old first-teaching year does not itself mean a course has ended.

The experiments below are our proposed teaching activities mapped to the published topics. They are not Pearson assignment briefs or a guarantee that completing them meets assessment criteria. **Both** means schematic drawing plus electrical simulation; **Both, model needed** requires a compatible device model or measured sensor data; **Diagram** means useful documentation without a complete simulation of the central behaviour.

## Experiment catalogue

All topic references below are to [Unit 8][unit].

| ID | Experiment and reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| F01 | Resistor combinations; A4–A5 | Both | Compare series and parallel loads, predict supply current, and verify voltage sharing. Save a calculation alongside the circuit and numerical readings. |
| F02 | Adjustable sensor input; A1, A4 | Both, model needed | Use a fixed resistor and variable sensor-equivalent resistance. Compare divider output over measured light or temperature conditions. The entered resistance is an assumption, not an optical or thermal simulation. |
| F03 | Push-button input and pull resistor; A1, B1 | Both, model needed | Draw push-to-make and push-to-break arrangements. Use an explicit switch model or separate open/closed circuits to test the resulting input voltage. |
| F04 | LED output and current limiting; A3–A5 | Both, model needed | Compare several limiting resistors and supplies using an LED model. Record current and resistor power; do not equate simulated current with measured brightness. |
| F05 | BJT switching stage; A2, B1 | Both, model needed | Sweep the input to an NPN or PNP stage driving an electrical load. Compare input, output and device currents. Supply the correct model and pin mapping. |
| F06 | Darlington input stage; A2 | Both, model needed | Compare a single transistor with a pair for the same load. Investigate the input drive needed to reach a stated output condition. |
| F07 | FET switching stage; A2 | Both, model needed | Apply a gate-voltage sweep or pulse. Compare off/on output and load current using a chosen FET model. |
| F08 | Thyristor latch; A2 | Both, model needed | Apply a gate pulse and observe whether conduction persists after it ends. Model interruption of load current to reset the device. A transistor model is not an SCR substitute. |
| F09 | Threshold alarm; A1–A3, B1 | Both, model needed | Combine a sensor-equivalent input, comparator/transistor and LED load. Set a target threshold and compare predicted switching with measured sensor values. This is one possible implementation of the unit's design work. |
| F10 | RC timing stage; A4–A5 | Both | Capture capacitor voltage after a source step. Change R and C separately and compare the measured delay to a chosen threshold. |
| F11 | Timer in monostable mode; A2, B1 | Both, model needed | Use a compatible timer model, trigger once and measure pulse duration. Change the timing components. A predefined pulse source cannot demonstrate the timer's timing law. |
| F12 | Timer in astable mode; A2, B1 | Both, model needed | Capture a timer's output and compare frequency/duty cycle for different component values. A flashing LED's electrical drive can be tested without modelling visual flashing. |
| F13 | Inductive-output protection; A4 | Both, model needed | Represent a relay coil by an explicit electrical model and compare switch-node voltage with and without a protection diode. Mechanical operation is outside the model. |
| F14 | Power-source suitability; A5 | Both, model needed | Compare the same circuit with an ideal source and a source having stated internal resistance. Battery chemistry and solar illumination need separate models or measurements. |
| F15 | PIC-based counter and display connections; A2–A3, B1 | Diagram | Document input switch, controller pins, supplies and display connections. Firmware execution, flowchart programming and seven-segment decoding are not ready-made TinyCAD workflows. Electrical interface stages can be tested separately. |
| F16 | Test-point and fault-diagnosis exercise; D1 | Both | Prepare a correct circuit and separate manually edited open/short/wrong-value versions. Predict diagnostic voltage/current readings. Record a test sequence for checking the physical build; this does not rely on an automatic fault-injection feature. |
| F17 | Construction and soldering preparation; B2, C1–C2 | Diagram | Produce a labelled schematic, polarity notes and a connectivity checklist for the physical assembly. TinyCAD does not turn the schematic into a breadboard photograph, demonstrate soldering competence or inspect joints. |

## Preparing a usable lesson

Provide the problem, a partially completed diagram, declared models, test points and a table comparing prediction, simulation and physical measurement. Retain screenshots and exported numerical data as supplementary evidence; the assessor still needs the physical construction and practical evidence specified for the unit.

Use **V Ω–COM** for voltage/resistance and **A–COM** for current. Resistance checks use an unpowered circuit. Lamp, buzzer, loudspeaker and relay symbols need suitable electrical models; sound, light, motion and construction quality are not inferred from the symbol.

For digital or timer models, check backend compatibility. Native Electron supports bundled XSPICE models; browser support differs. See [implementation status](10-implementation-status.md) and [laboratory instruments](16-virtual-laboratory-and-p1-analysis.md). The existing [virtual laboratory](../examples/simulation/virtual-laboratory.dzn) is an instrument example, not a finished Unit 8 assignment.

[course]: https://qualifications.pearson.com/en/qualifications/btec-firsts/engineering-2012-nqf.html
[unit]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Firsts/Engineering/2012/Specification-and-sample-assessments/BTECFIRST_CECD_ENG_SPEC_ISS4.pdf#page=131
