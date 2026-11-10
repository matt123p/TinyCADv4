# Functional blocks library

Enable **Functional blocks** in the bundled-library chooser. The bundle contains 14 canonical interfaces and 17 entries, generated in the selected NAND-derived digital family's style: pale yellow bodies, thin black strokes, matching fonts, 4 mm leads and connection points on the 1 mm grid. Body widths grow to fit the terminal labels without colliding with the central function title.

The interfaces are ADC (4-bit), DAC (4-bit), communication channel, data logger, FPGA, microcontroller, output transducer, PCM encoder, PLC I/O, receiver, sample-and-hold, state machine, TDM multiplexer and transmitter.

Each symbol keeps the teaching inventory's logical pin numbers, names, sides and electrical types. Bidirectional GPIO uses native input/output electrical pins. Active-low `RESET_N` uses the native Dot shape. ADC, PCM encoder and state machine have rising-edge Clock and falling-edge DotClock variants with identical terminal positions. General clock inputs on FPGA, MCU, sample-and-hold and TDM interfaces remain plain clock ports; no particular edge or control timing is inferred.

Power and reference terminals remain **visible and explicitly wired**. Names such as VDD, VSS, GND, VCC, COMMON, VREF and REF are preserved. They do not silently connect to the digital family's hidden VCC/VSS rails or to other blocks' reference terminals.

These are **diagram-only generic interfaces**, not physical package pinouts or executable simulation models. ADC conversion, firmware, HDL, data logging, communication and physical transduction require a separate implementation. No unrelated SPICE template is copied into the bundle.

The shared picker assigns all 14 types to these drawings, retaining both edge variants for the three clocked types. One assignment applies across all course bundles. Other saved choices are preserved.

## Build and verification

```sh
npm run libraries:functional
npm run libraries:package
npm run test:functional
```

The [recipe](../library-recipes/functional.json) uses the generated digital full-adder as its style reference. Generation reads the checked-in NAND source and SPICE style reference; it requires no private SQL dump. Outputs are `bundled-libraries/functional/functional.tclib` and its adjacent provenance JSON, recording the source style, recipe and every drawing hash.

Tests cover complete inventory and terminal coverage, electrical types, native pin shapes, digital resource reuse, grid alignment in all eight rotations/mirrors, editor placement, drawing save/load and reproducible SQLite packaging.
