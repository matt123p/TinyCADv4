# Technical reference

These documents describe TinyCAD's current implementation and the contracts useful when changing it.

| Document | Contents |
| --- | --- |
| [SPICE engine](spice-engine.md) | Runtime architecture, engine identity, model inputs, lifecycle, limits and verification. |
| [Simulation](simulation.md) | Analyses, sources, probes, charts, Circuit Explorer and virtual instruments. |
| [Drawing format](drawing-format.md) | XML/ZIP persistence, simulation records, numerical results and storage adapters. |
| [Libraries and examples](libraries.md) | Seven standard libraries, physical network panels, bundled amplifier/network examples, generation, provenance and content ownership. |
| [Teaching models](teaching-simulation-models.md) | Configurable digital, functional and sensor model behaviour and limitations. |
| [Teaching catalogue](teaching-catalogue.md) | Course context, experiment ideas and syllabus sources. |
| [Editor tools](editor-tools.md) | Layout API, connectivity constraints and Markdown drawing notes. |

The [symbol inventory](symbol-libraries/README.md) explains the machine-readable data used by library generators. Implementation details that change frequently belong in the linked source, recipes, schemas and tests.

Use **Standard → Network layout** for the 47 physical network device symbols, or **Open Example → Examples** for the transistor amplifier and small office network. The network example embeds its artwork and shows matching rack panels with socket-to-socket cabling. The standard catalogue keeps GCSE Physics and Teaching components; A-level, BTEC and degree inventories remain source material without bundled libraries.

For everyday use, see the separately maintained [TinyCAD v4 manual](https://docs.tinycad.net/v4/). Editable simulation drawings are in [examples/simulation](../examples/simulation/README.md), and recorded walkthroughs are in [tutorials](../tutorials/README.md).
