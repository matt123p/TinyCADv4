# TODO and Windows/macOS handoff

Working branch: **`feature/spice`**. Starting implementation commit: `81b73f5`. Pull the latest branch before working; the handoff checklist is added in a subsequent commit.

The next milestone is a clean native build, passing numerical fixtures, and a working installed application on Windows and macOS. Complete those checks before expanding the workbench UI. Check an item only after recording evidence on the target machine.

## Baseline already exercised

- [x] Linux x64 native and browser WASM engines passed all eight numerical fixtures: divider/current sign, RC transient, complex AC, DC sweep, noise, transfer function, pole-zero and diode.
- [x] Browser UI exercised the divider, noise plot switching, CSV export, compact copy, normal Save and compressed-file reopen.
- [x] A Linux x64 Debian package was built; its native runtime passed numerical fixtures, and its Electron UI ran the divider and noise through the real preload/IPC/helper path.
- [x] After the `.dzn` changes, 20 focused tests passed, including automatic format selection, filesystem/Drive persistence and Electron dialog filters. Electron, filesystem-browser and Google-browser bundles built.
- [ ] Qualify Windows x64, Windows ARM64 and macOS ARM64. The Linux evidence does not establish those targets work.
- [ ] Test installed `.dsn`/`.dzn` associations on each OS. The earlier packaged UI smoke test is not proof of the later association changes.

See [current implementation status](10-implementation-status.md) for what is implemented versus planned.

## 1. Get the branch and prepare the machine

Use Node 24, Python 3.12+, Git, and the native C/C++ toolchain. Run commands from the repository root unless stated otherwise.

```sh
git clone -c core.autocrlf=false --branch feature/spice git@github.com:matt123p/TinyCADv4.git
cd TinyCADv4
git pull --ff-only
npm ci
node -p "process.platform + ' ' + process.arch"
python3 -c "import platform; print(platform.system(), platform.machine())"
```

For an existing checkout, switch to `feature/spice` and pull after preserving any local changes. The clone setting above preserves the exact bytes of the locked upstream patches, including on Windows.

- [ ] Confirm Node, Python and compiler architectures agree. On Apple Silicon, avoid mixing an x64/Rosetta shell or Node installation with an ARM64 engine.
- [ ] Confirm compiler, `make`, `patch`, and Python commands are available in the shell that runs the native build.
- [ ] Keep native builds in a shell without an activated Emscripten environment.
- [ ] Inspect [the CI recipe](../.github/workflows/ngspice.yml) when reproducing a platform failure.

Generated `build/`, `public/engines/` and `release/` output is ignored by Git. Pulling this branch does **not** transfer the Linux engine or install a Windows/Mac engine. Build on the target machine or stage a complete qualified CI artifact, including its manifest, helper, library, modules and dependencies.

### Windows x64

Run `npm ci` with Windows Node 24. Build the engine in an **MSYS2 UCRT64** shell, using the repository's actual checkout path:

```sh
cd /c/src/TinyCADv4
pacman -S --needed make patch tar mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-python
export CC=gcc
export CXX=g++
python3 scripts/build-ngspice.py native
```

Then return to a normal Windows terminal at the repository root:

```sh
node scripts/tests/qualify-engines.mjs native
npm run test:simulation
npm run dev
npm run dist -- --win nsis --x64 --publish never
```

- [ ] First build succeeds from a fresh checkout without a system-installed ngspice.
- [ ] If the builder reports an unreviewed patch, inspect Git newline conversion. Add repository `.gitattributes` rules to enforce LF for checksum-locked patch files; do not change expected digests merely to accept CRLF conversion.
- [ ] Verify all dependent DLLs are copied and have the correct architecture. Check DLL discovery and missing-import diagnostics.
- [ ] Test checkout, installation and user-profile paths containing spaces and non-ASCII characters. Verify the private job-directory staging and wide-path library loading.
- [ ] After x64 passes, repeat on Windows ARM64 using **CLANGARM64**, the package list in CI, `CC=clang`, `CXX=clang++`, and an ARM64 packaging target.
- [ ] Check ARM64 helper static-link flags, libc++ selection and `llvm-objdump` fallback; these have not been qualified locally.
- [ ] Test AppX separately using the existing publisher/certificate setup. An unsigned NSIS test is not Store/AppX qualification.

### macOS

Prepare Xcode command-line tools, Node 24, Python 3.12+, `make` and `patch`. On the currently configured Apple Silicon target:

```sh
npm run engine:native
node scripts/tests/qualify-engines.mjs native
npm run test:simulation
npm run dev
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist -- --mac --arm64 -c.mac.identity=null -c.mac.notarize=false --publish never
```

- [ ] First native build succeeds using the Apple toolchain.
- [ ] Review the shared-library C++ link flags. The recipe currently replaces `-lstdc++` for CLANGARM64; establish whether the Apple toolchain needs a corresponding macOS change.
- [ ] Inspect helper, dylib and every `.cm` module with `otool -L`. Remove build-machine/Homebrew-only dependency paths from shipped binaries or bundle the required dependencies explicitly.
- [ ] Verify install names and loader paths after relocation into the application bundle.
- [ ] Check whether `install_name_tool` changes require renewed ad-hoc signing for local development loads.
- [ ] Launch the packaged application from Finder, not just the development terminal. Separate expected unsigned-package/Gatekeeper behavior from actual simulator loading errors.
- [ ] Test Developer ID signing and notarization separately. Verify nested engine signatures and manifest hashes still agree after signing, then verify the outer app and stapled notarization ticket.
- [ ] If using an Intel Mac, qualify development with x64 Node/Python/compiler. Add an explicit macOS x64 packaging/CI profile before claiming Intel distribution support; the current Mac release target is ARM64.

## 2. Engine and packaging acceptance checks

- [ ] Native fixture command passes all eight cases on each target.
- [ ] Run `npm run test:simulation` after building native. Check the skip count: native tests can be skipped when the native manifest is absent.
- [ ] Packaged engine checks pass. `npm run dist` runs [the package verifier](../scripts/verify-packaged-engines.mjs); it numerically tests packaged runtimes executable on the host. A cross-architecture artifact still needs execution on its target machine.
- [ ] Install on a machine/session without the compiler toolchain or an ngspice installation available, and repeat a simulation. This tests dependency closure rather than developer-machine PATH availability.
- [ ] A missing, mismatched or corrupted bundled file produces a useful error; it never silently switches the Electron run to WASM or a system ngspice.
- [ ] Run/Stop repeatedly, stop during startup and during a long transient, close a running window, and open another drawing during a run. Check for orphan helpers, late results attached to the wrong document, stale temporary files and inability to start another acquisition.
- [ ] Check Windows executable/DLL signing against manifest verification: signing can alter PE bytes after an earlier hash was recorded.
- [ ] Confirm packaged notices, source archive, patches and runtime dependency licences are present.

### WASM and CI artifacts

Native Electron testing does not require rebuilding WASM. `npm run test:engines` requires **both** engines to be staged; use the native-only fixture command above until then.

- [ ] Build WASM using the locked SDK instructions in [the implementation guide](10-implementation-status.md), or obtain a qualified `ngspice-wasm` CI artifact.
- [ ] If using downloaded CI artifacts, extract them beneath `build/engine-artifacts/`, preserving each artifact directory and manifest, then run `node scripts/stage-engine-artifacts.mjs`.
- [ ] Run `npm run test:engines` with both engines present to compare their numerical results.
- [ ] Build and exercise the browser variant on each relevant browser. The filesystem variant needs File System Access support; browser support must be recorded separately from Electron support.
- [ ] Enable a practical feature-branch CI entry point. Current workflows run on PRs targeting `main` or pushes to `main`/`production`; a plain `feature/spice` push does not run the matrix. Open a PR into `main` or add `workflow_dispatch`.

## 3. Manual drawing and results checklist

Use prepared drawings with placed components carrying valid `$$SPICE` metadata. Symbol sourcing, selection and library-provider work remain on their separate branch.

- [ ] Add, rename, reorder, duplicate and delete Simulation sheets; preserve at least one schematic sheet. Confirm every Simulation sheet uses the shared circuit across schematic sheets.
- [ ] Run a 5 V divider with two 1 kΩ resistors: midpoint **2.5 V**, source branch current **−2.5 mA**. Status must identify `native` in Electron and `wasm` in the browser.
- [ ] Exercise transient, complex AC, DC sweep including descending ranges, noise's separate spectrum/integrated plots, transfer function and pole-zero results.
- [ ] Check missing models/attributes, duplicate references, missing ground, invalid quantities and unsupported browser code models. Errors should explain how to recover.
- [ ] Exercise signal selection, differential/gain/power traces, unit-separated plots, Fit/zoom/pan, both cursors, pinned baselines, history selection and stale-result indications.
- [ ] Export CSV, JSON, raw data, measurements and SVG; reopen exports in another suitable tool and check complex values, units, sample counts and partial-run status.
- [ ] Save an ordinary drawing as XML `.dsn`. Grow retained results/logs to at least **1 MiB** and confirm automatic ZIP `.dzn` selection. Test explicit XML/ZIP overrides.
- [ ] Remove or exclude results and confirm automatic selection returns to `.dsn`. Cancel a format-change destination dialog and confirm the original file/association and dirty state remain correct.
- [ ] Reopen `.dsn` and `.dzn` through the dialog, recent-file list, command line and OS double-click. Also open ZIP deliberately renamed `.dsn` and XML renamed `.dzn`: content decides the decoder.
- [ ] Open either drawing type while editing a library; confirm the correct drawing window/workflow is used.
- [ ] Save a compact `.dzn` copy, reopen both original and copy, and verify the original retains results while the copy retains setup/history without result buffers.
- [ ] Check result removal/Undo, omission from saves, corrupt/truncated ZIP rejection and failed/cancelled saves without overwriting the original.
- [ ] Test the Drive variant: new upload, existing-file `.dsn`↔`.dzn` transition with the same file ID/shared URL, and reopen by ID. Apply the external `.dzn` association setting from [Drive deployment notes](11-drawing-extensions-and-drive.md).

## 4. Next implementation work

### First useful education release

- [ ] Fix and regression-test platform failures found above; keep source/patch changes and locked digests reviewable.
- [ ] Finish schematic probe placement, two-way highlighting, current direction/reference presentation and operating-point overlays. Keep readings tied to a visible acquisition and freshness state.
- [ ] Add readiness issue lists that locate the affected placed component/net, with model and pin-mapping recovery paths.
- [ ] Provide prepared teaching drawings and first-run guidance using the agreed symbol-branch contract.
- [ ] Add the simple ideal DC meter presentation; then build bench views on the existing analysis/result model.
- [ ] Review keyboard, touch, accessibility, localization, narrow-window layouts and actionable error messages with educators.
- [ ] Resolve the repository-wide TypeScript errors and establish a clean typecheck baseline. Existing bundle/test success is not a passing `npx tsc --noEmit` result.
- [ ] Review large-result performance and memory/Undo retention. Removing stored results currently preserves session buffers for Undo; confirm limits and recovery guidance are suitable for classroom machines.

### Broader workbench, after the foundation is qualified

- [ ] Scope, Bode, supply/generator, expanded meter and capability-backed logic-analyzer views.
- [ ] Parameter/temperature sweep execution, trial tuning and richer run-family comparisons.
- [ ] FFT/Fourier processing with explicit sample interval, resampling/window choices and units.
- [ ] Live/Pause/Resume only after the selected backend demonstrates safe cooperative control. Current Stop terminates the solver; label that behavior honestly.
- [ ] Monte Carlo/corner experiments and specialist analyses, prioritized against the existing user stories.
- [ ] Extend model compatibility and file-backed stimuli only with a defined, document-owned data-file boundary. Current file-backed device models are deliberately rejected.

Keep the one-drawing/multi-sheet model. No project support, linked schematic documents or symbol-provider UI is added by these TODOs. The full acceptance requirements remain in [the requirements catalogue](04-requirements.md).

## 5. Record results for the next machine

For each completed platform check, record the commit, OS version, CPU/Node/Python/compiler architecture and versions, engine manifest build ID, commands, pass/fail/skip counts, installer type and a reproducing drawing for any failure. Keep generated logs under ignored `build/` directories; put concise findings and follow-up issue links in this document. Never commit signing credentials or certificates.

| Platform | Commit / engine build ID | Build + numerical tests | Installed UI + associations | Signing | Findings |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | Pending | Pending | Pending | Pending | |
| Windows ARM64 | Pending | Pending | Pending | Pending | |
| macOS ARM64 | Pending | Pending | Pending | Pending | |
| macOS x64, if added | Pending | Pending | Pending | Pending | Not in the current release matrix. |
