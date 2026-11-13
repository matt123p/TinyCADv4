# TinyCAD

## About TinyCAD

This is the source code for TinyCAD. The TinyCAD website is https://www.tinycad.net


TinyCAD is a circuit diagram editor for creating and editing electronic schematics. It runs in a web browser or as a desktop app via Electron.

It is intended for:

- Electronics hobbyists
- Students and educators
- Makers and prototyping teams
- Engineers who want a lightweight schematic capture tool

The focus is fast schematic editing, practical symbol/library workflows, and straightforward export options.

This project is a complete re-write of the original C++ TinyCAD (https://github.com/matt123p/TinyCAD). 

## Manual and documentation contributions

Read the [TinyCAD manual](https://docs.tinycad.net/) for installation, drawing,
symbol libraries, keyboard shortcuts, and other workflows. The v4 manual includes
translations; the legacy v3 manual is also available on the documentation site.

The manual is maintained in the separate
[TinyCAD-docs repository](https://github.com/matt123p/TinyCAD-docs). Corrections,
missing steps, clearer examples, and updated screenshots are welcome.

- **Small fixes:** use **Edit this page on GitHub** in the manual, or open the
  relevant English Markdown file under `docs/v4/` in TinyCAD-docs. Click the pencil
  icon, make your change, and propose a pull request to `matt123p/TinyCAD-docs:main`.
- **Larger changes:** fork and clone TinyCAD-docs, create a branch, and follow its
  [setup and preview instructions](https://github.com/matt123p/TinyCAD-docs#local-setup).
  Preview with `npm run serve`, check links and navigation, then submit a focused
  pull request. Include screenshots when useful.
- **Translation corrections:** edit the saved translation in `translations/v4/`
  in TinyCAD-docs. See its
  [translation guide](https://github.com/matt123p/TinyCAD-docs/blob/main/translations/README.md)
  for cache behavior and local preview instructions.

See [Contributing to the TinyCAD Manual](https://docs.tinycad.net/v4/Contributing-to-the-Manual/)
for the full browser and local editing workflows, writing checklist, and pull
request template. Submit manual changes to TinyCAD-docs; application code changes
belong in this repository.

## Simulation and technical reference

TinyCAD runs integrated ngspice simulations locally: WebAssembly in the browser
and a bundled native engine in Electron. Simulation sheets, instruments and
results live in the drawing. See the [technical reference](docs/README.md) for
engine architecture, simulation workflows, file formats, libraries and editor tools.

Standard libraries include 47 original vector network devices with matching 19-inch
rack panels and cable connections inside their sockets. Use **Open Example → Examples**
for the transistor amplifier or **Small office network**, which embeds its devices
for standalone editing. See [Libraries and examples](docs/libraries.md) for the ten
bundled libraries, artwork provenance, rack conventions and build/test commands.

The **Embedded processors and smart home** standard library adds 44 physical PCB
views: ESP32/ESP8266 devkits, Raspberry Pi 3/4/5, Arduino Uno/Nano/Mega and sensor
modules, plus LCD/OLED/touch/e-paper displays with front and rear wiring views. See the
[library guide](docs/embedded-smart-home.md) for the inventory, previews and pinout sources.

The **Audio & Music** standard library adds 99 compact original vector resources for
PA, studios, podcasts, recording, instruments/MIDI and cabling, with socket-centred
whole-cable connections. See the [guide](docs/audio-music.md). Embedded PCB views
also use compact placement sizes: [18 mixed components on A4](docs/embedded-smart-home-a4.png).

The **Test & Measurement** standard library adds 78 compact lab resources for power,
instruments, probes, acquisition, thermal equipment, relays, controls and apparatus.
Connections distinguish individual conductors, complete cables and fluid hoses. See
the [guide](docs/test-measurement.md) and [A4 preview](docs/test-measurement-a4.png).

The **Motors & Motion** standard library adds 66 compact robotics and automation
resources: motors, steppers, servos, drivers, encoders, limits, solenoids, actuators
and mechanical parts. See the [guide](docs/motors-motion.md) and
[A4 placement preview](docs/motors-motion-a4.png).

The **Solar power and batteries** standard library includes 52 supplied symbols
for conceptual home-energy planning, with whole-cable and logical-link connections.

## Installation

### Preferred: App Stores

Install from your platform store when available:

- **Windows**: Microsoft Store (search for **TinyCAD**)
- **macOS**: Mac App Store (search for **TinyCAD**)
- **Linux**: Snap Store (search for **TinyCAD**)

### Direct: GitHub Releases

If you prefer manual installation, download builds from this repository's GitHub Releases page.

Typical package types:

- **Windows**: installer (`.exe`) or AppX package (`.appx`)
- **macOS**: disk image (`.dmg`)
- **Linux**: Snap (`.snap`) or Debian package (`.deb`)

For Windows direct downloads, prefer the `.exe` installer for local testing unless you have configured an AppX signing certificate. AppX packages built without a signing certificate are suitable for Microsoft Store submission, but Windows will not install them directly for sideload testing.

Use direct downloads when you need a specific version, want to test pre-release builds, or are not using a store-managed install.

## Compatibility with Previous Windows Version

TinyCAD for the Web is a full rewrite of the original Windows-only C++ TinyCAD, with a modern TypeScript/React codebase.

Compatibility notes:

- This version of TinyCAD is file compatible with the previous version.  You should be able to simply
  open existing `.dsn` and `.tclib` files. ZIP-compressed drawings use `.dzn`; both drawing extensions load by content/header.
- The project keeps TinyCAD's core schematic/library workflow and file association concepts.
- Because this is a rewrite, some edge-case behavior may differ from the legacy C++ implementation.  This should be kept to a miniumum and is not intended. If you have an old design or library that does not behave as expected, please open an issue with a sample file.

## Platforms

This project runs in multiple modes:

- **Web (browser)**: Windows, macOS, Linux, ChromeOS, and any modern browser that supports ES modules and the File System Access API.
- **Desktop App**: Windows, macOS, and Linux.

## Building from Source

1. Make sure you have the latest version of Node.js installed
1. Clone the repository.
2. Install dependencies. (`npm install`)

## Run Locally (All Modes)

This project has multiple entry points and storage backends. Each mode is started with a different script:

- **Google Drive mode** (OAuth + Drive storage)
	- `npm run start:ga`
- **Local filesystem mode** (File System Access API)
	- `npm run start:fs`
- **Electron mode** (desktop app)
	- `npm run dev`

## Build Outputs

- **Google Drive build**: `npm run build:ga`
- **Local filesystem build**: `npm run build:fs`
- **Electon App**: `npm run dist`
- **Generate missing AppX icons**: `npm run generate:appx-icons`
- **Generate missing icon assets**: `npm run generate:icons`
- **Signed test AppX**: `npm run dist:test-appx`

Build artifacts are generated by Parcel based on the mode-specific HTML entry points.

Build scripts run Parcel with cache disabled (and clear `.parcel-cache`) to ensure clean, reproducible outputs. Start/dev scripts keep Parcel cache enabled for faster local iteration.

## Release Notes and Store Listings

`CHANGELOG.md` is the source of release notes. Keep work in `Unreleased` until
preparing a release, then move those entries into a dated `## v<version> — YYYY-MM-DD`
section matching `package.json`. `node scripts/release-notes.mjs` extracts that
version's notes; the Electron release workflow already uses them for GitHub Releases.
It deliberately does not substitute Unreleased notes for an existing version.

The workflow is configured once; release text is maintained in the changelog, not
in GitHub Actions YAML. A separate release-notes file is another established approach
([electron-builder supports it](https://www.electron.build/docs/api/electron-builder.interface.releaseinfo/)),
but TinyCAD reuses its existing versioned changelog to avoid maintaining two copies.

- **Microsoft Store:** `publish-store.yml` generates plain-text “What's new” from
  the entry matching `package.json`, includes it in the Actions job summary and
  saves it as the `microsoft-store-whats-new` artifact. The job uploads the packages
  as a draft, updates `BaseListing.ReleaseNotes` in existing English listings,
  then submits and polls for certification. Other languages, packages, pricing,
  descriptions and submission settings are preserved. Missing, empty or duplicate
  version entries stop the process; it never falls back to Unreleased. If the notes
  update fails, the draft is not submitted. See the
  [Microsoft Store CLI submission documentation](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/commands).
- **Snap Store:** the current `snapcore/action-publish@v1` action accepts a package
  and release channels, with no changelog/release-notes input. Keep the release
  notes in GitHub Releases and link to the
  [TinyCAD changelog](https://github.com/matt123p/TinyCADv4/blob/main/CHANGELOG.md)
  from the Snap Store description. A changelog file can also be bundled in the
  installed application, but uploading that file does not create a “What's new”
  listing field. See the [publishing action's inputs](https://github.com/snapcore/action-publish/blob/master/action.yml).

Preview the Microsoft Store text locally without publishing:

```sh
node scripts/msstore-notes.mjs generate .tmp/msstore/whats-new.txt
```

For each release, update `package.json` and move the completed changes into the
matching dated changelog section. Keep the notes concise and written for users.
No workflow edit or separate hand-written Store notes file is needed.

## Windows AppX Builds

There are two separate Windows AppX workflows in this repository.

### Windows Store Submission

Use this when preparing a package for Microsoft Store submission.

1. Set `APPX_PUBLISHER` in `.env.local` to the publisher identity from Partner Center.
2. Build the package:
	- `npm run dist -- --win appx`
3. Submit the generated `.appx` from `release/` to the Store.

Notes:

- This build is intentionally unsigned.
- Windows will not install this package directly for local testing.
- The Store signs the package during submission.
- Missing icon files are generated automatically from `images/TC Icons.svg` during packaging.
- Page 1 generates the main app icon family (`TinyCAD.png`, `TinyCAD.ico`, `TinyCAD.icns`, and the AppX assets).
- Page 2 generates the TinyCAD design file icon family (`TinyCAD File.png`, `TinyCAD File.ico`, `TinyCAD File.icns`).
- Page 3 generates the TinyCAD library file icon family (`TinyCAD Lib.png`, `TinyCAD Lib.ico`, `TinyCAD Lib.icns`).

### Local AppX Testing

Use this when you need a sideloadable AppX for local installation outside the Store.

1. Generate or reuse the local test certificate:
	- `npm run setup:test-appx`
2. Build and sign the local test package:
	- `npm run dist:test-appx`
3. If `Add-AppxPackage` reports `0x800B0109`, open an elevated terminal and refresh certificate trust machine-wide:
	- `npm run setup:test-appx -- -MachineWide`
4. Install the generated package:
	- `Add-AppxPackage .\release\TinyCAD 4.0.0.appx`

What these commands do:

- `npm run setup:test-appx` creates a self-signed code-signing certificate in `.certs/appx/`, imports the public cert into the current user's `TrustedPeople` and `Root` stores, and writes the required `TEST_*` variables into `.env.local`.
- `npm run setup:test-appx -- -MachineWide` reuses the same certificate setup script but also imports the public cert into `LocalMachine\TrustedPeople` and `LocalMachine\Root`. This step requires an elevated PowerShell session.
- `npm run dist:test-appx` builds the AppX with the test publisher identity and signs the finished package during the same `dist` run using the newest installed Windows SDK `signtool.exe`.

Important:

- If you skip the machine-wide trust step, `Add-AppxPackage` can fail with `0x800B0109` even if the package signature itself verifies successfully.
- The test certificate is intended only for local sideload testing.
- The generated `.pfx` and `.cer` files under `.certs/` are ignored by git.

## Environment Variables and Secrets

Create a local environment file by copying `.env.local.example` to `.env.local` and filling in values as needed.

Common local variables:

- `GOOGLE_CLIENT_ID_DEV`
- `GOOGLE_CLIENT_ID_PROD`
- `GOOGLE_ANALYTICS_ID`
- `APPX_PUBLISHER` (used for Electron Windows AppX/MSIX packaging)
- `CSC_LINK` / `CSC_KEY_PASSWORD` (used to sign Windows packages, including AppX/MSIX, for local sideload installation)
- `TEST_APPX_PUBLISHER` / `TEST_CSC_LINK` / `TEST_CSC_KEY_PASSWORD` (written by `npm run setup:test-appx` for local signed AppX builds)

If `CSC_LINK` and `CSC_KEY_PASSWORD` are set, `electron-builder` signs the Windows artifacts and the generated AppX can be installed locally for testing. If those variables are not set, the AppX is still produced but remains unsigned for Store submission workflows.

- `TEST_*` values are managed by the test AppX scripts and normally do not need to be edited by hand.

`.env.local` is ignored by git and must not be committed.

## License

This project is licensed under the GPL v3 License. See the LICENSE file for details.
