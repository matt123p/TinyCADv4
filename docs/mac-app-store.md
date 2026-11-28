# Mac App Store builds

Run on macOS with Node 22+, Xcode command-line tools, Python 3 and the native
engine build prerequisites described in `docs/spice-engine.md`. The script builds
the host Node architecture (arm64 or x64), including ngspice. It does not upload.

## Apple setup

Register an explicit App ID (this account uses `net.tinycad.tinycad`) in your Apple Developer account,
and create a macOS app record with that bundle ID in App Store Connect. Install
an Apple Distribution application certificate and a **Mac Installer Distribution**
certificate, with their private keys, in your login keychain. The latter may be
shown as `3rd Party Mac Developer Installer`. Developer ID certificates are for
distribution outside the store and cannot replace these certificates.

Download a Mac App Store distribution provisioning profile for that App ID and
certificate. For local sandbox testing, also create an Apple Development
certificate and a Mac development profile containing your Mac's device ID.

Add these values to `.env.local` (existing exported environment variables win):

```dotenv
MAS_TEAM_ID=YOURTEAMID
MAS_APP_ID=net.tinycad.tinycad
MAS_BUILD_VERSION=4.1.1
MAS_PROVISIONING_PROFILE=/absolute/path/TinyCAD_Store.provisionprofile
MAS_DEV_PROVISIONING_PROFILE=/absolute/path/TinyCAD_Development.provisionprofile
```

Do not commit certificates, private keys, profiles or `.env.local`. This script
does not need an Apple account password or App Store Connect API key.

```sh
npm run dist:mas -- --check
npm run dist:mas -- --dev
npm run dist:mas
```

Outputs are in `release/mas-store/`. Upload the generated distribution `.pkg`
using Apple's Transporter app. Increment `MAS_BUILD_VERSION` for subsequent
Store uploads. It defaults to `4.1.1` and changes only the internal Mac Store
build number independently of the shared release version in `package.json`. The build checks the profile's team, bundle ID (`MAS_APP_ID`, default `com.tinycad.app`) and expiry, requires
signing, and checks the resulting installer signature. Electron-builder checks
the installer certificate when packaging. No notarization is needed for this
store workflow. The normal DMG build remains available separately.

The distribution-signed app is intended for Apple processing, rather than local
launching. Use `--dev` with your development profile for local sandbox testing.

## Export compliance

To include the export-compliance answer in future uploads, set
`MAS_USES_NON_EXEMPT_ENCRYPTION=false` in `.env.local` if your completed Apple
questionnaire determines that the app uses only exempt encryption. The script
writes the Boolean `ITSAppUsesNonExemptEncryption` into the Store app's
`Info.plist`. Without this setting, Apple continues to ask the questionnaire.
This declaration includes third-party dependencies such as Electron; HTTPS
alone does not mean the app contains no encryption. TinyCAD also uses Electron
safeStorage for credentials and JWT verification for authentication.

If the questionnaire determines that non-exempt encryption is used, set the
value to `true` and complete Apple's documentation process instead. Existing
uploaded builds still need their answers supplied in App Store Connect.

## Sandbox permissions

These permissions live in `scripts/mas/entitlements.plist`; electron-osx-sign adds
the signing identifiers and application group information from the profile.

| Entitlement | TinyCAD use |
| --- | --- |
| `com.apple.security.app-sandbox` | Required for Mac App Store distribution. |
| `com.apple.security.files.user-selected.read-write` | Open/save designs, import/export files, choose library files and folders. |
| `com.apple.security.files.bookmarks.app-scope` | Allows persistent security-scoped bookmarks for user-chosen libraries and recent files; runtime bookmark handling is still required. |
| `com.apple.security.network.client` | Chat API requests, authentication and other outgoing requests. |
| `com.apple.security.network.server` | The ChatGPT authentication callback listener, bound to loopback. |
| `com.apple.security.print` | Native printing via Electron's print API. |

`scripts/mas/entitlements.inherit.plist` grants `app-sandbox` and `inherit` to
Electron's child processes and the native simulation helper. The engine hook
signs nested resources with the store/development application certificate before
recording their hashes; the outer signing pass skips those resources.

Apple re-signs nested executables for TestFlight and App Store distribution,
so their delivered bytes may differ from the build-time hashes. In packaged
MAS builds, an engine executable hash mismatch triggers strict verification of
the complete app bundle, including nested code, resource seals and an Apple
trust anchor. Non-executable engine resources still require matching hashes.
Unpackaged development and non-Store builds continue to require matching hashes for every
engine file.

No camera, microphone, USB, full-disk access or blanket Documents/Downloads
access is requested. Bundled component symbols do not require hardware access.

## Required testing before review

A successful package build does not verify the app's behavior under App Sandbox.
In the development MAS app, test opening/saving designs, exporting PDFs, printing,
loading libraries, simulation (including XSPICE), chat sign-in and multiple
windows. Test user-selected files and library folders again after quitting and
relaunching, including launching via a document in Finder.

The current file/library code does not implement security-scoped bookmark
creation and restoration. Persistent access outside the container may require
reselecting files/folders until that is implemented. The bookmark entitlement
enables that API; it does not implement persistence. Test helper execution and
dynamic library loading under the sandbox on a registered development Mac.

Complete screenshots, support/privacy-policy URLs, privacy declarations, age
rating, export compliance and review notes in App Store Connect. Explain that
incoming networking is used only for the local authentication callback.

References:
- [Electron MAS submission guide](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)
- [Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)
