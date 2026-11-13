# Drawing format and result storage

One drawing contains schematic sheets, Simulation sheets, instructions, analysis definitions and optional results. Save/Open applies to that single file. Model attachments are inputs to its setups.

## Representation and naming

Ordinary drawings save as XML `.dsn`. Simulation components, settings or results select ZIP `.dzn`, independent of size. This includes sources/probes/instruments, configured SPICE attributes, ground named `0`, Simulation sheets and result-free copies that retain setup. Earlier XML preferences cannot override simulation presence.

Loading detects content from bytes. Renamed XML `.dzn` and ZIP `.dsn` files remain readable. An invalid ZIP produces a file error. Legacy XML simulation drawings are supported and switch to `.dzn` on their next automatic save. Keep an original when exchanging new Simulation records with older TinyCAD versions, which may discard unfamiliar content.

[dsnCodec.ts](../src/io/dsnCodec.ts) coordinates document encoding/decoding; [dsnContainer.ts](../src/io/dsnContainer.ts) handles ZIP/XML detection and archive validation. [drawingSaveFormat.ts](../src/io/drawingSaveFormat.ts) and [drawingFiles.js](../shared/drawingFiles.js) own representation selection, naming and MIME constants.

## ZIP container, version 1

```text
mimetype
manifest.json
drawing.xml
results/<run-id>/index.json
results/<run-id>/<number>-real.bin
results/<run-id>/<number>-imaginary.bin   (complex vectors only)
```

`mimetype` is the first, uncompressed entry and contains exactly `application/x-tinycad-dsn+zip`. The manifest has `format: "tinycad-dsn"`, `containerVersion: 1`, `documentSchemaVersion: 1` and an `entries` inventory of path, decoded size and SHA-256 for every document/result payload. It does not hash itself. Checksums detect corruption, not authorship.

The writer uses Store/Deflate, fixed entry timestamps and non-ZIP64 output. `drawing.xml` retains TinyCAD's XML document and versioned simulation records. Raw samples use little-endian float64 binary entries with vector/scale metadata in the result index. Complex vectors retain both components. The legacy XML codec carries equivalent result buffers as base64.

The reader rejects unsafe/duplicate paths, unsupported compression, encryption, links, executable/directory entries, ZIP64, malformed inventories, missing payloads and checksum mismatches. XML supports UTF-8 and BOM-marked UTF-16; document types and entities are rejected. Archive entries are read through the bounded codec rather than extracted to disk.

Current container limits are 256 MiB input, 512 MiB decoded data, 10,000 entries, 32 MiB `drawing.xml`, 4 MiB manifest/result index and 64 MiB per binary entry. Result retention also obeys the tighter engine storage budgets. See the codec for the complete validation rules.

## Document and results

[document.ts](../src/simulation/document.ts) owns simulation serialization/migration. [contracts.ts](../src/simulation/contracts.ts) defines setup and run records. Persistent document/sheet identities survive round trips; tab index and generated net numbers are unsuitable as durable bindings.

A setup stores analysis, parameters, attached models, selected/derived signals, instructions, measurements, requirements, tuning bindings and study definitions. Run metadata records identity/time, state, backend/build ID, circuit/setup hashes, effective analysis/parameters and result availability. Explorer snapshots retain captured definitions and scalar results; later definition edits do not rewrite them.

Numerical buffers live in [resultStore.ts](../src/simulation/resultStore.ts), outside Redux snapshots, keyed by run ID. Loading validates the entire candidate result set before replacing the active cache. Limits include logs, complex vectors and multiple plots: 64 MiB/run and 256 MiB/document. Undo-retained buffers count toward the budget.

**Remove stored results** preserves setup and compact history with `dataState: removed`. A setup saved without retaining payloads uses `not-retained`. **Save without results** creates a compact copy without mutating the open drawing's retained data. Saving builds a fresh archive from reachable payloads, so removed results cannot survive as orphan entries. Reopening a compact copy releases session/Undo buffers.

CSV and numerical exports use retained full-resolution data independently of chart decimation/zoom. Result JSON, SPICE-text raw and measurement/study reports retain their declared scope. Exports and removal are separate operations.

## Storage adapters

Filesystem, Google Drive and Electron adapters carry drawing bytes. Electron writes a temporary sibling file before renaming it into place. A local format change requests a new destination and preserves the original; a successful save updates the open file association. Drive updates content, filename and MIME metadata on the existing file ID through a resumable upload.

Electron and filesystem dialogs accept `.dsn` and `.dzn`. Drive's Open-with registration is external configuration: [google-drive-ui.json](../config/google-drive-ui.json) records the expected extensions and MIME types. Keep `dzn` alongside `dsn` and `tclib` in the Google Cloud Console Drive UI integration. XML uploads use `application/xml`; ZIP uploads use the internal ZIP MIME above.

Simulation persistence/corruption tests are part of `npm run test:simulation`. The codec benchmark (`npm run benchmark:simulation`) covers real/complex round trips and compact-copy recovery. Base64 XML encoding has higher temporary memory cost than binary ZIP; the logical storage budget does not cap total process memory.
