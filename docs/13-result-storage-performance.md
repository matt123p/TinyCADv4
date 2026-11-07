# Result storage performance

Run `npm run benchmark:simulation` from the repository root. Optional positional
arguments replace the default sample counts, for example
`npm run benchmark:simulation -- 1000000`. Reports and the isolated bundle are
written beneath ignored `build/qualification/result-performance/`.

The benchmark uses the application's real result cache and XML/ZIP codecs. It
creates synthetic complex AC arrays, saves and reopens them, checks the restored
real and imaginary values, removes result storage, then saves/reopens a compact
copy and verifies the result cache is empty. Each format/workload uses a separate
Node process. It does not measure solver speed, plotting, interaction or a full
Electron/browser process.

## Windows x64 observation, 7 November 2026

Windows 11 Pro, i5-12400F, Node 24.14.0; single runs, without forced garbage
collection. Four float64 arrays hold the scale, input and complex output.
Peak RSS includes the runtime, generated arrays, original and reopened results,
encoding/decoding temporaries and retained local references. The logical result
budget is not a cap on total process memory.

| Samples | Logical data | Format | Saved bytes | Encode | Decode | Peak RSS |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 250,000 | 8,000,037 bytes | ZIP | 4,293,492 | 399 ms | 105 ms | 143 MiB |
| 250,000 | 8,000,037 bytes | XML | 10,669,860 | 255 ms | 207 ms | 168 MiB |
| 1,000,000 | 32,000,037 bytes | ZIP | 17,127,868 | 1,330 ms | 365 ms | 281 MiB |
| 1,000,000 | 32,000,037 bytes | XML | 42,669,865 | 1,023 ms | 619 ms | 469 MiB |

Before the XML decoder fix, the same 1,000,000-sample workload peaked at
1,052 MiB and took 2,409 ms to decode. `Uint8Array.from` over the decoded base64
string materialized an intermediate character array. Filling the byte buffer
directly removes that allocation; the existing XML/ZIP round-trip and corruption
tests still pass. These single-run timings establish a useful regression
baseline, not a statistical performance guarantee.

Compact files were approximately 1.6 kB ZIP / 2.2 kB XML. Their round trips took
under 10 ms and cleared the global result cache. The benchmark keeps local
references for validation, so it does not claim that process RSS immediately
falls after removal or compact reopen. Interactive Undo behavior and plots still
need their separate acceptance review.

Automatic saves already select ZIP at 1 MiB of retained data. Prefer that format
for large acquisitions; explicit XML uses base64 and has a higher temporary
memory cost. Existing limits remain 64 MiB per run and 256 MiB per document,
including logs and Undo-retained buffers. Classroom-device responsiveness,
browser/Electron peak memory and larger run families still need measurements.
