# BTEC National Applied Science AAQ: electronics experiments

Student drawings: [BTEC National Applied Science AAQ Extended Certificate — Units 3 and 4](../bundled-examples/teaching/btec-applied-science-aaq/README.md). They are also available in **File → Open Example**. Each activity has a drawing, a preview and student-facing Markdown instructions; simulation examples use `.dzn` and connection plans use `.dsn`.

Research checked: **10 November 2026**.

## Course and source mapping

Course: **Pearson Level 3 Alternative Academic Qualification BTEC National in Applied Science (Extended Certificate)**, qualification **610/3965/2**, first teaching September 2025. Sources are [Pearson's qualification page][course] and the [specification, Issue 7, May 2026][spec].

The relevant references are **Unit 3: Principles and Applications of Physics**, area C, printed pp. 55–56, and **Unit 4: Practical Scientific Procedures and Techniques**, C2–C3, printed p. 67. This is a different course structure from the [2016 Applied Science catalogue](20-btec-national-applied-science-2016-electronics-experiments.md): old Unit 15 references must not be carried over.

The activities are proposed preparations/comparisons tied to those sections. They do not replace the published physical procedures or demonstrate a learner's practical competence. **Both** means drawing and electrical simulation; **Both, model needed** needs a compatible device model or calibrated physical input; **Diagram** means documentation without simulation of the main physical process.

## Experiment catalogue

All references below are to the [AAQ specification][spec]. Thermal and mechanical experiments are omitted; solar-cell entries cover the electronic measurement circuit and its electrical response.

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

## Using the files in teaching

Supply a diagram, a statement of controlled variables, model assumptions and a table for predictions versus measured results. For wire and solar-cell investigations, retain the original physical measurements rather than treating values entered into the model as new experimental evidence.

The mapping does not imply every proposed circuit is prescribed by Pearson. For example, a divider is a convenient way to inspect a sensor electrically; it should not be presented as a separate compulsory AAQ practical. Household installation tests, calorimetry and fuse-operation demonstrations are outside this electronics-only list.

See [laboratory instruments](16-virtual-laboratory-and-p1-analysis.md) and [implementation status](10-implementation-status.md) for the current tool capabilities. No complete AAQ lesson pack is created by this document.

[course]: https://qualifications.pearson.com/en/qualifications/btec-nationals/applied-science-aaq.html
[spec]: https://qualifications.pearson.com/content/dam/pdf/btec-aaqs/applied-science/2025/specification-and-sample-assessments/btec-national-in-applied-science-specification.pdf
