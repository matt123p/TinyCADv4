# Choosing artwork for the course bundles

This stage chooses artwork for the 102 canonical types in [all-symbols.json](all-symbols.json). It does not build the ten course bundles. One decision applies to every `library_usage` entry for a canonical ID, even when a symbol appears in several bundles.

## Run the reviewer

Install the repository's Node.js dependencies first, then run from the repository root:

```sh
npm run symbols:review -- --sql '../sql/tinycad1_prod(1).sql'
```

Open **http://127.0.0.1:4174**. Use `--port 4175` if needed. The server binds to loopback and also accepts the Coder port-forwarded hostname supplied by `VSCODE_PROXY_URI`. In Coder, open port **4174** from the Ports panel; the terminal also prints its forwarded HTTPS URL. Saving and importing choices work through that URL. It builds the existing TinyCAD SVG renderer and prepares a source catalogue automatically. It does not require a SQL server, browser build, Electron or additional npm dependencies.

The command without `--sql` reuses the prepared snapshot. On the first run it also recognises the existing dump at `../sql/tinycad1_prod(1).sql`. A different source path must be supplied explicitly.

```sh
# Prepare source metadata, SVG renderer and initial decisions without a server:
npm run symbols:prepare -- --sql /path/to/tinycad.sql

# Start using that prepared snapshot:
npm run symbols:review

# Run regression checks without the private SQL dump:
npm run test:symbol-review
```

## What is already assigned

Automatic assignments in [symbol-choices.json](symbol-choices.json), before individual manual choices, comprise:

- **19 direct SPICE artwork reuses:** fixed resistor, capacitor, experimental capacitor plates, polarised capacitor, variable capacitor, inductor, potentiometer, signal/rectifier diodes, LED, zener, NPN/PNP, NMOS/PMOS, op-amp/comparator triangles and behavioural voltage/current sources.
- **6 native editor features:** wire, junction, reference ground, net label, no-connect and annotation.
- **12 derived families:** rheostat, NTC thermistor, LDR, strain gauge, Wheatstone bridge, photodiode, solar cell, SCR, N/P JFET and NPN/PNP Darlington. These are built from corrected SPICE artwork rather than selected from SQL.
- **21 digital types** are generated from the selected NAND reference, including rising/falling-edge variants for seven clocked types. See [Digital logic](../digital-library.md).
- **14 functional block types** are generated in the digital style, with 17 entries including three pairs of clock-edge variants. Power and reference ports remain visible and preserve their inventory names. See [Functional blocks](../functional-library.md).
- **10 sensor/interface types** are generated using related component conventions: test point, Hall/piezo/light/pressure/temperature/moisture/pH sensors, analogue switch and AM modulator. See [drawings and research references](../sensor-interface-library.md).
- **20 initially unchosen types** need deliberate artwork choices (saved choices can already cover these).

SPICE reuse is fixed in the reviewer to keep the corrected drawing geometry. Each reuse records its actual bundle recipe ID and NameID, drawing hash, and logical-to-source pin map. For example, the inventory's BJT collector is logical pin 2 but the reused drawing uses source pin 3. The potentiometer's logical wiper is pin 2, while the source wiper is pin 3. All four existing LED colours are linked to the one canonical LED choice.

A generic op-amp reuses the 741 artwork. This does not approve the 741 model for every experiment. Likewise, a rectifier's intended electrical rating is not established by sharing diode artwork. Simulation requirements remain separate from this artwork review. Comparator and behavioural-source reuse records set `modelReuseAllowed: false`: their existing drawing is retained, but the original 741/independent-source model configuration must be replaced with a suitable adapter. DC, sine, pulse, PWL and FM sources, current sources, controlled sources and conventional meter functions use built-in controls and are excluded from this queue. Their settings and experiment dependencies are retained in `existing_tools`.

The Digital logic bundle contains 28 entries: 21 logical types plus seven falling-edge alternatives. Hidden VCC/VSS supply pins are retained in each logical pin map and connect using native Power-pin semantics.

The supplied instruments, probes and native sources are outside the master generation queue. See the [built-in coverage audit](README.md) for tools and settings. They are not recreated by this tool.

## Review workflow

1. Select a required symbol in the left queue. Filter by course, decision status or symbol name. The heading lists every bundle affected by the shared choice.
2. Inspect the suggested candidates. Search the full catalogue by name, description, author, part number, NameID or SymbolID if the suggestions miss something. **Browse whole catalogue** includes all source drawings. Identical SQL SymbolIDs are grouped into one artwork card; aliases remain selectable in the review dialog.
3. Compare the candidate with a SPICE reference. Previews use the real TinyCAD renderer at a common drawing scale, with a 1 mm grid and source pin IDs. Change the reference when a different component family is more appropriate. **Fit previews** scales drawings independently and is intended for inspecting large ICs; turn it off to compare sizes.
4. Click **Review & choose**. Verify the logical-to-source terminal mapping, including polarity and supply terminals. Multi-part drawings have a source-part preview selector; selecting a different preview part does not silently discard the other source terminals. Suggestions use unique terminal names; the app does not equate arbitrary package pin numbers with logical inventory numbers.
5. If you deliberately choose artwork needing edits, tick **Choose this artwork with a documented adaptation** and describe the work. Missing/extra pins, hidden or multiple parts, off-grid coordinates and incomplete mappings cannot be saved as an unqualified match. Duplicate use of a source terminal is rejected.
6. Save the choice. The server writes the shared JSON file atomically. **Next unchosen symbol** moves the review forward. Rejecting a candidate is specific to the canonical type; the same artwork may still suit another type.
7. If no source fits, record **Needs drawing** with a description. This remains unresolved in the progress count. It does not silently become a generated symbol or completed choice.

Existing SPICE and native assignments can be inspected under their status filters. Newly chosen entries can be reopened. Export/import backs up or restores the complete decision collection; imports are validated against the current source snapshot and restore canonical source identity rather than trusting edited provenance fields.

## Derived families and resistor styles

[library-recipes/derived-symbols.json](../../library-recipes/derived-symbols.json) defines the derived families, their existing SPICE bases and logical-to-source terminal maps. `scripts/lib/symbol-artwork.mjs` adds the relevant arrows, sensing marks, junction-gate/channel geometry or repeated transistor/resistor bodies. It does not search SQL for replacement family graphics or copy a model into a different device type.

Every resistor-body component has both **EU rectangular** and **US zigzag** artwork. This includes the fixed resistor, potentiometer and trimmer in the SPICE bundle, plus the derived rheostat, thermistor, LDR, strain gauge and four-resistor bridge. Both styles are in the same canonical decision's `variants` array and will apply consistently to all bundles. Each bridge uses four copies of the selected body style; styles are never mixed inside it. Physical wire sections and electrode probes remain distinct drawings rather than being silently replaced by resistor bodies.

The US base occupies exactly the original 2 × 5.2 mm body envelope. It retains the original 1.4 mm end leads and on-grid terminals. Decorations are applied after choosing the body, so EU/US variants share all terminal positions. Diode derivatives retain the corrected diode body; JFETs retain the MOSFET enclosure and all three terminal positions while replacing its insulated-gate/channel marks. Darlington pairs repeat the existing BJT artwork and add internal links.

The reviewer shows all variants for these assigned families and their common pin map. New derived families explicitly require a suitable model adapter; artwork reuse is not model qualification.

```sh
npm run test:symbol-artwork
```

### Resistance-wire style choice

For `resistance_wire`, the reviewer offers an explicit **one-of-two choice** between the existing EU rectangle and US zigzag. This user-requested exception is defined in `selection-rules.json` under `symbolChoices`. It keeps one selected candidate for this entry, with `resistorStyle: "eu"` or `"us"`; it does not retain both as an automatic pair. A previous choice of either drawing is preserved. Other resistor-based families continue to retain both variants together.

## Matching rules

[selection-rules.json](selection-rules.json) is the shared style guide displayed by the app. It covers electrical meaning, 1 mm pin spacing, roughly 1–4 mm leads, comparable component bodies, thin strokes, IEC conventions, symmetry and explicit adaptations.

Candidate ranking combines name/alias matches, preferred onetransistor authorship and measured style differences. Pin-count/duplicate-pin/grid mismatches carry larger penalties than cosmetic differences. It is a shortlist, not a semantic proof or an automatic choice. Body bounds are estimates from drawing primitives and can include arrows or other meaningful decorations. Lead measurements use the XML pin length; separate drawn lead segments still need visual inspection. Large multi-terminal blocks are allowed to be larger than the discrete reference.

The original onetransistor SQL drawings are uncorrected candidates. Their duplicate pin numbers or other defects remain flagged. Existing SPICE candidates use the corrected bundled versions. The two-terminal rheostat is derived from the existing two-terminal resistor with an added adjustment arrow; it is not treated as a three-terminal potentiometer.

## Files and persistence

| File | Purpose |
| --- | --- |
| `docs/symbol-libraries/symbol-choices.json` | Versioned shared decisions; keep in source control. |
| `docs/symbol-libraries/selection-rules.json` | Human-readable matching policy used by the reviewer. |
| `.tmp/symbol-review/catalog.json` | Generated requirement/candidate index. |
| `.tmp/symbol-review/artwork/*.xml` | Generated selected-table SQL artwork and corrected SPICE artwork. |
| `library-recipes/derived-symbols.json` | Reproducible SPICE-based family derivations and style variants. |
| `.tmp/symbol-review/renderer.js` | Generated TinyCAD preview renderer. |
| `tools/symbol-review/` | Local web interface. |
| `scripts/symbol-review/` | Preparation, ranking, validation, persistence and HTTP server. |

The cache is already covered by the repository's `/.tmp/` ignore rule. Keep the original dump outside source control. Preparation exports only component drawing records and the author username needed for attribution; account email fields, login keys and unrelated application records are excluded.

Decisions include source hashes, stable IDs and a revision. A stale browser tab cannot overwrite a newer decision; reload it first. If the JSON file is edited externally while the server runs, saving stops until the server is restarted. Keep one reviewer server running against a choices file at a time.

Changed inventories or SPICE artwork/entry identities require a new prepared snapshot. The SPICE fingerprint uses drawing hashes and entry identities, so SQLite repacking or folder metadata changes do not invalidate identical artwork choices. Existing choices are preserved and a snapshot mismatch stops startup/import rather than dropping decisions. Reconcile those choices against the changed source before continuing; the tool does not silently migrate or reset them.

## Handoff to bundle building

`decisions[canonical_symbol_id]` is the source of truth. Resolve it once, then use that same artwork in every referencing course bundle. A chosen SQL entry records SymbolID, NameID, author and XML hash; a SPICE reuse records the existing bundle and recipe entry. `pinMap` values use `sheet:part:source_number` keys to distinguish multi-part terminals.

Artwork selection is complete only when every type is `reuse`, `native` or `chosen`. `pending` and `needs-drawing` remain blockers. Choices with `requiresAdaptation` record a further terminal/geometry work queue; unresolved model requirements and physical package pinouts must also be handled before claiming simulation coverage. No course `.tclib` files are created at this stage. The standalone Digital logic bundle is generated separately from its selected NAND reference.
