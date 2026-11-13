# Technical reference

These documents describe TinyCAD's current implementation and the contracts useful when changing it.

| Document | Contents |
| --- | --- |
| [SPICE engine](spice-engine.md) | Runtime architecture, engine identity, model inputs, lifecycle, limits and verification. |
| [Simulation](simulation.md) | Analyses, sources, probes, charts, Circuit Explorer and virtual instruments. |
| [Drawing format](drawing-format.md) | XML/ZIP persistence, simulation records, numerical results and storage adapters. |
| [Libraries and examples](libraries.md) | Ten standard libraries, physical board/equipment layouts, seven explained example drawings, generation, provenance and content ownership. |
| [Teaching models](teaching-simulation-models.md) | Configurable digital, functional and sensor model behaviour and limitations. |
| [Editor tools](editor-tools.md) | Layout API, connectivity constraints and Markdown drawing notes. |

The [symbol inventory](symbol-libraries/README.md) explains the machine-readable data used by library generators. Implementation details that change frequently belong in the linked source, recipes, schemas and tests.

Use **Standard → Network layout** for the 47 physical network device symbols, or **Open Example → Examples** for the transistor amplifier and small office network. The network example embeds its artwork and shows matching rack panels with socket-to-socket cabling. The same collection includes explained examples for embedded/smart home, solar/batteries, Audio & Music, Test & Measurement, and Motors & Motion. Each opens as a standalone editable drawing; the **Explanation** panel keeps the connection tables and extension ideas available.

Use **Standard → Embedded processors and smart home** for 44 PCB wiring symbols with physical headers, sensor function icons and LCD/OLED/touch/e-paper screens. The [library guide](embedded-smart-home.md) includes the board inventory, galleries, source survey and pinout conventions.

Use **Standard → Audio & Music** for 99 compact resources for PA systems, studios, podcasts, instruments/MIDI and audio cabling. The [guide](audio-music.md) includes the inventory, original artwork, connector semantics and online survey. [A4 previews](audio-music-a4.png) demonstrate native placement sizes.

Use **Standard → Test & Measurement** for 78 compact lab setup resources: power supplies, instruments, probes, acquisition, heaters, relays, controls and laboratory apparatus. The [guide](test-measurement.md) covers the inventory and conductor/cable/hose connections, with an [A4 placement preview](test-measurement-a4.png).

Use **Standard → Motors & Motion** for 66 robotics and automation resources: motors, steppers, servos, drivers, feedback, limit sensors, solenoids, actuators and mechanical parts. The [guide](motors-motion.md) includes carrier pin maps, sources and galleries, with an [A4 placement preview](motors-motion-a4.png).

Use **Standard → Solar power and batteries** for the 52 supplied home-energy planning symbols, covering generation, storage, EV charging, supply equipment, monitoring and loads.

For everyday use, see the separately maintained [TinyCAD v4 manual](https://docs.tinycad.net/v4/). Editable simulation drawings are in [examples/simulation](../examples/simulation/README.md), and recorded walkthroughs are in [tutorials](../tutorials/README.md).
