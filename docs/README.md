# TinyCAD simulation design and implementation specification

Status: proposal for review. Research checked on 7 November 2026.

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

## Scope and status

These documents specify a proposed UI for an integrated ngspice experience with the approachable circuit-and-instruments workflow associated with Multisim. All new simulation screens and behavior described here are proposed; they are not present in TinyCAD today. User stories are research-informed hypotheses, pending user testing.

**One drawing file, multiple sheets.** This version extends TinyCAD's existing multi-sheet document. Schematic sheets contain the shared circuit; non-drawing **Simulation** sheets contain analysis setup, parameters, instructions, instrument views, and results. For example, `Lesson.dsn` can contain `Circuit`, `DC checks`, and `Frequency response` tabs. Save/Open applies to that one drawing file. There is no project file, project manager, linked schematic files, separate simulation workbook, or required setup/results sidecar. Existing model dependencies remain inputs, not a new project structure.

**Separate branch: SPICE symbol sourcing and selection.** Assume users can already obtain, choose, and place the symbols they need through the editor workflow supplied by that branch. Symbol providers, catalogues, search/filtering, import, selection/placement UI, and symbol-library maintenance are outside this work. This specification starts with placed components and covers their simulation settings, readiness, analysis, instruments, and results. Model configuration and pin-mapping checks for a placed component remain in scope; they do not prescribe how its symbol was obtained. UI review can use prepared drawings while the branches evolve independently.

**Runtime and distribution:** Browser builds use local ngspice WASM; Electron uses native ngspice with its helper, libraries, and required modules bundled in the application. The implementation plan builds both from pinned upstream source in GitHub Actions and verifies each platform package. These engine installation resources do not introduce user projects or additional drawing files.

**Compact drawings and exported results:** New drawings default to a ZIP-based `.dsn` format, auto-detected from its header; existing XML `.dsn` files remain readable. Users can export result data, remove stored results while retaining setup, or save a compact copy without results. All internal archive entries still belong to one drawing file.

The priority labels describe the intended product scope:

| Priority | Meaning |
| --- | --- |
| P0 — foundation | Required for a useful first simulation experience and the first complete UI prototype. |
| P1 — full workbench | Required for the broader Multisim-style experience; keep its controls out of the first-run path. |
| P2 — specialist | Valuable advanced workflows, subject to explicit capability and usability review. |

Priority is independent of visibility. An essential model-mapping control can be contextual; an advanced analysis can remain easy to find through search.

The specification now includes implementation architecture and build/distribution details as well as the UI design. The UI can still be reviewed using static screens or a prototype with clearly labeled sample results. The proposed engine recipes, schemas, and APIs require implementation and qualification; no simulator integration, binary build, or workflow change has been performed in this documentation change.

The existing [TinyCAD manual](https://docs.tinycad.net/v4/) remains the guide to current functionality. These planning documents belong in this application repository; they do not replace that separately maintained manual.
