# Libraries and examples

## Standard library catalogue

[bundled-libraries/config.json](../bundled-libraries/config.json) lists the read-only `.tclib` bundles shared by Electron and both browser modes. Its contract is [bundled-libraries.schema.json](../schemas/bundled-libraries.schema.json).

Each entry has a stable unique `id`, display `name`, relative `path` and optional `description`. Paths use forward slashes and stay inside `bundled-libraries/`. Keep IDs stable so saved selections survive updates. Directory paths locate files; the chooser displays a flat symbol list.

The **Standard Libraries** selector loads one library at a time. Only the catalogue loads initially; unselected libraries are not downloaded or parsed. Choosing another library releases the previous one. The selection persists separately from personal library configuration. Failed loads offer Retry and allow a different selection. Standard libraries support preview, search, placement and replacement; personal libraries retain their editing controls.

Packaged assets live under `dist/bundled-libraries/`. Browser deployment preserves that directory; desktop reads packaged resources through restricted IPC. [package-libraries.mjs](../scripts/package-libraries.mjs) validates the catalogue and referenced files. Tests: `npm run test:libraries`.

## Bundles and electrical conventions

| Bundle | Contents and contracts |
| --- | --- |
| SPICE essentials | 27 entries: passives, transformer, resonators, discrete semiconductors, coloured LEDs, 741 and independent sources. European and US resistor variants share connectivity. |
| Digital logic | 21 canonical types / 28 entries: gates, combinational blocks, counters, shift register, flip-flops and latches. Seven clocked types have separate rising/falling entries. |
| Functional blocks | 14 interfaces / 17 entries: ADC/DAC, communications, logger, MCU/FPGA/PLC, sample-and-hold, state machine, PCM/TDM and transducer. ADC, PCM and state machine have both clock-edge variants. |
| Sensors and interfaces | Ten generic types: test point, Hall, piezo, light/pressure/temperature voltage sensors, moisture, pH, analogue switch and AM modulator. |
| Teaching components | 116 entries covering 96 non-editor inventory types, including artwork/clock variants. Ten course libraries select from that same set. |

Digital supplies are native hidden **Power** pins named **VCC** and **VSS**. Connect those named nets to actual supplies; VSS is not implicitly node `0`. **Show power pins** exposes them. Native Dot, Clock and DotClock pin shapes convey inversion and edge polarity. Functional and sensor power/reference pins are visible and require explicit wiring.

Generic logical pin numbers are not commercial package pinouts. Preserve each inventory's terminal names, electrical types and polarity. The test point has one real passive pin; it is electrically connected rather than decorative. Six editor/connectivity inventory types use native wire/junction/label/ground/no-connect/annotation operations. Built-in instruments, probes and waveform sources are listed as `existing_tools` dependencies, outside generated symbol requirements.

All teaching components carry configurable educational models. MCU/FPGA/PLC behaviour does not execute firmware or HDL. Supply loading, timing, physical calibration and analogue limits are simplified. [Teaching models](teaching-simulation-models.md) specifies parameters and tested semantics. A symbol or inventory record alone does not establish a simulation model.

## SPICE essentials

Use **Simulation → Components** for common parts; **More…** opens the full standard library. Placed symbols retain hidden `$$SPICE` attributes. Numeric SPICE suffixes include `1k`, `10u`, `100n` and `1Meg`; `m` means milli. `Model`/`Model Name` selects a device model; an empty `Model File` emits the embedded generic definition. Custom model text must also satisfy the [engine input policy](spice-engine.md#deck-and-model-contract).

| Component | Drawing terminals / model |
| --- | --- |
| BJT | 1 base, 2 emitter, 3 collector; template emits collector/base/emitter order. |
| MOSFET | 2 gate, 3 drain, 4 source; bulk tied to source. |
| Diode, zener, LED | 1 anode, 2 cathode. |
| 741 | 3 IN+, 2 IN−, 7 positive supply, 4 negative supply, 6 output. Offset-null pins omitted. |
| Potentiometer | Ends 1/2, wiper 3; two resistor segments with a 1 micro-ohm floor. |
| Transformer | Primary 1/2, secondary 3/4; coupled ideal inductors, no saturation/winding resistance. |
| Resonators | Motional series RLC in parallel with shunt capacitance. |

The 741 behavioural model approximates 200,000 open-loop DC gain, 2 Megohm differential input resistance, 5 Hz dominant pole, 0.5 V/µs slew limit, 75 ohm output resistance and rail clipping with 2 V headroom. It omits bias/offset, common-mode validity, temperature, noise, short-circuit current and full stability effects. Generic diode/transistor/LED/resonator models are teaching approximations; LED colour is not calibrated brightness. Electrolytic polarity is graphical and is not enforced by its ideal capacitor model. Core inductors remain linear.

## Sources, recipes and provenance

[library-recipes](../library-recipes) records selections and guarded adaptations. Adjacent `*.provenance.json` files in [bundled-libraries](../bundled-libraries) retain attribution, source IDs, hashes and drawing/model changes; bundle metadata is also embedded in SQLite `TinyCADBundleInfo`.

SPICE artwork comes from **onetransistor** and templates from **aryajur** in the legacy SQL collection. The digital style derives from **matt**'s NAND (SymbolID 160 / NameID 9279), retained as [nand-reference.xml](../library-sources/digital/nand-reference.xml). Selected course artwork is frozen under [library-sources/teaching](../library-sources/teaching), including explicit pin and geometry repairs. The digital/functional/sensor/course generators use checked-in sources without a private SQL dump or selection UI.

Connection points use the 1 mm grid. SPICE resistor variants share their 2 × 5.2 mm envelope; digital family drawings use pale yellow bodies and 4 mm signal leads. Native inversion/clock markers and explicit pin corrections must survive rotations, mirrors, placement and save/load.

[build-library-from-sql.mjs](../scripts/build-library-from-sql.mjs) remains the legacy import boundary. It parses selected literal INSERT records rather than running a database. Recipes select exactly one visible component by source ID or name, optionally merge `spiceFrom`, override attributes, and apply guarded `pins`/`geometry` changes. `requireSpice` validates template macros, not electrical behaviour. Keep SQL dumps outside the repository: unrelated account/application records do not belong in exported content.

See [spice.json](../library-recipes/spice.json), [digital.json](../library-recipes/digital.json), [functional.json](../library-recipes/functional.json) and [sensors-interfaces.json](../library-recipes/sensors-interfaces.json) for full recipe contracts. Model implementations live in [teaching-models.mjs](../scripts/lib/teaching-models.mjs); [selected-artwork.mjs](../scripts/lib/selected-artwork.mjs) owns the frozen selection adaptations. The [symbol inventory guide](symbol-libraries/README.md) describes course coverage data.

Regression commands are `test:spice`, `test:digital`, `test:functional`, `test:sensors`, `test:teaching` and `test:symbol-artwork` through npm. Coverage includes terminal contracts, actual editor placement, rotated/mirrored geometry, hidden rails, reproducibility, persistence and numerical model cases where an engine is available.

## Bundled examples

[bundled-examples/config.json](../bundled-examples/config.json) uses [bundled-examples.schema.json](../schemas/bundled-examples.schema.json). The checked-in catalogue is empty; standalone simulation fixtures are separately retained in [examples/simulation](../examples/simulation/README.md).

Groups require unique `id`, `title`, `preview`, `examples` and exactly one of inline `description` or UTF-8 `descriptionPath`. Drawing entries add `path` and an ID unique within the group. Paths stay under `bundled-examples/`; previews are supplied images. Catalogue `assets` lists additional description images. Relative images resolve beside the Markdown file, or from the catalogue root for inline text.

**Open Example** loads descriptions/previews on demand and opens a drawing only when requested. Markdown descriptions support links/images/tables and sanitized HTML. An example opens as a new editable drawing with no association to its bundled source. Save creates a user copy. Unsaved-change cancellation preserves the original document; a successful open clears its undo history.

[package-examples.mjs](../scripts/package-examples.mjs) validates and stages only referenced resources into `dist/bundled-examples/`. Desktop reads them through restricted IPC. Tests: `npm run test:examples`.
