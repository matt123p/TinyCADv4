# BTEC National Extended Diploma in Electrical and Electronic Engineering: experiments

Research checked: **10 November 2026**.

## Course and source mapping

Reference course: **Pearson BTEC Level 3 National Extended Diploma in Electrical and Electronic Engineering**, 2016 suite, qualification **601/7587/4**. The electronics mapping here is to **Unit 19: Electronic Devices and Circuits**, learning aims A–C. Check the centre's programme and assignment brief before selecting activities; this is not a full mapping of every engineering unit or every qualification size.

Sources: [Pearson course/qualification page][course] and [Extended Diploma specification, Issue 10, June 2026, Unit 19, printed pp. 239–247][unit]. The PDF covers the Engineering Extended Diploma family, including the named electrical/electronic route. Do not use this unit number for the different BTEC First or Higher National specifications.

These are proposed investigations, not Pearson-authored assignments. **Both** means drawing and electrical simulation; **Both, model needed** requires compatible device/subcircuit models; **Diagram** denotes useful circuit documentation without a complete model of the central activity. Physical construction, testing and reflection remain separate evidence.

## Experiment catalogue

The references below are to [Unit 19][unit].

| ID | Experiment and reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| N01 | Diode characteristic; A2 | Both | Use a limited DC sweep and collect component V/I. Compare selected signal and rectifier diode models, including the effect of the external resistor. |
| N02 | Half-wave rectification; A2 | Both | Capture a low-voltage sine input and resistive-load output. Compare polarity, conduction intervals and mean output. |
| N03 | Full-wave rectification; A2 | Both | Draw a bridge and identify which diodes conduct in each half-cycle. Compare output ripple frequency with the half-wave version. |
| N04 | Smoothing and load regulation; A2 | Both | Add a reservoir capacitor, change the load and capture ripple and mean voltage. Use transient analysis rather than a small-signal AC sweep to model rectifier conduction. |
| N05 | Zener reference/regulation; A2 | Both, model needed | Use a breakdown-capable model and a limiting resistor. Vary input and load, then compare output voltage, device current and power. |
| N06 | LED indicator design; A2 | Both, model needed | Select resistor values against a stated current target. Compare nominal and tolerance cases using the selected LED model. Brightness and damage require further modelling or measurement. |
| N07 | BJT switching; A3 | Both, model needed | Compare input drive, base current, collector current and output voltage through the switching range. Check a real model rather than imposing an unlimited current-gain assumption. |
| N08 | FET switching; A3 | Both, model needed | Compare electrical load response to gate pulses and input-voltage changes. Use the appropriate N/P-channel model and connections. |
| N09 | Transistor bias and operating point; A3 | Both, model needed | Adjust a bias network and inspect DC voltages/currents. Compare predicted and measured quiescent conditions before applying a signal. |
| N10 | Single-stage transistor amplifier; A3 | Both, model needed | Compare input/output amplitude and phase, then sweep frequency at a fixed bias. Obtain gain and bandwidth and repeat for a changed load. |
| N11 | Comparator threshold; A4 | Both, model needed | Sweep one input across a reference and capture output switching. Include supply limits and a suitable comparator/op-amp model. |
| N12 | Inverting amplifier; A4 | Both, model needed | Change feedback ratio, compare signed gain and inspect clipping with an adequately realistic model. |
| N13 | Non-inverting amplifier; A4 | Both, model needed | Repeat at several gains and compare input loading, output amplitude and operating range. |
| N14 | Amplifier/filter frequency response; A4–A6 | Both, model needed | Supply a model with frequency dependence. Compare cutoff and gain–bandwidth behaviour; use a declared active filter topology if investigating its component sensitivity. |
| N15 | Gate truth tables; B1 | Both, model needed | Test all input combinations of the specified basic gates. State logic levels, supply and the selected device family. |
| N16 | TTL/CMOS interface and timing; B1 | Both, model needed | Compare loaded output and input thresholds using compatible models. Capture propagation delay only if the models represent it. Ideal Boolean behaviour cannot establish real-family specifications. |
| N17 | Minimise and verify combinational logic; B2 | Both, model needed | Prepare alternative implementations of a function and compare their complete truth tables. Karnaugh-map reasoning remains in the student's analysis, not an automatic TinyCAD tool. |
| N18 | Latches and flip-flops; B3 | Both, model needed | Apply defined clock/data/reset sequences to prepared R-S, D or JK models. Capture state changes and distinguish asynchronous inputs from clocked inputs. |
| N19 | Counters and shift register; B3 | Both, model needed | Compare three-stage counter or register sequences. Test reset and observe ripple delays where the model supports them. |
| N20 | Simulation-to-bench comparison; A5–A6, B4–B5, C | Both | Produce diagrams, saved settings, labelled results and a comparison table. Diagnose differences using measured components and instrument loading, then record the resulting design changes and personal reflection. |
| N21 | Physical build/test preparation; A1, A6, B5 | Diagram | Annotate supplies, polarity, pin names and test points. The schematic supports construction and measurement; it does not prove safe soldering, assembly quality or the learner's practical performance. |

## Delivery and modelling limits

Unit 19 is a particularly close match to schematic capture, simulation and bench comparison. Nevertheless, a library symbol alone is not a working SPICE component. Supply identified semiconductor, op-amp and logic models and verify their pin mappings before assigning a circuit.

Native Electron supports bundled XSPICE code models; a digital example using them may not run in the browser. TinyCAD does not replace an HDL simulator or device programmer. Use numeric captures/CSV for the comparisons and external tools where a particular truth-table report or regression is required.

Retain theoretical, simulated and physical results separately. Evidence and grading must follow the official unit and centre assignment, not the row count in this catalogue. See [implementation status](10-implementation-status.md) and [laboratory instruments](16-virtual-laboratory-and-p1-analysis.md).

[course]: https://qualifications.pearson.com/en/qualifications/btec-nationals/engineering-2016.html
[unit]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Nationals/Engineering/2016/specification-and-sample-assessments/spec-btec-nat-eng-extdip.pdf#page=249
