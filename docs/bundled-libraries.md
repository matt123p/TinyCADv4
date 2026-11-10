# Standard Libraries

Put the libraries to distribute in `bundled-libraries/` and list them in
`bundled-libraries/config.json`. The catalog includes the SPICE essentials and [Digital logic](digital-library.md) bundles;
add further entries alongside it. See [Building libraries from SQL](library-from-sql.md).
The same catalog is used by the desktop installer and both browser versions.

```json
{
  "$schema": "../schemas/bundled-libraries.schema.json",
  "version": 1,
  "libraries": [
    {
      "id": "standard-passives",
      "name": "Passive components",
      "path": "standard/passives.tclib",
      "description": "Resistors, capacitors, and inductors."
    },
    {
      "id": "standard-connectors",
      "name": "Connectors",
      "path": "standard/connectors.tclib"
    }
  ]
}
```

Each entry represents one existing TinyCAD `.tclib` file. Keep `id` stable across
releases so selections survive library updates. `path` is relative to
`bundled-libraries/`; it must stay inside that directory. Use forward slashes on
all platforms. `description` is optional. IDs must be unique. Standard libraries
are listed directly in the chooser, and each library shows a flat list of symbols.
Subdirectories in `path` only locate packaged files; they do not create UI folders.

## Selection and packaging

In the Libraries panel, select **Standard Libraries**, then use the library
selector in the **Libraries** section header. Only one standard library can be
selected at a time. Choosing a different library releases the previous library's
data and loads the new choice. Select **No standard library selected** to clear
it. The header shows the selected entry's `description` on two lines, with the
full description available on hover.

The choice is saved automatically in the desktop user settings or browser local
storage, separately from personal library configuration. The selected library
loads when the panel initializes in a new session; unselected libraries never
download or parse. Only the small catalog is read to populate the selector.
A failed load offers Retry, and the selector remains available to choose another
library.

The selected library works with normal symbol preview, placement, local search,
and replacement. Standard libraries are read-only and cannot open in the library
editor or be saved over. Personal libraries retain their editing and folder
controls.

All `build:electron`, `build:fs`, and `build:ga` commands copy the catalog and
only its referenced files into `dist/bundled-libraries/`. The existing installer
packaging includes `dist/`, so no installer-specific file list is needed.
Browser hosts should deploy the entire `dist/` directory, preserving the
`bundled-libraries/` subdirectory. No external library service is required.
Desktop reads the packaged files locally through a restricted IPC service.

`npm run libraries:package` validates the catalog and stages these assets on its
own; missing files, duplicate IDs, unsafe paths, and links outside the source
directory fail the build. Development start commands also stage the assets.
Restart a browser development server after changing the catalog or library files
to stage an updated copy. Desktop development reads `bundled-libraries/` directly.

Run `npm run test:libraries` for catalog, packaging, lazy loading, selection,
error recovery, read-only, and desktop IPC regression checks.
