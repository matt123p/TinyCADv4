# Running the simulation integration

For the next Windows or Mac session, start with [TODO and platform handoff](12-todo-and-platform-handoff.md).

Simulation lives in the existing drawing: use **Simulate** to add a sheet. Run and Stop are in the main toolbar while a Simulation sheet is selected; duplicate setup is in that sheet tab's menu. Place/configure components through the existing editor and their Options/SPICE tabs. Per-instance SPICE edits override the symbol definition, including for symbols without library SPICE data.

## Implemented

- P1 virtual instruments are schematic components with instrument-style bottom panels: two-channel differential scope, loading-aware DC/AC meter and separate unpowered resistance test, function generator and soft-current-limited bench supply. Electron scope/meter windows persist across selection and target their own components. Analysis lab adds guided AC/transfer-function metrics, seeded Monte Carlo/corner studies, saved multi-condition test suites and power/stress checks. Definitions, conditions and study history persist; failures remain explicit. See [P1 scope, models and qualification](16-virtual-laboratory-and-p1-analysis.md). Fault injection and FFT remain P2 by explicit scope decision.

- Circuit Explorer implements the first P0 advanced-analysis slice: session-only tuning overrides with Reset/Undo/Apply and debounced reruns, numeric property/source/parameter bindings, preferred-value sliders, cancellable one-variable sweeps, persistent sweep groups, overlaid curves and metric-versus-parameter plots. Named time-weighted/transient/complex-AC measurements and typed requirements persist with the setup; runs capture definitions, results, units and provenance. Fresh DC voltage/current/power annotations use stable schematic/net mapping. See [Circuit Explorer](15-circuit-explorer.md) for semantics, bounds and automated qualification.

- Browser ngspice 47 runs in a fresh WASM worker per acquisition. Electron runs the same upstream release through a dedicated native helper process. Neither path needs a user-installed simulator or downloads a runtime on first use.
- Simulation sheets contain analysis settings, parameters, attached model text, instructions, signal selection, derived differential/gain/power traces and run history. All schematic sheets contribute to one circuit. No project or linked drawing format was added.
- Operating point, transient, AC, DC sweep, noise, transfer function and pole-zero analyses have forms and validated commands. Noise keeps spectral and integrated plots separately. Native builds load bundled XSPICE code models; browser circuits using code-model devices receive an explanation.
- Run and Stop preserve acquisition identity and accepted data chunks. Solver startup files are disabled. Stop terminates the isolated solver; these profiles do not offer cooperative Pause or Live.
- Results include scalar tables, paginated numerical data and Chart.js plots with labelled unit axes (voltage/current on separate left/right axes), real/magnitude/dB/phase display, horizontal log scale, wheel/pinch/region zoom, drag/button pan, Fit, keyboard-accessible cursors, sample-weighted statistics and compatible pinned-baseline overlays. Chart sampling preserves extrema and refines visible samples when zooming. Chart downloads offer PNG and full-resolution CSV; JSON/SPICE-text-raw and measurement JSON exports remain available.
- The toolbar SPICE menu inserts embedded voltage/current sources, ground, voltage/differential/current probes and voltage-controlled voltage/current sources. Dedicated bottom panels configure these components. Independent sources offer DC, sine, pulse, triangle, PWL, exponential and FM waveforms, plus AC magnitude/phase; Chart.js previews use the same numeric parameters as the generated SPICE statements. Probes show retained run output after verifying the circuit hash. See [sources, probes and charts](14-spice-controls-and-charts.md).
- A resizable right-hand chart panel keeps the schematic visible in browser and Electron. Probe charts appear by default; users can add/remove charts, choose custom signals, select acquisitions and run/stop from the drawing. Live and retained readings are checked against the circuit fingerprint. Electron charts can be detached into independent windows and docked again; actual hidden-window rendering, live values and independent closure have automated qualification. Chart layout is session-only.
- Ordinary drawings default to XML `.dsn`; any simulation components, settings or results always select ZIP `.dzn`, regardless of size or an earlier XML preference. Result-free simulation drawings also use `.dzn`. Compressed drawings use ZIP Store/Deflate, a MIME entry, versioned manifest and SHA-256 inventory. Real/imaginary samples use little-endian float64 entries. ZIP/XML detection reads the header. Existing XML remains readable/writable; current XML embeds result buffers as base64. Keep an original copy when exchanging new Simulation records with older TinyCAD releases.
- The File menu offers Save without results; result removal preserves setup/history. Removed numerical buffers remain available to Undo during the session and count toward its memory limit. Limits are 64 MiB per run and 256 MiB per document, including complex/multiple-plot vectors and UTF-8 solver logs. Saving a compact copy and reopening it releases session/Undo buffers.
- Optional DRC checks report components missing SPICE data. Simulation readiness and solver diagnostics locate affected symbols through the DRC-style issue list. Built-in source settings are validated before running. Two-way probe highlighting and model/pin-mapping recovery remain planned.
- Three prepared, editable teaching drawings cover a 5 V divider, RC charging and RC low-pass response. See [examples and guidance](../examples/simulation/README.md). They contain setup and embedded component definitions, with no precomputed results, and are included in packaged application resources.
- Filesystem, Drive and Electron adapters read/write bytes. Electron drawing replacement writes a temporary file and renames it after writing succeeds. Invalid archives are rejected before replacing the result cache.

## Build and run

Use Node 24, Python 3.12+, GNU make, patch and a C/C++17 toolchain. On Windows use MSYS2 UCRT64 or CLANGARM64. `npm run engine:native` selects the matching environment from `MSYS2_ROOT`, `build/toolchains/msys64`, or `C:/msys64`; it does not depend on Windows Store Python aliases or WSL. The build script downloads the release archive only if absent and verifies its locked SHA-256 before extraction. Source builds apply four checksum-locked patches: startup initialization, non-XSPICE compilation, quoted code-model paths, and the Windows UTF-8/wide-path code-model loader. Patch files are forced to LF by `.gitattributes`.

The normal native command rebuilds from freshly extracted source. `npm run engine:native -- --stage-only` is a development shortcut for rebuilding the helper and collecting dependencies from an existing native build. It rejects changed source/patch/configure provenance or a changed installed library; use the full build after recipe changes affecting ngspice.

```sh
npm ci
python3 scripts/install-emsdk.py
source build/toolchains/emsdk-4.0.23/emsdk_env.sh
npm run engine:wasm
npm run build:fs
# Or npm run start:fs for Parcel development.
```

Build native ngspice outside the activated Emscripten environment, so native tools are selected:

```sh
npm run engine:native
npm run test:engines
npm run dev
# Package only targets whose engine artifacts are staged:
npm run dist -- --linux deb --x64
```

`build/engines/native` is the development runtime. Packaging uses `build/engines/native-${arch}`. GitHub Actions build every supported platform/architecture on its own runner, upload complete engine directories and stage the appropriate artifacts before packaging. The after-pack hook rejects missing/mismatched binaries and verifies ELF/PE/Mach-O architecture and hashes. macOS nested engine binaries are signed before their packaged manifest is finalized; outer application signing preserves those signatures. Windows finalizes changed PE hashes after signing and rechecks architecture/integrity before creating the installer. Its hook has simulated-byte regression coverage and an actual self-signed helper/DLL qualification with all eight numerical fixtures passing; trusted release-certificate qualification remains separate. AppX archives are additionally checked for associations, hashes, architecture, licences and teaching drawings, and their extracted host-compatible runtimes run the numerical fixtures. Existing release signing and publishing steps remain in place.

Engine output includes the upstream source archive, licensing inventory, patches and build provenance. Generated binaries are ignored by Git. `engine.lock.json` pins source/SDK/patch digests; the manifest build identity also includes the bridge/build-recipe digests and compiler identity. WASM assets are copied unchanged and integrity-checked at runtime. Native startup verifies its bundled files and never searches PATH for a simulator.

## Verification and remaining work

P1 passes 62 automated regression tests, TypeScript checking, isolated browser
and Electron production bundles, and all 10 native/WASM numerical/parity fixtures
on the Windows host. The two added parity fixtures cover meter loading and
behavioural current limiting. Hidden Electron checks verify persistent scope/meter
windows, independent closure, correct edit targets, dual channel scales,
cursor/graticule rendering and P1 study execution. Panel PNGs are captured in
`build/qualification/chart-windows/` for visual review. This does not replace
installed-application or classroom acceptance.

```sh
npm run test:simulation
npm run test:engines       # both staged engines
node scripts/tests/qualify-engines.mjs wasm
node scripts/tests/qualify-engines.mjs native
```

Numerical fixtures cover a divider and source-current sign, RC charging, complex AC response, DC sweep, noise's two plots, transfer function, pole-zero and a diode. Both engines are compared numerically. Persistence tests exercise XML/ZIP conversion, UTF-16 XML, complex and multi-plot buffers, compact copies, unsafe/corrupt archive rejection, transactional cache replacement, quantity parsing, complex traces and exports.

The Circuit Explorer P0 changes pass 60 local automated tests, TypeScript checking,
filesystem-browser and Electron production bundles, and all eight WASM numerical
fixtures on the Windows host. The new native regression verifies a five-value RC
sweep against theoretical cutoff within 0.1%, immutable tuning, cached reuse,
cancelled scheduling, saved sweep restoration and divider voltage/current/power
annotations. Hidden Electron DOM checks verify tuning, cached Reset, Apply, five
gain curves, metric plots, restored sweep groups, typed requirement failures and
immediate suppression of stale DC annotations. UI solver events in that check
are deterministic fixtures; the separate native regression uses bundled ngspice.

The feature catalogue also describes later workbench features. General two-way schematic probe highlighting, unrestricted multidimensional sweeps, fault injection, FFT, Live/Pause, specialist analyses and a full localization pass remain planned. P1 adds bench instruments, seeded Monte Carlo and bounded corner enumeration to Circuit Explorer's one-variable sweeps, operating-point overlays and named measurement/requirement evidence. Existing placed-component SPICE properties remain editable; embedded sources and probes have dedicated configuration panels. File-backed device models (including XSPICE filesource/table models) are rejected; external device data files are not part of this profile.

Automated qualification on 8 November 2026 passes all six engine jobs: WASM and native Windows x64/ARM64, macOS ARM64 and Linux x64/ARM64. Each native job passes eight numerical fixtures and 41 simulation tests without skips. Windows also passes all 46 local focused tests, native/WASM parity, typecheck, localization checks and both browser production bundles. Packaging passes Windows NSIS/AppX for both architectures, macOS ARM64 DMG, Linux x64/ARM64 Debian and x64 core24 Snap. Host-compatible packaged runtimes pass the numerical fixtures; cross-architecture payloads pass architecture and integrity checks. See the [platform handoff](12-todo-and-platform-handoff.md) for reproducible commands, build identities and CI evidence.

Earlier browser checks cover the divider, Noise plot switching, CSV export, compact copy, normal Save and compressed-file reopen. An earlier Linux x64 Debian installation ran the divider and Noise analysis through its real IPC/native helper. The current Windows-host work used automated checks only: installed UI, double-click associations and classroom review remain separate acceptance checks, as do trusted production signing, notarization and store submission. Engine, browser and Electron workflows support manual dispatch for feature-branch qualification; packaging can reuse verified engine artifacts without rebuilding them.

The native Linux qualification profile builds on Ubuntu 24.04, and Snap uses core24 to match its glibc runtime; support for older distributions is not established by this profile. The Windows workflow uses UCRT64 and CLANGARM64, following [MSYS2’s supported environments](https://github.com/msys2/setup-msys2/blob/main/README.md). Artifact transfer uses the Node 24 [download-artifact v7 action](https://github.com/actions/download-artifact/releases/tag/v7.0.0).

See [Drawing extensions and Drive deployment](11-drawing-extensions-and-drive.md) for naming, automatic compression and the external Google Cloud Console registration step.
