# First-year physics degrees: electronics experiments supported by TinyCAD

Research checked: **10 November 2026**.

## Representative syllabuses

There is no single first-year physics syllabus. This document proposes an electronics strand based on published UK university examples; it does not claim every university runs these experiments or teaches every topic in year one.

| Reference | Published course evidence | How it is used here |
| --- | --- | --- |
| **P-LAB** | [Warwick PX152-30 Physics Laboratory, 2025/26][lab], undergraduate Level 1: practical investigation, data/uncertainty work and electronic circuits involving transistors, op-amps and logic | Basis for measurement practice, electronic building blocks and comparison with real experiments. |
| **P-CIR** | [Warwick PX157-10 Electricity and Magnetism, 2025/26][circuits], undergraduate Level 1: DC/AC circuit theory and reactive networks | Basis for passive-circuit experiments. The current [first-year module list][year] provides programme context. |
| **P-PROJ** | [Glasgow's first-year PHYS1001 project-based laboratory case study][project] | Evidence of sensor-calibration/electronics project work at this level; it is a published teaching case, not a promise about every current Glasgow lab allocation. |

The experiments below are our own proposals derived from these topic areas. The module pages give indicative content, not the detailed experimental scripts below. Physical fields, optics, mechanics, radiation experiments and apparatus construction are excluded except for the electrical interface to a sensor.

**Both** means diagram plus electrical simulation. **Both, model needed** requires a compatible device model or calibrated equivalent input. **Diagram** means documentation without a complete simulation of the central process. All models require valid SPICE mappings. These are proposed lessons, not existing completed lesson files.

## Experiment catalogue

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

## Making the degree-level exercise useful

Require a prediction, assumptions, an experiment plan, raw results, uncertainty treatment and a comparison between simulation and bench data. A close fit does not prove a model independently when its component values were fitted to those same data. Export for regression, residual plots or error bars where needed.

Keep the level appropriate to the actual course: a transistor/op-amp workshop can be included where the department teaches it, but the presence of a first-year electricity module elsewhere does not establish that the same electronics is compulsory there. Contact the department's current module specification before using this as a complete year-one plan.

TinyCAD does not measure plate geometry, thermal response or optical input, and it does not acquire from real instruments. The scope uses recorded simulated acquisitions. Digital models may depend on native XSPICE support and are not an HDL/firmware workflow. See [implementation status](10-implementation-status.md) and [instrument models](16-virtual-laboratory-and-p1-analysis.md).

The [divider](../examples/simulation/voltage-divider.dzn), [RC charging](../examples/simulation/rc-charging.dzn) and [virtual laboratory](../examples/simulation/virtual-laboratory.dzn) files can seed a lesson. They require additional instructions and evidence requirements for the proposed degree-level investigations.

[lab]: https://courses.warwick.ac.uk/modules/2025/PX152-30
[circuits]: https://courses.warwick.ac.uk/modules/2025/PX157-10
[year]: https://warwick.ac.uk/fac/sci/physics/prospective/undergraduate_study/physics_courses/firstyrmodules/
[project]: https://www.gla.ac.uk/myglasgow/learningandteaching/activelearning/casestudies/project-based-learning/
