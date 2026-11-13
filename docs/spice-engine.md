# SPICE engine

TinyCAD runs ngspice locally. Browser filesystem and Google Drive modes use WebAssembly in a dedicated worker. Electron uses a bundled native helper process and ngspice shared library. Runtime selection follows `TARGET_SYSTEM`; Electron requires its bundled native engine. Users do not need a separate simulator installation.

Upstream references: [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf) and [shared-library interface](https://ngspice.sourceforge.io/shared.html).

## Runtime boundaries

| Source | Responsibility |
| --- | --- |
| [contracts.ts](../src/simulation/contracts.ts) | Analysis/setup/run types, result vectors and engine requests/events. |
| [session.ts](../src/simulation/session.ts) | Circuit validation, run ownership, progress, diagnostics and finalization. |
| [deck.ts](../src/simulation/deck.ts) | SPICE template expansion, model validation, analysis commands and selected vectors. |
| [engine.ts](../src/simulation/engine.ts) | Native IPC or a fresh browser worker for each acquisition. |
| [engine.worker.ts](../src/simulation/engine.worker.ts) | Manifest and asset verification, WASM initialization, model staging and numerical callbacks. |
| [electron/simulation.js](../electron/simulation.js) | Request validation, native integrity checks, temporary inputs, process supervision and cleanup. |
| [host.cpp](../native/ngspice-host/host.cpp) | Standalone native host using ngspice's shared-library API. |
| [resultStore.ts](../src/simulation/resultStore.ts) | Numerical storage outside Redux/undo snapshots and memory accounting. |

All schematic sheets contribute to one electrical circuit. Simulation sheets hold independent analysis setups in the same drawing. Connectivity uses TinyCAD's netlist machinery; the solver has its own worker/process. Simulation UI and engine code load on demand.

There is one active acquisition per renderer session, shared by sheets, instruments and studies. Sequential sweeps/studies schedule separate runs. The session tracks document replacement so callbacks from an old drawing cannot commit into the new one.

## Engine identity and assets

[engine.lock.json](../build-support/ngspice/engine.lock.json) is authoritative for the upstream release, source/toolchain checksums, protocol, configure options and patch digests. The current release is ngspice 47, with Emscripten 4.0.23 and protocol 1. Engine manifests record build identity, capabilities and file hashes; saved runs retain backend and build ID.

Browser assets live under `engines/ngspice/` relative to the deployed document base. The worker verifies the loader/WASM pair against the manifest before initialization. Keep asset paths valid for filesystem, Drive and nested deployments.

Electron development resolves `build/engines/native`; installed applications use `resources/ngspice`. Packaging stages architecture-specific inputs from `build/engines/native-${arch}`. Startup validates platform, architecture, protocol and bundled file hashes before launching the helper. It uses the manifested library/modules and suppresses user startup files.

The native matrix covers Windows x64/ARM64, macOS ARM64 and Linux x64/ARM64. Linux's qualification baseline is Ubuntu 24.04; Snap uses core24. Treat this as the configured matrix, rather than evidence for older distribution compatibility.

Native verification/packaging logic is in [verify-engine-package.cjs](../scripts/verify-engine-package.cjs), [finalize-signed-engine.cjs](../scripts/finalize-signed-engine.cjs) and [dist.mjs](../scripts/dist.mjs). Signing can change native bytes, so packaged hashes are finalized after the relevant signing stage. Preserve licence notices and source/patch provenance with the engine payload. Engine recipes and CI workflows remain the source of truth for toolchain setup and packaging.

## Capabilities and lifecycle

Both backends support operating point, transient, AC, DC sweep, noise, transfer function and pole-zero analysis. Native supports bundled XSPICE code models; the browser profile disables XSPICE and reports A-device circuits as unsupported. Portable teaching models use analogue primitives and behavioural sources on both backends.

`EngineRequest` carries `runId`, generated `deck`, attached model `files` and `maxBytes`. Events are `ready`, `vectors`, `data`, `log` and `finished`; `ready` supplies engine identity/capabilities. Complex data has explicit real/imaginary values. Noise and other multi-plot output retain separate plots and scales. Consult the types before extending the protocol.

Stop terminates the isolated worker/helper and retains accepted complete data chunks. A stopped run cannot resume. The current profiles report Live and Pause unavailable. Native completion waits for helper cleanup before enabling another acquisition; keep streamed terminal events and IPC completion ordering consistent when changing this code.

## Deck and model contract

Placed components carry `$$SPICE`, `$$SPICE_PROLOG` and related attributes; per-instance edits override library definitions. The Simulation sheet owns the analysis. Analysis commands and `.end` in component templates are rejected, and readiness checks report missing templates, invalid references and pin/macro problems.

Attach custom model text through the Simulation sheet. Include/library references must resolve to supplied logical filenames, using the validated `.lib`, `.cir` or `.mod` naming grammar. Models are staged in a worker filesystem or native temporary directory. They are not fetched automatically from network URLs or arbitrary local paths.

Control scripts, shell commands, startup directives, external module loading and file-backed devices such as filesource/table models are rejected. Validation exists at the deck and native IPC boundaries. A helper process provides crash isolation; it is not an OS security sandbox.

The deck saves selected schematic signals, source/instrument currents, supported device readings and explicit extra signals. Preserve that selection when adding model internals: saving every private node can exceed native vector limits. Data-logger record signals are deliberately exposed.

## Limits and diagnostics

Results are limited to 64 MiB per run and 256 MiB per document, including real/imaginary arrays, multiple plots and UTF-8 logs. Buffers retained for Undo still count. These are logical data budgets, not process RSS limits. Each setup retains at most 1,000 run records; exploration/studies retain at most 100 groups.

The WASM profile uses a 4 MiB stack, stack overflow checks and a 512 MiB maximum memory setting. Heap growth does not enlarge the stack. Netlist preprocessing can exceed Emscripten's default stack even for a small amplifier; preserve the complete amplifier tutorial fixture when changing these settings.

Readiness and solver diagnostics use the DRC-style issue list to locate components. Failed startup, invalid models, nonconvergence and missing signals must remain explicit. Numerical measurements with unavailable evidence must not become zero-valued results.

## Verification references

- `npm run test:simulation` checks deck generation, lifecycle, persistence, measurements and feature integration.
- `npm run test:engines` exercises staged native/WASM engines with numerical fixtures and parity comparisons. [qualify-engines.mjs](../scripts/tests/qualify-engines.mjs) also accepts `native` or `wasm`.
- [qualify-chart-windows.mjs](../scripts/tests/qualify-chart-windows.mjs) exercises real Electron DOM/canvas/window behavior; its solver events use deterministic fixtures. Separate numerical tests execute ngspice.
- `npm run benchmark:simulation` measures result-cache and XML/ZIP codec cost, writes reports under `build/qualification/result-performance/`, and checks compact-copy recovery. It does not measure solver or UI speed.

Engine fixtures cover divider voltage/current sign, RC transient/complex AC response, DC sweep, noise plots, transfer function, pole-zero, diode behavior and instrument loading/current limiting. Automated results do not establish installed UI behavior, classroom usability or trusted release signing.
