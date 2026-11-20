# PCB G0 engineering qualification

This experiment qualifies the bounded WP1 engine fixture. The [complete PCB specification](TinyCAD_PCB_Layout_Complete_Specification.md#255-g0-build-versus-reuse-experiment) defines the classroom and manufacturing release gates.

## Fixture and verification

`npm run qualify:pcb-g0` runs the same worker bundle over loopback in Chromium and a sandboxed Electron renderer. It compares the TypeScript and WASM Clipper2 ports. The fixture imports a KiCad footprint with a plated oval slot and an asymmetric polygon SMT pad, places it on the bottom at 30°, routes around copper on both faces with a through-via, and fills the ground zone with a thermal. The 14 × 10 mm profile includes a circular cutout. A separate round drill provides the NPTH case.

The runner writes the five fabrication files and `qualification.json` below `.tmp/pcb-g0-*`. It asserts that the initial board has no opens, shorts, or missing terminals, and that the seeded open and short are detected. It also checks that a missing copper layer and a changed drill diameter fail read-back, that cancellation publishes no result, and that the revision guard discards stale work. The profile, copper and drill/slot outputs are identical across all four host and kernel combinations in the recorded run.

The independent Gerbonara 1.6.3 checker in `scripts/pcb/check-g0-cam.py` verifies the emitted fabrication files. It recognised five top and ten bottom copper regions, the four outer profile edges, both analytic arcs of the cutout, a 0.30 mm plated drill, a 0.50 mm routed plated slot, and a 1.00 mm non-plated mounting hole. Gerbonara uses the plating supplied for each file when opening this fixture. TinyCAD's read-back additionally checks the XNC file-function attributes and compares the reconstructed copper to the frozen positive geometry. [Gerbonara documentation](https://gerbolyze.gitlab.io/gerbonara/)

After the fixture runs, point `python scripts/pcb/check-g0-cam.py` at the printed result directory's `browser/wasm` or `desktop/wasm` subdirectory. The checker requires `gerbonara==1.6.3`. The runner accepts an alternate Electron executable through `TINYCAD_PCB_G0_ELECTRON` when an installed test copy is needed.

## Reference laptop run

On the four-core, 8 GiB reference laptop, set the primary display to 1920 × 1080 and update Chrome or Edge to its stable release. Record the actual hardware in a local `hardware.json` using this shape.

```json
{
  "model": "Manufacturer and exact laptop model",
  "physicalCores": 4,
  "installedRamGiB": 8,
  "integratedGpu": "Exact integrated GPU model",
  "stableBrowser": "chrome"
}
```

Run `npm run qualify:pcb-g0 -- --reference-host hardware.json` from the repository root. The runner checks the reported hardware fields, the running host's usable memory and primary display, and the Electron sandbox setting. It uses the installed stable browser channel selected in the file (`chrome` or `msedge`) and records the observed browser and Electron versions. Keep the resulting `qualification.json` with the reference measurements and compare its route, cancellation and worker memory data with the development-host evidence below. The laptop model, physical core count, installed RAM and GPU model come from the hardware record.

## Measured development-host results

20 November 2026, Windows x64, Intel Core i5-12400F, 12 logical CPU threads, 31.8 GiB RAM, Node 24.14.0, Chromium 158.0.8127.18 and Electron 44.9.0. The Electron renderer sandbox was enabled. Each row reports one cold fixture run and six warm runs. The P95 uses the nearest-rank method, so it is the maximum of these six observations.

| Runtime and kernel | Setup | Cold fixture | Warm fixture median / P95 | Warm route P95 | Worker JS heap used at completion | WASM memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chromium / TypeScript | 0.01 ms | 166.7 ms | 96.2 / 111.0 ms | 37.4 ms | 13.1 MB | — |
| Chromium / WASM | 6.5 ms | 134.2 ms | 89.6 / 109.3 ms | 31.1 ms | 21.8 MB | 16.9 MB |
| Electron / TypeScript | 0.02 ms | 175.1 ms | 100.1 / 111.5 ms | 36.4 ms | 14.2 MB | — |
| Electron / WASM | 7.7 ms | 143.2 ms | 89.7 / 94.5 ms | 27.9 ms | 12.4 MB | 16.9 MB |

The completion heap sample is a snapshot from the dedicated worker's V8 isolate. It excludes browser process overhead and cannot establish a peak memory limit. Worker termination returned control to the caller within 0.02 ms across the four observed cases, with no result published during the following 25 ms observation window. A separate worker returned a stale result that the revision guard discarded.

All four output sets had SHA-256 `a94b9d6cf0a3bdf4a92141c98d61d9026bde973aa6f1a93f9df19ac03f91b847` over their ordered file names and contents. The first end-to-end run exposed integer clipping artifacts when the reader compared reconstructed copper to overlapping source fragments. The comparison now unions the expected positive copper before performing a two-way geometric difference. The independent reader still rejects changed polarity, arc direction, drill diameter and missing layers.

### Monitored WP1 baseline

The interim WP1 baseline is the development machine above, using its 1920 × 1200 display. `npm run qualify:pcb-g0 -- --monitor-resources` ran both geometry candidates in Chromium and sandboxed Electron, with 24 fixture iterations per normal candidate run. The resulting fabrication bytes kept the same SHA-256 and passed the Gerbonara cross-check. This run recorded 13 Windows process samples per runtime.

| Runtime | Initial working set | Peak sampled working set | Mean CPU | Peak sampled CPU | Process CPU time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 171.2 MiB | 308.7 MiB | 1.18 cores | 2.71 cores | 7.92 s |
| Electron | 217.5 MiB | 398.9 MiB | 1.33 cores | 2.70 cores | 9.41 s |

CPU is expressed in logical-core equivalents over the sampling intervals. Working sets sum the runtime process working sets, including resident shared pages that can appear in more than one process. The values are sampled peaks for the engineering fixture. The runner writes the individual samples alongside fixture timings and worker heaps in `qualification.json`.

## Supported fixture scope

| Area | Qualified in WP1 | Release work |
| --- | --- | --- |
| Coordinates and geometry | Integer nm, exact straight-edge predicates, analytic circular profile arcs, real cutouts, polygon union/difference/intersection, and round offsets. Derived curves use a 100 nm chord tolerance including integer rounding. | Minimum-feature and fragile-contact fixtures for the full supported M1 corpus. Offsets and analytically near-tangent boundaries need additional adversarial coverage. |
| Footprints and placement | Front-authored `.kicad_mod` files with rect/circle/oval pads and one enclosed-anchor, zero-stroke filled polygon per custom SMD pad. Round and straight oval drills, explicit mask/paste surfaces, arbitrary placement rotation and bottom mirroring. Embedded padstacks in the G0 JSON prototype preserve their assignments and physical faces. | Wider KiCad coverage, placement UI, curated assets, and mechanical data. Unsupported electrical geometry blocks the prototype import. Omitted silkscreen, courtyard, and 3D assets are reported. Production board files follow the [XML format contract](pcb-format.md#standalone-board-format). |
| Conductivity | Same-layer contact on resolved copper polygons, clipped round/slot drill voids, explicit through-plating, thermal spokes, and independent bare/assembled terminal checks. Boundary-only contact is reported separately. | General geometric DRC, complex drill profiles and tighter near-contact classification. Validate minimum feature width and annulus for every manufacturing profile. |
| Routing and fill | Bounded H/V/45° A* around foreign copper, keepouts from the copper/profile geometry, width and annulus checks, and through-via changes. Positive zone clipping with four-axis thermals. | Interactive stop-at-obstacle behavior, off-grid snapping, connected editing, incremental rules, and editable priorities and thermal settings. |
| CAM | Two positive region copper files, Gerber profile with analytic arcs, separate metric XNC files for plated/non-plated round holes and straight slots, and independent read-back. | Full export set, external CAM inspection on the M1 corpus, release manifests, and physical fabrication and assembly qualification. |

## Stop/go decisions

- **Identity and undo.** Continue with the WP0 schematic UUID compatibility layer and PCB revisioned commands. Worker results carry the board ID, revision, input digest and engine identity. A revision change, including undo, invalidates older derived results. [WP0 format and migration decisions](pcb-format.md)
- **Geometry.** Use Clipper2 WASM as the working polygon/offset engine for the next milestone. Keep the small `PolygonKernel` interface and the TypeScript port as a comparison candidate. The TypeScript route has simpler startup and packaging. WASM passed the same fixtures and was faster on the warm end-to-end runs. Use the repository's exact TypeScript predicates and shared placement transforms in both cases. Both pinned development packages use BSL-1.0. The WASM package also has the MIT `@types/emscripten` dependency and a compiled Emscripten runtime. Review notices for the exact binaries when moving the engine into shipped builds. [TypeScript port](https://github.com/countertype/clipper2-ts) · [WASM port](https://github.com/ErikSom/Clipper2-WASM)
- **Router.** Continue with the bounded native router and the same geometry/rule APIs for preview and checks. The fixture needed 123 explored nodes and one through-via. The previous TinyCAD router handles schematic layout. External router integration can follow the DSN/SES adapter contract and must show that it retains locks and constraints before qualifying its output. [PCB routing contract](TinyCAD_PCB_Layout_Complete_Specification.md#153-autorouter-adapter-contract)
- **Footprints.** Implement the next import increment around the electrical subset in the table and the explicit blocker/warning report. Persist the imported footprint revision and review mappings by pad ID. A package hint or pad number resemblance supplies no mapping.
- **Connectivity.** Join intersecting copper on the same layer and copper touching the same declared plated barrel. Keep bare gaps visible when fitted jumpers or reviewed internal equivalence join them during assembly. A net tie names two terminal anchors and a single tie shape. Contacts outside that shape remain subject to the normal short check. Undeclared, drilled, split, or extra-contact tie shapes are invalid in this subset.
- **Browser and desktop.** Use one TypeScript worker and writer path. Both sandboxed Chromium contexts detect the same seeded faults and reconstruct identical output bytes. Full application bundling, cache policy and change notification remain editor integration work.
- **Independent CAM.** Continue checking emitted bytes with the on-device Gerber/XNC reader and the pinned Gerbonara cross-check. Compare the production reference corpus in an independent CAM viewer before M1. The Gerber implementation uses the standard region, polarity and arc commands. XNC tools express finished-hole diameters. [Ucamco Gerber and XNC specifications](https://www.ucamco.com/en/guest/downloads/gerber-format)
- **Performance.** Use the monitored Windows development-host run as the WP1 baseline. The 19-fragment engineering fixture verifies the engine path and provides initial CPU and memory costs. Full classroom boards, SVG interaction, open/save, and autosave need workload-appropriate measurements on the specified reference laptop for M1 qualification under §27.1.
