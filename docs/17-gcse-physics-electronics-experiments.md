# GCSE physics: electronics experiments supported by TinyCAD

Research checked: **10 November 2026**.

## Syllabus and scope

This catalogue maps to **AQA GCSE Physics 8463**, using the current online specification. No exam board was specified, so AQA is the reference syllabus; this is not a claim that practical numbers or requirements are identical for Edexcel, OCR, WJEC or other qualifications. Combined Science also has different practical numbering.

The official sources are [Electricity, section 4.2][electricity] and [Practical assessment, section 8][practicals]. The main compulsory circuit investigations are **Required Practical 3** (resistance) and **Required Practical 4** (component characteristics). The other entries below are proposed teaching experiments tied to syllabus content, not additional compulsory practicals.

Only circuits, electronic components and electrical measurements are included. Mechanical waves, magnetic-force apparatus, motors, generators, transformer construction, static-charge demonstrations and calorimetry are outside this catalogue.

## What the support labels mean

| Label | What TinyCAD can contribute |
| --- | --- |
| **Both** | Draw the experimental circuit and investigate an electrical model using existing DC, sweep or transient analysis. Components must still have valid SPICE mappings. |
| **Both, model needed** | Draw the experiment now; meaningful simulation needs a suitable device model or measured values supplied by the teacher. |
| **Diagram** | Draw and annotate the electrical arrangement. The important physical behaviour is not represented by the current circuit simulation. |

These are proposed uses based on the current application, rather than a collection of already-built lesson files. Suggested circuit choices and measurement plans are our own. A simulation can support prediction, preparation and comparison; it does not perform the hands-on measurements required by the syllabus. See [AQA's practical assessment requirements][practicals].

## Required circuit practicals

References in this table use [AQA practical assessment][practicals]; the corresponding subject-content reference is [4.2.1.3 or 4.2.1.4][electricity].

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested use and evidence |
| --- | --- | --- | --- | --- |
| G01 | Resistance of a wire as its length changes | RP3; 4.2.1.3 | Both, model needed | Draw the wire, test section, ammeter and voltmeter. Represent each chosen length by a resistance supplied from measurements or a declared wire model. Export V and I, calculate R, and plot R against length externally. Simulation cannot measure wire length or discover its material properties. |
| G02 | Equivalent resistance of series combinations | RP3; 4.2.1.3 | Both | Compare one, two and three resistors at a fixed supply. Record total current and calculate the equivalent resistance. Use separate saved circuits or a component-value study. |
| G03 | Equivalent resistance of parallel combinations | RP3; 4.2.1.3 | Both | Add branches and compare supply current with the individual branch currents. Show how adding a branch changes the effective load. Keep the numerical demand appropriate to GCSE; AQA does not require the parallel-resistance calculation itself. |
| G04 | I–V investigation: fixed resistor | RP4; 4.2.1.4 | Both | Draw the supply, current-limiting control, ammeter in series and voltmeter across the test resistor. Sweep supply voltage through positive and negative values. Export paired V/I readings for a characteristic graph and a resistance estimate. |
| G05 | I–V investigation: filament lamp | RP4; 4.2.1.4 | Both, model needed | Draw the same measurement circuit with a lamp. Compare measured data with an electrothermal or empirical lamp model. A fixed resistor with a lamp symbol will not reproduce the characteristic; a diagram and real laboratory measurements remain useful without that model. |
| G06 | I–V investigation: diode | RP4; 4.2.1.4 | Both | Use a diode model and series limiting resistor. Sweep the supply in both directions and measure voltage across the diode separately from supply voltage. Compare forward conduction and reverse current; use a graph scale that makes the intended feature visible. |

## Further syllabus-linked investigations

These activities develop the circuit content in [AQA Electricity][electricity]. They are teaching proposals rather than separately numbered AQA required practicals.

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested use and evidence |
| --- | --- | --- | --- | --- |
| G07 | Choosing and connecting electrical meters | 4.2.1.1, 4.2.1.3 | Both | Prepare a resistor test circuit with correctly positioned instruments. Compare a resistance inferred from V/I with a resistance-mode reading on an unpowered circuit. Practise V Ω–COM for voltage/resistance and A–COM for current. |
| G08 | Current at different positions in one loop | 4.2.1.2; 4.2.2 | Both | Put current probes before and after different components. Compare readings while changing supply voltage or resistance. Use a short transient capture to connect a steady current with charge transferred over a chosen time. |
| G09 | Voltage sharing in a series circuit | 4.2.2 | Both | Choose unequal resistors, measure each voltage and compare their sum with the supply. Swap the resistors and predict the new readings before running. |
| G10 | Branch current and voltage in parallel circuits | 4.2.2 | Both | Use two unequal branch resistors. Measure both branch voltages, both currents and the supply current. Repeat with one branch open. |
| G11 | Resistance of an NTC thermistor versus temperature | 4.2.1.4 | Both, model needed | Draw the measurement circuit and annotate the external temperature measurement. Enter measured R(T) values as separate runs, or supply a calibrated model. Plot resistance against temperature externally. A resistor-value sweep alone is not a temperature experiment. |
| G12 | Resistance of an LDR versus illumination | 4.2.1.4 | Both, model needed | Draw the LDR test circuit and label the controlled light conditions. Use measured resistance values for electrical predictions. TinyCAD does not model lamp distance, illumination or the LDR's optical response automatically. |
| G13 | Temperature-responsive sensor circuit | 4.2.1.4, thermistor applications | Both, model needed | Combine a thermistor-equivalent resistance with a fixed resistor and measure the output as the entered resistance changes. Compare the two sensor positions. This is a possible circuit for exploring the application; potential-divider calculations and a transistor/comparator switching stage are extensions, not additional GCSE requirements. |
| G14 | Light-responsive sensor circuit | 4.2.1.4, LDR applications | Both, model needed | Repeat the sensor exercise with light/dark resistance values. Define whether the output should rise or fall as illumination decreases. A complete automatic lamp switch needs an additional switching model; changing resistance alone does not implement a switching threshold. |
| G15 | Resistor power and electrical energy | 4.2.4.1–4.2.4.2 | Both | Measure current and voltage for several resistor/supply combinations. Compare calculated power with a power trace; use a transient capture or a timed steady reading to calculate energy. This predicts electrical dissipation, not temperature rise or visible brightness. |
| G16 | Direct versus alternating voltage | 4.2.3.1 | Both | Compare a DC source with a low-voltage sine source on the scope. Identify polarity changes and repeat at different frequencies. This is an electronic demonstration of the distinction; it does not require a mains-voltage experiment. |
| G17 | LED polarity and a suitable series resistor | 4.2.1.1, component symbols; 4.2.1.4, diode behaviour | Both, model needed | Use an LED-specific model to compare current for different series resistors and supply polarities. This is a syllabus-linked diode application, not a separately required LED practical. Electrical current can be predicted; brightness, colour and damage are not automatically simulated. |
| G18 | Physical layout versus circuit diagram | 4.2.1.1; AT7 | Diagram | Draw a clear schematic from a photograph or bench arrangement, label meter connections and mark intended measurement points. Students can use it to construct or check the real experiment even when the lamp or sensor has no simulation model. |

## Modelling and classroom preparation

For a lesson, provide a schematic with component values, measurement points and a prediction question. Save each circuit with a Simulation sheet and explicitly identify which results are simulated and which were collected using real apparatus.

Use the student supply and meters when instrument familiarity matters; use probes when comparing several readings at once. The current meter changes circuit loading, while the voltage meter also has finite input resistance. These effects can be made small for a GCSE exercise by choosing suitable values. Do not present instrument loading as a new compulsory GCSE topic.

For G04–G06, distinguish **component voltage** from **supply voltage** when plotting the characteristic. A DC sweep provides numerical samples; export the results if a particular I-against-V graph or regression is needed. A diagram symbol alone never establishes a valid electrical model.

The existing [voltage-divider example](../examples/simulation/voltage-divider.dzn) is a starting point for G09 and the electrical parts of G13–G14. The [virtual laboratory](../examples/simulation/virtual-laboratory.dzn) demonstrates instrument wiring and waveform capture for G07 and G16. Neither file is currently a complete RP3/RP4 lesson pack.

## Deliberate boundaries

There are no GCSE entries here for op-amp amplifiers, logic counters, RC time constants or communications modulation: those belong to advanced or optional work in the [A-level catalogue](18-a-level-physics-electronics-experiments.md). Diode rectification may be a useful extension, but this catalogue does not label it an AQA GCSE required experiment. Household earthing/fuse demonstrations and National Grid exercises have also been left out to keep the list focused on electronics rather than electrical installations and power systems.

[electricity]: https://www.aqa.org.uk/subjects/physics/gcse/physics-8463/specification/subject-content/electricity
[practicals]: https://www.aqa.org.uk/subjects/physics/gcse/physics-8463/specification/practical-assessment
