# Teaching symbol libraries: extraction/generation handoff

Prepared **10 November 2026**, from the ten GCSE, A-level, BTEC and degree catalogues.

Start with **[library-manifest.json](library-manifest.json)**. This single self-contained JSON collection contains ten independent libraries, all experiment descriptions/references, and the full symbol records. Another application does not need to scrape the Markdown documents.

## Files

| File | Purpose |
| --- | --- |
| [all-symbols.json](all-symbols.json) | Deduplicated master: one full definition per symbol type, with all course/experiment usage retained. |
| [all-symbols.csv](all-symbols.csv) | The same deduplicated set as CSV, one row per symbol type. |
| [library-manifest.json](library-manifest.json) | Recommended complete machine-readable handoff. |
| [symbols.csv](symbols.csv) | One row per symbol per course, with aliases, folder, logical pins, drawing notes and simulation requirements. |
| [experiment-symbol-map.csv](experiment-symbol-map.csv) | One row per experiment, with its syllabus reference and symbol lists. |
| [symbol-library.schema.json](symbol-library.schema.json) | JSON Schema draft-07 contract for collections and standalone library files. |
| [INVENTORY.md](INVENTORY.md) | Complete human-readable checklist, grouped by course and proposed folder. |
| `libraries/*.json` | Self-contained individual course libraries, linked below. |

All files use UTF-8. CSV fields are quoted with doubled embedded quotes and CRLF records. Parse CSV before interpreting columns ending in `_json`; those cells contain arrays or objects. JSON retains the richest metadata.

**Already supplied equipment is excluded from generation:** the oscilloscope, three-socket multimeter, function generator, bench supply, voltage probe, differential probe and current probe. These appear only in `existing_tools`/`existing_tool_ids` as dependencies, with `already_provided: true` and `generate_symbol: false`. The deduplicated generation list now contains **112 types**.

Conventional circle-A, circle-V and circle-Ω symbols remain available for textbook circuit diagrams; they are distinct from the branch's built-in multimeter. Native editor primitives remain separately typed and should use existing editor operations.

## Libraries

| Course | Standalone JSON |
| --- | --- |
| GCSE Physics, AQA 8463 | [gcse-physics-aqa](libraries/gcse-physics-aqa.json) |
| A-level Physics, AQA 7408, including optional Electronics | [a-level-physics-aqa](libraries/a-level-physics-aqa.json) |
| BTEC First Certificate Engineering, selected Unit 8 | [btec-first-engineering](libraries/btec-first-engineering.json) |
| BTEC National Extended Diploma Applied Science 2016, selected Unit 15 | [btec-applied-science-2016](libraries/btec-applied-science-2016.json) |
| BTEC National Applied Science AAQ Extended Certificate | [btec-applied-science-aaq](libraries/btec-applied-science-aaq.json) |
| BTEC National Extended Diploma Electrical/Electronic Engineering, selected Unit 19 | [btec-national-electrical-electronic-engineering](libraries/btec-national-electrical-electronic-engineering.json) |
| BTEC HNC Electrical/Electronic Engineering for England, Unit 4019 | [btec-hnc-electrical-electronic-engineering](libraries/btec-hnc-electrical-electronic-engineering.json) |
| First-year physics degree | [degree-year1-physics](libraries/degree-year1-physics.json) |
| First-year electronics degree | [degree-year1-electronics](libraries/degree-year1-electronics.json) |
| First-year engineering degrees, shared strand | [degree-year1-engineering](libraries/degree-year1-engineering.json) |

Source-document paths inside JSON/CSV are relative to the **repository root**. Each library retains its syllabus-source URLs and links to the corresponding use-case document. Degree coverage remains a representative proposal, not a universal syllabus.

## Coverage and folders

Symbols are intentionally repeated between libraries. `canonical_symbol_id` identifies a reusable generic type if an extraction cache is useful; deduplication is optional. Each library's `symbols` array is complete independently.

For a single generation queue, use **all-symbols.json** instead: it merges by canonical ID, rejects conflicting definitions, and retains the original per-course roles in `library_usage`. The combined list includes shared supporting symbols and editor primitives; these remain explicitly typed, rather than being mistaken for physical components. No type in the present master is optional-only across all courses.

For an experiment, combine its `experiment_symbol_ids` with the library's `common_symbol_ids`. Reverse mappings are in `used_by_experiments`. `library_requirement` distinguishes `experiment_coverage`, `common_support`, and `optional_extension`. An experiment-specific symbol can also be shared support, indicated by `common_support_symbol`.

If the target app needs **one library per individual experiment**, create one from that union of IDs and copy the matching complete symbol records from its course library. All 214 experiments have an explicit mapping, so this does not require another interpretation of the syllabus. Optional extensions can be added separately when wanted.

This is a **coverage inventory, not a minimal circuit BOM**. Comparative and alternative implementations may need several transistor types. A bridge uses repeated diode/resistor instances; those are not separate reusable symbol definitions. Resistance, capacitance and LED colour are properties. Explicit optional entries do not create new syllabus requirements.

`folder` is a proposed slash-separated logical path, such as `02 Semiconductors/Transistors`. The consumer may build a tree, retain paths as tags or flatten them into names. **No library-subfolder feature is implemented by this work.** The twelve top-level groups cover passives, semiconductors, sensors, switches, sources, outputs, analogue, digital, functional blocks, instruments, connections and editor primitives.

## Extraction/generation contract

1. Search trusted symbol sources using `name`, `aliases` and `search_terms`, or generate a generic educational symbol from `drawing_description`. Preserve terminal meanings, polarity, count and placement. Prefer IEC/UK teaching conventions; visual variants must keep connectivity.
2. `logical_number` is an inventory identifier, **not a package pinout**. Generic MCU, FPGA, counter and sensor interfaces must not be silently identified with a commercial part. Verify an authoritative device pinout before making package-specific assets.
3. Retain IDs, reference prefixes, folder metadata and configurable properties. The prefix is a naming suggestion, not a complete SPICE mapping.
4. Keep artwork and model requirements separate. A SPICE family hint is not a complete template. No executable models, footprints or geometry are supplied here; `ready_to_simulate_from_this_manifest` is deliberately false.
5. Use `existing_tools[].native_tool` for the supplied instruments/probes. They are outside `symbols` and must not be extracted or regenerated as library requirements. Experiment dependencies are listed in `existing_tool_ids`; shared dependencies have `common_support_tool: true`.
6. For `editor_primitive`, use native wire, junction, label, ground, no-connect and annotation features. Do not create electrically disconnected pictures of connectivity primitives.
7. Keep `diagram_block` entries diagram-only until a real implementation is supplied. Firmware, HDL, ADC operation and physical sensing are not generated by a symbol.

When connecting existing tools, the supplied multimeter's logical terminals are **1 = V Ω, 2 = COM, 3 = A**. Current uses A–COM; voltage/resistance use V Ω–COM. The supplied scope's A+, A−, B+, B− inputs remain separately connected. These are integration notes, not new symbol requirements.

## Instruction to pass to another app

> Read `library-manifest.json`. Create one independent symbol library per `library_id`, retaining the proposed folder paths as metadata. Extract or generate the `symbols` entries, preserving IDs, aliases, terminal contracts and experiment mappings. Use native editor operations for editor primitives. Do not generate `existing_tools`: those instruments and probes are already supplied. Report unresolved models or package pinouts separately; do not mark artwork ready to simulate. Duplicated symbols between course libraries are allowed.

## Regeneration

From the repository root:

```sh
node scripts/generate-teaching-symbol-libraries.mjs
```

The script reads the ten Markdown catalogues and its curated symbol assignments. It rejects missing/unknown experiment mappings, unknown symbols and duplicate logical pin numbers. Curate mappings when adding experiments, then regenerate. The schema and this guide are maintained separately.
