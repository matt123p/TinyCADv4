# Bundled SPICE models

TinyCAD offers 77 SPICE models in the browser and 80 in the Electron desktop app. Search and attachment run locally once the picker has loaded. Each model links to its upstream definition or to the upstream archive and its member filename. TinyCAD records the revision or archive checksum and includes the notices with the bundled model packs.

## Choose a model

1. Open the **SPICE** tab in the library symbol editor or on a placed symbol, then choose **Bundled → Find SPICE model…**.
2. Search by part number, alias, model ID or device family. Exact model IDs rank first, followed by exact aliases and partial matches. Select a row to see its source link, terminal order and any adjustable parameters below the table. **View SPICE definition** expands the instance template, model text and required helper subcircuits.
3. Review the pin mapping. For tagged **SPICE essentials** symbols, the picker only lists models with a preverified mapping for the current pin layout. Other symbols, including older placements without the library identity, can browse the models available in their edition and map terminals manually. TinyCAD suggests unambiguous pin matches and requires a distinct pin for each terminal. Hidden supply pins are included. A library symbol with multiple parts offers the pin numbers shared by those parts because its template applies to every part.
4. Choose **Select SPICE model**. On a placed symbol, attachment is one undoable drawing edit. In the library editor, it sets the default for future placements from that saved library entry. If the symbol has no compatible catalog models, **Find SPICE model…** displays an inline error. **Remove attached model** restores the previous template.

## Edit a local copy

**Custom** opens the editable SPICE template, prologue and epilogue fields. Switching from an attached bundled model to **Custom** keeps the mapped pins and parameter settings and copies the model and its dependencies into the **Prologue**. The copied definitions use names scoped to the schematic reference, so the edited model can run alongside the bundled original and other copies.

Switching back to **Bundled** restores the linked model. Switching to **Custom** again restores your edits. Both settings survive save and reopen, and the selected mode determines which model runs. On a placed symbol, edits apply to that instance. In the library symbol editor, saving the edited symbol makes its active definition the default for future placements. The copy retains the upstream source link and licence in SPICE comments.

## Catalog sources

| Source | Models in TinyCAD | Contents |
| --- | ---: | --- |
| OpenJellyBean 0.6.0 | 42 | BJTs, MOSFETs, JFETs, signal and Schottky diodes, zeners, LEDs, op-amp sections and complete packages, and a potentiometer. [Catalog](../bundled-libraries/spice/openjellybean.json) · [Pinned upstream library](https://github.com/xdylanm/openjellybean/blob/0d0d9b659b202368dc419f8276bacb1e39694915/jellybean.lib) |
| circsim | 15 | LM741, yellow LED, LM393, LM339, NE5532, NE555, PC817, 4N35, LM317, TL431, 7805, IRLZ44N, IRF540N, IRF3205 and IRF9540N. [Catalog](../bundled-libraries/spice/circsim.json) · [Pinned upstream inventory](https://github.com/epim/circsim/blob/059858b15671c3edaf4c62f944ecb8c7420ae1d4/resources/models/index.json) |
| Spice_Files | 14 | The three original MIT model files cover LEDs, zeners, a rectifier diode and bridge, optocouplers, a switch, a relay, a 16 MHz crystal and a 10:1 transformer. [Catalog](../bundled-libraries/spice/spice-files.json) · [Upstream licensing notice](https://raw.githubusercontent.com/BoredDog/Spice_Files/main/NOTICE.md) |
| ngspice special models | 1 | ICL8038 waveform generator, with a PNP model card in place of the upstream `LPNP` type rejected by ngspice 47. [Catalog](../bundled-libraries/spice/ngspice-special.json) |
| ngspice special models (desktop) | 3 | LTC1044HV voltage inverter, LR8 regulator and the regulator’s helper op-amp. This pack uses native XSPICE. [Catalog](../bundled-libraries/spice/ngspice-xspice.json) |
| SkyWater SKY130 | 1 | Nominal integrated PNP transistor with a substrate terminal. [Catalog](../bundled-libraries/spice/sky130.json) |
| GlobalFoundries GF180MCU | 3 | Nominal MIM capacitors with densities of 1.0, 1.5 and 2.0 fF/µm². [Catalog](../bundled-libraries/spice/gf180mcu.json) |
| IHP SG13G2 | 1 | Nominal pnpMPA integrated PNP transistor. [Catalog](../bundled-libraries/spice/ihp-sg13g2.json) |

The picker labels the models as typical approximations. The circsim `LM741` represents nominal gain, bandwidth, slew rate, offset and supply current. Its input stage is high impedance and its offset-null pins are omitted. The circsim `LED_YELLOW` models electrical behaviour and is fitted to 2.10 V at 20 mA. [LM741 definition](https://github.com/epim/circsim/blob/059858b15671c3edaf4c62f944ecb8c7420ae1d4/resources/models/opamp.lib#L235) · [Yellow LED definition](https://github.com/epim/circsim/blob/059858b15671c3edaf4c62f944ecb8c7420ae1d4/resources/models/discrete-extra.lib#L54)

### Licence and model coverage

TinyCAD is GPL-3.0-only. The Apache Software Foundation and the Free Software Foundation confirm that Apache-2.0 material can be included in a GPLv3 project. The foundry packs retain the Apache-2.0 licence, original copyright notices and descriptions of TinyCAD’s adaptations. They contain self-contained nominal models. Full foundry kits use their own model trees, process corners, simulator setup and, for some devices, compiled model plugins such as IHP’s PSP OSDI models. [Apache Software Foundation](https://www.apache.org/licenses/GPL-compatibility.html) · [Free Software Foundation](https://www.gnu.org/licenses/license-compatibility.html) · [IHP technology library documentation](https://ihp-open-pdk-docs.readthedocs.io/en/latest/contents/technology_libraries/index.html)

The ngspice engine uses a modified BSD licence with separate bundled notices. Its model downloads have individual terms. The ICL8038 and LTC1044 files explicitly declare BSD-3-Clause. The LR8 file marks its regulator and helper op-amp as public domain. The starter set includes vendor models with separate terms, and the 741, 555 and `74HCxxxM` files reviewed for this import include no clear redistribution grant. The LM3914 header identifies a modified BSD licence and credits earlier model development whose terms were unverified. The Micro-Cap and University of Granada downloads are third-party collections without a verified collection-wide grant. [ngspice engine notices](../licenses/ngspice-47-copying.txt) · [ngspice model downloads](https://ngspice.sourceforge.io/modelparams.html)

## Compatibility with SPICE essentials

The catalogs have 34 preverified symbol-to-model pairings across 19 of the 29 **SPICE essentials** symbols. OpenJellyBean supplies 22 pairings, circsim supplies six and Spice_Files supplies six. The numbers below are TinyCAD pin numbers in SPICE terminal order. [SPICE essentials terminal contracts](libraries.md#spice-essentials)

| Bundled symbol | Compatible catalog models | Pins in model order |
| --- | --- | --- |
| Potentiometer, Trimmer resistor, Potentiometer (US), Trimmer resistor (US) | `POT_OJ` | 1, 3, 2 (end A, wiper, end B). TinyCAD initialises `R` from `Value` and `POS` from `Wiper`. |
| NPN transistor | `BC547B_OJ`, `2N3904_OJ` | 3, 1, 2 (collector, base, emitter) |
| PNP transistor | `BC557B_OJ`, `2N3906_OJ` | 3, 1, 2 (collector, base, emitter) |
| N-channel MOSFET | `2N7000_OJ`, `MIRLZ44N`, `MIRF540N`, `MIRF3205` | 3, 2, 4 (drain, gate, source) |
| P-channel MOSFET | `BS250_OJ`, `MIRF9540N` | 3, 2, 4 (drain, gate, source) |
| Diode | `1N4148_OJ`, `1N5819_OJ`, `BAT54_OJ`, `B140_OJ`, `DRECT_GEN` | 1, 2 (anode, cathode) |
| Zener diode (5.1 V) | `BZX79C5V1_OJ`, `1N4733A_OJ`, `ZENER_OJ`, `1N4733A_GEN` | 1, 2 (anode, cathode) |
| LED (red), LED (green), LED (blue), LED (yellow) | `LED_RED_OJ`, `LED_GREEN_OJ`, `LED_BLUE_OJ`, `LED_YELLOW`, respectively | 1, 2 (anode, cathode) |
| LED (red), LED (green) | `LED_RED_GEN`, `LED_GREEN_GEN`, respectively | 1, 2 (anode, cathode) |
| XTAL (quartz crystal) | `XTAL_16M` | 1, 2 |
| Transformer | `XFMR_10TO1` | 1, 2, 3, 4 (primary dot, primary return, secondary dot, secondary return) |
| 741 op-amp | `LM741` | 3, 2, 6, 7, 4 (IN+, IN−, output, positive supply, negative supply) |
| LM358 | `LM358_DUAL_OJ` | 1–8 in package order |
| LM324 | `LM324_QUAD_OJ` | 1–14 in package order |

### Symbols that use their built-in templates

The following 10 symbols have no compatible catalog entry. Their built-in SPICE templates are available under **Custom**.

| Category | Symbols |
| --- | --- |
| Fixed resistors | Resistor, Resistor (US) |
| Capacitors | Capacitor, Electrolytic capacitor, Trimmer capacitor |
| Inductors | Inductor, Inductor with core |
| Resonators | Ceramic resonator |
| Sources | DC / AC voltage source, DC / AC current source |

The yellow LED and 741 op-amp have no OpenJellyBean pairing. Their bundled alternatives come from circsim.

## AI chatbot tools

The Electron chatbot uses the same catalog, compatibility checks, template generator and attachment action as the picker. Search and inspection are read-only. Attachment rechecks the drawing revision and requires confirmation before replacing an existing custom template. [TinyCAD assistant](chatbot.md) · [Tool definitions](../src/chat/tool-specs.ts)

| Tool | What it does |
| --- | --- |
| `search_spice_models` | Returns model IDs, source links, descriptions, ordered terminal roles and parameter defaults. Scopes results to compatible models when given a tagged bundled symbol. |
| `inspect_spice_target` | Resolves a placed symbol by selection or reference and sheet. Returns its pins, template or attachment, the drawing revision and mapping information for an optional model. |
| `attach_spice_model` | Applies an exact model and pack revision in one undoable edit. Uses a preverified mapping when available or validates a user-supplied terminal-to-pin mapping. |

## Saving, simulation and export

Drawings retain each attachment’s pinned revision, mapping and parameters through XML and ZIP saves. Drawing-level attachments share a pack at drawing level. A model inherited from a TCLib symbol can carry its pinned pack in the symbol’s hidden binding. [Drawing format](drawing-format.md)

TinyCAD generates the instance statement from the model’s SPICE designator and mapped pins. For example, the bundled NPN symbol with `2N3904_OJ` uses `QTC_$(ref) %(3) %(1) %(2) 2N3904_OJ`. TinyCAD resolves the macros to the schematic reference and connected nets when it builds the deck. [Netlist writer](../src/io/netlists/netlistSpice.ts)

Each simulation stages one local include per referenced pack alongside any setup-local model files. TinyCAD detects model definition and filename conflicts before invoking the engine. Regular SPICE export embeds the referenced catalog model text and licence notices inline in the `.cir` file. [SPICE engine](spice-engine.md) · [Deck preparation](../src/simulation/deck.ts)

## Maintaining the catalogs

Run `python scripts/build-openjellybean-catalog.py` with Python 3.11 or newer to regenerate the JSON catalogs offline. Add `--check` to compare the checked-in catalogs with the generated output. The script reads the pinned source files and the shipped SQLite symbol library. Each JSON stores the pack text, checksum and licence, plus descriptions, aliases, terminal order, parameter defaults, compatibility mappings and source URLs for individual models. [Generator](../scripts/build-openjellybean-catalog.py) · [Additional source manifest](../library-sources/spice-catalogs/manifest.json)

The [catalog regression tests](../scripts/tests/simulation-model-catalog.test.mjs) run in the simulation and chat suites. They cover pinned sources, compatibility, attachment, drawing round-trips and portable netlists. The [picker browser tests](../scripts/tests/layout-browser/spice-picker.spec.mjs) cover offline selection, TCLib persistence and Custom copies in browser and Electron renderer builds. The [engine qualification fixtures](../scripts/tests/qualify-engines.mjs) exercise bundled models on native and WebAssembly ngspice.
