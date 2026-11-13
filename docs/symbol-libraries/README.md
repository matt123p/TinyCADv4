# Teaching symbol inventory

These are data inputs to the checked-in library generators. The [teaching catalogue](../teaching-catalogue.md) supplies course context, stable experiment IDs and syllabus sources; [libraries](../libraries.md) and [teaching models](../teaching-simulation-models.md) describe the executable bundles.

| File | Purpose |
| --- | --- |
| [library-manifest.json](library-manifest.json) | Complete collection: ten courses, 214 experiments, symbol records and built-in-tool dependencies. |
| [all-symbols.json](all-symbols.json) | 102 deduplicated types: 96 component types plus six native editor/connectivity types. |
| [all-symbols.csv](all-symbols.csv) | Deduplicated inventory as CSV. |
| [symbols.csv](symbols.csv) | One symbol/course row with logical pins and requirements. |
| [experiment-symbol-map.csv](experiment-symbol-map.csv) | One experiment row with its symbol/tool coverage. |
| [symbol-library.schema.json](symbol-library.schema.json) | Draft-07 schema for collections and standalone libraries. |
| `libraries/*.json` | Self-contained individual course inventories. |
| [symbol-choices.json](symbol-choices.json), [selection-rules.json](selection-rules.json) | Recorded artwork choices and style inputs; selected XML is frozen in `library-sources/teaching/`. |

For one experiment, combine `experiment_symbol_ids` with `common_symbol_ids`; resolve native tool dependencies through `existing_tool_ids` and shared `existing_tools`. Use `canonical_symbol_id` for cross-course deduplication. `library_requirement` distinguishes experiment coverage, common support and optional extensions. Repeated component instances and different values are not additional reusable types.

`logical_number` is an inventory terminal ID, not a physical package pinout. `folder` is slash-separated metadata, not an implemented library-browser hierarchy. `editor_primitive` uses native editor operations. `existing_tools` identifies built-in scope/meter/generator/supply/probes/sources that must not be duplicated as library symbols. Scope inputs are A+, A−, B+, B−; meter terminals are 1 V Ω, 2 COM, 3 A.

The inventory describes requirements; `ready_to_simulate_from_this_manifest: false` refers to inventory records. Executable educational models live in generated `.tclib` entries and `scripts/lib/teaching-models.mjs`. Test points/connectors use comment-only templates rather than artificial loads or shorts.

Source-document paths are relative to the repository root and include course section anchors. JSON retains the richest metadata. CSV is UTF-8 with quoted fields, doubled quotes and CRLF records; parse CSV before decoding `_json` cells.

[scripts/generate-teaching-symbol-libraries.mjs](../../scripts/generate-teaching-symbol-libraries.mjs) reads the consolidated catalogue and curated symbol assignments. It validates experiment coverage, symbol IDs and logical pin uniqueness. When changing experiments, update assignments and regenerate the JSON/CSV together. `scripts/lib/teaching-native-tools.mjs` maintains the built-in tool mapping.
