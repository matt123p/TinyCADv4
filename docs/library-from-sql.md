# Building libraries from a SQL dump

`npm run libraries:sql` reads the legacy TinyCAD site's phpMyAdmin/MySQL dump and builds ordinary `.tclib` files. It does not run the dump in a database or require MySQL. Node.js and the project's installed dependencies are sufficient.

Run these commands from the repository root. Keep the original dump outside the repository; it contains unrelated application and account data.

```sh
# List an author's visible components, with the source NameID and SymbolID.
npm run libraries:sql -- inspect --sql '../sql/tinycad1_prod(1).sql' --author onetransistor

# Include source attributes in a JSON inventory; optionally filter by name/description.
npm run libraries:sql -- inspect --sql '../sql/tinycad1_prod(1).sql' --author aryajur --search SPICE --json /tmp/spice-inventory.json

# Generate the checked-in SPICE bundle and its provenance report.
npm run libraries:sql -- build --sql '../sql/tinycad1_prod(1).sql' --recipe library-recipes/spice.json

# Build a different recipe or override its destination.
npm run libraries:sql -- build --sql /path/components.sql --recipe library-recipes/my-library.json --output bundled-libraries/my-library.tclib
```

The builder reads literal `INSERT ... (columns) VALUES ...` records for `symbol`, `symbolname`, `symbolattribute`, and the author ID/username lookup. It handles MySQL string escapes, multiline XML, comments, multiple rows, and binary hex literals. SQL expressions and unsupported insert forms in those tables fail explicitly. Other statements are ignored. Output contains only selected drawings, attributes, folders, and component provenance; account email addresses, login keys, and unrelated records are not included.

## Recipe format

The complete working example is [spice.json](../library-recipes/spice.json). A small recipe looks like this:

```json
{
  "version": 1,
  "id": "my-passives",
  "name": "My passives",
  "author": "onetransistor",
  "output": "bundled-libraries/my-passives.tclib",
  "requireSpice": true,
  "components": [
    {
      "id": "resistor",
      "source": { "nameId": 9496 },
      "spiceFrom": { "author": "aryajur", "nameId": 9964 },
      "name": "Resistor",
      "folder": "Passive/Resistors",
      "attributeRenames": { "NAME": "Value" },
      "attributes": { "Value": { "value": "1k", "show": 0 } }
    }
  ]
}
```

Top-level fields:

| Field | Meaning |
| --- | --- |
| `version` | Must be `1`. |
| `id`, `name` | Stable bundle identifier and display name. |
| `author` | Optional default source author username. |
| `output` | Optional `.tclib` destination, relative to the working directory. |
| `pinGrid` | Optional required terminal spacing in XML coordinate units (millimetres). `1` enforces the standard 1 mm grid; invalid or off-grid positions fail the build. A component may override it. |
| `requireSpice` | Require templates, validate pin/attribute macros, and add a comment template to directive-only components. Omit or set false for other libraries. |
| `showName` | Default name display mode, unless overridden per component. |
| `notes`, `references` | Optional provenance notes and reference links. |
| `components` | Ordered list of exported entries. |

Each component has a unique recipe `id` and a `source` selector. Select by `nameId`, or by exact `name` and optional `description`. An optional `author` restricts the selector; otherwise the recipe author applies. A selector must match exactly one visible component. Multiple output entries may clone the same source.

Optional component fields:

| Field | Meaning |
| --- | --- |
| `name`, `description`, `reference` | Override the source display name, description, or reference prefix, e.g. `R?`. |
| `folder` | Slash-separated symbol folder path inside the library. Parents are created automatically. |
| `showName`, `showRef` | Display modes: `0` always, `1` default hidden, `2` never, `3` value plus extra text, `4` name/value when nonempty, `5` name/value, `6` value when nonempty. |
| `spiceFrom` | A second source selector. Merges its attributes over the original attributes, excluding `Reference` and `Package`. Specify its author explicitly when different from the recipe author. |
| `removeAttributes` | Attribute names to remove after merging. |
| `attributeRenames` | Rewrites `$(old)` attribute references in inherited templates. It does not rename attribute records; add/remove the corresponding records explicitly. |
| `attributes` | Attribute overrides: a string value, or `{ "value": "...", "show": 0 }`. SPICE metadata defaults to hidden. |
| `pins` | Exact pin corrections, described below. |
| `geometry` | Guarded drawing corrections: each edit selects one `RECTANGLE`, `ELLIPSE`, or `POLYGON` using `tag` and `match` attributes, then applies `set`, replaces local polygon `points`, or sets `remove: true`. Coordinate attributes accept arrays and compare numerically. |
| `colours` | Resource recolouring: `{ "tag": "FILL", "id": 1, "rgb": "#0000ff" }`. Converts RGB to TinyCAD's stored BGR format. |
| `polygons` | Mirror a polygon's local points: `{ "at": [58, 49.4], "mirror": "x" }` or `"y"`. Arc polygons are rejected. |
| `notes` | Reason for adaptations, retained in provenance. |

Pin corrections select a single pin by `at: [x,y]`, `matchNumber`, and/or `matchName`. They can set `number`, `name`, `electrical`, `position: [x,y]`, and `length`, or set `remove: true`. Positions use XML millimetres; pin lengths are nonnegative integer drawing units (five per millimetre). Selection must match exactly one pin. Duplicate or missing terminal numbers within a part are rejected, so repairs are explicit and reviewable in the recipe.

Geometry edits also require exactly one matching primitive. For example, this recenters a rectangle without moving any pins:

```json
{
  "tag": "RECTANGLE",
  "match": { "a": [0, 0], "b": [2, 4] },
  "set": { "a": [-1, 0], "b": [1, 4] }
}
```

`points` replaces polygon point coordinates while retaining their arc flags; the point count must match. Geometry and pin changes are recorded in provenance. The SPICE recipe requires a 1 mm terminal grid, and its regression checks verify body alignment, lead contact, and terminal alignment through all four rotations and their mirrored variants.

`requireSpice` checks `%()` / `@()` pin references and `$()` attribute references in `$$SPICE`, `$$SPICE_PROLOG`, and `$$SPICE_EPILOG`. It does not validate electrical behavior; simulate new models separately.

## Output and registration

The builder writes a SQLite `.tclib` and adjacent `.provenance.json`. Identical drawings are deduplicated; symbol folders are embedded using the library's folder tables. The report records selected source IDs and usernames, source/drawing/recipe hashes, pin changes, notes, and references. The same provenance is embedded in `TinyCADBundleInfo`. Rebuilding with identical source, recipe, and dependencies produces identical bytes.

Add the output to [bundled-libraries/config.json](../bundled-libraries/config.json), then run `npm run libraries:package`. Normal browser and Electron builds also package the catalog automatically. See [bundled-libraries.md](bundled-libraries.md) for catalog details. Keep the generated library and report in source control; end users do not need the SQL dump or extraction tool.

```sh
npm run test:spice
# Optional real simulator checks, when ngspice is installed:
NGSPICE_BIN=ngspice npm run test:spice
```

Tests use synthetic SQL and the checked-in bundle, so they do not need the private dump. They cover parser escapes, recipe guards, reproducibility, provenance, folders, actual placement and replacement, hidden SPICE fields, drawing save/load, and netlist expansion. Optional ngspice tests simulate every entry and check the 741 follower's transient response.
