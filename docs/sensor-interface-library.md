# Sensors and interfaces

Enable **Sensors and interfaces** in the bundled-library chooser. This library supplies the ten remaining generic teaching drawings, sharing the existing component/digital family's thin black strokes, fonts and on-grid electrical connection points.

| Symbol | Drawing |
| --- | --- |
| Test point | One native passive pin, with its 4 mm lead ending exactly at the tangent of an open circle. The pin is the electrical terminal; there is no decorative replacement for its lead. |
| Hall-effect sensor | Yellow three-terminal powered sensor, H motif and incoming magnetic-field B arrow. |
| Piezoelectric sensor | The corrected SPICE capacitor's original electrodes, scale and pin positions, with a central piezo element, force arrow, polarity and PZ label. |
| Voltage-output light sensor | Yellow powered detector containing the corrected SPICE diode body and two incoming light arrows. |
| Voltage-output pressure sensor | Yellow powered detector with a diaphragm and incoming pressure arrow. |
| Voltage-output temperature sensor | Yellow powered detector with a thermometer motif; distinct from the existing two-terminal NTC thermistor. |
| Moisture sensor | Two interleaved electrodes and a water-drop motif, representing a passive resistive sensing interface. |
| pH probe | Labelled pH source circle with separate signal and reference terminals. |
| Voltage-controlled analogue switch | Open switch contacts and a dashed actuation link to a separate differential control input. A/B are passive switched terminals; CTRL+/CTRL− are control inputs. |
| AM modulator | Yellow AM functional block with a multiplier motif, separate differential carrier/message inputs and differential output. |

Logical numbers, terminal names, electrical types and terminal sides follow `all-symbols.json`. Supply and reference pins remain visible and explicitly wired. The Hall interface represents a conditioned, three-pin sensor, not a bare four-terminal Hall element. None of these generic terminal numbers claims a real IC package pinout.

These are original generic drawings informed by related circuit conventions. They are **not claimed to be standardised IEC sensor symbols**. The powered light sensor is distinct from the existing photodiode and LDR; the moisture sensor is distinct from an ambient-humidity IC. Sensing/calibration laws, switch thresholds and AM modulation laws require separate simulation adapters. Multiplication alone can produce suppressed-carrier modulation; conventional AM needs the intended carrier bias and modulation index to be defined by its model.

## Research references

Manufacturer references were checked before creating the drawings. They support the circuit concepts below rather than asserting a universal symbol for every generic sensor:

- [TI DRV5055](https://www.ti.com/lit/ds/symlink/drv5055.pdf): conditioned three-pin Hall sensor with supply, ground and analogue output.
- [TI OPT101](https://www.ti.com/lit/ds/symlink/opt101.pdf): photodiode and amplifier implementing a powered light-to-voltage interface.
- [TI LM35](https://www.ti.com/lit/ds/symlink/lm35.pdf): powered temperature-to-voltage interface.
- [NXP MPX5010](https://www.nxp.com/products/MPX5010D): conditioned piezoresistive pressure sensor.
- [ADI piezofilm sensor conditioning](https://www.analog.com/en/resources/technical-articles/2022/07/16/07/45/amplifier-provides-signal-conditioning-for-piezofilm-sensor.html): electrical piezo equivalent includes capacitance and a generated signal.
- [ADI CN0428](https://www.analog.com/en/resources/reference-designs/circuits-from-the-lab/cn0428.html): measuring/reference pH electrodes and their battery-like electrical equivalent.
- [ADI analogue switch](https://www.analog.com/en/resources/glossary/analog-switch.html): controlled analogue signal path and conventional switch representation.
- [ADI AD633](https://www.analog.com/media/en/technical-documentation/data-sheets/AD633.pdf): multiplier-based amplitude modulation.

## Generation and checks

```sh
npm run libraries:sensors
npm run libraries:package
npm run test:sensors
```

The [recipe](../library-recipes/sensors-interfaces.json) records drawing conventions, component bases and research URLs. The generator uses checked-in SPICE and NAND-derived style references without downloading any drawings or requiring the private SQL dump. It produces `bundled-libraries/sensors-interfaces/sensors-interfaces.tclib` and adjacent provenance with each source and drawing hash.

Tests check logical terminal contracts, electrical types, explicit supplies, reproducible packaging, pin/circle contact, editor placement in all eight rotations/mirrors and drawing save/load. The real netlist test also connects the test point's sole pin to a named net through a wire.

The picker assigns these ten drawings globally across all course bundles. Decisions outside this group are preserved. Saved SQL choices which still require adaptations remain a separate review step.
