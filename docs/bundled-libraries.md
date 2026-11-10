# Bundled libraries

Put the libraries to distribute in `bundled-libraries/` and list them in
`bundled-libraries/config.json`. The checked-in catalog is intentionally empty.
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
      "folder": "Standard/Discrete",
      "description": "Resistors, capacitors, and inductors."
    },
    {
      "id": "standard-connectors",
      "name": "Connectors",
      "path": "standard/connectors.tclib",
      "folder": "Standard"
    }
  ]
}
```

Each entry represents one existing TinyCAD `.tclib` file. Keep `id` stable across
releases so selections survive library updates. `path` is relative to
`bundled-libraries/`; it must stay inside that directory. Use forward slashes on
all platforms. `folder` is an optional display path and supports any depth of
subfolders independently of the file's physical location. Entries without a
folder appear at the root. `description` is optional. IDs must be unique.

## Folders of symbols inside one library

The `folder` field above groups whole library files. To group **symbols within a
library**, use the optional `symbolFolders` field on that library entry:

```json
{
  "version": 1,
  "libraries": [
    {
      "id": "standard-components",
      "name": "Standard components",
      "path": "standard.tclib",
      "symbolFolders": [
        { "path": "Passive", "symbols": ["Resistor", "Capacitor"] },
        { "path": "Semiconductor", "symbols": ["Diode", "Transistor"] },
        { "path": "Passive/Inductors", "symbols": [42] }
      ]
    }
  ]
}
```

Each `symbols` item is either an exact symbol name from that `.tclib` or a numeric
`NameID`. Replace the example names and ID with entries from your library. A
symbol can belong to one folder; assigning it to multiple folders or naming a
missing symbol reports a load error. Use `/` for nested folders. An empty
`symbols` array creates an empty folder. Unlisted symbols retain their embedded
folder, or appear directly under the library when they have none. Omitting
`symbolFolders` uses the organization already stored in the `.tclib`.

The resulting tree is:

```text
Standard components (one library)
├── Passive
│   ├── Resistor
│   ├── Capacitor
│   └── Inductors
│       └── symbol with NameID 42
└── Semiconductor
    ├── Diode
    └── Transistor
```

These catalog assignments are applied after the user selects the library; they
do not rewrite its file or change its read-only status. Library selection still
loads one whole `.tclib` at a time. Searching by symbol or folder name reveals
matching symbols inside their folders, ready for normal preview and placement.

Editable libraries also support embedded symbol folders. In the library editor,
use **Symbol folders** (the folder icon) to add, rename, or remove folders. Each
symbol card has a folder selector once folders exist. New symbols inherit the
folder of the currently edited symbol, and duplicates keep the original folder.
Removing a folder moves its symbols to its parent, or the library root, and keeps
the symbols. Folder changes support Undo and take effect in the file when saved.

Embedded folder paths and assignments are saved in optional
`TinyCADSymbolFolder` and `TinyCADSymbolFolderEntry` SQLite tables. Existing flat
libraries remain flat and require no migration. The original symbol tables are
unchanged, so older TinyCAD versions can read the symbols; saving with an older
version will discard folder organization.

## Selection and packaging

In the Libraries panel, select **My Libraries**, then **Choose** beside
**Bundled libraries**. Checking an entry saves the selection and loads that
library. Unchecking it releases its loaded data. Previously selected libraries
load when the panel initializes in a new session; unselected libraries never
download or parse. Only the small catalog is read to populate the chooser.
Selections are stored in the desktop user settings or browser local storage,
separately from personal library configuration. A failed library load offers
Retry and does not prevent other libraries from loading.

Selected libraries work with normal symbol preview, placement, local search,
and replacement. They are marked read-only, cannot open in the library editor,
and cannot be saved over. Manage their selection using the chooser. Existing
personal libraries retain their editing and folder controls.

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
