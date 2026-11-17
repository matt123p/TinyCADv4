# Teaching experiment catalogue

These are syllabus-linked activity ideas and source context retained for future lesson/content work. They are not completed lesson packs, official assessment briefs or evidence of physical practical competence. Source research dates are 9–10 November 2026; qualification/module availability must be checked when preparing a course.

**Both** means drawing plus electrical simulation; **Both, model needed** requires a suitable declared model or measured equivalent; **Diagram** documents a circuit/interface without fully simulating its central process. The [teaching models](teaching-simulation-models.md) now supply generic educational equivalents for the course inventory. The original model-needed labels still identify activities whose results depend on a suitable model and calibration. Firmware, HDL, light, sound, motion and hardware acquisition are not inferred from artwork.

Provide a prediction, declared models/conditions, simulated results and a separate bench comparison. Use V Ω–COM for voltage/resistance and A–COM for current; resistance tests require an unpowered supported network. Distinguish tolerance assumptions from measurement uncertainty.

Stable experiment IDs link to the [symbol coverage manifest](symbol-libraries/library-manifest.json). These are coverage lists rather than minimal circuit bills of materials. The [simulation examples](../examples/simulation/README.md) are starting circuits and instrument demonstrations.

## gcse-physics-aqa

**GCSE Physics — AQA 8463**

### Syllabus and scope

This catalogue maps to **AQA GCSE Physics 8463**, using the current online specification. Practical numbers and requirements differ for Edexcel, OCR, WJEC and other qualifications. Combined Science also has different practical numbering.

The official sources are [Electricity, section 4.2][gcse-physics-aqa-electricity] and [Practical assessment, section 8][gcse-physics-aqa-practicals]. The main compulsory circuit investigations are **Required Practical 3** (resistance) and **Required Practical 4** (component characteristics). The other entries below are proposed teaching experiments tied to syllabus content, not additional compulsory practicals.

Only circuits, electronic components and electrical measurements are included. Mechanical waves, magnetic-force apparatus, motors, generators, transformer construction, static-charge demonstrations and calorimetry are outside this catalogue.

### What the support labels mean

| Label | What TinyCAD can contribute |
| --- | --- |
| **Both** | Draw the experimental circuit and investigate an electrical model using existing DC, sweep or transient analysis. Components must still have valid SPICE mappings. |
| **Both, model needed** | Draw the experiment now; meaningful simulation needs a suitable device model or measured values supplied by the teacher. |
| **Diagram** | Draw and annotate the electrical arrangement. The important physical behaviour is not represented by the current circuit simulation. |

These are proposed uses based on the current application, rather than a collection of already-built lesson files. Suggested circuit choices and measurement plans are our own. A simulation can support prediction, preparation and comparison; it does not perform the hands-on measurements required by the syllabus. See [AQA's practical assessment requirements][gcse-physics-aqa-practicals].

### Required circuit practicals

References in this table use [AQA practical assessment][gcse-physics-aqa-practicals]; the corresponding subject-content reference is [4.2.1.3 or 4.2.1.4][gcse-physics-aqa-electricity].

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested use and evidence |
| --- | --- | --- | --- | --- |
| G01 | Resistance of a wire as its length changes | RP3; 4.2.1.3 | Both, model needed | Draw the wire, test section, ammeter and voltmeter. Represent each chosen length by a resistance supplied from measurements or a declared wire model. Export V and I, calculate R, and plot R against length externally. Simulation cannot measure wire length or discover its material properties. |
| G02 | Equivalent resistance of series combinations | RP3; 4.2.1.3 | Both | Compare one, two and three resistors at a fixed supply. Record total current and calculate the equivalent resistance. Use separate saved circuits or a component-value study. |
| G03 | Equivalent resistance of parallel combinations | RP3; 4.2.1.3 | Both | Add branches and compare supply current with the individual branch currents. Show how adding a branch changes the effective load. Keep the numerical demand appropriate to GCSE; AQA does not require the parallel-resistance calculation itself. |
| G04 | I–V investigation: fixed resistor | RP4; 4.2.1.4 | Both | Draw the supply, current-limiting control, ammeter in series and voltmeter across the test resistor. Sweep supply voltage through positive and negative values. Export paired V/I readings for a characteristic graph and a resistance estimate. |
| G05 | I–V investigation: filament lamp | RP4; 4.2.1.4 | Both, model needed | Draw the same measurement circuit with a lamp. Compare measured data with an electrothermal or empirical lamp model. A fixed resistor with a lamp symbol will not reproduce the characteristic; a diagram and real laboratory measurements remain useful without that model. |
| G06 | I–V investigation: diode | RP4; 4.2.1.4 | Both | Use a diode model and series limiting resistor. Sweep the supply in both directions and measure voltage across the diode separately from supply voltage. Compare forward conduction and reverse current; use a graph scale that makes the intended feature visible. |

### Further syllabus-linked investigations

These activities develop the circuit content in [AQA Electricity][gcse-physics-aqa-electricity]. They are teaching proposals rather than separately numbered AQA required practicals.

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

### Sources

[gcse-physics-aqa-electricity]: https://www.aqa.org.uk/subjects/physics/gcse/physics-8463/specification/subject-content/electricity
[gcse-physics-aqa-practicals]: https://www.aqa.org.uk/subjects/physics/gcse/physics-8463/specification/practical-assessment

## a-level-physics-aqa

**A-level Physics — AQA 7408, including optional Electronics**

### Syllabus and scope

This catalogue uses **AQA A-level Physics 7408** as its reference syllabus. It separates core content from the **optional Electronics unit, 3.13**. The optional activities are relevant only when that option is taught; they are not requirements for every A-level physics student. It is not a cross-board mapping or an AS-only catalogue.

Official references are [Electricity, 3.5][a-level-physics-aqa-electricity], [capacitance and electrical waveform content in 3.7][a-level-physics-aqa-fields], [Electronics, 3.13][a-level-physics-aqa-electronics], and [Practical assessment][a-level-physics-aqa-practicals]. Only electronic circuits and their electrical measurements are included. Coils moving in fields, transformer construction, optics, particle experiments and other non-electronic apparatus are excluded even where a scope is used to read the signal.

**Required practicals:** the directly relevant core activities are **RP5**, **RP6** and **RP9**. Other rows are proposed investigations linked to syllabus topics, not extra AQA required practicals. Practical completion and endorsement require real practical competence; modelled data is supplementary. See [AQA practical assessment][a-level-physics-aqa-practicals].

### Support labels and current capabilities

| Label | Meaning |
| --- | --- |
| **Both** | Draw the circuit and simulate its electrical behaviour with existing analysis tools and suitable SPICE mappings. |
| **Both, model needed** | Draw now; simulation requires an attached, compatible component model, an equivalent circuit or calibrated input data. Check the supplied educational model against the measurement goal. |
| **Diagram** | Useful for wiring, stage connections or annotated blocks. The central process is not a ready-made simulation workflow in TinyCAD. |

The experiment designs and suggested outputs below are our proposals. TinyCAD currently provides DC operating points, DC sweeps, transient and small-signal AC analysis, numerical measurements and CSV export. Some log-linear plots, regressions and custom processing are best done externally. The student scope displays recorded electrical acquisitions; it does not acquire from physical laboratory hardware. See [implemented capabilities](spice-engine.md), [instrument models](simulation.md#virtual-laboratory) and [Circuit Explorer](simulation.md#circuit-explorer).

### Core: required practicals

The practical numbers and assessment status below come from [AQA practical assessment][a-level-physics-aqa-practicals]. Circuit construction and the proposed analysis steps can be prepared in TinyCAD.

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested experiment and evidence |
| --- | --- | --- | --- | --- |
| A01 | Wire resistivity | RP5; [3.5.1.3][a-level-physics-aqa-electricity] | Both, model needed | Draw the wire test section and meters; annotate length and diameter measurements. Enter measured resistance values or a declared wire model. Use R versus length and the measured cross-sectional area to estimate resistivity externally. Simulation cannot supply independent evidence for the geometry or material law entered into it. |
| A02 | Cell emf and internal resistance | RP6; [3.5.1.6][a-level-physics-aqa-electricity] | Both | Model a cell as an ideal voltage source with an explicit series resistor. Vary the load, collect terminal voltage and current, and fit V against I externally. Start with, for example, 1.5 V and 1 Ω; identify intercept and gradient. Do not confuse the bench supply's current limiting with a cell's internal resistance. |
| A03 | Capacitor charging | RP9; [3.7.4.4][a-level-physics-aqa-fields] | Both | Drive an RC circuit with a step and capture capacitor voltage and charging current. Vary R and C independently. Compare fitted or measured time constants and the time to reach a chosen fraction of the final voltage. |
| A04 | Capacitor discharging | RP9; [3.7.4.4][a-level-physics-aqa-fields] | Both | Capture decay after a known charging interval, using a suitable switch model or an explicitly stated source arrangement. Export the decay for a plot of ln(V) against time and obtain RC from its gradient. Include every discharge path, including meter resistance. |

### Core: further circuit investigations

The references identify syllabus topics; the suggested circuits and choices of comparison are teaching proposals. The source sections are [3.5][a-level-physics-aqa-electricity] and [3.7][a-level-physics-aqa-fields].

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested experiment and evidence |
| --- | --- | --- | --- | --- |
| A05 | I–V characteristic of an ohmic resistor | 3.5.1.2 | Both | Sweep the source, collect component V and I and examine the gradient. Repeat with different resistance values; distinguish a V-against-I graph from an I-against-V graph. |
| A06 | I–V characteristic of a filament lamp | 3.5.1.2 | Both, model needed | Compare a measured characteristic with a validated lamp model. A constant resistance does not represent filament heating; without an electrothermal or empirical model, use TinyCAD for the experimental diagram. |
| A07 | I–V characteristic of a semiconductor diode | 3.5.1.2 | Both | Include current limiting, sweep both polarities and examine the diode's own voltage. Compare different valid diode models without assuming a universal fixed forward drop. |
| A08 | Thermistor resistance and a temperature-sensitive divider | 3.5.1.3; 3.5.1.5 | Both, model needed | Enter measured temperature/resistance pairs or a calibrated sensor model. Compare output sensitivity over a chosen range. A generic resistor sweep explores circuit response but does not establish the temperature calibration. |
| A09 | Series/parallel networks and conservation checks | 3.5.1.4 | Both | Measure signed currents at a junction and voltage changes around a loop. Predict the effect of an extra branch or changed resistor, then compare numerical residuals. |
| A10 | Cells in series and identical cells in parallel | 3.5.1.4 | Both | Include an internal resistance for each source. Compare terminal voltage and load current for the same load; avoid modelling parallel cells as contradictory ideal voltage sources. |
| A11 | Adjustable potential divider | 3.5.1.5 | Both | Use two resistors, or two resistor segments representing a potentiometer. Vary the ratio and compare unloaded output with output connected to a finite load. |
| A12 | Light-dependent potential divider | 3.5.1.5 | Both, model needed | Substitute measured light/dark resistance values or a calibrated LDR model. Compare sensor positions and the resulting direction of output change. Illumination itself is external input data. |
| A13 | Electrical power and supply losses | 3.5.1.4; 3.5.1.6 | Both | Measure delivered load power and power in an explicit source resistor. Vary the load and account for the electrical energy supplied. Physical cell heating and chemical behaviour need additional models. |
| A14 | Capacitance from transferred charge | 3.7.4.1 | Both | Integrate capacitor current over a selected interval and compare the resulting charge change with its voltage change. Repeat with different C values. Calculate the quotient externally if needed. |
| A15 | Plate spacing, area and dielectric: electrical measurement circuit | 3.7.4.2 | Diagram | Draw the capacitor and its measurement connections; annotate independently measured geometry and dielectric. The current multimeter has no capacitance range, and the circuit solver does not determine capacitance from drawn plate dimensions. Entering an assumed C only tests subsequent circuit behaviour. |
| A16 | Energy stored and dissipated in a capacitor circuit | 3.7.4.3 | Both | Compare calculated stored energy with the integral of discharge-resistor power. State the integration interval and initial voltage. A simulated discharge into a resistor is an electrical energy balance, not a temperature measurement. |
| A17 | Scope measurements of DC and sinusoidal signals | 3.7.5.5; AT h | Both | Vary source amplitude, offset and frequency. Read volts/div and time/div, then compare cursor or graticule estimates with reported period and frequency. Use multiple cycles when estimating a period. |
| A18 | Sinusoidal peak, peak-to-peak and RMS measurements | 3.7.5.5 | Both | Capture complete cycles and compare a scope's voltage readout, AC meter reading and calculated RMS. Use a zero-offset sine initially; distinguish AC-only RMS from total RMS when adding an offset. |
| A19 | Meter loading and measurement error | 3.5.1.2; 3.5.1.5; practical skills | Both | Compare a high-resistance divider with and without finite voltmeter input resistance. Compare current readings for different meter burdens. This is an evaluation exercise linked to the circuit topics, rather than another numbered required practical. |

### Optional Electronics: devices and analogue circuits

All entries in this and the next section are linked to [AQA's optional Electronics unit][a-level-physics-aqa-electronics]. They must not be presented as compulsory core practicals. Compatible semiconductor and amplifier models need to be supplied and checked; a symbol in a library does not guarantee simulation support.

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested experiment and evidence |
| --- | --- | --- | --- | --- |
| A20 | MOSFET transfer and output behaviour | 3.13.1.1 | Both, model needed | Use an N-channel enhancement device. Sweep gate voltage at several fixed drain conditions in separate runs, and measure drain current. Compare threshold estimates while keeping the model's limitations explicit. |
| A21 | MOSFET-controlled load | 3.13.1.1 | Both, model needed | Apply a pulse to the gate and compare gate, drain and load traces. Check the difference between an ideal switch assumption and a selected real device. |
| A22 | Zener characteristic and reference supply | 3.13.1.2 | Both, model needed | Sweep a limited supply through a series resistor, then test the reference with changed input and loading. Record diode voltage and current. Use a model containing the intended breakdown behaviour. |
| A23 | Photodiode detector circuit | 3.13.1.3 | Both, model needed | Draw the reverse-biased detector and readout. Use a calibrated photocurrent input to compare electrical response to steady and pulsed illumination. Wavelength response and optical intensity must come from external data/model parameters. |
| A24 | Hall-sensor interface and pulse readout | 3.13.1.4 | Both, model needed | Draw sensor supply, output and load. Use an equivalent voltage/pulse source to test the receiving electronics. Magnetic field and motion are not generated by the circuit solver. |
| A25 | Parallel LC response and damping | 3.13.3.1 | Both | Drive a parallel LC network through a stated source impedance. Sweep frequency, measure voltage gain and compare resonance with a calculated prediction. Change damping resistance and obtain bandwidth/Q. Use an energy-response or correctly squared voltage response for the syllabus's half-energy criterion. |
| A26 | Op-amp comparator | 3.13.3.2 | Both, model needed | Compare a varying sensor voltage with a reference. Observe the switching point and output limits. An unbounded ideal controlled source is not a realistic comparator; include suitable rail limiting or an amplifier model. |
| A27 | Inverting amplifier | 3.13.4.1 | Both, model needed | Choose two resistor ratios, apply a small sine and compare signed gain, phase and summing-node voltage. Repeat at larger input amplitude to expose saturation if the model supports it. |
| A28 | Non-inverting amplifier | 3.13.4.2 | Both, model needed | Repeat the gain measurement with a non-inverting configuration, then change the feedback ratio. Make supply rails and signal reference explicit in the diagram. |
| A29 | Summing amplifier | 3.13.4.3 | Both, model needed | Apply two independently adjustable inputs through different resistors. Compare the measured output with a weighted sum, then investigate clipping with a suitable model. |
| A30 | Difference amplifier | 3.13.4.3 | Both, model needed | Compare differential excitation with equal voltages on both inputs. Deliberately change one resistor to investigate imperfect common-mode rejection. |
| A31 | Amplifier frequency response | 3.13.4.4 | Both, model needed | Run small-signal AC analysis at several closed-loop gains. Measure cutoff/bandwidth and compare gain–bandwidth products. A frequency-independent ideal amplifier cannot demonstrate this behaviour. |

### Optional Electronics: digital signals and communications

Source mapping: [Electronics, sections 3.13.2, 3.13.5 and 3.13.6][a-level-physics-aqa-electronics]. These are proposals for experiments or demonstrations, not claims that TinyCAD already has dedicated ADC, counter or communications instruments.

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested experiment and evidence |
| --- | --- | --- | --- | --- |
| A32 | Analogue signals and two-level regeneration | 3.13.2.1 | Both, model needed | Inject a known perturbation into a signal, then compare a threshold stage's input and output. Use explicit sources and a bounded comparator/gate model; investigate where the noise becomes too large to recover the intended levels. |
| A33 | Sampling, quantisation and PCM | 3.13.2.1 | Diagram | Draw an annotated sampler/ADC/encoding chain and identify where timing and voltage resolution enter. A working converter demonstration needs compatible mixed-signal models or external processing. Scope display sampling must not be described as an experiment on a modelled ADC. |
| A34 | Gate truth tables | 3.13.5.1 | Both, model needed | Draw gates, set all input combinations and compare output voltages with a truth table. Include AND, NAND, OR, NOR, NOT and EOR. Supply valid gate models and logic-level assumptions. |
| A35 | A logic network from a truth table | 3.13.5.1 | Both, model needed | Draw a proposed multi-gate network and test every input combination. Compare an alternative implementation of the same function. This can also be diagram-only work when models are unavailable. |
| A36 | Binary, BCD and Johnson counting | 3.13.5.2 | Both, model needed | Draw clock/reset connections and capture output sequences for each counter type. Test reset and, where applicable, counting direction. A prepared compatible counter model is required. |
| A37 | Modulo-n counter | 3.13.5.2 | Both, model needed | Add reset-decoding logic to a counter and verify the sequence length. Use a sufficiently small time step to capture reset pulses and avoid assuming ideal zero-delay behaviour. |
| A38 | Astable clock and duty cycle | 3.13.5.3 | Both, model needed | Use a suitable oscillator model, such as a modelled timer circuit. Vary its timing R/C and measure period, pulse width and duty cycle. Feeding in a predefined pulse source only supplies a clock; it does not test an astable. A specific timer IC is not required by this syllabus. |
| A39 | Electronic communication-chain connections | 3.13.6.1 | Diagram | Draw and annotate source, processing, transmitter, channel and receiver blocks. Identify which interfaces carry electrical signals. This is a block-diagram teaching exercise, not an end-to-end communication simulation. |
| A40 | Electrical model of a wired channel | 3.13.6.2 | Both, model needed | Represent a short wired connection by an explicitly justified R/C equivalent. Compare received pulses for different parameter sets. The model does not establish the behaviour of optical fibre or radio propagation. |
| A41 | Time-division multiplexing | 3.13.6.3 | Diagram | Draw two source channels, timed switches and a receiver arrangement. Annotate time slots. Simulation needs switch/control models and a prepared timing sequence; it is not a built-in multiplexing instrument. |
| A42 | AM waveform demonstration | 3.13.6.4 | Both, model needed | Supply a behavioural or compatible modulator model and compare carrier, message and modulated traces. Vary message amplitude/frequency. The proposed circuit implementation is optional; the syllabus does not require its details. |
| A43 | FM waveform demonstration | 3.13.6.4 | Both | Use the configurable source's FM waveform, then compare time-domain traces as modulation settings change. Identify carrier and message timing. A spectral sideband/bandwidth investigation requires external analysis or an added workflow; the current UI does not provide FFT. |

### Sources

[a-level-physics-aqa-electricity]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/subject-content/electricity
[a-level-physics-aqa-fields]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/subject-content/fields-and-their-consequences-a-level-only
[a-level-physics-aqa-electronics]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/subject-content/electronics-a-level-only
[a-level-physics-aqa-practicals]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/practical-assessment

## btec-first-engineering

**BTEC First Certificate in Engineering — selected Unit 8**

### Course and source mapping

This document covers the **Pearson BTEC Level 1/Level 2 First Certificate in Engineering**, qualification **600/6628/3**, in the 2012 suite. The detailed reference is **Unit 8: Electronic Circuit Design and Construction**, learning aims A–D. This is a selected electronics unit, not a claim that every Engineering learner takes it. The same unit also appears in larger awards in the suite.

Sources: [Pearson qualification page][btec-first-engineering-course] and [specification, Issue 7, August 2020, Unit 8, printed pp. 119–129][btec-first-engineering-unit]. The filename still contains an older issue number; the document's internal issue is the reference used here. The qualification page lists registration and certification dates by nation; an old first-teaching year does not itself mean a course has ended.

The experiments below are our proposed teaching activities mapped to the published topics. They are not Pearson assignment briefs or a guarantee that completing them meets assessment criteria. **Both** means schematic drawing plus electrical simulation; **Both, model needed** requires a compatible device model or measured sensor data; **Diagram** means useful documentation without a complete simulation of the central behaviour.

All topic references below are to [Unit 8][btec-first-engineering-unit].

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

### Sources

[btec-first-engineering-course]: https://qualifications.pearson.com/en/qualifications/btec-firsts/engineering-2012-nqf.html
[btec-first-engineering-unit]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Firsts/Engineering/2012/Specification-and-sample-assessments/BTECFIRST_CECD_ENG_SPEC_ISS4.pdf#page=131

## btec-applied-science-2016

**BTEC National Extended Diploma Applied Science (2016) — selected Unit 15**

### Course and source mapping

Reference course: **Pearson BTEC Level 3 National Extended Diploma in Applied Science**, 2016 suite. This catalogue concentrates on **Unit 15: Electrical Circuits and their Applications**, learning aims A–D. Unit availability depends on qualification size and the centre's choices; this is not a catalogue for the smaller Extended Certificate or the newer AAQ course.

Sources: [Pearson course page][btec-applied-science-2016-course] and [specification, Issue 9, September 2021, Unit 15, printed pp. 167–178][btec-applied-science-2016-unit]. The online course page should be used for registration/funding status rather than assuming the specification's publication date describes current availability. The [AAQ catalogue](teaching-catalogue.md#btec-applied-science-aaq) maps the different, newer unit structure separately.

Activities below are our proposed teaching investigations. They do not replace the published assessment criteria, physical construction or observed practical evidence. **Both** means drawing and electrical simulation; **Both, model needed** means a calibrated input or compatible model must be supplied; **Diagram** identifies work where documentation is useful but the physical process is not simulated.

References in the second column are to [Unit 15][btec-applied-science-2016-unit]. Electronics only: electrical installations, motors, transformer construction and shock physiology are not included.

| ID | Experiment and reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| S01 | Resistor networks; A2, B1 | Both | Compare up to three resistors in series, parallel and mixed arrangements. Record equivalent resistance and conductance, with calculations beside the schematic. |
| S02 | Meter positions and loading; B2 | Both | Compare a divider with different voltmeter input resistances and current-meter burdens. Document which quantity each connection measures. |
| S03 | Potential-divider design; B2 | Both | Choose a target output and vary resistor ratio. Add a finite load and quantify the change rather than assuming an unloaded formula remains exact. |
| S04 | Emf and internal resistance; B2 | Both | Use an ideal source plus a series resistor. Change the load and fit terminal voltage against current using exported values. Identify the declared model's emf and resistance. |
| S05 | Ohmic/non-ohmic behaviour; A3 | Both, model needed | Compare resistor and LED characteristics using DC sweeps. Use a suitable electrothermal lamp model if including a filament lamp; a constant resistor cannot reproduce heating. |
| S06 | Capacitor reservoir and transferred charge; A2 | Both | Capture charge and discharge currents and capacitor voltage. Integrate current over a selected interval and compare with the voltage change. |
| S07 | Capacitors in series and parallel; A2 | Both | Compare networks using the same charging resistance. Infer equivalent capacitance from a transient response; the student multimeter has no capacitance range. |
| S08 | Capacitor filtering; A3 | Both | Apply a sine or pulse to an RC network. Compare input/output amplitude and timing across frequencies and relate the result to the chosen component values. |
| S09 | Peak and RMS readings; C3, D3 | Both | Use a low-voltage sine source, scope and AC meter. Compare readings over complete cycles and distinguish a source's offset from its alternating component. |
| S10 | AC-to-DC supply stage; C3 | Both, model needed | Prepare a rectifier with compatible diodes and a smoothing capacitor. Vary load and capacitance; compare mean output and ripple from transient captures. This is an electronic implementation of the topic, not a complete mains-supply model. |
| S11 | LDR interface; D1 | Both, model needed | Enter measured sensor resistances for several illumination conditions and predict divider output. Optical distance/intensity must come from measurements or a declared model. |
| S12 | Thermistor interface; D1 | Both, model needed | Use measured R(T) values to compare output sensitivity and sensor placement. Keep the temperature calibration separate from the electrical prediction. |
| S13 | Strain-gauge bridge; D1 | Both, model needed | Model the bridge resistors and sweep a small declared resistance change. Measure differential output and the effect of an initially unbalanced bridge. Mechanical strain is not generated by the solver. |
| S14 | Reed-switch alarm interface; D1 | Both, model needed | Draw the switched input, bias resistor and indicator. Compare separate switch states or a compatible controlled switch. Magnetic actuation is external to the circuit. |
| S15 | Thermocouple readout and amplification; C1, D2 | Both, model needed | Supply measured thermocouple voltages through a stated source resistance. Test loading and an amplifier interface. The model does not independently reproduce thermoelectric conversion. |
| S16 | Piezoelectric sensor interface; D2 | Both, model needed | Use a justified charge/current-source and capacitance equivalent. Compare output pulses and loading. The mechanical excitation is a declared input. |
| S17 | Sensor/data-logger connection plan; D3 | Diagram | Draw the sensor, conditioner, supply, common reference and recorder interface for a selected physical measurement. TinyCAD does not stream data into a real logger or model every pH/moisture/pressure sensor. |
| S18 | Model-versus-measurement evaluation; A–B, D | Both | Repeat a selected circuit with nominal and measured component values. Keep predicted and bench data separate, then identify discrepancies attributable to loading, tolerance or an inadequate model. |

### Sources

[btec-applied-science-2016-course]: https://qualifications.pearson.com/en/qualifications/btec-nationals/applied-science-2016.html
[btec-applied-science-2016-unit]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Nationals/Applied-Science/2016/specification-and-sample-assessments/BTEC-L3-Nat-ExtDip-in-Applied-Science-Spec.pdf#page=175

## btec-applied-science-aaq

**BTEC National Applied Science AAQ Extended Certificate — Units 3 and 4**

### Course and source mapping

Course: **Pearson Level 3 Alternative Academic Qualification BTEC National in Applied Science (Extended Certificate)**, qualification **610/3965/2**, first teaching September 2025. Sources are [Pearson's qualification page][btec-applied-science-aaq-course] and the [specification, Issue 7, May 2026][btec-applied-science-aaq-spec].

The relevant references are **Unit 3: Principles and Applications of Physics**, area C, printed pp. 55–56, and **Unit 4: Practical Scientific Procedures and Techniques**, C2–C3, printed p. 67. This is a different course structure from the [2016 Applied Science catalogue](teaching-catalogue.md#btec-applied-science-2016): old Unit 15 references must not be carried over.

The activities are proposed preparations/comparisons tied to those sections. They do not replace the published physical procedures or demonstrate a learner's practical competence. **Both** means drawing and electrical simulation; **Both, model needed** needs a compatible device model or calibrated physical input; **Diagram** means documentation without simulation of the main physical process.

All references below are to the [AAQ specification][btec-applied-science-aaq-spec]. Thermal and mechanical experiments are omitted; solar-cell entries cover the electronic measurement circuit and its electrical response.

| ID | Experiment and reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| Q01 | Correct meter connections; U3 C1.1–C1.3, U4 C2 | Both | Prepare an ammeter/voltmeter test circuit, then compare readings for a known load. Use V Ω–COM for voltage/resistance and A–COM for current. |
| Q02 | Meter calibration/comparison plan; U4 C2 | Both | Predict readings for several declared reference resistors and source values. Draw the real calibration arrangement and compare bench readings against an independently established reference. A virtual meter is not a calibration certificate for physical equipment. |
| Q03 | Series and parallel loads; U3 C1.3, U4 C2 | Both | Build resistor combinations, record individual and supply readings, and compare calculations with modelled and physical measurements. |
| Q04 | Wire resistance versus length; U4 C2 | Both, model needed | Draw the test section and meter positions. Enter measured resistances or a stated wire law for each length; plot exported R against length externally. |
| Q05 | Resistivity and cross-sectional area; U4 C2 | Both, model needed | Annotate measured diameters and lengths for the specified wire comparison. Use measured V/I results to calculate resistivity externally. The solver cannot measure wire diameter or establish a material constant independently. |
| Q06 | Filament-lamp characteristic; U3 C1.4, U4 C2 | Both, model needed | Draw the current-limited measurement circuit and compare a real lamp characteristic with an electrothermal or empirical model. Keep a fixed-resistance illustration clearly labelled as an approximation. |
| Q07 | Diode polarity and characteristic; U3 C1.4 | Both | Sweep a current-limited source and measure the diode's voltage and current. Compare forward and reverse behaviour using an identified diode model. |
| Q08 | LED current limiting; U3 C1.4, U4 C2 | Both, model needed | Compare current and resistor dissipation for different supply/resistor choices. Use an LED-specific model; light output and damage are not automatic simulation results. |
| Q09 | Thermistor electrical response; U3 C1.4, U4 C2 | Both, model needed | Substitute measured R(T) values into the test circuit. Compare current or divider output, recording temperature data independently. |
| Q10 | LDR electrical response; U3 C1.4 | Both, model needed | Use measured resistance under controlled illumination to predict readings. Changing an arbitrary resistor is a circuit exercise, not a simulated light experiment. |
| Q11 | Photodiode readout; U3 C1.4 | Both, model needed | Model a reverse-biased detector with calibrated photocurrent and compare output for different loads. Supply the optical response externally. |
| Q12 | Electrical power and energy; U3 C2–C3 | Both | Compare resistor loads at known voltages. Calculate power and energy for a stated duration from simulated readings, then compare with real measurements where appropriate. Temperature change is not modelled by the resistor alone. |
| Q13 | Solar-cell load and output measurements; U4 C3 | Both, model needed | Draw the panel, voltmeter and selectable electrical load. Use a declared solar-cell equivalent or measured I–V data to compare output conditions. Irradiance, colour and angle must be measured or explicitly supplied. |
| Q14 | Solar-cell optical investigation plan; U4 C3 | Diagram | Annotate the circuit, test conditions and data-recording points for changes in distance, angle and illumination. The spatial/optical arrangement remains a separate apparatus sketch; TinyCAD does not calculate it from a schematic. |

### Sources

[btec-applied-science-aaq-course]: https://qualifications.pearson.com/en/qualifications/btec-nationals/applied-science-aaq.html
[btec-applied-science-aaq-spec]: https://qualifications.pearson.com/content/dam/pdf/btec-aaqs/applied-science/2025/specification-and-sample-assessments/btec-national-in-applied-science-specification.pdf

## btec-national-electrical-electronic-engineering

**BTEC National Extended Diploma Electrical and Electronic Engineering — selected Unit 19**

### Course and source mapping

Reference course: **Pearson BTEC Level 3 National Extended Diploma in Electrical and Electronic Engineering**, 2016 suite, qualification **601/7587/4**. The electronics mapping here is to **Unit 19: Electronic Devices and Circuits**, learning aims A–C. Check the centre's programme and assignment brief before selecting activities; this is not a full mapping of every engineering unit or every qualification size.

Sources: [Pearson course/qualification page][btec-national-electrical-electronic-engineering-course] and [Extended Diploma specification, Issue 10, June 2026, Unit 19, printed pp. 239–247][btec-national-electrical-electronic-engineering-unit]. The PDF covers the Engineering Extended Diploma family, including the named electrical/electronic route. Do not use this unit number for the different BTEC First or Higher National specifications.

These are proposed investigations, not Pearson-authored assignments. **Both** means drawing and electrical simulation; **Both, model needed** requires compatible device/subcircuit models; **Diagram** denotes useful circuit documentation without a complete model of the central activity. Physical construction, testing and reflection remain separate evidence.

The references below are to [Unit 19][btec-national-electrical-electronic-engineering-unit].

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

### Sources

[btec-national-electrical-electronic-engineering-course]: https://qualifications.pearson.com/en/qualifications/btec-nationals/engineering-2016.html
[btec-national-electrical-electronic-engineering-unit]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Nationals/Engineering/2016/specification-and-sample-assessments/spec-btec-nat-eng-extdip.pdf#page=249

## btec-hnc-electrical-electronic-engineering

**BTEC HNC Electrical and Electronic Engineering for England (2024) — Unit 4019**

### Course and source mapping

Course: **Pearson BTEC Level 4 Higher National Certificate in Electrical and Electronic Engineering for England (2024)**, qualification **610/1220/8**. This is the HNC, not a catalogue of Level 5 HND options.

Sources: [qualification page][btec-hnc-electrical-electronic-engineering-course], [programme specification, Issue 2, June 2026, section 6.2.1, printed p. 27][btec-hnc-electrical-electronic-engineering-programme], and [Engineering Suite unit descriptors, Issue 6, October 2025, Unit 4019, printed pp. 144–151][btec-hnc-electrical-electronic-engineering-units]. The programme structure names **4019: Electrical and Electronic Principles** as a mandatory specialist unit. The unit bank also contains many other units that are not automatically part of this particular HNC: do not import the old 2017 Unit 19/20/22 structure or assume 4020/4022 are mandatory here.

The proposals below map primarily to **4019 LO1–LO4**. Design/test documentation can additionally support the selected project context, but does not itself fulfil all requirements of the course's other units. **Both** means drawing plus electrical simulation; **Both, model needed** requires a supplied compatible device/equivalent model; **Diagram** means documentation rather than complete simulation.

The LO references below are to [Unit 4019][btec-hnc-electrical-electronic-engineering-units]. Mechanical machines, installation testing and power-system design are excluded from this electronics-only catalogue.

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

### Sources

[btec-hnc-electrical-electronic-engineering-course]: https://qualifications.pearson.com/en/qualifications/btec-higher-nationals/electrical-electronic-engineering-for-england-2024.html
[btec-hnc-electrical-electronic-engineering-programme]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Higher-Nationals/electrical-electronic-engineering-for-england/2024/specification/9781292448480-btec-hn-l4-l5-electric-electron-engin-engl.pdf#page=35
[btec-hnc-electrical-electronic-engineering-units]: https://qualifications.pearson.com/content/dam/pdf/BTEC-Higher-Nationals/engineering-for-england/2024/unitdescriptors/btec-hncd-unit-descriptor-engineering-suite-2024.pdf#page=160

## degree-year1-physics

**First-year physics degree — representative electronic-circuit strand**

### Representative syllabuses

There is no single first-year physics syllabus. This document proposes an electronics strand based on published UK university examples; it does not claim every university runs these experiments or teaches every topic in year one.

| Reference | Published course evidence | How it is used here |
| --- | --- | --- |
| **P-LAB** | [Warwick PX152-30 Physics Laboratory, 2025/26][degree-year1-physics-lab], undergraduate Level 1: practical investigation, data/uncertainty work and electronic circuits involving transistors, op-amps and logic | Basis for measurement practice, electronic building blocks and comparison with real experiments. |
| **P-CIR** | [Warwick PX157-10 Electricity and Magnetism, 2025/26][degree-year1-physics-circuits], undergraduate Level 1: DC/AC circuit theory and reactive networks | Basis for passive-circuit experiments. The current [first-year module list][degree-year1-physics-year] provides programme context. |
| **P-PROJ** | [Glasgow's first-year PHYS1001 project-based laboratory case study][degree-year1-physics-project] | Evidence of sensor-calibration/electronics project work at this level; it is a published teaching case, not a promise about every current Glasgow lab allocation. |

The experiments below are our own proposals derived from these topic areas. The module pages give indicative content, not the detailed experimental scripts below. Physical fields, optics, mechanics, radiation experiments and apparatus construction are excluded except for the electrical interface to a sensor.

**Both** means diagram plus electrical simulation. **Both, model needed** requires a compatible device model or calibrated equivalent input. **Diagram** means documentation without a complete simulation of the central process. All models require valid SPICE mappings. These are proposed lessons, not existing completed lesson files.

| ID | Experiment and syllabus link | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| P01 | DC network verification; P-CIR | Both | Solve a multi-loop network analytically, then compare signed currents and node voltages with the solver. Identify which discrepancies are numerical and which indicate a modelling or sign error. |
| P02 | Source resistance and loading; P-CIR, P-LAB | Both | Compare a measured source model with an ideal source while varying the load. Fit an equivalent source resistance from exported terminal readings. |
| P03 | Voltmeter loading; P-LAB | Both | Connect a finite-resistance meter to a high-resistance divider. Estimate the expected loading error before running, then compare with a physical meter. |
| P04 | Ammeter burden; P-LAB | Both | Repeat a low-resistance current measurement with several declared meter burdens. Quantify how inserting the instrument changes the circuit. |
| P05 | Capacitor combinations and energy; P-CIR | Both | Compare charging responses of series/parallel capacitor networks and calculate stored energy. Infer effective C using a stated method rather than a nonexistent virtual capacitance-meter range. |
| P06 | RC charging/discharging; P-CIR | Both | Capture both capacitor voltage and resistor current. Fit a decay externally, compare the time constant with component measurements and discuss instrument loading. |
| P07 | RL transient; P-CIR | Both | Apply a step to a resistive-inductive circuit, include coil resistance and compare fitted time constant with the model prediction. A lumped inductor does not model the magnetic geometry. |
| P08 | Damped RLC response; P-CIR | Both | Change R and compare oscillatory and non-oscillatory responses. Extract a decay rate and oscillation period from an adequately sampled transient. |
| P09 | Complex impedance and phase; P-CIR | Both | Sweep RC and RL circuits, measure voltage/current phase and compare with phasor calculations. State the reference direction and phase convention. |
| P10 | Series resonance; P-CIR | Both | Sweep an RLC circuit, measure response and bandwidth, then compare the inferred resonance with the transient experiment. Include generator output impedance. |
| P11 | AC power and power factor; P-CIR | Both | Average instantaneous load power and compare it with RMS-based apparent power. Calculate power factor and distinguish energy storage from dissipation. |
| P12 | Scope timing and amplitude measurements; P-LAB | Both | Compare graticule/cursor estimates with numerical readings as timebase and capture step change. Record the acquisition settings and avoid treating display interpolation as additional samples. |
| P13 | Transistor operating point and gain; P-LAB | Both, model needed | Bias a prepared BJT circuit, verify its DC state and compare small/large signal behaviour. Compare with a real circuit using an identified device. |
| P14 | Op-amp feedback and limits; P-LAB | Both, model needed | Test a simple amplifier at several gains and input amplitudes. Compare an idealised prediction with a rail-limited, frequency-dependent model and physical results. |
| P15 | Threshold detector and logic output; P-LAB | Both, model needed | Apply a slow input and a reference to a comparator, then check the resulting logic levels. The model must represent the required output limits. |
| P16 | Simple logic-network verification; P-LAB | Both, model needed | Prepare a small network, predict its truth table and exercise every combination. This is a proposed workshop exercise, not a claim that a particular gate exercise is allocated by Warwick. |
| P17 | Sensor calibration and interface loading; P-PROJ | Both, model needed | Enter measured sensor voltage/resistance data and compare interface output for different loading. The physical calibration is obtained independently, not generated by fitting the same simulation. |
| P18 | Component uncertainty and model sensitivity; P-LAB | Both | Compare nominal and measured component values, then use bounded sweeps or tolerance studies. Keep manufacturing tolerances, instrument uncertainty and repeated-measurement scatter separate in the analysis. |
| P19 | Electronic measurement-chain documentation; P-LAB, P-PROJ | Diagram | Draw sensor, conditioning stage, recorder/controller and references. Annotate supply and test connections. Firmware, physical data acquisition and weather-station operation need other tools. |

### Sources

[degree-year1-physics-lab]: https://courses.warwick.ac.uk/modules/2025/PX152-30
[degree-year1-physics-circuits]: https://courses.warwick.ac.uk/modules/2025/PX157-10
[degree-year1-physics-year]: https://warwick.ac.uk/fac/sci/physics/prospective/undergraduate_study/physics_courses/firstyrmodules/
[degree-year1-physics-project]: https://www.gla.ac.uk/myglasgow/learningandteaching/activelearning/casestudies/project-based-learning/

## degree-year1-electronics

**First-year electronics degree — representative circuit/device/digital strand**

### Representative syllabuses

This is a proposed first-year electronics/electrical-and-electronic engineering catalogue, not a national syllabus or a list of experiments guaranteed at every institution. The primary sources are published university modules:

| Reference | Source and topic coverage |
| --- | --- |
| **E-CAD** | [Leeds ELEC1130 Circuit Analysis and Design, 2026/27][degree-year1-electronics-leeds]: circuit analysis, measurement/loading, semiconductors and amplifier design. |
| **E-CIR** | [Southampton ELEC1311 Circuits, 2026/27][degree-year1-electronics-circuits]: linear circuits, reactive response, phasors and time-domain analysis. |
| **E-DIG** | [Southampton ELEC1313 Digital Systems, 2026/27][degree-year1-electronics-digital]: combinational/sequential design, timing and programmable hardware. |
| **E-YEAR** | [Southampton Electronic Engineering degree, year-one module list][degree-year1-electronics-degree]: programme context. The public prospectus page currently describes 2027/28 entry; the technical module references above are the dated 2026/27 versions. |

These sources establish relevant subject areas. The circuit choices and experiment plans below are our proposals, not reproductions of departmental lab scripts. Detailed semiconductor fabrication, electromagnetics, software and non-electronic machinery are outside scope.

**Both** = schematic plus electrical simulation; **Both, model needed** = compatible device/subcircuit models must be supplied; **Diagram** = useful circuit/interface documentation without simulating the central process. A supplied model must be checked against the chosen backend and measurement goal.

### Passive circuits and measurement

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

### Devices and analogue circuits

| ID | Experiment and syllabus reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| E11 | Diode characteristic and operating point; E-CAD | Both | Compare a chosen SPICE diode with an ideal/piecewise analytical approximation. Examine where the approximation produces an unacceptable error. |
| E12 | Rectification and smoothing; E-CAD | Both | Compare half/full-wave circuits and load-dependent ripple with a low-voltage sine source. Include real diode models and use transient analysis. |
| E13 | Transistor bias and load line; E-CAD | Both, model needed | Predict DC operating point, run the model and repeat for component tolerances. Export device readings for a load-line comparison. |
| E14 | BJT amplifier gain and resistance; E-CAD | Both, model needed | Measure small-signal gain and infer input/output resistance using controlled source/load changes. Compare with a small-signal equivalent. |
| E15 | FET characteristics and switching; E-CAD | Both, model needed | Compare selected gate/drain conditions with a device model. Investigate gate-drive and load effects rather than assuming every FET is an ideal switch. |
| E16 | Op-amp feedback stages; E-CAD | Both, model needed | Compare inverting and non-inverting gain, input loading and output range. Distinguish an ideal analytical block from a model with rails and frequency limits. |
| E17 | Active filter; E-CAD | Both, model needed | Measure a prepared op-amp filter's gain/phase and pulse response. Compare component changes with the predicted poles/cutoff using an appropriate amplifier model. |

### Digital design and interfaces

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

### Sources

[degree-year1-electronics-leeds]: https://catalogue.leeds.ac.uk/Module/UG/ELEC/1130/202627
[degree-year1-electronics-circuits]: https://www.southampton.ac.uk/courses/modules/elec1311
[degree-year1-electronics-digital]: https://www.southampton.ac.uk/courses/2026-27/modules/elec1313
[degree-year1-electronics-degree]: https://www.southampton.ac.uk/courses/electronic-engineering-degree-beng

## degree-year1-engineering

**First-year engineering degrees — shared electronics and discipline applications**

### Meaning of “all engineering courses”

This is one combined document for the electronic-circuit strand that can support different engineering disciplines. It is **not** a claim that every mechanical, civil, chemical, aerospace, biomedical or software engineering degree teaches every listed topic in year one. Departments vary in what is common, specialised, optional or taught later.

Representative official sources are:

| Reference | Published syllabus/context |
| --- | --- |
| **G-CORE** | [Warwick ES191-15 Electrical and Electronic Circuits, 2025/26][degree-year1-engineering-warwick], undergraduate Level 1. The module describes circuit analysis, reactive response, devices, filters and introductory digital work in an engineering context. |
| **G-BROAD** | [Cambridge Engineering first-year overview][degree-year1-engineering-cambridge]. Its common course includes electrical/information engineering alongside the other engineering subjects. This is broad programme evidence, not a public lab script for each experiment below. |
| **G-ANALYSIS** | [Southampton ELEC1311 Circuits, 2026/27][degree-year1-engineering-southampton], Level 4. A second detailed example for the analytical circuit material, rather than evidence that every engineering discipline takes this module. |

The catalogue is our proposed teaching synthesis of those sources. Only electronics and electrical circuit measurements are included. It does not attempt to simulate structures, fluid flow, combustion, heat transfer, motion or complete industrial control systems.

**Both** means schematic drawing plus electrical simulation; **Both, model needed** requires a compatible device model or calibrated equivalent input; **Diagram** means documentation without a complete simulation of the central process. Select a subset against the actual programme, not the document's total row count.

### Shared experiment catalogue

| ID | Experiment and syllabus reference | TinyCAD use | Suggested investigation and evidence |
| --- | --- | --- | --- |
| GY01 | Instrument connections and measurement loading; G-CORE | Both | Compare a divider's predicted output with finite-resistance voltage measurement and compare current readings with stated burden. Explain how an instrument changes the circuit. |
| GY02 | DC network analysis; G-CORE, G-ANALYSIS | Both | Use a multi-branch resistor circuit and compare measured node/current values with nodal and mesh calculations. |
| GY03 | Equivalent source and load; G-CORE | Both | Compare an original network with its port equivalent for several loads. State source resistance and avoid treating an ideal source as a complete battery model. |
| GY04 | Superposition; G-CORE, G-ANALYSIS | Both | Investigate each independent source separately, then compare the total voltage/current. Show explicitly why power is not a linear sum of these separate results. |
| GY05 | Electrical power budget; G-CORE | Both | Account for resistor, source and load power for different operating conditions. Distinguish predicted electrical dissipation from temperature rise or mechanical output. |
| GY06 | RC step response; G-CORE, G-ANALYSIS | Both | Capture voltage/current, measure time constant and compare loading assumptions. Repeat with measured component values. |
| GY07 | RL response and coil resistance; G-CORE, G-ANALYSIS | Both | Compare current rise for an idealised and resistive coil model. The experiment concerns its electrical terminals, not magnetic geometry or motion. |
| GY08 | Damped RLC response; G-CORE | Both | Change resistance and compare transient oscillation/decay and frequency response. Choose sampling and run length from the expected response. |
| GY09 | Impedance and phase; G-CORE, G-ANALYSIS | Both | Compare an RC/RL load's frequency-dependent current with phasor calculations. Keep phase reference and current direction explicit. |
| GY10 | AC power and power factor; G-CORE | Both | Compare average instantaneous power with RMS-derived apparent power for a small circuit model. Complete complex-power calculations externally if necessary. |
| GY11 | Passive filter and pulse distortion; G-CORE | Both | Compare frequency response and transient response of the same RC filter under defined source/load conditions. |
| GY12 | Diode and rectifier interface; G-CORE | Both | Use current limiting, an identified diode model and low-voltage sine input. Compare polarity, conduction and output ripple. The rectifier topology is a proposed application of the device topic. |
| GY13 | Transistor load driver; G-CORE | Both, model needed | Investigate drive voltage/current and output loading using a prepared transistor model. For an inductive equivalent load, compare switch-node voltage with protection included. |
| GY14 | Op-amp conditioner; G-CORE | Both, model needed | Scale a declared low-level input to a desired output range. Compare loading, gain and saturation with a suitable amplifier model. |
| GY15 | Active filter; G-CORE | Both, model needed | Compare the passive and buffered/active versions of a selected filter under changed loading. Use a model with adequate bandwidth. |
| GY16 | Logic decision circuit; G-CORE, G-BROAD | Both, model needed | Draw a small combinational controller and verify all combinations against a stated truth table. Compatible gate models are required; programming an industrial controller is separate. |
| GY17 | Sensor-to-controller interface; G-CORE, applied proposal | Both, model needed | Supply measured sensor voltages/resistances and investigate offset, loading and conditioning. Do not claim the circuit independently reproduces the physical sensing mechanism. |
| GY18 | System connections and test plan; G-BROAD, applied proposal | Diagram | Draw supplies, references, sensor connections, driver and receiving equipment, with test points. The full mechanical/process/software system remains outside TinyCAD. |

### Sources

[degree-year1-engineering-warwick]: https://courses.warwick.ac.uk/modules/2025/ES191-15
[degree-year1-engineering-cambridge]: https://www.admissions.eng.cam.ac.uk/course/firstyear
[degree-year1-engineering-southampton]: https://www.southampton.ac.uk/courses/modules/elec1311
