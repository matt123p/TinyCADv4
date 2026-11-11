# First-year engineering degrees: a shared electronics experiment catalogue

Student drawings: [First-year engineering degrees — shared electronics and discipline applications](../bundled-examples/teaching/degree-year1-engineering/README.md). They are also available in **File → Open Example**. Each activity has a drawing, a preview and student-facing Markdown instructions; simulation examples use `.dzn` and connection plans use `.dsn`.

Research checked: **10 November 2026**.

## Meaning of “all engineering courses”

This is one combined document for the electronic-circuit strand that can support different engineering disciplines. It is **not** a claim that every mechanical, civil, chemical, aerospace, biomedical or software engineering degree teaches every listed topic in year one. Departments vary in what is common, specialised, optional or taught later.

Representative official sources are:

| Reference | Published syllabus/context |
| --- | --- |
| **G-CORE** | [Warwick ES191-15 Electrical and Electronic Circuits, 2025/26][warwick], undergraduate Level 1. The module describes circuit analysis, reactive response, devices, filters and introductory digital work in an engineering context. |
| **G-BROAD** | [Cambridge Engineering first-year overview][cambridge]. Its common course includes electrical/information engineering alongside the other engineering subjects. This is broad programme evidence, not a public lab script for each experiment below. |
| **G-ANALYSIS** | [Southampton ELEC1311 Circuits, 2026/27][southampton], Level 4. A second detailed example for the analytical circuit material, rather than evidence that every engineering discipline takes this module. |

The catalogue is our proposed teaching synthesis of those sources. Only electronics and electrical circuit measurements are included. It does not attempt to simulate structures, fluid flow, combustion, heat transfer, motion or complete industrial control systems.

**Both** means schematic drawing plus electrical simulation; **Both, model needed** requires a compatible device model or calibrated equivalent input; **Diagram** means documentation without a complete simulation of the central process. Select a subset against the actual programme, not the document's total row count.

## Shared experiment catalogue

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

## Applying the shared work to different disciplines

The following contexts are **our suggested adaptations**, not claims that the cited universities prescribe these projects or that they are compulsory first-year content. They keep the modelling boundary at the electronic interface.

| Discipline/context | Suitable adaptation | Where TinyCAD stops |
| --- | --- | --- |
| Mechanical and automotive | GY07/GY13: inductive-load drive; GY17: position-sensor input | No engine, vehicle-motion or motor-mechanics simulation. |
| Civil and structural | GY14/GY17: bridge-sensor conditioner; GY18: instrumentation wiring | Supply strain/resistance data externally; structural deformation is not solved. |
| Aerospace | GY05/GY17: instrument power budget and sensor interface | No aircraft dynamics, avionics certification or environmental qualification. |
| Chemical/process | GY14/GY17: temperature/pressure transmitter interface | Process behaviour and sensor calibration must be supplied independently. |
| Biomedical | GY14/GY15: amplifier/filter fed by an explicit synthetic signal | A circuit study does not establish physiological accuracy or suitability for patient connection. |
| Manufacturing/mechatronics | GY13/GY16/GY18: detector, logic and actuator-driver interface | PLC logic execution, robot motion and manufacturing workflows require other tools. |
| Energy/environmental | GY03/GY05: source/load and measurement interfaces | Solar/thermal/mechanical energy conversion needs a declared equivalent model or measured data. |
| Computing/software/robotics | GY16/GY18: hardware I/O, pulls, clocks and external drivers | No firmware execution, HDL synthesis or full embedded-system simulation. |

## Evidence and limits

Use a task brief, a labelled schematic, analytical predictions, declared component models, captured results and a plan for bench comparison. Where tolerances are varied, distinguish them from measurement uncertainty. Physical assembly, instrument operation and course assessment still need the department's required evidence.

TinyCAD is a circuit editor and electrical simulation environment, not a general engineering multiphysics tool. Semiconductor, sensor and digital components may need additional models; XSPICE-dependent digital circuits require attention to native/browser differences. No automatic fault-injection or hardware-data-acquisition feature is assumed here.

See [implementation status](10-implementation-status.md) and [instrument models](16-virtual-laboratory-and-p1-analysis.md). The [first-year electronics catalogue](25-first-year-degree-electronics-experiments.md) offers more specialised device/digital work, while the [physics catalogue](24-first-year-degree-physics-electronics-experiments.md) emphasises measurement and experimental analysis.

[warwick]: https://courses.warwick.ac.uk/modules/2025/ES191-15
[cambridge]: https://www.admissions.eng.cam.ac.uk/course/firstyear
[southampton]: https://www.southampton.ac.uk/courses/modules/elec1311
