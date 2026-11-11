# A-level physics: electronics experiments supported by TinyCAD

Student drawings: [A-level Physics — AQA 7408, including optional Electronics](../bundled-examples/teaching/a-level-physics-aqa/README.md). They are also available in **File → Open Example**. Each activity has a drawing, a preview and student-facing Markdown instructions; simulation examples use `.dzn` and connection plans use `.dsn`.

Research checked: **10 November 2026**.

## Syllabus and scope

This catalogue uses **AQA A-level Physics 7408** as its reference syllabus because no exam board was specified. It separates core content from the **optional Electronics unit, 3.13**. The optional activities are relevant only when that option is taught; they are not requirements for every A-level physics student. It is not a cross-board mapping or an AS-only catalogue.

Official references are [Electricity, 3.5][electricity], [capacitance and electrical waveform content in 3.7][fields], [Electronics, 3.13][electronics], and [Practical assessment][practicals]. Only electronic circuits and their electrical measurements are included. Coils moving in fields, transformer construction, optics, particle experiments and other non-electronic apparatus are excluded even where a scope is used to read the signal.

**Required practicals:** the directly relevant core activities are **RP5**, **RP6** and **RP9**. Other rows are proposed investigations linked to syllabus topics, not extra AQA required practicals. Practical completion and endorsement require real practical competence; modelled data is supplementary. See [AQA practical assessment][practicals].

## Support labels and current capabilities

| Label | Meaning |
| --- | --- |
| **Both** | Draw the circuit and simulate its electrical behaviour with existing analysis tools and suitable SPICE mappings. |
| **Both, model needed** | Draw now; simulation requires an attached, compatible component model, an equivalent circuit or calibrated input data. This is not a claim that a prepared teaching component already exists. |
| **Diagram** | Useful for wiring, stage connections or annotated blocks. The central process is not a ready-made simulation workflow in TinyCAD. |

The experiment designs and suggested outputs below are our proposals. TinyCAD currently provides DC operating points, DC sweeps, transient and small-signal AC analysis, numerical measurements and CSV export. Some log-linear plots, regressions and custom processing are best done externally. The student scope displays recorded electrical acquisitions; it does not acquire from physical laboratory hardware. See [implemented capabilities](10-implementation-status.md), [instrument models](16-virtual-laboratory-and-p1-analysis.md) and [Circuit Explorer](15-circuit-explorer.md).

## Core: required practicals

The practical numbers and assessment status below come from [AQA practical assessment][practicals]. Circuit construction and the proposed analysis steps can be prepared in TinyCAD.

| ID | Experiment | Syllabus reference | TinyCAD support | Suggested experiment and evidence |
| --- | --- | --- | --- | --- |
| A01 | Wire resistivity | RP5; [3.5.1.3][electricity] | Both, model needed | Draw the wire test section and meters; annotate length and diameter measurements. Enter measured resistance values or a declared wire model. Use R versus length and the measured cross-sectional area to estimate resistivity externally. Simulation cannot supply independent evidence for the geometry or material law entered into it. |
| A02 | Cell emf and internal resistance | RP6; [3.5.1.6][electricity] | Both | Model a cell as an ideal voltage source with an explicit series resistor. Vary the load, collect terminal voltage and current, and fit V against I externally. Start with, for example, 1.5 V and 1 Ω; identify intercept and gradient. Do not confuse the bench supply's current limiting with a cell's internal resistance. |
| A03 | Capacitor charging | RP9; [3.7.4.4][fields] | Both | Drive an RC circuit with a step and capture capacitor voltage and charging current. Vary R and C independently. Compare fitted or measured time constants and the time to reach a chosen fraction of the final voltage. |
| A04 | Capacitor discharging | RP9; [3.7.4.4][fields] | Both | Capture decay after a known charging interval, using a suitable switch model or an explicitly stated source arrangement. Export the decay for a plot of ln(V) against time and obtain RC from its gradient. Include every discharge path, including meter resistance. |

## Core: further circuit investigations

The references identify syllabus topics; the suggested circuits and choices of comparison are teaching proposals. The source sections are [3.5][electricity] and [3.7][fields].

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

## Optional Electronics: devices and analogue circuits

All entries in this and the next section are linked to [AQA's optional Electronics unit][electronics]. They must not be presented as compulsory core practicals. Compatible semiconductor and amplifier models need to be supplied and checked; a symbol in a library does not guarantee simulation support.

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

## Optional Electronics: digital signals and communications

Source mapping: [Electronics, sections 3.13.2, 3.13.5 and 3.13.6][electronics]. These are proposals for experiments or demonstrations, not claims that TinyCAD already has dedicated ADC, counter or communications instruments.

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

Native Electron supports bundled XSPICE code models; the browser does not support all such circuits. Digital activities therefore require a deliberate model/backend choice. A diagram can still be useful on either platform. See [implementation status](10-implementation-status.md).

## Optional extensions beyond the mapped experiments

Two useful preparations are a half-wave/bridge rectifier with RC smoothing, and an RC low-pass/high-pass comparison. They combine diode, capacitor and AC concepts but are **proposed extensions**, not extra AQA required practicals or a claim that RC filter theory is mandatory in the core. Use DC/transient analysis for large-signal switching and small-signal AC analysis for linear frequency response; these are different experiments.

The existing [RC charging](../examples/simulation/rc-charging.dzn), [RC low-pass](../examples/simulation/rc-low-pass.dzn) and [virtual laboratory](../examples/simulation/virtual-laboratory.dzn) drawings provide starting points. They do not constitute a completed set of the activities above. In particular, confirm lesson-scale timing, source impedance and instrument loading before reusing an example.

## Preparing useful lesson files

For each activity, prepare the diagram, declared model assumptions, input values to vary, expected electrical measurements and a place for students to compare predictions with laboratory evidence. Use the multimeter's **V Ω–COM** sockets for voltage/resistance and **A–COM** for current. Resistance measurements require an unpowered circuit; decide whether a component must be disconnected to measure it independently.

Choose analysis and evidence deliberately: DC sweeps for static characteristics, transient captures for timing, and AC sweeps for small-signal gain. Set measurement windows within the captured record. Export values for regressions and log-linear analysis instead of assuming the scope performs every syllabus calculation.

Sensor and lamp models must be identified as assumptions. Supplying measured R(T), an assumed optical current or an equivalent Hall voltage is useful for testing downstream circuitry, but does not independently reproduce the physical sensor experiment. Keep physical measurements and simulated predictions separately labelled in student records.

[electricity]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/subject-content/electricity
[fields]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/subject-content/fields-and-their-consequences-a-level-only
[electronics]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/subject-content/electronics-a-level-only
[practicals]: https://www.aqa.org.uk/subjects/physics/a-level/physics-7408/specification/practical-assessment
