# Running the simulation integration

Simulation lives in the existing drawing: use **Simulate** or **+ Simulation** to add a sheet. Place/configure components through the existing editor and their SPICE properties. This integration consumes their `$$SPICE` templates; symbol supply and selection remain separate work.

## Implemented

- Browser ngspice 47 runs in a fresh WASM worker per acquisition. Electron runs the same upstream release through a dedicated native helper process. Neither path needs a user-installed simulator or downloads a runtime on first use.
- Simulation sheets contain analysis settings, parameters, attached model text, instructions, signal selection, derived differential/gain/power traces and run history. All schematic sheets contribute to one circuit. No project or linked drawing format was added.
- Operating point, transient, AC, DC sweep, noise, transfer function and pole-zero analyses have forms and validated commands. Noise keeps spectral and integrated plots separately. Native builds load bundled XSPICE code models; browser circuits using code-model devices receive an explanation.
- Run and Stop preserve acquisition identity and accepted data chunks. Solver startup files are disabled. Stop terminates the isolated solver; these profiles do not offer cooperative Pause or Live.
- Results include scalar tables, paginated numerical data, plots, real/magnitude/dB/phase display, horizontal log scale, zoom/pan/Fit, keyboard-accessible cursors, sample-weighted statistics and compatible pinned-baseline overlays. SVG/CSV/JSON/SPICE-text-raw and measurement JSON exports are available.
- Ordinary drawings default to XML `.dsn`; retained result data/logs of at least 1 MiB select ZIP `.dzn`. Explicit format overrides remain available. Compressed drawings use ZIP Store/Deflate, a MIME entry, versioned manifest and SHA-256 inventory. Real/imaginary samples use little-endian float64 entries. ZIP/XML detection reads the header. Existing XML remains readable/writable; current XML embeds result buffers as base64. Keep an original copy when exchanging new Simulation records with older TinyCAD releases.
- Storage controls remove results without deleting setup/history, omit selected sheets' data from saves, change XML/ZIP representation, or download a compact copy without changing the open file association. Removed numerical buffers remain available to Undo during the session and count toward its memory limit.
- Filesystem, Drive and Electron adapters read/write bytes. Electron drawing replacement writes a temporary file and renames it after writing succeeds. Invalid archives are rejected before replacing the result cache.

## Build and run

Use Node 24, Python 3.12+, GNU make, patch and a C/C++17 toolchain. On Windows use the MSYS2 UCRT64 or CLANGARM64 environment from the engine workflow. The build script downloads the release archive only if it is absent and verifies its locked SHA-256 before extraction. Source builds apply the three recorded upstream fixes for startup initialization, non-XSPICE compilation and quoted code-model paths.

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

`build/engines/native` is the development runtime. Packaging uses `build/engines/native-${arch}`. GitHub Actions build every supported platform/architecture on its own runner, upload complete engine directories and stage the appropriate artifacts before packaging. The after-pack hook rejects missing/mismatched binaries and verifies ELF/PE/Mach-O architecture and hashes. macOS nested engine binaries are signed before their packaged manifest is finalized; outer application signing preserves those signatures. Existing release signing and publishing steps remain in place.

Engine output includes the upstream source archive, licensing inventory, patches and build provenance. Generated binaries are ignored by Git. `engine.lock.json` pins source/SDK/patch digests; the manifest build identity also includes the bridge/build-recipe digests and compiler identity. WASM assets are copied unchanged and integrity-checked at runtime. Native startup verifies its bundled files and never searches PATH for a simulator.

## Verification and remaining work

```sh
npm run test:simulation
npm run test:engines       # both staged engines
node scripts/tests/qualify-engines.mjs wasm
node scripts/tests/qualify-engines.mjs native
```

Numerical fixtures cover a divider and source-current sign, RC charging, complex AC response, DC sweep, noise's two plots, transfer function, pole-zero and a diode. Both engines are compared numerically. Persistence tests exercise XML/ZIP conversion, UTF-16 XML, complex and multi-plot buffers, compact copies, unsafe/corrupt archive rejection, transactional cache replacement, quantity parsing, complex traces and exports.

The feature catalogue also describes later workbench features. Bench instrument panels, schematic probe placement/highlighting and operating-point overlays, curated teaching examples, automatic parameter/Monte Carlo sweeps, FFT, Live/Pause, specialist analyses and a full localization pass are not implemented here. These are not represented by inert controls. Existing placed-component SPICE properties remain the component/source editor. File-backed device models (including XSPICE filesource/table models) are rejected; external device data files are not part of this profile.

Linux x64 native and WASM builds and numerical tests have been exercised locally. Browser checks cover the divider, Noise plot switching, CSV export, compact copy, normal Save and compressed-file reopen. A Linux x64 Debian package was built; its bundled native runtime passed the numerical fixtures, and the packaged Electron UI ran the divider and Noise analysis through its real IPC/native helper. Other native targets, signing, other installers and store submission require the added CI matrix; local Linux validation does not establish that those packages pass. Repository-wide TypeScript checking also reports existing errors outside the simulation changes; application bundle checks and simulation tests are separate checks.

The native Linux qualification profile builds on Ubuntu 24.04, and Snap uses core24 to match its glibc runtime; support for older distributions is not established by this profile. The Windows workflow uses UCRT64 and CLANGARM64, following [MSYS2’s supported environments](https://github.com/msys2/setup-msys2/blob/main/README.md). Artifact transfer uses the Node 24 [download-artifact v7 action](https://github.com/actions/download-artifact/releases/tag/v7.0.0).

See [Drawing extensions and Drive deployment](11-drawing-extensions-and-drive.md) for naming, automatic compression and the external Google Cloud Console registration step.
