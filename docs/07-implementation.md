# Implementation architecture

Status: implementation design, researched on 7 November 2026. This document proposes code boundaries and contracts; no engine, helper, build script, or new file schema has been implemented or compiled in this documentation change. The existing [UI requirements](04-requirements.md) remain the behavioral contract.

## 1. Fixed decisions

| Area | Decision |
| --- | --- |
| Browser, including filesystem and Google Drive modes | Execute ngspice compiled to WebAssembly locally, in a dedicated simulation Web Worker. |
| Electron | Execute native ngspice in a bundled, standalone helper process using its shared-library API. Bundle the helper, library, required runtime dependencies, initialization data, and supported code-model modules for the target OS/architecture. |
| Source and releases | Build both backends from the same pinned upstream source release through GitHub Actions. Start qualification with ngspice 47; final lock entries require verified source/toolchain digests and passing builds. See [build and bundling](08-engine-build-and-bundling.md). |
| Application behavior | One typed simulation service and result format; backend selection follows the application target. Electron does not silently fall back to WASM or a system-installed ngspice. |
| Document | One `.dsn` file containing schematic and non-drawing Simulation sheets. No project support, linked schematic documents, separate workbook, or required setup/results sidecar. |
| Symbols | Consume placed symbols and their simulation metadata from the separate symbol branch. No symbol providers, catalogue, search, import, or selection/placement UI is added here. |

The shared-library interface supplies commands and callbacks suitable for embedding. Using a separate native helper is a TinyCAD architecture decision: it provides a process boundary around solver state and crashes while avoiding an Electron/Node native-addon ABI dependency. [ngspice shared-library documentation](https://ngspice.sourceforge.io/shared.html).

## 2. Existing repository integration points

| Current code | Implementation change |
| --- | --- |
| [Drawing model](../src/model/dsnDrawing.ts) | Extend the sheet collection with a discriminated Simulation sheet type and persistent identities. Existing sheets default to schematic when loading old drawings. |
| [XML reader/writer](../src/io/ioXml.ts) and platform storage adapters | Add versioned non-drawing sheet records and result references under the existing document root. Introduce a shared byte-based DSN codec for header-detected ZIP/XML input and binary-safe saving; keep `.dsn` as the file extension. |
| [Drawing page](../src/components/pages/designApp.tsx) and [sheet bar](../src/components/toolbar/sheetbar.tsx) | Render schematic or Simulation content by sheet type; retain ordinary tab navigation and the optional result dock. |
| [Netlist worker](../src/web-worker/main.ts) and [worker client](../src/web-worker/worker.ts) | Continue connectivity work independently of the solver. Filter inputs to schematic sheets. Do not run the solver in this existing worker. |
| [Connectivity state](../src/web-worker/netlistState.ts) | Generate a versioned snapshot and source mapping from schematic sheets only. |
| [SPICE exporter](../src/io/netlists/netlistSpice.ts) | Share template expansion where appropriate; introduce a structured simulation-deck builder instead of assuming legacy exported text is ready for guided execution. Preserve the existing export path. |
| [Electron preload](../electron/preload.js) and [type declarations](../src/electron.d.ts) | Add a narrow simulation API with validated requests, subscriptions, and explicit unsubscribe/dispose behavior. |
| [Electron main](../electron/electron.js) | Own helper processes, resource paths, window/document association, limits, termination, and cleanup. |

Proposed new source layout; these paths are design targets, not existing files:

```text
src/simulation/
  contracts.ts               # requests, events, capabilities, result schema
  simulationService.ts       # one running experiment per drawing
  deckBuilder.ts             # deterministic snapshot -> runnable deck + maps
  dependencyResolver.ts      # staged model text and include graph
  resultStore.ts             # bounded numerical buffers, outside undo history
  measurements.ts            # common result measurements and transforms
  backends/wasmBackend.ts
  backends/nativeBackend.ts
  workers/simulation.worker.ts
src/components/simulation/    # sheet UI, plots, probes, instruments
electron/simulation.js       # validated IPC and native-helper supervision
native/ngspice-host/          # standalone host using the upstream C API
native/ngspice-bridge/        # minimal callback/value bridge for WASM
```

Keep contracts and numerical interpretation independent of React, Redux, filesystem access, and a particular binary provider. The backend factory uses the existing `TARGET_SYSTEM` distinction. Browser bundles must not import Electron or Node implementations; desktop production must resolve the native backend explicitly.

## 3. Document and sheet model

Introduce a union rather than adding simulation fields to every schematic object:

```ts
type DrawingSheet = SchematicSheet | SimulationSheet;

interface SimulationSheet {
  kind: 'simulation';
  id: string;                 // persistent opaque identity
  name: string;
  schemaVersion: number;
  instructions: string;
  analysis: AnalysisDefinition;
  parameters: ParameterDefinition[];
  probes: ProbeDefinition[];
  instruments: InstrumentDefinition[];
  measurements: MeasurementDefinition[];
  runs: SavedRunRecord[];     // metadata + optional retained payload reference
}
```

These illustrative types omit field details defined by the UI requirements. Schematic sheets retain their current drawing fields, plus `kind: 'schematic'` and a persistent identity. Migrate old drawings on load with deterministic within-document references and save the assigned IDs thereafter. Do not use tab index, sheet name, or a generated SPICE node number as a durable identity.

Audit every traversal of `drawing.sheets`, not just the solver: connectivity, DRC, annotation, BOM, drawing rendering, printing, editing commands, copy/paste, and serializers need explicit handling of non-drawing sheets. Simulation sheets must never be passed to code that assumes `items`, drawing geometry, or symbols. Print/export should route each sheet type to its appropriate renderer.

Normal component values and electrical connectivity remain shared across all schematic sheets. Analysis options, named experiment parameters, and explicit trial/sweep overrides belong to their Simulation sheet. Distinguish an analysis-only override from **Apply to drawing** in both state and serialization. Duplicating a Simulation sheet creates new IDs and copies setup/instructions/configuration; it does not copy waveform payloads or circuit instances.

Keep definition edits in the existing document undo/dirty-state workflow. Store solver workers, process handles, subscriptions, transient status, and live numerical buffers outside the undo tree. Finished-run metadata and a decision to retain/delete results are document changes; individual arriving samples must not create thousands of undo entries.

### Single-file serialization

Keep one `.dsn` file and introduce the ZIP-based representation defined in [Compressed DSN format and result management](09-dsn-format-and-results.md). New drawings default to compression; the shared codec detects ZIP versus existing XML from the header and validates its contents. Remember an opened file's representation for normal Save and offer explicit conversion in Save as.

The ZIP contains `drawing.xml` plus a format manifest and optional binary result entries. Keep the `TinyCADSheets` XML root and existing schematic records inside that document. Add an explicitly versioned `SimulationSheet` extension record for each non-drawing sheet, with a persistent ID and escaped structured setup. A proposed shape is:

```xml
<SimulationSheet id="..." version="1">
  <NAME>Charging experiment</NAME>
  <SETUP encoding="json">...escaped structured configuration...</SETUP>
  <RUNS>...metadata and optional internal result references...</RUNS>
</SimulationSheet>
```

Persist explicit document sheet order and schematic identities using versioned metadata; preserve existing node layout for schematic contents. Model the extension schema and migrations in one module, with round-trip fixtures. Unknown future records must be preserved without interpretation or cause a clear read-only compatibility response; never silently discard them on save.

In compressed DSN, retained numerical data uses binary ZIP entries referenced by the XML, with little-endian float64 format, vector metadata, decoded sizes, and checksums. Let ZIP compress raw binary; do not base64 it or separately recompress it inside the archive. XML-only DSN can retain versioned inline base64 payloads. Both decode to the same model and must enforce decoded-size/resource limits before allocation. Setup-only saving omits payloads but keeps run identity and **Results not retained** metadata.

Add snapshot-based CSV/JSON/SVG result exports and a result-stripping projection through the shared result store/codec. Explicit removal clears generated raw/derived payloads, logs, previews, and cached readings but preserves setup and compact records marked **Results removed**. A compact-copy save applies that projection without mutating the open drawing. Rewrite a fresh archive and inventory so removed results cannot survive as orphan entries. Keep large undo-owned payload references out of Redux and account for their memory.

Old TinyCAD versions may not read compressed DSN and may ignore or lose unfamiliar XML records. Do not promise lossless old-version round trips. Test the new reader against old drawings, warn on legacy-compatible export, and keep the complete original. Final schema names and migration code must be verified before shipping. The ZIP is still one drawing, not a project or a user-managed sidecar. All platform file I/O must carry bytes rather than assuming DSN is a UTF-8 string.

## 4. Simulation request pipeline

1. Capture the owning document ID, Simulation sheet ID, immutable circuit revision, and setup revision.
2. Validate the selected analysis and backend capabilities before creating a run. Check the model/pin metadata supplied for placed components and apply explicit exclusions.
3. Obtain a connectivity snapshot for all schematic sheets and build deterministic signal/device identifiers.
4. Resolve supplied model dependencies into a closed input set. Detect missing includes and cycles; stage approved text rather than giving the solver arbitrary filesystem access.
5. Generate the deck, selected vectors, effective numerical options, and explicit analysis/sweep commands. Preserve a mapping from deck lines, engine node names, and instance names to sheet/component/pin identities.
6. Calculate a run fingerprint from circuit, model-content digests, effective options, parameters, selected data, and engine build ID. Allocate a run ID and announce Checking/Running.
7. Start the selected isolated backend. Normalize events, numerical chunks, and diagnostics through the common result store.
8. Finalize exactly once as Complete, Failed, or Stopped, retaining metadata and available data. Recompute freshness relative to the current drawing separately from execution success.

Hash canonical, meaningful inputs. Schematic layout, panel position, and tab order do not invalidate electrical results. Changes to the shared circuit invalidate all affected analyses; changing one sheet's setup invalidates that sheet's results. Record the effective saved values and trial overrides separately.

### Deck ownership and model inputs

Use a structured analysis definition for guided runs. Do not append a second `.tran` or `.control` section to legacy RUN commands and hope the right analysis executes. Detect legacy commands, preserve their text, and require one effective analysis owner as specified in R08/R34.

The symbol branch owns symbol acquisition and representation. The integration contract needed here is the placed instance's simulation template/model reference, declared terminals, pin mapping, parameter values, and any resolved text dependencies. Adapt the existing `$$SPICE` fields through one boundary; do not require that branch to adopt a new symbol picker or library structure.

Resolve `.include`/`.lib` references with a parser aware of quoted paths, continuation lines, and section selection. Map authorized inputs to logical run-local paths such as `models/<content-id>.lib`; do not silently fetch models over the network. A browser uses approved document bytes or user-authorized file handles; Electron stages the same logical input set. Missing dependencies remain explicit. Temporary native staging directories are implementation internals, not user projects.

Generated P0 runs admit circuit/model declarations and typed analysis commands. They do not execute arbitrary user-provided shell/control scripts. P1 Custom analysis must define and validate a supported command grammar, including nested model inputs, and reject filesystem/process/module-loading operations outside the staged input policy. A helper process isolates crashes; it is not by itself an OS security sandbox. Never expose a raw unrestricted `ngSpice_Command` IPC endpoint to the renderer.

## 5. Common service and event contract

Use a versioned asynchronous protocol for both backends. The following sketches describe application contracts, not upstream functions:

```ts
interface EngineInfo {
  backend: 'wasm' | 'native';
  buildId: string;
  ngspiceVersion: string;
  protocolVersion: number;
  capabilities: EngineCapabilities;
}

interface RunRequest {
  protocolVersion: number;
  documentId: string;
  sheetId: string;
  runId: string;
  generation: number;
  snapshotHash: string;
  deck: string;
  inputs: LogicalInputFile[];
  signals: SignalRequest[];
  limits: ResourceLimits;
}

interface SimulationBackend {
  initialize(): Promise<EngineInfo>;
  start(request: RunRequest): Promise<void>;
  stop(runId: string): Promise<void>;
  abort(runId: string): Promise<void>;
  dispose(): Promise<void>;
  subscribe(listener: (event: EngineEvent) => void): () => void;
}
```

Events include Ready, Started, Progress, VectorDefinitions, DataChunk, Diagnostic, AcquisitionBoundary, and Finished. Every run event carries the document/sheet/run IDs, worker/process generation, monotonically increasing sequence, and engine build ID. Drop stale-generation events after termination or document replacement. An initialization failure is distinct from a circuit failure and includes a repairable missing/corrupt-engine explanation.

Send real data as Float64 arrays; represent complex vectors with explicit real/imaginary arrays. Include vector IDs, quantity/units, scale kind (time, frequency, sweep variable, scalar), and sign conventions. A chunk declares sample count and start index. Validate lengths, limits, and ordering before accepting data. No backend-specific pointer, mutable engine buffer, or unparsed console table reaches the UI as a result.

Allow one active run per drawing. Multiple windows/documents own separate solver instances; schedule an application-wide resource limit without mixing ownership. A sweep executes sequential members initially, each with its own identity and parameters. Parallel execution can be added only with separate isolated instances and measured limits.

The host owns command acknowledgement and state transitions. Pause/Resume, Live control, and step/breakpoint operations are additional capability-gated commands. A missing capability must give the UI a reason; do not implement a pause button by merely freezing the plot while the circuit continues running.

## 6. Browser WASM backend

Load an ES-module factory and matching `.wasm` lazily in a **dedicated solver worker**, distinct from the netlist worker. Keep the UI and connectivity service responsive during long solves. Instantiate one module per isolated run initially; cache verified module bytes/compiled code where supported rather than retaining hidden circuit state between independent runs.

Build a small C bridge around the pinned engine's shared API callbacks, linked into the WASM output. Copy vector definitions and numerical values into owned buffers before returning from callbacks. Keep float64 calculations and cap model text, samples, vectors, log size, and WASM memory. Exact bridge exports and linker configuration must be established by the first compiled integration spike; a command-line-only WASM executable is not automatically a callback-compatible library.

Stage approved model files and deterministic initialization content in Emscripten's in-memory filesystem. Do not use NODEFS, browser-global filesystem shims, a public CDN's `latest` engine, or a user's local `spinit`. Resolve loader/worker/WASM URLs from the deployed asset base; filesystem and Google Drive browser builds must work under their actual `/fs/` and `/ga/` paths and a repository Pages subpath.

### Stop, streaming, and threading

The default browser profile is **single-threaded WASM in a worker**, so basic simulation does not require cross-origin-isolation response headers. Emscripten pthread support depends on SharedArrayBuffer and suitable COOP/COEP setup; do not assume the existing Pages deployment provides that environment. [Emscripten pthread documentation](https://emscripten.org/docs/porting/pthreads.html).

A synchronous C solve prevents its worker from servicing ordinary inbound messages until it yields. An `async` TypeScript wrapper does not change that. Initial finite-run Stop therefore belongs to the supervising application: cancel the generation, terminate the solver worker when an in-engine stop cannot be serviced, finalize as **Stopped**, and preserve every complete data chunk already accepted by the application. A new run uses a new worker/instance. Record `stopMethod: worker-terminated`; never claim that solver state can resume. Termination is an expected stop path for this profile, not a reason to lose the drawing.

Emit bounded chunks from bridge callbacks as work proceeds, so stopping does not depend on reading a final raw file. Set a hard outbound-byte/sample budget inside the bridge as well as a receiver budget. If exhausted, report the limit and have the supervisor terminate the run; do not permit unbounded messages while a blocked worker cannot consume acknowledgements. Only accepted complete chunks form retained partial data; buffered engine samples may be lost and must not be presented as received.

For cooperative controls, investigate an instrumented yield/interrupt path or bounded engine-step boundary. Asyncify can suspend instrumented execution, but a command-prompt yield is insufficient during a long solve. The compiled path must yield during the actual operation and stop at a verified safe engine boundary, without reentrant solver calls from callbacks. [Emscripten asynchronous-code documentation](https://emscripten.org/docs/porting/asyncify.html).

Ship Pause/Resume and Live continuation only after that behavior passes browser tests. Until then the backend reports them unavailable; finite Transient, Operating Point, and AC plus reliable Stop remain the first release gate. A threaded profile can be a later optional artifact when hosting and browser support are proven, not a hidden prerequisite or an automatic change to the deployment.

### Asset and failure behavior

Ship loader, WASM, manifest, and required data together with content-addressed URLs or a versioned engine directory. The manifest is coupled to the application build ID. Verify fetched WASM bytes against its manifest before instantiation and report stale/missing assets explicitly. Provide a compile-from-bytes fallback if streaming instantiation fails because a host serves the wrong MIME type; require correct `application/wasm` serving in release tests.

No simulation backend request goes to a remote solver. Cached application/engine assets can support offline execution, but do not claim that the whole browser application works offline before its loading/storage modes are tested. Browser authentication or Drive availability does not change the local WASM execution architecture.

## 7. Electron native backend

Run a standalone `tinycad-ngspice-host` executable launched with `child_process.spawn`, an argument array, and `shell: false`. It loads the bundled native shared library and emits a versioned framed protocol over pipes. Electron main supervises it; renderer and preload never load a DLL themselves. `utilityProcess.fork` is a different option for a Node entry point, not a direct launcher for this C/C++ executable. [Electron utilityProcess reference](https://www.electronjs.org/docs/latest/api/utility-process).

The helper uses the pinned shared API to initialize callbacks, load a prepared circuit, start execution, receive values, and stop it. The concrete integration points are `ngSpice_Init` for callback registration, `ngSpice_Circ` for the prepared circuit, and `ngSpice_Command` behind typed host operations. `SendInitData` supplies vector definitions, `SendData` supplies values, and diagnostic/controlled-exit callbacks supply status and failure information. Verify signatures and lifecycle against the selected release header during M0; these functions are not renderer APIs.

Use a dedicated command/control thread and a solver thread where supported, with a bounded queue for callbacks. Serialize engine commands; never call arbitrary commands concurrently or recursively from a callback. Copy callback data before returning and intercept controlled-exit notifications as run/helper failures. Do not let a solver exit terminate Electron main.

Use a length-prefixed frame format with validated type/length and binary numerical payloads. Reserve stdout for protocol frames and stderr for bounded helper diagnostics. Separate control from bulk-data work so Stop is not queued behind megabytes of plot data. A callback queue overflow requests a controlled stop from the command thread and reports a resource-limit failure; it must not silently drop samples used for measurements.

Initialize one helper per active document session initially and fully reset circuit state between independent finite runs; restarting the helper per run is the conservative first implementation. Hold a helper across acquisitions only for a tested Live session. On renderer destruction, document close, navigation, or app quit, cancel subscriptions, stop/kill the owned helper, close pipes, and remove temporary files. Handle Windows process termination explicitly; a POSIX signal strategy is not cross-platform.

### Native library and module loading

Resolve the bundle through `process.resourcesPath` in a packaged app and one explicit generated staging path in development. Verify its manifest target against `process.platform` and `process.arch` and complete a protocol/build-ID handshake before enabling Run. Never search the user's PATH, Homebrew installation, registry, or model directory for an alternate engine.

Keep the helper, ngspice shared library, dependent libraries, code-model modules, and deterministic `spinit` in the same qualified target bundle. Native code-model modules must come from the same locked build/profile as their engine. Configure module paths from the trusted bundle; model text cannot supply an arbitrary executable module path. Platform loader rules, dependency closure, signing, and packaging paths are defined in [build and bundling](08-engine-build-and-bundling.md#6-native-bundle-layout-and-loading).

### IPC boundary

Expose only initialize/info, start, stop, abort, and event subscriptions through the context-isolated preload. Validate sender/window ownership, protocol shape, requested document/run, input sizes, and logical dependency paths in main. Use bounded binary transfers; avoid base64 JSON for every live point. Maintain `nodeIntegration: false` and `contextIsolation: true`. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

A native failure must produce an actionable engine-start or run diagnostic and preserve previous results. Do not turn a missing packaged DLL into a prompt to install ngspice manually: missing runtime payload is a packaging defect covered by release checks.

## 8. Capabilities and numerical parity

Record capabilities from the **qualified artifact profile**, then validate them with a startup handshake and fixtures. Initial common profile covers analog Operating Point, Transient, AC, supported passive/semiconductor models, selected signal capture, and complete/partial numerical results. Optional analyses become available only when tested.

Native XSPICE `.cm` modules cannot be copied into WASM and expected to load. Browser code models require a compatible static registration or WASM side-module build and matching linker/runtime configuration. Emscripten supports WASM dynamic linking, but that is not compatibility with host DLLs. [Emscripten dynamic-linking documentation](https://emscripten.org/docs/compiling/Dynamic-Linking.html).

Build and package native XSPICE modules when enabled. Treat browser XSPICE and compiled OSDI/Verilog-A models as separate qualification work; default to unavailable until tested. Do not silently remove unsupported devices to obtain an answer. Compare common-profile results across both engines; native-only capabilities carry a visible reason in the UI and saved run metadata. The P1 mixed-signal goal remains a product requirement, not a claim that the first WASM profile already implements it.

Results need numerical agreement within fixture-specific tolerances, not bitwise equality across compilers. Normalize complex values, current direction, units, scale, and recorded time intervals before comparisons. Keep engine version, build/profile ID, effective options, dependencies, and limits with every run.

## 9. Result handling and resource budgets

Keep numerical storage outside React render state. Publish throttled progress/plot updates while retaining full accepted samples in a bounded result store. Render decimated/envelope data for plots and calculate measurements from the original retained data, with any interpolation/resampling declared.

Start qualification with explicit adjustable limits: 128 selected vectors, 64 MiB accepted numerical data per run, 256 MiB total retained numerical buffers per open document, 2 MiB retained log text, and a 512 MiB maximum browser WASM heap. These are proposed engineering defaults, not measured performance guarantees. Pinning a baseline protects it from automatic eviction but does not remove the total limit: ask the user to free data, save a copy, or explicitly raise an allowed budget before accepting more. Validate total staged input bytes, command length, sample/chunk size, run count, and decoded saved-result size too. Show a setup warning for predictably large work; terminate with a named resource-limit diagnostic if a hard limit is crossed. Native limits must also be explicit rather than relying on available host memory.

The service finalizes each run once after processing accepted ordered chunks. Unexpected worker/process death marks it Failed with available partial data; a user Stop marks it Stopped. A late Complete event cannot override an acknowledged cancellation. Reject chunks with invalid IDs, lengths, sequence, or vector definitions. Include the received sample extent in saved records so plots/measurements cannot imply an unreceived tail exists.

## 10. Implementation sequence and gates

| Stage | Concrete deliverable | Required evidence before moving on |
| --- | --- | --- |
| M0 — engine qualification | Pinned source/toolchain lock, callback-capable WASM bridge, native helper, same divider/transient/AC fixtures | Browser runs without isolation headers; native target builds/starts; numerical vectors match; blocked-worker Stop preserves delivered chunks; artifact manifests have real digests. |
| M1 — document foundations | Typed non-drawing sheets, identity mapping, XML/ZIP codec, binary-safe storage, UI shell, schematic-only traversals | Old XML and new compressed drawing loads, equivalent same-file round trips, bounded archive failures, schema preservation, duplication/deletion, no simulated elements from setup sheets. |
| M2 — integrated P0 | Deck builder, readiness, service, both backends, probes, results, bounded storage, CSV/JSON/SVG exports, stripping and compact-copy save | A01–A10, A14/A16/A17, and A20–A23 plus backend parity/crash/packaged-app checks. |
| M3 — full workbench | Sweeps, tuning, instruments, additional export/report formats, capability-gated Live/mixed signal | Corresponding P1 UI criteria, verified safe acquisition/control behavior, supported module profiles and cross-platform package tests. |
| M4 — specialist work | P2 analyses and tools | Per-feature numerical, resource, model, UI, and artifact qualification. |

M0 must resolve the actual WASM bridge/export recipe, cooperative-control feasibility, and ARM64 compiler/runtime combinations. These are explicit engineering qualification tasks; documentation alone cannot establish support. Do not ship an architecture-labelled artifact without an on-target run. The [bundling plan](08-engine-build-and-bundling.md) defines how qualified binaries become application release inputs.
