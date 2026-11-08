# TODO and Windows/macOS handoff

Upstream branch: **`feature/spice`** (local branch on the Windows host: `spice`). Starting implementation commit: `81b73f5`; Windows work started from merge `c415713c5c8ba3ebfaea5073ed1e106e129a1fa5`. Windows qualification changes are committed as `5d0ac5f`; XML memory, deterministic examples and ARM64 CI setup fixes are in `8c078c7`. Preserve local changes before pulling. Evidence below identifies the tested revisions.

The next milestone is a clean native build, passing numerical fixtures, and a working installed application on Windows and macOS. Complete those checks before expanding the workbench UI. Check an item only after recording evidence on the target machine.

## Baseline already exercised

- [x] Linux x64 native and browser WASM engines passed all eight numerical fixtures: divider/current sign, RC transient, complex AC, DC sweep, noise, transfer function, pole-zero and diode.
- [x] Browser UI exercised the divider, noise plot switching, CSV export, compact copy, normal Save and compressed-file reopen.
- [x] A Linux x64 Debian package was built; its native runtime passed numerical fixtures, and its Electron UI ran the divider and noise through the real preload/IPC/helper path.
- [x] After the `.dzn` changes, 20 focused tests passed, including automatic format selection, filesystem/Drive persistence and Electron dialog filters. Electron, filesystem-browser and Google-browser bundles built.
- [x] Automated engine and package qualification covers Windows x64/ARM64 and macOS ARM64, with target-native engine fixtures and integrity/architecture checks. Installed interactive behavior remains excluded from this run.
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

Run `npm ci` with Windows Node 24. Install the build dependencies in an **MSYS2 UCRT64** shell:

```sh
cd /c/src/TinyCADv4
pacman -S --needed make patch tar mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-python
export CC=gcc
export CXX=g++
python3 scripts/build-ngspice.py native
```

Alternatively, after installing those MSYS2 packages, use a normal PowerShell terminal at the repository root. The launcher selects UCRT64 automatically for x64 Node, searches `MSYS2_ROOT`, `build/toolchains/msys64`, then `C:/msys64`, and passes the checkout path without shell interpolation:

```sh
npm run engine:native
node scripts/tests/qualify-engines.mjs native
npm run test:simulation
npm run dev
npm run dist -- --win nsis appx --x64 --publish never
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/qualify-windows-signing.ps1
```

- [x] Windows x64 builds from freshly extracted, checksum-verified source without a system-installed ngspice. This host used the existing checkout; a checkout path containing spaces still needs a full source-build check.
- [x] Enforce LF for checksum-locked patches with `.gitattributes`. Original patch digests are unchanged; the reviewed Windows loader fix is a separate fourth locked patch.
- [x] Verify Windows x64 DLL discovery and dependency closure: only MinGW's GCC, libstdc++ and pthread runtime DLLs accompany ngspice; no Windows OS DLLs are redistributed. Relocated native tests run with PATH limited to Windows System32. The packaged architecture/integrity hook is a separate package check.
- [ ] Test checkout, installation and user-profile paths containing spaces and non-ASCII characters. Verify the private job-directory staging and wide-path library loading.
- [ ] After x64 passes, repeat on Windows ARM64 using **CLANGARM64**, the package list in CI, `CC=clang`, `CXX=clang++`, and an ARM64 packaging target.
- [ ] Check ARM64 helper static-link flags, libc++ selection and `llvm-objdump` fallback; these have not been qualified locally.
- [x] Build unsigned x64 AppX with the configured publisher. Verify its actual archive's associations, engine hashes/architecture, patches/licences, teaching drawings and extracted runtime numerical fixtures. This does not qualify Store installation or trusted signing.
- [ ] Test AppX signing and installation using the release publisher/certificate and Store configuration.

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

- [x] Native fixtures pass all eight cases on Windows x64/ARM64, macOS ARM64 and Linux x64/ARM64 in CI run 42425171099.
- [x] Each target-native CI job passes 41 simulation tests with zero skips. Local Windows runs also include symbol/proxy checks: 46 tests, zero failures/skips.
- [x] Packaged engine checks pass on Windows, macOS ARM64 and Ubuntu 24.04 in CI run 42430335118. Host-compatible runtimes pass numerical fixtures; cross-architecture packages pass hash/architecture checks, with their engine binaries separately executed in the target-native qualification run. Installed interaction remains excluded.
- [ ] Install on a machine/session without the compiler toolchain or an ngspice installation available, and repeat a simulation. This tests dependency closure rather than developer-machine PATH availability.
- [x] Automated broker checks reject missing, mismatched, corrupted or unverified bundled binaries before announcing readiness or spawning a helper/fallback; failure releases the acquisition slot. Interactive error presentation remains excluded.
- [ ] Run/Stop repeatedly, stop during startup and during a long transient, close a running window, and open another drawing during a run. Check for orphan helpers, late results attached to the wrong document, stale temporary files and inability to start another acquisition.
- [x] Sign isolated Windows helper/DLL copies with an ephemeral self-signed identity, finalize the changed hashes, and rerun all eight numerical fixtures. Store-trusted release identities remain a separate check.
- [x] Windows x64: confirm packaged notices, source archive, all four patches and runtime dependency licences are present. Repeat for other target packages.

### WASM and CI artifacts

Native Electron testing does not require rebuilding WASM. `npm run test:engines` requires **both** engines to be staged; use the native-only fixture command above until then.

- [x] Obtain the passing `ngspice-wasm` artifact from [CI run 42425171099](https://github.com/matt123p/TinyCADv4/actions/runs/42425171099), commit `add42bd`. WASM build ID `ngspice-47-f061b271c3845335`.
- [x] Extract beneath `build/engine-artifacts/ngspice-wasm` and run `node scripts/stage-engine-artifacts.mjs` on the Windows host.
- [x] Run `npm run test:engines` on Windows x64: all eight native/WASM fixtures and numerical parity comparisons pass. Evidence: `build/qualification/windows-x64/engine-parity.log`.
- [ ] Build and exercise the browser variant on each relevant browser. The filesystem variant needs File System Access support; browser support must be recorded separately from Electron support.
- [x] Add `workflow_dispatch` to the engine, Electron and browser workflows. Dispatching a feature-branch run remains separate from this local qualification; no CI result is implied by adding the entry point.

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
- [x] Add embedded source/probe/ground insertion, source waveform previews, probe result charts and Chart.js result plotting. Sources support voltage/current, DC/sine/pulse/triangle/PWL/exponential/FM and AC settings; extra tools include differential/current probes and VCVS/VCCS. Automated checks cover native preview parity, insertion/wire connectivity, definitions/configuration after save/reopen, probe polarity and complex differences, chart unit axes, peak preservation and full-resolution CSV.
- [ ] Finish two-way probe highlighting and schematic operating-point overlays. Probe panels now identify the selected acquisition, explain direction/reference and reject readings after circuit changes; installed visual acceptance remains separate.
- [ ] Add readiness issue lists that locate the affected placed component/net, with model and pin-mapping recovery paths.
- [x] Provide prepared teaching drawings and first-run guidance using placed symbols with embedded `$$SPICE` templates. [Divider, RC charging and RC low-pass](../examples/simulation/README.md) include expected readings and editable values; packaging includes them. Save/reopen, connectivity, readiness and native measurements have regression coverage. Visual classroom review remains pending.
- [ ] Add the simple ideal DC meter presentation; then build bench views on the existing analysis/result model.
- [ ] Review keyboard, touch, accessibility, localization, narrow-window layouts and actionable error messages with educators.
- [x] Resolve the repository-wide TypeScript errors and establish `npm run typecheck` as a clean baseline and engine CI check.
- [x] Add a reproducible large-result storage benchmark and fix the XML decoder's intermediate character-array allocation. [Windows measurements](13-result-storage-performance.md) cover 250,000/1,000,000 samples, XML/ZIP latency, peak RSS and compact-copy cache recovery. Classroom/browser/Electron rendering and larger run-family measurements remain pending. Retention tests include UTF-8 logs and all complex/multiple-plot buffers; existing 64 MiB/run and 256 MiB/document limits include Undo-retained buffers.

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

### Windows x64 host, 7–8 November 2026

Host: Windows 11 Pro 10.0.26300, Intel Core i5-12400F, x64 Node 24.14.0. Build tools are repository-local MSYS2 UCRT64 Python 3.14 and GCC 16.2.0 (MSYS2 Rev6). No system ngspice is used. The portable MSYS2 base was `msys2-base-x86_64-20260927.sfx.exe`, SHA-256 `ad336cccfda47758b5e15cda993fbba421115cb0b126697daef1ee4dfe37209f`, followed by repository updates and the packages above. Generated tools and evidence are under ignored `build/`.

Failures fixed on this host:

- Native Windows Python accidentally launched WSL's `bash`; build commands now resolve the actual MSYS2 executable and convert configure paths with `cygpath`.
- `shutil.which` did not discover MinGW DLLs because of Windows `PATHEXT`. Import discovery now checks actual DLL filenames and excludes resolved Windows system paths. Staging replaces its target directory to avoid shipping stale dependencies.
- The broker rejected `libstdc++-6.dll` because its manifest filename whitelist excluded `+`; the validated filename grammar now includes it.
- CRT ANSI arguments and upstream narrow code-model loading failed with Unicode paths. The helper now recovers wide Windows arguments and opens UTF-8 deck paths; locked patch 004 uses UTF-16 `LoadLibraryExW` for code models and resolves relative paths against the private job directory.
- Directory-link tests now use Windows junctions, so the focused tests do not require administrator symlink privileges.

Repository checks: `npm run typecheck` and `npm run check:i18n` pass. Tests now cover Stop during startup, repeated stopped acquisitions, document replacement with late results, the Electron window-destruction hook, and UTF-8 log/complex-buffer memory accounting. These automated hooks do not establish interactive installed UI behavior.

Native build ID: **`ngspice-47-7a23c2a71eecbd41`**, `win32/x64`, four locked patches and seven XSPICE modules. A fresh extraction/configure/compile/install completed, followed by verified helper/dependency restaging, most recently after the ARM64-only libtool recipe correction. All eight numerical fixtures pass. The focused suite passes **46 tests, 0 failures, 0 skips** (31 source tests, 4 native/example tests, 4 signing-hook tests, 4 broker integrity tests, 2 artifact-provenance tests and 1 Snap descriptor test). Relocation tests copy the whole runtime into paths with spaces and `Unicode Ω 测试`, run with System32-only PATH, and confirm local startup files are ignored. The teaching drawings are reopened from saved XML and produce their expected native divider, charging and AC measurements. Their static SVG renders were inspected for field overlap and source polarity; this is not a live UI test.

An unsigned x64 NSIS installer was built with Electron 44.9.0 / electron-builder 26.15.3. The Electron bundle check passed (16 modules, 51 resource/chunk references), the package hook checked PE architecture and hashes, and the packaged engine passed all eight numerical fixtures. `Get-AuthenticodeSignature` confirmed the packaged helper is unsigned and its bytes still match the manifest. Windows signing happens after `afterPack`, so an `afterSign` hook now finalizes changed PE hashes/sizes and revalidates the package before archiving. Tests simulate signer byte changes and reject source-resource or architecture changes transactionally; they do **not** establish Authenticode validity. Trusted release certificates, AppX signing and installed-app checks remain pending.

Actual PE-signing follow-up: `scripts/tests/qualify-windows-signing.ps1` creates an ephemeral RSA code-signing certificate in memory, signs isolated helper/DLL copies, runs the real finalization hook (two changed hashes), and passes all eight native fixtures. Its encrypted temporary PFX is deleted and environment variables restored; certificate stores are not changed. Windows reports an untrusted-root chain for this self-signed test identity. Trusted release-certificate validation and AppX signing remain pending. Evidence: `authenticode-test.log`.

Unsigned AppX: `release/TinyCAD Windows Setup 4.0.10-x64.appx`, 246,868,850 bytes, SHA-256 `7380715334c5da3b4fd743aac5b09c3aabea25789fc0aab2f9a34fcaee7113bb`. `scripts/verify-appx-package.mjs` verifies all 17 engine resources and four patches, PE architecture, runtime licences, three teaching drawings and `.dsn`/`.dzn`/`.tclib` manifest associations. It extracts the verified runtime and passes all eight fixtures with System32-only PATH. The archive has no signature entry; no installation was attempted. `npm run dist` now invokes this archive check for generated AppX files. Evidence: `windows-appx.log`, `appx-archive-check.log`, `package-archives-final.log`.

AppX payload names are percent-encoded, including `libstdc%2B%2B-6.dll`; the archive verifier compares decoded deployment names, consistent with [Microsoft's MSIX encoder/decoder](https://github.com/microsoft/msix-packaging/blob/master/src/msix/common/Encoding.cpp).

Final artifact after `add42bd`: `release/TinyCAD Windows Setup 4.0.10-x64.exe`, 174,279,182 bytes, SHA-256 `9f567981c9d1644ace80e5a8371093dea4832440e1b905ae9539ec37ba7901e5`. Its Authenticode status is `NotSigned`. `windows-dist-final.log` records successful finalization and all eight packaged numerical fixtures for the unpacked application and the actual AppX archive. The package contains the upstream source archive, notices, four patches, runtime licences and all three teaching drawings.

`scripts/dist.mjs` now launches Node/JavaScript CLIs without a shell, preserving paths and arguments containing spaces. This was exercised with Node installed under `C:\Program Files\nodejs`.

Reproduce from PowerShell after building the engine:

```powershell
# A workspace-local temp directory also works in restricted agent sessions.
New-Item -ItemType Directory -Force build/qualification/windows-x64 | Out-Null
$env:TEMP = Join-Path (Get-Location) 'build/qualification/windows-x64'
$env:TMP = $env:TEMP
node scripts/tests/qualify-engines.mjs native
node --test scripts/tests/*.test.mjs
npm run typecheck
npm run check:i18n
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm run dist -- --win nsis appx --x64 --publish never
```

Current evidence is under `build/qualification/windows-x64/`: `native-build-final.log` (fresh source build), `native-restage-final.log` (current runtime provenance), `all-focused-final.log` (46 tests), `engine-parity.log`, `result-performance.log`, `authenticode-test.log`, `windows-dist-final.log`, `browser-fs.log`, `browser-ga.log`, `typecheck.log` and `i18n.log`. A verifier run without prior build output is recorded in `build/qualification/appx-fresh-workspace.log`. The checked-in build recipes, tests and benchmarks are the durable reproducer; generated logs are not committed.

Computer Use was unavailable on this host, and the user subsequently selected automated checks only. Installed UI, double-click associations and keyboard/touch/educator review are excluded. Trusted release certificates, AppX signing and macOS notarization remain separate checks. Native/WASM parity and unsigned NSIS/AppX archive checks pass on this Windows host; target-native CI supplies the cross-platform engine evidence below.

Automated follow-up: both filesystem and Google browser production bundles pass with the qualified WASM assets (`browser-fs.log`, `browser-ga.log`). All 46 focused tests and typecheck also pass after the XML memory fix described in [storage measurements](13-result-storage-performance.md). These bundle checks do not establish live browser behavior.

CI follow-up found two Windows ARM64 build issues. [Run 42419676381](https://github.com/matt123p/TinyCADv4/actions/runs/42419676381) failed before compilation because Parcel's LMDB 2.8.5 dependency lacks a Windows ARM64 prebuild. The engine-only job now installs without unrelated lifecycle scripts and explicitly rebuilds esbuild; compiler/helper execution remains native ARM64. This does not establish native Parcel development support on Windows ARM64.

[Run 42420607807](https://github.com/matt123p/TinyCADv4/actions/runs/42420607807) then compiled ngspice successfully, but its vendored libtool recognized only x86 import-library file signatures and silently generated only a static library. Commit `a5de2c7` sets `lt_cv_deplibs_check_method=pass_all` for CLANGARM64, allowing the native linker to validate imports; the override is included in manifest configure provenance. Commit `add42bd` also ensures AppX verification creates its generated output directory in fresh packaging checkouts.

The replacement [CI run 42425171099](https://github.com/matt123p/TinyCADv4/actions/runs/42425171099), implementation commit `add42bd`, passes all six engine jobs: WASM plus Windows x64/ARM64, macOS ARM64 and Linux x64/ARM64. Each native job passes eight numerical fixtures and 41 simulation tests without skips. Windows ARM64 completed on 8 November 2026; its log confirms cached `pass_all` dependency recognition, DLL creation, numerical checks and relocation/Unicode tests. Windows packaging also passed. Linux packaging exposed `ubuntu-latest` moving to Ubuntu 26.04, incompatible with destructive core24 Snap builds. macOS built its DMG but electron-builder's implicit CI publishing then failed without a token.

Commit `5f8ee40` pins Linux packaging to Ubuntu 24.04 and explicitly disables publishing in build jobs; the existing production release job remains the publisher. Its [packaging retry 42429605099](https://github.com/matt123p/TinyCADv4/actions/runs/42429605099) reuses the six qualified engine artifacts and passes Windows and macOS packaging, including packaged native fixtures. Linux reached Snapcraft but exposed electron-builder's core24 descriptor pointing at `meta/gui` while generating the desktop source in `snap/gui`.

Commit `7d1b0d2` adds a Linux-only descriptor workaround using the correct `gui/` asset-relative path. The actual electron-builder generator is regression-tested; other descriptor fields and platforms are preserved. This follows [Snapcraft's prime/asset desktop-source resolution](https://github.com/canonical/snapcraft/blob/main/snapcraft/parts/setup_assets.py). The [final packaging run 42430335118](https://github.com/matt123p/TinyCADv4/actions/runs/42430335118) passes all three packaging jobs on 8 November 2026. No release was published.

- Windows builds x64/ARM64 NSIS and unsigned AppX. Both AppX archives pass associations, source/patch/resource integrity and PE architecture checks; their inventory contains 17 x64 / 15 ARM64 engine resources. The x64 unpacked and extracted AppX runtimes pass all eight numerical fixtures. ARM64 engine execution was already qualified on its native runner with identical verified payloads.
- macOS builds an unsigned ARM64 DMG; its app-bundle runtime passes all eight numerical fixtures.
- Ubuntu 24.04 builds x64/ARM64 Debian packages and an x64 core24 Snap. Snapcraft prime/pack succeeds with the corrected desktop source. Packaged host-compatible x64 runtimes pass all eight numerical fixtures; ARM64 engine execution was qualified in the target-native job.

Reuse first verifies all six source engine jobs passed; staging then checks the current source lock, patch digests, bridge content (normalizing only line endings), required configuration and file hashes. The source and bridge must match even when application/packaging code changes.

For packaging-only follow-ups with unchanged engine source/patches/bridge, run:

```powershell
gh workflow run electron.yml --repo matt123p/TinyCADv4 --ref feature/spice -f engine_run_id=42425171099
```

Leave `engine_run_id` blank to rebuild and qualify all engines. This option accepts an original engine-qualified run, not a packaging-only retry whose engine jobs were skipped.

| Platform | Commit / engine build ID | Build + numerical tests | Installed UI + associations | Signing | Findings |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | Local `add42bd` / `ngspice-47-7a23c2a71eecbd41`; engine CI `ngspice-47-65e0e9df3dd29004`; package `7d1b0d2` | Clean source build; 8/8 development, NSIS, AppX archive and self-signed fixtures; 46 local tests, 0 skips; native/WASM parity; CI packaging passes | Excluded from this automated-only run | Self-signed helper/DLL and manifest finalization pass; release trust and AppX signing pending | UTF-8 loader, MinGW dependencies, launcher and XML memory fixed; GCC 16.2.0. |
| Windows ARM64 | Engine CI `add42bd` / `ngspice-47-50645e01958249ec`; package `7d1b0d2` | Native build, 8 fixtures and 41 simulation tests pass with zero skips; NSIS/AppX builds and archive checks pass; clang 23.1.5 | Excluded from this automated-only run | Pending: trusted release identity | CLANGARM64 libtool fix qualified; runtime DLLs are ngspice and libc++; [engine run](https://github.com/matt123p/TinyCADv4/actions/runs/42425171099), [package run](https://github.com/matt123p/TinyCADv4/actions/runs/42430335118). |
| macOS ARM64 | Engine CI `add42bd` / `ngspice-47-060f5eb640ab77cf`; package `7d1b0d2` | Native build, 8 fixtures and 41 simulation tests pass; unsigned ARM64 DMG and app-bundle runtime pass. Apple clang 17.0.0. | Excluded from this automated-only run | Pending: release certificate/notarization | [Packaging run 42430335118](https://github.com/matt123p/TinyCADv4/actions/runs/42430335118); no installed-app claim. |
| macOS x64, if added | Pending | Pending | Pending | Pending | Not in the current release matrix. |
