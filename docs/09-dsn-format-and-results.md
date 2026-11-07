# Compressed DSN format and result management

Implementation update: see [Running the simulation integration](10-implementation-status.md) for the code now present, build commands, verification and outstanding work. The design below also describes later capabilities.


Status: proposed format and implementation contract. This extends the [implementation architecture](07-implementation.md) and [UI requirements](04-requirements.md). No file codec or export/removal command has been implemented in this documentation change.

## 1. User-facing behavior

Keep **one drawing file**, using `.dsn` for XML or `.dzn` for ZIP. Automatic saving chooses XML normally and ZIP when retained result buffers/logs total at least 1 MiB. Explicit format choices override this policy. Opening automatically detects compressed DSN or existing XML DSN from bytes at the start of the file; users do not need to select an import format or unzip anything.

Schematic and Simulation sheets remain tabs in the same drawing. Archive entries are internal storage, not linked schematic documents, a project folder, or a required sidecar. Compression changes how the drawing is stored, not how circuits or analyses are organized.

Add three distinct result actions to the Results header and Simulation menu:

| Action | Purpose | Effect on the drawing |
| --- | --- | --- |
| **Export results…** | Save recorded data or measurements independently for analysis, teaching, or archiving. | Leaves results and setup intact. |
| **Remove stored results…** | Remove selected runs' generated data from the current drawing to reduce its saved size. | Marks the document dirty; the next Save omits the removed payloads. Setup remains. |
| **Save a copy without results…** | Share a compact lesson or keep a small setup-only copy. | Writes a new drawing without generated result payloads; leaves the open drawing and its results intact. |

These are P0 features. Plot export initially supports SVG; numerical export supports CSV and a self-describing JSON dataset; measurements have a CSV export. Additional rendering/report formats can follow without changing result storage.

### Export dialogue

Choose scope by **Selected run**, **Selected runs**, **This Simulation sheet**, or **All Simulation sheets**. Show run identities, states, recorded intervals, vector counts, and approximate export size. Select signals/measurements and an explicit interval. Default to the full retained record; zooming the plot must not silently change the export.

CSV exports recorded scale values and numerical values with explicit units, signal identity, run/sheet identity, and complete/partial/stale/trial state. Use a documented long-form table for combining runs or unequal scales, with one sample per signal per row. Include separate real/imaginary columns for complex data. Offer derived magnitude/phase only as explicitly labeled columns. Use locale-independent decimal points and standards-compliant quoting; display locale does not change numerical meaning. JSON preserves vector definitions, actual recorded arrays, settings/provenance, quantities, units, sign conventions, and run state without CSV ambiguity. Nonfinite/invalid values require an explicit representation and reason, rather than a plausible zero or an unexplained JSON `null`.

SVG export includes the current plot selection, axes, units, legend, owning sheet/run identities, displayed interval, and status. A measurement export names its definition, interval/method, value, units, and validity. Plot export may use the displayed view; numerical export uses full retained samples for the chosen interval, not display decimation. The dialogue makes that difference visible.

For multiple numerical runs, prefer one JSON dataset or a single long-form CSV. This version does not require a new results-package/project format or an import-results workflow. Exported files are optional independent outputs; saving/reopening the drawing never depends on them.

Export a stable snapshot of selected completed/stopped data. An active run must first stop, or the user must explicitly choose **Recorded data so far** with a fixed received-sample boundary. Show errors and cancellation without changing stored results. A browser download request is not proof that a user has successfully saved the file: show **Download requested** when completion cannot be observed, and never automatically strip data based on that event.

### Remove-results dialogue

Show the same scope choices, affected run count, decoded data size, and estimated saved-file reduction. Include pinned baselines in the list, visibly marked. Automatic retention may protect pinned runs, but an explicit **All stored results** operation can include them after the dialogue clearly identifies the loss. Default to the current Simulation sheet when launched there; whole-drawing removal is an explicit scope choice.

Remove raw numerical chunks, generated measurement values, transformed data/FFT caches, plot previews, saved acquisition payloads, and generated logs for the selected runs. Preserve schematic sheets, model assignments/references, analysis parameters, instructions, exclusions, instrument connections, probe definitions, measurement formulas, plot configuration, and compact run metadata. Keep the run identity, original state, timestamp, effective settings/provenance, and pinned designation as metadata with **Results removed**. A pinned result without data cannot be used as a numerical baseline; offer rerun or unpin.

No cached scalar reading, thumbnail, comparison overlay, or derived value may continue to imply that removed data is present. Definitions remain ready to run again. A full cleanup clears all selected generated payloads; it does not delete Simulation sheets or their setups. If a run in scope is active, require stopping it before removal so incoming chunks cannot repopulate stripped results.

Offer **Export first…**, **Cancel**, and **Remove results**. Export first returns to this review after the export attempt; removal still needs its own explicit action. Do not combine “download started” and deletion into one automatic transaction.

Removal is one undoable document action. Keep payload references in a bounded undo-owned result store rather than copying large arrays into Redux. Saved-file reduction takes effect on successful Save. Undo may retain data in memory temporarily; it must count against memory budgets. If normal undo retention cannot preserve the operation, explain that and offer **Save a copy without results** before any irreversible removal.

**Save a copy without results** uses the same stripping projection on an immutable snapshot. Cancelling or failing the copy leaves the original unchanged. Ordinary Save does not discard currently retained results unless the user has selected setup-only retention or removed them explicitly.

## 2. Container format and header detection

### Compressed DSN container version 1

Use a conventional ZIP archive beginning at byte offset zero. The ZIP local-header signature is `50 4B 03 04` (hex; `PK\x03\x04`). Do not prepend a proprietary header that breaks ZIP tools. ZIP recognition selects a bounded archive reader; TinyCAD identity and supported version are then confirmed from required archive entries. A random ZIP renamed `.dsn` is not a drawing. The ZIP format reference is [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT); the TinyCAD rules below are this proposal's own format contract.

Required layout:

```text
Lesson.dzn                       # one ZIP file, not a directory
  mimetype                       # first entry, stored without compression
  manifest.json                  # TinyCAD identity, versions, content inventory
  drawing.xml                    # document, schematic sheets, Simulation setup
  results/<run-id>/...            # optional generated data, binary chunks
```

`mimetype` contains exactly the ASCII private identifier `application/x-tinycad-dsn+zip`, with no BOM or newline. This is a proposed internal identifier, not a claim of an officially registered media type. The writer emits this small stored entry first. The manifest confirms `format: "tinycad-dsn"`, `containerVersion: 1`, document schema version, document identity, and the `drawing.xml` path. Container version, document schema version, application version, and ngspice build/protocol versions are independent.

The manifest lists every document/result payload by canonical relative path, decoded byte size, content role, and SHA-256. It also records result encoding/version and ownership by sheet/run. It excludes itself from its own content hash list; its integrity is checked structurally and through the archive checksum. Checksums detect corruption and consistency errors; they do not authenticate a drawing's author.

Use ZIP Store or Deflate, UTF-8 filenames, no encryption, no spanning/split volumes, and no executable entries. Version 1 writers produce ordinary non-ZIP64 archives within the application limits. Readers must validate descriptors and directory records rather than assuming sizes are in the first local header. ZIP64 or unsupported methods receive a specific unsupported-format response in this version; never silently truncate or attempt a different parser.

### Detection algorithm

1. Read bytes, not a decoded string. Apply the compressed-input size limit before allocating a complete document buffer.
2. If offset zero is `50 4B 03 04`, parse as a candidate compressed DSN. Validate the ZIP, `mimetype`, manifest identity/version, and payload inventory before document parsing.
3. Otherwise, detect a supported XML text encoding/BOM and a valid legacy TinyCAD root. Accept the existing XML DSN representation through the XML reader. Preserve its supported encoding semantics; do not use “first byte is `<`” as the whole XML test.
4. A truncated ZIP prefix, empty ZIP, damaged compressed DSN, unsupported archive, or incorrect manifest is an explicit file error. A ZIP error must not fall back to treating binary data as XML. Unrecognized input is not a drawing.

The `.dsn`/`.dzn` extensions and storage-service MIME metadata remain useful labels but never determine the decoder. Do not scan past an arbitrary executable prefix looking for a ZIP header; self-extracting or prefixed archives are outside this format.

Automatic saves use XML `.dsn` normally and ZIP `.dzn` for retained result buffers/logs totalling at least 1 MiB; **Save as → Compressed drawing (.dzn)** converts explicitly. **Save as → XML DSN (.dsn)** offers an uncompressed representation when needed. XML representation and old-version compatibility are separate: current XML may contain new Simulation records that an older TinyCAD cannot preserve. A legacy-compatible export still warns before omitting unsupported content and retains the complete original.

## 3. Document and numerical payload encoding

`drawing.xml` retains the existing `TinyCADSheets` root and the versioned Simulation records proposed in [single-file serialization](07-implementation.md#single-file-serialization). In compressed DSN, those records reference archive-internal result payloads instead of embedding base64 arrays. Persistent sheet/component/probe identities and sheet order do not depend on entry filenames or archive offsets.

Store raw numerical chunks as little-endian IEEE-754 float64 with explicit vector definitions, scale kind, sample counts, chunk indices, and checksums. Complex vectors have declared real/imaginary components. Share a scale within a run where appropriate; do not store hundreds of redundant time arrays without reason. The archive's Deflate compression applies to raw binary entries; do not base64 and separately recompress them inside ZIP.

For XML-only DSN, serialize retained payloads inline with an explicitly versioned base64 binary encoding and bounded decoded size. Both representations decode to the same in-memory model. Converting between them preserves numerical values, provenance, IDs, instructions, and result status. Do not redefine numerical precision to improve compression.

Generated result data belongs under `results/`; definitions and compact run records belong in `drawing.xml`. Optional result indexes identify derived measurements, logs, and previews as generated payloads. The manifest inventories their ownership so **Remove stored results** can remove all affected data, including secondary caches. Required vector definitions/scales must not point to an unrelated run or a missing entry.

Internal entries do not introduce project support. `drawing.xml` is the only circuit document in this container; archive result chunks are data belonging to it. External model references continue to follow the existing dependency policy and symbol-branch boundary, not a new arbitrary file bundling feature.

## 4. Shared codec and binary-safe I/O

Add a shared `src/io/dsnCodec.ts` boundary accepting bytes/streams and returning the drawing plus detected representation. Keep ZIP handling out of model serializers and per-platform storage classes. Run expensive compression/decompression and result serialization in an I/O worker, separate from connectivity and simulation workers.

Recommended archive implementation: a pinned direct dependency on `@zip.js/zip.js`, behind the codec adapter. Its project documents streaming and incremental ZIP processing, suitable for bounded payload handling. Qualify the chosen version in browser, Electron, and server rendering, including any worker/compression assets. [zip.js project](https://github.com/gildas-lormeau/zip.js). [fflate](https://github.com/101arrowz/fflate) is an alternative with streaming ZIP APIs; do not introduce multiple independent DSN codecs or treat TinyCAD's existing transitive pako dependency as an archive reader. The selected exact dependency/version must be reviewed and locked when implementing this design; none is installed here.

Proposed application interfaces:

```ts
type DsnRepresentation = 'zip-v1' | 'xml';

decodeDsn(input: ByteSource, limits: DsnLimits): Promise<DecodedDrawing>;
encodeDsn(snapshot: DrawingSnapshot, options: SaveOptions): Promise<ByteOutput>;
projectWithoutResults(snapshot: DrawingSnapshot, scope: ResultScope): DrawingSnapshot;
exportResults(snapshot: ResultSnapshot, options: ResultExportOptions): Promise<ByteOutput>;
```

These are design signatures, not implemented APIs. A save projection uses immutable run references; compression and stripping must not mutate the open drawing while bytes are being written.

| Existing path | Required change |
| --- | --- |
| [Filesystem storage](../src/io/filesystem/filesystemUserManager.ts) | Replace DSN `file.text()` with byte/stream input; write the encoded bytes directly. Keep `.dsn` in file-picker filters without requiring XML MIME. |
| [Google Drive storage](../src/io/google/googleUserManager.ts) | Fetch DSN as bytes and upload binary media with suitable metadata; do not apply `response.text()` or text encoding to ZIP content. Preserve existing file identity/revision semantics. |
| [Electron storage adapter](../src/io/electron/electronUserManager.ts), [preload types](../src/electron.d.ts), and [native file I/O](../electron/io.js) | Replace DSN UTF-8 read/write and string-only IPC assumptions with bounded binary-safe messages/streams. Preserve source format metadata across Save. Library formats keep their own codec. |
| [XML serializer](../src/io/ioXml.ts) | Continue document/XML schema handling; expose result-payload references through a serialization context. It does not sniff or decompress the outer file. |
| [Save/export coordinator](../src/io/files.tsx) | Route DSN persistence and result commands through shared codecs; snapshot document and retention choices; dirty-state clearing occurs only after successful persistence of that snapshot. |
| [Rendering entry points](../renderer/Clientsymbol.tsx) and [server bundle build](../scripts/build-server-bundle.mjs) | Audit consumers that currently expect XML strings. Add byte-based DSN entry points or an explicit codec step while retaining deliberate XML-string APIs for clipboard/symbol rendering. Do not pass ZIP bytes to XML parsing. |

Audit recent-files opening, drag/drop, backups/recovery, examples, Drive downloads, and file associations as well as the main Open dialogue. Header detection must be shared across all drawing entry points. This format change applies to `.dsn`; it does not silently ZIP `.tclib` or alter the separate symbol workflow.

## 5. Safe save, stripping, and failure recovery

Write a fresh archive containing only the snapshot's reachable entries. Stripping must not append a new ZIP directory while leaving obsolete result bytes in the file, copy orphan result entries, or retain results inside redundant previews. Recalculate manifest sizes/digests and remove all dangling generated-data references before commit.

Build and validate a complete candidate before replacing an existing drawing. On Electron, use a sibling temporary file, flush/close, validate, and commit with the platform's supported replacement strategy; preserve the original on failure. The filesystem browser path commits through a successful writable-stream close. Drive storage must report the completed binary update and handle conflicts; if it cannot preserve the original on a failed replacement, use a safe new-copy path. A generic download cannot overwrite/verify an existing file automatically.

Cancellation, out-of-space, failed compression, failed export, invalid references, and write errors preserve the original file and the current document's state. Save a copy without results must never remove the original's payloads or change its file association. If a drawing changes during save, only the persisted revision can be marked saved; later edits remain dirty.

Size reporting distinguishes decoded result bytes, compressed result-entry bytes where known, and total saved file size. Compression ratio depends on content; tiny files can grow slightly due to container overhead. Do not promise a fixed percentage saving. A result-removal preview is an estimate until the fresh encoded candidate is complete.

### Archive validation and limits

Proposed initial configurable bounds: 256 MiB input file, 512 MiB total decoded archive bytes, 10,000 entries, 32 MiB archive `drawing.xml` (whose arrays are separate entries), and 1 MiB manifest. Numerical result retention remains subject to the tighter per-run/per-document budgets in the implementation architecture. XML-only DSN counts inline base64 bytes against the input limit and applies decoded-payload limits separately. Writers must apply the corresponding reader limits before commit; if XML expansion would exceed them, offer compressed DSN or a compact copy rather than writing a file TinyCAD cannot reopen. Enforce observed streamed output limits, not just claimed ZIP sizes. A valid highly compressible trace should not be rejected solely for a high ratio; hard decoded-byte/resource limits are authoritative.

Reject duplicate entry names, conflicting local/central-directory records, invalid CRC/digests, missing referenced payloads, unsafe absolute/parent paths, links, unsupported methods/encryption, overlapping entry ranges, and malformed/truncated archives. Canonicalize paths and require manifest references to remain within the allowed internal namespaces. Do not extract a DSN archive to the filesystem; read entries through the bounded codec. XML parsing must not resolve external entities. Unsupported future versions get an explicit compatibility/read-only response rather than a lossy rewrite.

## 6. Required verification

| Fixture/action | Required outcome |
| --- | --- |
| Open XML .dsn and ZIP .dzn, including files renamed to the other extension | Decoder follows header/validated contents; both produce equivalent drawing state. Automatic saving uses .dsn normally and .dzn for retained results of at least 1 MiB. |
| XML↔ZIP round trip with schematic/Simulation sheets and real/complex results | IDs, setup, instructions, exact retained samples, units, status, and metadata survive. Only storage representation changes. |
| Export full data from a decimated plot, an interval, and partial/stale/trial runs | Numerical samples and status match the selected retained snapshot. JSON/CSV and plot/measurement outputs declare their scope and units. |
| Cancel/fail export; request a browser download | No removal or retention-policy changes. Unobservable download completion is not reported as verified persistence. |
| Remove selected results, including a reviewed pinned baseline | All selected generated data/caches/logs are gone from the next saved file; definitions and compact metadata remain; UI shows Results removed and cannot compare against missing data. |
| Save a copy without results, then reopen original and copy | Original retains its results; copy retains setup and instructions without result payloads. |
| Strip all stored results and inspect the ZIP inventory | No orphan result bytes/entries or dangling references; fresh archive and consistent manifest. Undo restores data within the declared undo budget. |
| Truncated ZIP, renamed unrelated ZIP, unknown version, wrong checksums, duplicate/path-traversal entries, decompression-limit fixture | Specific errors without XML fallback, filesystem extraction, unbounded allocation, or overwriting the original. |
| Failed/cancelled save, full disk, Drive conflict, or drawing edited during compression | Original remains intact; current unsaved state is correct; successful-save acknowledgement refers to the persisted snapshot only. |
| Browser filesystem/Drive, Electron, examples, drag/drop, and rendering consumer | All intended DSN entry points accept both representations as bytes; library and XML-only clipboard APIs retain their declared formats. |

ZIP support is a P0 persistence gate. It does not change the separate ngspice WASM/native engine decisions or require new model/symbol sourcing work.
