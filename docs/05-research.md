# Research and TinyCAD baseline

Research checked on 7 November 2026. External evidence below comes from vendor or project documentation. Observations describe those sources; **Design implication** paragraphs are proposed TinyCAD decisions. No user interviews, competitive usability trials, or compatibility tests were conducted.

Scope update: SPICE symbol sourcing and selection are handled in a separate branch. Historical observations about libraries and import remain useful context, but they do not create work here to change symbol providers, browsing, import, selection, placement, or library maintenance. The proposed simulation workflows begin with placed components.

Document scope is also fixed by the user's direction: extend the existing multi-sheet drawing, including non-drawing sheets for simulation setup and parameters. This version uses one drawing file and adds no project support, multi-file hierarchy, or separate simulation workbook. This is a product decision, not a claim about an existing TinyCAD simulation feature.

## Product context

Digilent's notice identifies **Multisim Live** as reaching end of life on 15 September 2026 and recommends Circuit Design Suite / Multisim Desktop. It does not announce retirement of all Multisim products. The opportunity is to serve people who want an approachable integrated simulator without assuming Desktop has been retired. [Digilent: Multisim Live EOL letter](https://support.digilent.com/hc/en-us/articles/41178584173979-Multisim-Live-EOL-Letter).

## Existing TinyCAD behavior

### Simulation today

The v4 manual describes SPICE text export for execution in another simulator. Symbols supply model, prologue, and epilogue templates; the documented setup uses a RUN symbol and a net named `0`. [TinyCAD: SPICE output](https://docs.tinycad.net/v4/SPICE-output/).

Local source corroborates the baseline:

| Evidence | Relevant behavior |
| --- | --- |
| [Project readme](../readme.md) | Browser and Electron application; hobbyist, education, maker, and lightweight engineering audience. |
| [Toolbar](../src/components/toolbar/toolbar.tsx) | Existing **Generate SPICE netlist** command. |
| [SPICE symbol editor](../src/components/panel/EditSpicePanel.tsx) | Model, prologue, epilogue, and priority text controls. |
| [SPICE exporter](../src/io/netlists/netlistSpice.ts) | Expands templates; emits `NO_MODEL` for missing templates. |
| [Symbol properties](../src/components/panel/SymbolPanel.tsx) | Filters SPICE attributes out of ordinary symbol properties. |
| [Netlist panel](../src/components/panel/NetlistListPanel.tsx) | An existing place for connectivity inspection. |
| [Changelog](../CHANGELOG.md) | Recent attention to touch, panel resizing, translations, and keeping toolbars visible. |

**Design implication:** Add a guided model surface for placed components and an integrated result workspace. Keep legacy templates available through an explicit advanced path. Define a clear transition from RUN symbols to saved analyses, with no invisible competition between control sources.

### Sheets, connectivity, and navigation

TinyCAD's manual uses labels and power symbols to connect sheets. Its feature comparison distinguishes multi-sheet drawings from multi-file hierarchy, which v4 currently lacks. [Multiple sheet drawings](https://docs.tinycad.net/v4/Multiple-Sheet-Drawings/), [Feature differences](https://docs.tinycad.net/v4/Feature-Differences/).

**Design implication:** Use the existing sheet bar for schematic and non-drawing Simulation sheets in one drawing. Setup, parameters, instructions, instruments, and results belong to Simulation sheets; all schematic sheets form the shared circuit. Cross-probing includes sheet identity. This version does not add linked schematic files or hierarchical project support.

The current design-rule workflow lists issues and centers the drawing on a selected issue. [TinyCAD: Design Rules Check](https://docs.tinycad.net/v4/Design-Rules-Check/).

**Design implication:** Simulation problems should follow that familiar locate-and-fix pattern, with an additional readiness layer for models, sources, and analysis setup.

### Libraries and input methods

The documented KiCad import accepts `.kicad_sym` libraries, not KiCad projects or schematics. A graphical symbol import is therefore not evidence that a simulation model is usable. [TinyCAD: Importing symbols from KiCad](https://docs.tinycad.net/v4/Importing-Symbols-from-KiCAD/).

TinyCAD documents touch selection, two-finger navigation, and a precision loupe. [TinyCAD: Touch controls](https://docs.tinycad.net/v4/Touch-controls/).

**Design implication:** Inspect simulation readiness on placed components independently of their origin. Symbol import and selection UI belong to the separate branch. Retain touch navigation and the loupe; add visible probe commands and signal pickers rather than relying on hover or modifier keys.

## How other simulators approach the UI

### Multisim: instruments plus analyses

NI describes an interactive circuit workflow with virtual instruments and more detailed SPICE analyses. Its instrument catalogue includes meters, scopes, generators, Bode plotting, and logic tools. [NI: Instruments and analyses comparison](https://www.ni.com/en/shop/electronic-test-instrumentation/application-software-for-electronic-test-and-instrumentation-category/what-is-multisim/multisim-designers/select-edition/ni-multisim-simulation-driven-instruments-and-analyses-feature-c.html).

NI's analysis documentation describes a selected active analysis, defaults, output selection, and analysis settings saved with the design. [NI: Analyses](https://www.ni.com/docs/en-US/bundle/multisim/page/topics/analyses.html).

**Design implication:** Preserve familiar lab questions and reusable experiments. Use a small instrument shelf and a common analysis workspace; avoid presenting an entire instrument catalogue at first launch. Instrument panels and plots must refer to the same experiment rather than becoming competing result systems.

### KiCad: ngspice within schematic capture

KiCad documents model assignment and pin mapping, analysis tabs, schematic probing, tuning, saved workbooks, and result export. It also explains that models can require compatibility handling. [KiCad 9: Simulator](https://docs.kicad.org/9.0/en/eeschema/eeschema.html#simulator).

**Design implication:** Make readiness and pin mapping first-class tasks. Save analyses on Simulation sheets in the same drawing, provide bidirectional highlighting, and put a readable result table ahead of raw logs for numerical answers. Show common settings first, with advanced controls within reach. KiCad's workbook concept is reference material, not a proposal to introduce separate workbooks or projects into TinyCAD.

### LTspice: direct probing and a powerful result viewer

Analog Devices documents schematic probing, multiple plot panes, cursors, waveform arithmetic, saved plot configurations, and data export. [Analog Devices: Waveform viewer guide](https://analogdevicesinc.github.io/ltspice-reference/ai_ref/WAVEFORM-VIEWER-GUIDE.html).

**Design implication:** Make a selected circuit target the fastest route to a trace. Provide visible alternatives to gestures, retain plot configurations with analyses, and offer named measurements before asking users to write expressions.

### Qucs-S: visible analysis setup and electrical context

Qucs-S documents DC bias displayed on a schematic and graphical transient and AC settings. Its AC discussion distinguishes output voltage from the output/input ratio normally used for gain. [Qucs-S: Analog simulation](https://qucs-s-help.readthedocs.io/en/latest/overview/simulation-types/analog.html).

**Design implication:** State the electrical question and selected signals above the form. A **Gain** action should create a ratio with a named input reference, rather than silently plotting an absolute output level in dB.

## ngspice capability boundaries

The manual documents common circuit analyses, model definitions, numerical conventions, and convergence. It uses `m` and `M` for milli and `meg` for mega. The inspected manual identifies itself as a development document, so its contents are not a fixed runtime capability guarantee. [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf), [release and development documentation](https://ngspice.sourceforge.io/docs.html).

The control-language tutorial demonstrates repeated analyses, parameter alterations, and nested loops. These support an experiment workflow but do not supply that product UI. [ngspice: Control language tutorial](https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html).

XSPICE supplies event-driven digital and mixed-signal facilities. Its availability alone does not establish compatibility with every digital component or vendor model. [ngspice: XSPICE](https://ngspice.sourceforge.io/xspice.html).

**Design implication:** Separate an analysis from an experiment that repeats it, and from a view that processes results. Show a capability explanation when a feature or model is unavailable. Define live acquisition and instrument behavior explicitly; do not equate engine interactivity with a complete virtual laboratory.

## Evidence translated into stories

| Evidence | Proposed needs | Proposed response |
| --- | --- | --- |
| TinyCAD audience and export-only baseline | US01, US02, US24 | A small entry point, starter examples, and optional simulation workspace. |
| Multisim instruments and active analyses | US06, US07, US14 | Familiar bench tools plus saved, named experiments. |
| KiCad models, probing, and tuning | US04, US10, US12, US13 | Readiness report, pin map, direct probes, explicit trial values. |
| LTspice result inspection | US08, US11, US19 | Strong plotting, cursors, measurements, and comparisons. |
| Qucs-S electrical context | US05, US08 | Bias overlays and explicit input/output gain setup. |
| TinyCAD sheets and touch workflows, plus the user's single-document scope | US14, US21, US22, US26 | Non-drawing Simulation sheets in the same file, cross-sheet location, and equivalent touch/keyboard actions. |
| ngspice analyses and control flow | US09, US17, US18, US20, US23 | Capability-aware analysis forms, experiment controls, and an expert path. |

These mappings are design inferences. The [validation plan](06-ui-validation.md) describes how to test them. Runtime and packaging research, including the WASM repository assessment, is documented with sources in [Implementation architecture](07-implementation.md) and [Engine builds and bundling](08-engine-build-and-bundling.md). The later [DSN format and result-management specification](09-dsn-format-and-results.md) references the ZIP format and archive-library sources for the user's compressed-file and result-removal requirements; those additions are product decisions rather than observations about TinyCAD's current file format.
