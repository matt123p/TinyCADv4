# TinyCAD simulation design and implementation specification

P1 adds [virtual laboratory instruments and analysis workflows](16-virtual-laboratory-and-p1-analysis.md), with placeable scope, meter, generator and supply components. Fault injection and FFT are explicitly deferred to P2.

The first P0 slice of the [advanced-analysis recommendations](TinyCAD_ngspice_Advanced_Analysis_Features.md) is implemented in [Circuit Explorer](15-circuit-explorer.md): temporary tuning, one-variable sweeps, persistent named measurements/requirements and fresh DC schematic annotations. The guide distinguishes these features from the later P1/P2 workbench scope.

Status: simulation foundation and scoped P0/P1 workflows implemented; P2 features remain planned. Research checked on 7 November 2026. Automated qualification completed on 8 November: all six engine jobs and Windows, macOS and Linux packaging pass. Windows-host work also adds runtime fixes, lower XML result memory use, bounded log retention and [three editable teaching drawings](../examples/simulation/README.md). See [current implementation status](10-implementation-status.md) for implemented behavior and [the TODO/platform handoff](12-todo-and-platform-handoff.md) for evidence and outstanding manual acceptance checks.

## Start with the user stories

Read [User stories and journeys](01-user-stories.md) first. The proposed experience is: **draw a circuit, choose what to find out, run, measure, and compare**. A first measurement should require neither SPICE commands nor a separate simulation application.

Then work through:

1. [UI design](02-ui-design.md): workspace, screen sketches, navigation, interactions, and run states.
2. [Feature sets](03-feature-sets.md): analyses, instruments, components, and scope priorities.
3. [Requirements](04-requirements.md): observable behavior and acceptance criteria.
4. [Research and TinyCAD baseline](05-research.md): sources, existing behavior, and the reasoning behind the design.
5. [UI review and validation](06-ui-validation.md): prototype scenarios, usability targets, and decisions to resolve.
6. [Implementation architecture](07-implementation.md): shared service, browser WASM worker, Electron native helper, document schema, and implementation stages.
7. [Engine builds and bundling](08-engine-build-and-bundling.md): upstream/repository assessment, pinned source builds, GitHub Actions, target matrix, packaged dependencies, signing, and release gates.
8. [DSN format and result management](09-dsn-format-and-results.md): header-detected ZIP/XML drawings, numerical exports, result stripping, compact copies, binary-safe I/O, and compatibility.

For the implemented source/probe tools and plot controls, see
[Sources, probes and charts](14-spice-controls-and-charts.md).

For syllabus-linked teaching ideas, see the [GCSE electronics experiments](17-gcse-physics-electronics-experiments.md)
and [A-level electronics experiments](18-a-level-physics-electronics-experiments.md) catalogues.
Both use official AQA specifications and distinguish diagram work, simulation,
model-dependent activities and required practicals.

## BTEC and first-year degree experiment catalogues

The following research catalogues link electronic-circuit teaching ideas to published
qualification units or university modules. They distinguish drawing, simulation and
activities needing additional models. The degree catalogues are representative proposals,
not a universal university syllabus. Research checked on 10 November 2026.

| Course | Catalogue |
| --- | --- |
| BTEC First Certificate in Engineering, 2012 suite | [Electronics experiments](19-btec-first-engineering-electronics-experiments.md) |
| BTEC National Extended Diploma in Applied Science, 2016 suite | [Electronics experiments](20-btec-national-applied-science-2016-electronics-experiments.md) |
| BTEC National Applied Science AAQ Extended Certificate, first teaching 2025 | [Electronics experiments](21-btec-aaq-applied-science-electronics-experiments.md) |
| BTEC National Extended Diploma in Electrical and Electronic Engineering, 2016 suite | [Electronics experiments](22-btec-national-electrical-electronic-engineering-experiments.md) |
| BTEC HNC Electrical and Electronic Engineering for England, 2024 suite | [Electronics experiments](23-btec-hnc-electrical-electronic-engineering-experiments.md) |
| First-year physics degrees | [Electronics experiments](24-first-year-degree-physics-electronics-experiments.md) |
| First-year electronics degrees | [Electronics experiments](25-first-year-degree-electronics-experiments.md) |
| First-year engineering degrees, shared material and discipline applications | [Electronics experiments](26-first-year-degree-engineering-electronics-experiments.md) |

For course-specific symbol lists, see the [symbol-library handoff](symbol-libraries/README.md),
[complete readable inventory](symbol-libraries/INVENTORY.md), and
[combined JSON manifest](symbol-libraries/library-manifest.json).

## Scope and status

These documents describe an integrated ngspice experience with the approachable circuit-and-instruments workflow associated with Multisim. The feature catalogue includes both implemented foundation features and planned workbench features; it is not a claim that the whole catalogue is available. User stories remain research-informed hypotheses pending user testing. Use the implementation status and TODO documents to distinguish working code, local verification and outstanding platform qualification.

**One drawing file, multiple sheets.** This version extends TinyCAD's existing multi-sheet document. Schematic sheets contain the shared circuit; non-drawing **Simulation** sheets contain analysis setup, parameters, instructions, instrument views, and results. For example, `Lesson.dsn` can contain `Circuit`, `DC checks`, and `Frequency response` tabs. Save/Open applies to that one drawing file. There is no project file, project manager, linked schematic files, separate simulation workbook, or required setup/results sidecar. Existing model dependencies remain inputs, not a new project structure.

**Separate branch: SPICE symbol sourcing and selection.** Assume users can already obtain, choose, and place the symbols they need through the editor workflow supplied by that branch. Symbol providers, catalogues, search/filtering, import, selection/placement UI, and symbol-library maintenance are outside this work. This specification starts with placed components and covers their simulation settings, readiness, analysis, instruments, and results. Model configuration and pin-mapping checks for a placed component remain in scope; they do not prescribe how its symbol was obtained. UI review can use prepared drawings while the branches evolve independently.

**Runtime and distribution:** Browser builds use local ngspice WASM; Electron uses native ngspice with its helper, libraries, and required modules bundled in the application. The implementation plan builds both from pinned upstream source in GitHub Actions and verifies each platform package. These engine installation resources do not introduce user projects or additional drawing files.

**Compact drawings and exported results:** Ordinary drawings default to XML `.dsn`; any simulation components, settings or results select ZIP `.dzn`, regardless of size, auto-detected from its header; existing XML `.dsn` files remain readable. Users can export result data, remove stored results while retaining setup, or save a compact copy without results. All internal archive entries still belong to one drawing file.

The priority labels describe the intended product scope:

| Priority | Meaning |
| --- | --- |
| P0 — foundation | Required for a useful first simulation experience and the first complete UI prototype. |
| P1 — full workbench | Required for the broader Multisim-style experience; keep its controls out of the first-run path. |
| P2 — specialist | Valuable advanced workflows, subject to explicit capability and usability review. |

Priority is independent of visibility. An essential model-mapping control can be contextual; an advanced analysis can remain easy to find through search.

The specification includes implementation architecture and build/distribution details as well as the UI design. Runtime code, pinned engine recipes, document codecs, tests and CI workflows are now present. Automated platform qualification does not establish installed UI behavior or production signing, and planned controls should still be reviewed before implementation.

The existing [TinyCAD manual](https://docs.tinycad.net/v4/) remains the guide to current functionality. These planning documents belong in this application repository; they do not replace that separately maintained manual.

- [Running the simulation integration](10-implementation-status.md) — current implementation, build instructions, verification and remaining work.

- [Drawing extensions and Drive deployment](11-drawing-extensions-and-drive.md) — automatic .dsn/.dzn selection and Drive UI registration.

- [TODO and Windows/macOS handoff](12-todo-and-platform-handoff.md) — machine setup, platform blockers, acceptance checks, remaining implementation and evidence tracking.

- [Result storage performance](13-result-storage-performance.md) — reproducible XML/ZIP memory and latency measurements, compact-copy recovery and the XML decoder allocation fix.
