# PCB classroom performance

The production browser runner measures the classroom workload from [§27.1](TinyCAD_PCB_Layout_Complete_Specification.md#271-proposed-measurable-performance-targets). The generated board has 100 components, 500 pads, 2,000 tracks, 50 vias and four zones. Its filenames vary between opens so that each warm sample reads and parses the board again.

```sh
npm run build:fs
node scripts/pcb/classroom-fixture.mjs build/classroom.dpn
node scripts/pcb/qualify-workspaces.mjs dist build/qualification/classroom.json \
  --classroom-board=build/classroom.dpn --classroom-samples=10 --cold-samples=10 \
  --measure-memory --classroom-presentation --classroom-local-edit
```

The JSON records the exact browser version, graphics renderer, available
CPUs and viewport. It keeps the raw durations, renderer heap samples,
resource requests and live worker URLs. The memory flag captures browser
process snapshots during routing, refill and both design checks. Each
reading records when collection started and finished. The reported peak
uses readings completed during the workload. A null peak indicates that
no eligible reading was captured. Windows reuses one PowerShell collector
across the run. Use proportional memory where available and identify
shared-page double counting when the platform reports summed working sets.

Each run’s `observedMemory` names the phase with the highest sampled
working set and, when available, the highest proportional set size (PSS).
It compares workspace snapshots and completed task samples. Pan and zoom
presentation and local edit feedback have separate timing probes.

`--classroom-presentation` records Chromium's compositor feedback for two
120-input sequences after the ordinary memory checkpoints. It reports
frames per second, individual presentation times and frame-interval
median and P95 for pan and zoom. Missing or ambiguous feedback appears
as `unavailable`. These fields describe the compositor's presentation
feedback during the measured interval. `panFrameMs` and `zoomFrameMs`
remain browser callback observations. [Chromium frame pipeline](https://chromium.googlesource.com/chromium/src.git/+/main/docs/life_of_a_frame.md)

`--classroom-local-edit` extends five tracks using the editor controls and
undoes them afterward. It records when the copper-check pending message
appears and when each track becomes visible. The first of those two times
is the feedback latency. The report includes median and P95 for feedback
and commit separately.

For a development-host comparison of visible and headless launches, pass
`--channel=chromium` in both runs. Playwright then uses full Chromium even
in headless mode. With the default channel, a headless run uses Playwright’s
separate headless shell. Use the stable Chrome or Edge channel for the
reference-laptop run.

For a separate memory-retention run, add `--classroom-retention` with
`--measure-memory`. The runner collects garbage before opening the first
board and after each completed board workload. It then switches to Circuit
Design, returns to the same PCB, closes it and records all three states.
Read `classroomRetention` for DOM counters, live workers, renderer heap and
process memory. On Linux it also records anonymous, file-backed and
shared-memory PSS where exposed by procfs. Use the ordinary run for
acceptance timings, since forced collection between opens changes the
memory and timing conditions.

Add `--classroom-worker-memory` to record the PCB worker’s JavaScript heap
and Clipper’s WASM capacity at the end of a separate design check. The
runner holds that worker long enough to read its heap from Chromium
DevTools, then stops it. The `classroomWorkerMemory` fields describe
completion. The process memory probes still capture the sampled peaks.
Worker and WASM memory are part of the browser process accounting.

## Reference school laptop

Record the laptop using the same `hardware.json` as the WP1 run. Launch
on the primary 1920 × 1080 display and use the integrated GPU with the
installed stable Chrome or Edge channel. [Hardware record](pcb-g0.md#reference-laptop-run)

```sh
npm run build:fs
node scripts/pcb/classroom-fixture.mjs build/classroom.dpn
node scripts/pcb/qualify-workspaces.mjs dist build/qualification/classroom-reference.json \
  --reference-host=hardware.json --classroom-board=build/classroom.dpn \
  --classroom-samples=10 --cold-samples=10 --measure-memory \
  --classroom-presentation --classroom-local-edit --classroom-worker-memory
```

The reference flag starts a visible browser using the recorded stable
channel. It checks the actual display and probes WebGL 2 before applying
the benchmark viewport. The JSON records the renderer, graphics devices
and browser feature status. The run requires graphics-device evidence and
rejects identified software rendering. Compare the observed device with
the operator’s integrated GPU record. Run the WP1 browser and desktop
fixture with the same hardware record. [WP1 procedure](pcb-g0.md#reference-laptop-run)

### Production Electron classroom run

After the browser run, build Electron and use the same classroom file.
The runner uses a fresh Electron profile and native Open with local copies.

```sh
npm run build:electron
node scripts/pcb/qualify-electron-classroom.mjs build/classroom.dpn \
  build/qualification/classroom-electron.json --samples=10 --reference-host=hardware.json
```

The desktop and browser runners share the classroom interactions and
process sampler. The Electron report records the app’s process set, the
renderer heap, graphics information, the actual content viewport and
worker cleanup. Its open timing includes the native menu dispatch and
local read. For a virtual-display development run, omit the reference
flag and use `--software-rendering`.

## Development-host run

21 November 2026. Production filesystem build, headless Chromium 158.0.8127.18 with ANGLE SwiftShader, Node 24.22.3, Linux x64, Xeon E3‑1226 v3, four logical CPUs, 30.25 GiB host memory and a 1920 × 1080 viewport. Five fresh browser contexts per workspace measured startup. Five opens in a warmed application context measured the classroom workflow. P95 uses nearest rank, so P95 equals the largest observation for rows with five samples.

| Workload | Samples | Median | P95 |
| --- | ---: | ---: | ---: |
| Cold Circuit Design | 5 | 476 ms | 487 ms |
| Cold PCB Design | 5 | 377 ms | 386 ms |
| Cold Circuit Design + Simulation | 5 | 516 ms | 541 ms |
| Open classroom board with warm dependencies | 5 | 383 ms | 1,394 ms |
| Explicit zone refill | 5 | 932 ms | 947 ms |
| Design checks, including fresh fill and connectivity | 5 | 1,448 ms | 1,456 ms |
| Zone cancellation acknowledged in the UI | 5 | 14 ms | 16 ms |
| Selection to inspector update | 60 | 22.0 ms | 34.4 ms |
| Start a route to first visible preview | 5 | 480 ms | 509 ms |
| Move the cursor to an updated route preview | 60 | 16.7 ms | 17.1 ms |
| Wheel event to updated SVG zoom | 100 | 16.6 ms | 19.8 ms |

All five classroom checks reported zero findings and extracted physical connectivity. No main-thread Long Task entries were observed during the measured route-cursor sequences. Each cold entry stayed within its expected resource set. The PCB entry recorded 10.0 MiB of live renderer heap at idle, an 80.9 MiB maximum among classroom samples and 16.3 MiB after returning to Circuit Design and collecting garbage.

Production filesystem and mocked Drive follow-ups recorded the live worker names and URLs after repeated workspace switches and embedded STEP inspection. The filesystem run also opened and checked the classroom board. The PCB workers closed, including the STEP inspection worker. The schematic netlist worker was the only worker present after returning to Circuit Design in each run. Its idle startup coincided with the 3D inspection stage in the earlier trace.

The embedded STEP browser test also checks that returning to the 2D board detaches the viewer canvas and loses its WebGL context. A separate test forces WebGL 2 to be unavailable and verifies that SVG PCB editing and saving still work.

The earlier [WP1 run](pcb-g0.md#measured-development-host-results) measured process working sets and CPU on a Windows i5‑12400F with a small engine fixture. This Linux run measures full-editor latency and sampled renderer heap on a different workload and host. The two sets of measurements have different units and scope.

The reference-school-laptop budget still needs its own cold and warm results, process and worker memory, GPU evidence where available, continuous pan and zoom presentation rate, local edit feedback, and worker stop timing. The first run records UI cancellation latency and point-to-point zoom updates. Renderer V8 heap excludes browser process RSS, worker heaps and GPU memory.


## Results after editor recovery

The production filesystem build and production Google build with mocked Drive
each passed five fresh contexts per workspace on the Linux development host.
All three entry points loaded the expected workspace assets. After repeated
switches the schematic netlist worker was the only worker still running in
Circuit Design. The direct Drive link opened the standalone LED board and
rendered its embedded model.

| Cold entry | Filesystem median / P95 | Mocked Drive median / P95 |
| --- | ---: | ---: |
| Circuit Design | 484 / 509 ms | 496 / 912 ms |
| PCB Design | 402 / 442 ms | 474 / 803 ms |
| Circuit Design + Simulation | 512 / 521 ms | 636 / 1,021 ms |

Five filesystem classroom opens measured 429 ms median and 1,414 ms P95.
Refill and checks took 898 / 929 ms and 1,448 / 1,478 ms respectively.
All five checks checked physical connectivity and found zero issues. The
selection and route-cursor P95 values were 40.1 ms and 16.9 ms. Route setup
to first preview was 479 / 524 ms. The route-cursor samples contained no
reported long tasks. Shift-wheel zoom took 16.7 / 22.2 ms to change the SVG
viewBox width. Unmodified wheel events moved the board while preserving the
zoom. The 300 animation callback intervals during pan were 16.67 ms at P95.
These intervals measure browser callbacks during input. Compositor presentation
rate requires its own measurement.

The zone cancellation control changed in 15.3 / 17.8 ms. The geometry worker
close event arrived in 440 / 466 ms, including Playwright IPC. The classroom
PCB run recorded 11.8 MiB of renderer heap at cold idle, 59.5 MiB as its
largest sampled heap, and 17.4 MiB after returning to Circuit Design and
collecting garbage.

Run the Google build with a dummy client ID when using the runner’s mocked
authentication. Use this build for local qualification.

```sh
GOOGLE_CLIENT_ID_DEV=workspace-qualification.invalid \
GOOGLE_CLIENT_ID_PROD=workspace-qualification.invalid npm run build:ga
node scripts/pcb/qualify-workspaces.mjs dist build/qualification/wp3-wp6-drive.json \
  --mock-drive --step-board=examples/pcb/led-classroom/Reference/LED.dpn --cold-samples=5
```

Reference-laptop timing and process, worker and GPU memory remain open release
checks. Use the reference hardware and record the actual measurements for
comparison with the development-host data.


### Process memory

Add `--measure-memory` to the workspace runner. It records resident process
memory at the existing checkpoints. A separate classroom design-check run
samples the Chromium process set at roughly 200 ms intervals. On Linux the
report also includes proportional set size when procfs exposes it. The
isolated browser instance accounts for its renderer, GPU process, network
service and main process. Renderer memory includes workers in that process.
Dedicated GPU memory and individual worker or WASM heaps remain unmeasured.

On the Linux software-rendering host, the PCB run used 242 MiB of
proportional memory at cold idle, peaked at 666 MiB over seven classroom
samples, and used 448 MiB after returning to Circuit Design and collecting
garbage. The sum of resident working sets peaked at 874 MiB. That sum can
count shared pages repeatedly. The 666 MiB result is above the proposed
500 MB budget when measured across the isolated browser processes. Separate
renderer heap and worker-lifetime measurements distinguish the
small live JavaScript heap and closed PCB workers from the larger retained
process footprint. Benchmark and investigate that footprint before closing
the release performance gate.

The runner also exposed a route worker that remained alive after cancelling a
completed clearance preview. Cancelling or committing a route now closes it.
In one repeat run its close event arrived after 69 ms. That run measured
234 MiB at cold idle, a 679 MiB proportional peak and 402 MiB after the switch
and garbage collection. The peak remains above the proposed budget on this
host. These are separate single-run observations, so the difference in
retained memory is insufficient to quantify how much memory the fix saves.


### Geometry and worker follow-up

The board checker now reuses copper bounds, rejects pairs outside the largest
applicable clearance and avoids clipping geometry already contained in a
rectangular clearance boundary. Boards with cutouts or non-rectangular edges
still go through polygon clipping. Orientation uses exact integer products
where safe and retains the exact BigInt path for wide or nearly collinear
geometry. The browser closes the fill worker as soon as it publishes its
result and reuses the track and via SVG layer during unrelated canvas updates.

The following are separate single runs on the same Linux development host,
with the classroom board open in the production filesystem build.

| Build | Sampled proportional peak | Classroom design check |
| --- | ---: | ---: |
| Route worker lifetime fix | 679 MiB | 1,446 ms |
| Exact geometry fast paths | 622 MiB | 1,450 ms |
| Completed fill worker disposal | 560 MiB | 1,477 ms |
| Memoized track and via layer | 555 MiB | 1,398 ms |

The last run measured 416 MiB after initial fill, 493 MiB after selection,
zoom and pan, and 556 MiB with the routing preview active. The sampled check
peak and the active-routing checkpoint both exceed the proposed 500 MB
budget. The runner keeps these phases separate from its periodic check
sample. These observations describe the development host under software
rendering. The reference-laptop gate still requires repeatable cold and
warm measurements.

### Baseline after routed-outline checks

A fresh production filesystem build measured a 554 MiB proportional peak
during one 1,412 ms classroom design check. The active routing checkpoint
measured 557 MiB. Time and memory came from the same headless Chromium 158
development host as the preceding runs. All three workspaces started and
switched without unexpected cold resources or page errors.

Between initial fill and the checkpoint after selection, zoom and pan, the
browser process group increased from 421 to 496 MiB and Chromium's reported
embedder heap increased from 12 to 57 MiB. The embedder heap reached 68 MiB
during route preview and fell to 13 MiB after the route cancelled and the
board refilled. These counters identify when memory grows. They do not
attribute the increase to a particular SVG layer.

### SVG reuse and routing worker lifetime

The shared ruler reuses its canvas backing surface on pointer motion when
the dimensions are stable. The board reuses SVG for unaffected footprints
during selection and keeps the zone paths for the current fill. Route
clearance preparation closes the PCB worker when it becomes idle. The
editor can keep previewing the route from the returned geometry.

Three fresh production filesystem runs used the same development-host
classroom workload. Selection medians were 17.0, 17.3 and 18.5 ms, compared
with 22.5 ms in the post-outline baseline. The single-run ruler experiment
sampled 557 MiB during design checks and the addition of SVG reuse sampled
593 MiB. The three runs with the worker lifetime change sampled 529–576
MiB during checks and recorded 522–549 MiB at the active-routing checkpoint.
The check took 1,394–1,410 ms. The observed memory range still exceeds
the proposed budget and overlaps the earlier peak.

The clearance worker closed 477–627 ms after it started. The benchmark
verified that route preview continued with no PCB worker alive. The
schematic netlist worker remained live after switching from Circuit Design
to PCB Design in all three runs. The process samples do not identify its
individual memory usage.

### Schematic netlist worker suspension

Background netlist synchronization now follows the live schematic and net
list subscribers. When the last subscriber leaves, pending requests finish,
the worker exits and the cached netlist is released. Returning to a
schematic rebuilds the netlist from the current drawing. Explicit netlist
requests refresh from the supplied drawing and can run while PCB Design is
active.

The browser acceptance test switched from a populated schematic to PCB
Design, confirmed worker termination, compiled a changed schematic with
PCB Design still active, and verified the rebuilt netlist on return.
Project hierarchy exports and cross-probing, the simulated RC filter and
the classroom LED release passed as well. The workspace runner also checks
that no schematic netlist worker remains when PCB design checks finish.
The production filesystem and mocked Drive builds passed this check from
all three startup workspaces. The Drive run also opened the linked board
directly and displayed the embedded STEP model.

Three production filesystem runs recorded no live PCB or schematic
netlist worker during the classroom route preview. Proportional memory
ranged from 537–594 MiB during design checks and 530–571 MiB at the active
routing checkpoint. Design checks took 1,420–1,448 ms with zero findings.
The range overlaps the prior measurements and exceeds the proposed
budget. The checkpoint after selection, zoom and pan used 487–532 MiB,
up from 421–422 MiB after initial fill. These samples leave the exact
source of that renderer growth open.

### PCB viewport panning

The classroom runner now samples selection, zoom and pan separately. In the
first split run, whole-browser proportional memory measured 428 MiB after
selection, 451 MiB after zoom and 547 MiB after pan. The renderer accounted
for the increase during pan.

The shared SVG viewport now translates the drawing for pan and keeps the
root view box stable. Zoom still changes the scale around the pointer.
Snapping, drag and drop, object picking and rulers use the drawing
coordinates. The footprint editor strips the viewport transform when
exporting a full-size print.

| Run | After zoom | After pan | Active route preview | Sampled design-check peak |
| --- | ---: | ---: | ---: | ---: |
| Root view-box pan | 451 MiB | 547 MiB | 573 MiB | 626 MiB |
| Drawing transform, run 1 | 429 MiB | 430 MiB | 479 MiB | 521 MiB |
| Drawing transform, run 2 | 431 MiB | 431 MiB | 478 MiB | 520 MiB |
| Drawing transform, run 3 | 446 MiB | 447 MiB | 498 MiB | 548 MiB |

All three transform runs had a 16.67 ms P95 pan callback interval and
reported zero design-check findings. These are Linux development-host
measurements. Peak memory still exceeds the proposed budget, and the
reference laptop remains to be qualified.

Ten browser scenarios passed, including placement, routing, rulers, dimension
snaps, footprint printing, the classroom LED release and RC cross-probing.
Gerbonara verified both CAM fixtures. The production Electron scenario
verified native zoom and fit and byte-identical Save As of an offline board
before an edited save.

### Straight-track routing clearance

Manual routing checks foreign straight tracks as round-ended segments. It
uses the minimum centreline distance, both radii, the applicable pairwise
rule and the existing 0.2 µm geometry allowance. Preview, commit and
track edits share the calculation. Polygon checks still handle regional
clipping, pads, holes and keep-outs.

Three production filesystem runs on the same classroom fixture measured
290–346 ms to the first route preview, compared with 484–493 ms in the
three viewport runs. The active preview checkpoint measured 467–471 MiB,
compared with 478–498 MiB. All checks reported zero findings. The separate
sampled design-check peaks ranged from 516–530 MiB.

Three further runs sampled proportional memory throughout clearance
preparation and 12 live pointer movements. Route peaks were 464–477 MiB
(486–500 MB, rounded) across 8–10 samples per run with actual intervals of
115–146 ms. The largest observation was 499,728,384 bytes. Separate
classroom design checks peaked at 497–522 MiB in these runs. These are
sampled development-host results. The design checks still exceed the
500 MB budget, and reference-laptop qualification remains open.

All 142 PCB tests and seven production-browser scenarios passed. Browser
coverage included net classes, via rules, regional clearance, route
cancellation, zoom snapping, track edits and the offline classroom LED
exercise. Gerbonara independently read back the LED release's 40 × 22 mm
outline and six plated drills.

### Polygon allocation experiment

The experiment used exact JavaScript integer arithmetic for polygon area
when the local products and sum fit, with a BigInt fallback. It also sent
Clipper one preallocated coordinate array per ring. All 143 tests in the
experimental build passed. On references A–F and J, design-check reports
matched after timestamp removal. All other files returned by CAM preview,
including Gerber, drill and assembly files, matched byte for byte.

Three pairs of production filesystem runs alternated between the retained
and experimental builds. Each pair used the same browser, fixture and
runner. The timing is for the first full design check. The sampled peak is
for a second check in the same open tab, expressed in decimal megabytes.

| Pair | Retained time | Experimental time | Retained peak | Experimental peak |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1,522 ms | 1,411 ms | 571 MB | 601 MB |
| 2 | 1,443 ms | 1,390 ms | 541 MB | 570 MB |
| 3 | 1,436 ms | 1,394 ms | 574 MB | 603 MB |

The experimental build raised the observed whole-browser memory peak in all
three pairs. The polygon changes were removed. The retained build measured
423–431 MB after initial fill, 456–464 MB after zoom, and 518–539 MB after
cancelling the route and refilling. Memory was already at 534–536 MB before
the second check in these runs. That places part of the overage before the
check itself and identifies route cancellation and refill as stages to
isolate in the next measurement.

The runner now records a checkpoint after the cancelled fill worker closes
and samples the successful refill independently. Two production runs of
the retained build measured 487 and 493 MB after cancellation. The
successful refills peaked at 528 and 534 MB, then settled at 519 and
521 MB when Chromium displayed the results. Each refill yielded eight
proportional-memory samples. The subsequent repeat checks peaked at
529 and 534 MB. Both runs reported zero findings, page errors and
unexpected startup resources. The refill alone can exceed the budget
before the design check runs.

### Copper connectivity during refill

Zone island selection and the airwire overlay now use the same
drill-clipped fragments and plated connections as design checks. These
two consumers only need the physical islands. The full design-check path
also classifies contacts and reports boundary-only, fragile, and assembled
connections.

An instrumented run on the classroom board produced identical fill
regions, issues, fill clearances and airwires. Zone placement used 10
polygon intersections, down from 14. Airwire extraction used none,
down from 2,054. All 142 PCB tests and four production browser scenarios
passed. The reference CAD check reports matched after timestamp removal,
and the CAM output files matched byte for byte for A–F and J. Gerbonara
independently verified the offline classroom LED release.

Three production run pairs measured the following whole-browser
proportional peaks in decimal megabytes. The second pair ran the new
build first. Each of the six runs reported zero findings and no page
errors or unexpected startup resources.

| Pair | Previous refill time | New refill time | Previous refill peak | New refill peak | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 894 ms | 918 ms | 532 MB | 546 MB | 531 MB | 575 MB |
| 2 | 935 ms | 898 ms | 550 MB | 526 MB | 545 MB | 534 MB |
| 3 | 906 ms | 904 ms | 550 MB | 544 MB | 548 MB | 543 MB |

The results show overlap in timing and memory across builds. Both
workloads still exceeded the proposed 500 MB target in every run.

### Zone obstacle bounds

Zone filling compares the bounds of each copper obstacle, drill and
keep-out with the clipped fill area before offsetting it. The comparison
uses the obstacle's resolved clearance and an allowance for the round
join and integer rounding. A regression test keeps a track just outside
the zone whose clearance reaches into it and skips a track farther away.

The classroom worker result contains 712 vertices and serializes to
about 20 KB as JSON. The more expensive operation was expanding
obstacles. The instrumented classroom run reduced zone offsets from 212
calls returning 84,080 vertices to 12 calls returning 712 vertices. The
complete fill result and airwires matched. The reference A–F and J
design-check reports matched after removing generation timestamps, and
all other CAM preview files matched byte for byte.

All 143 PCB tests passed, as did the four production browser scenarios
covering routed regions, zone no-connect settings, a clipped thermal and
the offline LED exercise. Gerbonara independently verified the LED
release. TypeScript and the production filesystem build passed.

Three paired production runs recorded the following full check times and
whole-browser proportional-memory peaks. The second pair used the new
build first. Each run reported zero findings, page errors or unexpected
startup resources.

| Pair | Previous check time | New check time | Previous refill peak | New refill peak | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,390 ms | 911 ms | 529 MB | 521 MB | 536 MB | 560 MB |
| 2 | 1,442 ms | 912 ms | 543 MB | 537 MB | 544 MB | 540 MB |
| 3 | 1,452 ms | 879 ms | 548 MB | 539 MB | 545 MB | 540 MB |

Refill peak fell by 6–9 MB in the paired runs. Refill time overlapped,
with 888–951 ms before and 899–920 ms after. The full checks finished
34–39% faster. Repeat-check peaks varied in both directions, and all
new peaks still exceed the proposed 500 MB target.

### Unclipped track connectivity

Refill and airwire extraction reuse a track ring when it is convex,
has no holes of its own, and its bounds meet no drill opening. The
convexity check verifies a consistent turn direction and two monotone
chains, so a self-intersecting ring still goes through Clipper. The
full design-check path continues to use Clipper's canonical fragments.

The classroom airwire run reduced polygon difference calls from 2,604
to 654 and output vertices from 229,462 to 85,162. Fill regions, issues,
clearances and airwires matched the baseline. Tests cover a collinear
edge, either winding, a self-intersecting track ring, and a slot that
splits a track.

All 144 PCB tests and four production browser scenarios passed, covering
airwires, zone no-connect settings, a clipped thermal and the offline
classroom LED exercise. Gerbonara independently verified the LED
release. References A–F and J produced the same design-check reports
after timestamp removal and byte-identical CAM preview files.

Three paired production runs measured time from board open to its first
fill and sampled whole-browser proportional memory during explicit refill
and repeat design checks. The second pair ran the new build first. All
six runs reported zero findings, page errors and unexpected startup
resources.

| Pair | Previous first fill | New first fill | Previous refill peak | New refill peak | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 839 ms | 328 ms | 519 MB | 516 MB | 564 MB | 559 MB |
| 2 | 856 ms | 320 ms | 536 MB | 532 MB | 542 MB | 574 MB |
| 3 | 862 ms | 327 ms | 535 MB | 525 MB | 540 MB | 548 MB |

First-fill timings include the browser runner's wait for the editor
status. Explicit refill took 913–923 ms before and 391–967 ms after. The
refill peaks fell by 3–10 MB in these pairs. Repeat-check peaks were mixed.
Both workloads still exceeded the 500 MB target on the development host.

### Contact-area checks

Full design checks preserve the clipped copper fragments used for finding
locations and waiver fingerprints. Contact classification now reads
Clipper's single-ring intersection result directly and computes its signed
area with 64-bit coordinates. Multiple rings still use the region and
hole validator. The signed-area test distinguishes a point or edge contact
from overlap without constructing a JavaScript polygon just to discard it.

The instrumented classroom run made 2,054 contact-area queries, of which
2,050 returned one ring. The new path avoided constructing their 136,350
vertices in JavaScript. The design-check report matched after timestamp
removal. All 145 PCB tests passed, including tests for holes, boundary
contacts and one square nanometre of overlap near the coordinate limit.

The production filesystem build, TypeScript and both browser scenarios
passed. The seven reference boards produced matching check reports after
timestamp removal and byte-identical CAM preview files. Gerbonara
independently verified the classroom LED release.

An isolated Node run alternated the two kernels across four fresh
processes and collected ten warm full-check timings per variant. It
collected garbage before each check and excluded the first check in each
process. Median check time fell from 757 to 721 ms on the development host.

The same production browser workload produced more variable wall times
and memory. The second pair ran the new build first. Every run reported
zero findings, page errors or unexpected startup resources.

| Pair | Previous check time | New check time | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1,392 ms | 915 ms | 539 MB | 536 MB |
| 2 | 1,384 ms | 857 ms | 574 MB | 582 MB |
| 3 | 868 ms | 1,418 ms | 550 MB | 565 MB |

The browser measurements show no reliable memory reduction for this
change. The new build's sampled refills were 531–537 MB.

### Pad aperture geometry

Copper-only jobs such as placement preview, snapping, refill and route
editing skip the fabrication apertures. The full geometry used by
design checks, CAM and the inspection tools still includes the apertures.
A mask or paste opening with the same local shape as its copper land
reuses the transformed outline. Openings with their own shape still
receive a separate outline, and each aperture keeps its own layer,
kind and land identity.

The classroom board has 1,000 apertures with 120,000 vertices. The
copper-only geometry omits them, and the full geometry shares all
1,000 outlines with their lands. The compared copper features, drills
and assembly links matched. The geometry test uses a saved and
reopened board to exercise separately decoded pad shapes.

TypeScript, the production filesystem build, all 146 PCB tests and four
browser scenarios passed. The browser runs covered placement airwires,
via tenting, clipped thermals and the offline LED exercise. References
A–F and J produced matching design-check reports after timestamp
removal and byte-identical CAM preview files. Gerbonara independently
read back the LED release.

Three paired production runs measured whole-browser proportional memory
in decimal megabytes. The second pair ran the new build first. Every
run reported zero findings, page errors and unexpected startup resources.

| Pair | Previous refill peak | New refill peak | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: |
| 1 | 512 MB | 522 MB | 571 MB | 553 MB |
| 2 | 530 MB | 530 MB | 547 MB | 547 MB |
| 3 | 520 MB | 507 MB | 551 MB | 532 MB |

Repeat-check peaks fell by 18–19 MB in two pairs and were flat in one.
Refill peaks varied in both directions. The new build's first full
checks took 882–908 ms, compared with 870–896 ms before. The sampled
refill and check peaks remain above the proposed 500 MB target.

### Design checks during refill

Design checks and CAM wait for an active refill before starting their own
worker. The dialogue opens while the refill finishes. Closing the dialogue
while it is waiting cancels the pending analysis. Completed zone copper
stays visible and does not trigger a replacement worker. If an edit in
the dialogue makes the fill stale, the editor schedules a fill for the
current board when the dialogue closes.

The production runner can open design checks immediately after a refill
worker starts. It records worker start and close events and samples the
whole browser during the check and any resumed fill.

```sh
node scripts/pcb/qualify-workspaces.mjs dist build/qualification/refill-check.json \
  --classroom-board=build/classroom.dpn --measure-memory --check-during-refill
```

An initial approach called `terminate()` on the busy refill worker when
opening a dialogue. Chromium still reported that worker alive for
268–310 ms after starting the check worker in two runs. Waiting for the
refill result resolved that overlap and kept the completed fill.

| Pair | Previous worker overlap | Gap before check in new build | Previous sampled peak | New sampled peak |
| --- | ---: | ---: | ---: | ---: |
| 1 | 296 ms | 21 ms | 571 MB | 536 MB |
| 2 | 355 ms | 8 ms | 524 MB | 541 MB |

The probe measured the whole browser from refill through completion of
the check. The second pair ran the new build first. The check worker
closed 163–182 ms later in the new build because it waited for the
refill. Peak memory varied between runs. The latest sequential
classroom runs measured 508–528 MB during refill and 532–540 MB during
repeat checks.

Five browser scenarios passed across the final regression and companion
runs. They covered cancelling a waiting check, preserving a completed
fill, stale replies after manual cancellation, zone no-connect settings,
clipped thermals and the offline classroom LED. Gerbonara independently
verified that LED release. The production build, TypeScript and 146 PCB
tests passed.

### Copper clearance bounds index

Design checks reuse the bounds tree used by zone-width checks to find
nearby copper on each layer. They apply the same search clearance and
keep exact measurements and findings in board order. Zone-width checks
use the same visit and comparison limits as before.

The classroom board's previous loop enumerated 3,389,106 pairs and
made 3,246,152 bounds comparisons after layer and net filtering. The
new search visited 61,370 index nodes, plus the entries in the leaves
it reached. The two searches found the same nearby pairs in the same
order. This was verified on both the classroom and adversarial reference
boards. The adversarial board exercises pairs that reach the exact check.

All 146 PCB tests and four production browser scenarios passed, including
net class edits, regional rules, a clipped thermal and the offline LED
exercise. The reference A–F and J reports matched after timestamp removal,
and all other CAM preview files were byte-identical.

Ten warm Node check timings per variant, collected across four fresh
processes in alternating order, gave medians of 702 ms with the
pairwise scan and 516 ms with the index. Garbage collection ran before
each timing and the first check in each process was excluded. The
comparison changed the clearance search in the check engine and kept
the other current geometry code in both variants.

Three production browser pairs were more variable. Every run reported
zero findings, page errors and unexpected startup resources. Memory is
whole-browser proportional set size in decimal megabytes.

| Pair | Previous check time | New check time | Previous refill peak | New refill peak | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 922 ms | 896 ms | 499 MB | 520 MB | 519 MB | 576 MB |
| 2 | 880 ms | 865 ms | 509 MB | 537 MB | 568 MB | 581 MB |
| 3 | 862 ms | 914 ms | 506 MB | 529 MB | 560 MB | 527 MB |

The browser timing includes the wait for the editor to display the
report. Peak memory varied during repeat checks and was higher during
refill in all three pairs. The refill uses no clearance index. These
runs do not establish a browser memory improvement, and all new peaks
remain above 500 MB.

### Classroom entry and simulation chart loading

The `--classroom-entry` option isolates three entry paths for the same
classroom workload. Each invocation starts its own Chromium process and
opens the board from PCB Design. Use `direct` for fresh PCB entry,
`switched` for three empty-workspace cycles and an empty PCB check, or
`inspected` to add 3D inspection of the empty board. The usual workspace
matrix still runs separately.

```sh
node scripts/pcb/qualify-workspaces.mjs dist build/qualification/classroom-switched.json \
  --classroom-board=build/classroom.dpn --measure-memory --classroom-entry=switched
```

The empty Simulation workspace now requests the chart renderer when a
waveform or histogram is first displayed. The measured JavaScript
requests during empty workspace switches fell from 398,365 to 142,849
bytes in the uncompressed filesystem build. The production Chromium
source-preview check verified zero renderer requests at startup and
successful requests when inserting a source with a sine preview. The
Electron chart qualification passed for chart controls, pop-out
windows, source editing, circuit explorer and live instruments.
TypeScript, the production filesystem build and all 94 applicable
simulation tests passed. Two macOS-only signing tests were skipped.

Three fresh-process runs per entry path and build measured the following
whole-browser proportional memory ranges in decimal megabytes. All
eighteen runs completed with zero findings or page errors. The new
build issued no waveform or histogram requests in the empty probes.

| Entry path | Previous before file open | New before file open | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: |
| Direct | 231–237 MB | 231–238 MB | 478–483 MB | 478–514 MB |
| After switches | 319–320 MB | 315–317 MB | 497–530 MB | 493–533 MB |
| After switches and 3D inspection | 328–333 MB | 338–342 MB | 511–566 MB | 526–556 MB |

The switched build had 77–86 MB more resident memory before the board
opened than fresh PCB entry. 3D inspection added another 21–27 MB
at that point in the new build. The peak ranges overlap across build
variants. The latest full workspace matrix passed and sampled 505 MB
during classroom refill and 520 MB during repeat checks. The broader
workload still exceeds the proposed 500 MB target on the development
host.

### SVG drawing transform

The shared viewport keeps its SVG root in display pixels. Pan, zoom and
fit update the drawing-group matrix. The existing screen-to-drawing
matrix still drives snapping and pointer-anchored zoom, and the rulers
use the same scale and origin. The root view box changes only when the
drawing area resizes. The footprint print export still writes the full
fit extent in millimetres.

The paired runs used the inspected classroom entry on the same
development host. The second pair ran the new build first. Values are
whole-browser proportional memory in decimal megabytes.

| Pair | Previous after zoom | New after zoom | Previous refill peak | New refill peak | Previous repeat-check peak | New repeat-check peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 449 MB | 430 MB | 507 MB | 483 MB | 539 MB | 516 MB |
| 2 | 434 MB | 426 MB | 489 MB | 483 MB | 521 MB | 546 MB |
| 3 | 451 MB | 432 MB | 509 MB | 483 MB | 543 MB | 516 MB |

Chromium reported 41–55 MB of embedder heap after zoom before the change
and 20 MB in each new run. Zoom feedback P95 remained 16.9–17.7 ms.
All six browser scenarios passed, covering pointer-centred zoom, both
rulers, resizing, route and dimension snaps, track editing, footprint
printing and the offline classroom exercise. Gerbonara independently
verified the LED release.

The full workspace matrix passed and measured 520 MB during refill and
581 MB during repeat checks. The dedicated inspected entry isolates a
single workspace history. The full matrix also runs the other startup
entries in the same process, so its memory is reported separately.

A diagnostic run collected garbage before opening the classroom board.
It sampled Chromium process memory, V8 heaps and DOM counters immediately
before and after collection. These samples are separate from the
unmodified qualification runs.

| Entry | Browser before collection | Browser after collection | DOM nodes before | DOM nodes after | Renderer after | GPU process after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct | 232 MB | 223 MB | 558 | 487 | 104 MB | 42 MB |
| After switches | 317 MB | 273 MB | 3,014 | 704 | 139 MB | 55 MB |
| After switches and inspection | 341 MB | 293 MB | 3,054 | 706 | 144 MB | 71 MB |

The switched and inspected sessions lost more than 2,300 DOM nodes after
collection. They still had 50 and 70 MB more resident memory than
direct entry. The renderer and GPU process retain most of the measured
difference. These counters aggregate processes and leave individual
retained objects unidentified.

The production Electron portable-board scenario passed on the same
viewport code. It verified native zoom and fit, an unchanged Save As
and an edited save and reopen. TypeScript and both production builds
passed.

### First and repeat design checks

The workspace runner now samples process memory during the first design
check after refill as well as the repeat check. Each sampled task gets a
process snapshot before the command starts and then samples at nominal
100 ms intervals, plus the process-counter read time. The JSON keeps
the first-check series in `classroom.checkMemory` beside the existing
repeat-check series in `classroomMemory`.

An in-page observer measures from activating the check command to the
report entering the DOM. This removes browser automation polling from
the duration. The runner also records Long Task entries that overlap
the first check. This timing describes report insertion in the editor.
Compositor presentation requires a separate measurement.

Two production runs per entry measured the following whole-browser
proportional memory on the development host, in decimal megabytes.

| Entry path | First check baseline | First check peak | Repeat baseline | Repeat peak |
| --- | ---: | ---: | ---: | ---: |
| Direct PCB | 431–432 MB | 490–492 MB | 485–486 MB | 494–495 MB |
| After switching and empty 3D inspection | 490–499 MB | 510–533 MB | 504–528 MB | 515–538 MB |
| Full workspace matrix | 498–526 MB | 523–532 MB | 521–524 MB | 528–530 MB |

First reports entered the DOM in 686–735 ms. Repeat reports arrived in
655–715 ms. No Long Task entries overlapped the six first checks.
Every check found zero issues and verified physical connectivity. The
timing-only run also completed and reported the first check at 658 ms.
The full workflow still exceeds the 500 MB target. The higher repeat
baseline is visible before the repeat command runs.

### Clipper path transfer

The polygon kernel reuses a typed coordinate buffer and imports each ring into
Clipper in one call. The binding copies the ring before the buffer is reused.
Signed nanometre coordinates, ring winding and vertex limits are preserved.

Three pairs exercised the full production filesystem workspace matrix on the
development host. The second pair ran the new build first. Timing starts at
the design-check command and ends when the report enters the DOM. Memory is
peak sampled whole-browser proportional memory in decimal megabytes.

| Pair | First check, previous → new | Repeat check, previous → new | First peak, previous → new | Repeat peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 719 → 640 ms | 690 → 622 ms | 564 → 521 MB | 571 → 523 MB |
| 2 | 692 → 656 ms | 646 → 611 ms | 531 → 553 MB | 526 → 555 MB |
| 3 | 771 → 669 ms | 688 → 625 ms | 559 → 567 MB | 566 → 566 MB |

Median first-check time fell from 719 to 656 ms and median repeat-check time
fell from 688 to 622 ms. In the isolated Node geometry benchmark, ten warm
checks per build had medians of 526 and 486 ms. Every classroom report had zero
findings. The browser memory ranges overlap and every new run exceeded 500 MB.

All 146 PCB tests and four browser scenarios passed, including routing rules,
clipped thermals and offline release and export. The seven reference boards
(A–F and J) produced the same findings and CAM files. Gerbonara independently
read back the LED manufacturing release and the adversarial CAM preview.

### Routing clearance transfer

In a diagnostic run after workspace switches and empty 3D inspection, forced
collection reduced renderer proportional memory from 285 to 214 MB after
routing and refill, with the board still open. The corresponding run with
both rulers hidden measured 285 to 216 MB. These two single runs locate
transient allocations and do not contribute to the qualification totals.

The classroom routing worker sent 170,263 vertices for expanded drills and
copper obstacles. The editor now receives their signed integer coordinates
in transferable buffers. The coordinates occupy 1.36 MB, plus the ring
offsets and obstacle bounds. The renderer materialises each polygon on the
first test that reaches its bounds and reuses it for later pointer moves.
Preview and commit still use the same segment and polygon clearance tests.

Three pairs ran the full production filesystem workspace matrix on the
development host. The second pair ran the new build first. The peaks below
are whole-browser proportional memory in decimal megabytes.

| Pair | First route preview, previous → new | Route setup peak, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 298 → 201 ms | 482 → 465 MB | 590 → 539 MB | 590 → 543 MB |
| 2 | 289 → 201 ms | 482 → 471 MB | 557 → 540 MB | 588 → 541 MB |
| 3 | 262 → 200 ms | 459 → 458 MB | 524 → 534 MB | 530 → 532 MB |

Median time to the first visible route preview fell from 289 to 201 ms.
After setup, pointer-to-preview P95 ranged from 17.1 to 18.3 ms with the new
build. Every classroom check reported zero findings. Peak memory during
first and repeat checks still exceeded the proposed 500 MB target.

The transfer test round-trips signed coordinates, a polygon hole, a drill
obstacle and distinct copper layers through transferable buffers. The
classroom geometry test verifies both clear and blocked legs against the
same preview that the editor receives and commits the clear route.

All 147 PCB tests and seven browser scenarios passed. The browser tests
covered the shared PCB shell, regional routing rules, snapping at different
zoom levels, track edits, retry and cancellation with delayed worker replies,
refill sequencing, and the offline LED release. Gerbonara independently read
back that manufacturing archive.

### Routing snap geometry

Entering route mode now records track bounds from the two endpoints and the
track width. The first pointer sample near a track builds its exact rounded
copper outline. The snap lookup still uses the exact outline for tolerance
and ties, and reuses it for later samples while routing. Pad and via snapping
continue to account for the surrounding copper and drill openings.

The previous and current implementations agreed on 24,139 queries across
the classroom board and references A–F and J. This covered track ends and
centrelines, nearby points at several acquisition radii, plated holes and
layer selection. All 148 PCB tests and five browser scenarios passed. The
offline LED exercise also passed independent Gerbonara read-back.

In the isolated Node benchmark, median snap-target construction across ten
warm runs fell from 138 to 24 ms. The browser's first-preview timing starts
at the waypoint click, after route mode opens. It also includes worker and
rendering time. Three pairs measured the full production filesystem workflow
on the development host, with the new build first in pair 2.

| Pair | First route preview, previous → new | Route setup peak, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 191 → 205 ms | 448 → 472 MB | 518 → 565 MB | 552 → 566 MB |
| 2 | 197 → 208 ms | 477 → 462 MB | 549 → 537 MB | 585 → 535 MB |
| 3 | 200 → 209 ms | 460 → 461 MB | 539 → 571 MB | 577 → 567 MB |

All six runs reported zero findings. The browser timing and memory results
give no consistent improvement across the workflow. Memory during first and
repeat checks still exceeded 500 MB.

### Validation of rounded copper and openings

Native board and padstack validation checks a capsule's endpoints, width and
conservative envelope before tessellating it. When that envelope is fully
within the board limits, validation has no outline to allocate. The maximum
allowed width stays within the arc vertex budget. Near a coordinate limit,
validation still checks the exact rounded vertices. The same validation
serves tracks, vias, pad drills, wire jumper drills and CAM drill writing.

All 149 PCB tests and three browser workflows passed. The reference boards
A–F and J produced identical check reports after timestamp normalisation and
byte-identical CAM files. Gerbonara independently read back the offline LED
release and the adversarial geometry preview.

Direct comparison with the tessellating validator produced identical
acceptance and error messages for 24,000 generated capsules near the
coordinate limits. Median native validation of the classroom board fell
from 33.4 to 9.6 ms across 14 warm Node samples per build.

Three pairs ran the full production filesystem workflow on the development
host. The second pair used the new build first. Peak values are sampled
whole-browser proportional memory in decimal megabytes.

| Pair | Classroom open, previous → new | Refill peak, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1,304 → 1,215 ms | 511 → 495 MB | 536 → 527 MB | 536 → 534 MB |
| 2 | 1,276 → 1,228 ms | 508 → 491 MB | 532 → 522 MB | 533 → 529 MB |
| 3 | 1,281 → 1,212 ms | 505 → 500 MB | 571 → 525 MB | 572 → 527 MB |

Every run found zero design-check issues. The new build reduced refill and
design-check peaks in all three pairs. First and repeat checks still
exceeded 500 MB.

### Exact polygon area

The signed-area calculation translates the ring to its first vertex and
uses integer arithmetic in JavaScript numbers while the coordinates,
products and accumulated area are all exactly representable. For larger
intermediate values it repeats the calculation with BigInt. The returned
area remains a BigInt in nanometres squared, at twice the geometric area.
Coordinate validation also checks X and Y directly, avoiding a temporary
array per vertex.

An independent BigInt calculation matched the result for 32,000 generated
rings, including local rings translated near the board limits and rings
spanning the board. The PCB test suite also covers cancellation between two
large products that leaves one square nanometre of doubled area.

Three pairs ran the full production filesystem workflow on the development
host. The second pair used the new build first. Memory figures are sampled
whole-browser proportional memory in decimal megabytes.

| Pair | First check, previous → new | Repeat check, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 654 → 575 ms | 605 → 556 ms | 558 → 555 MB | 559 → 564 MB |
| 2 | 666 → 565 ms | 611 → 541 ms | 501 → 535 MB | 508 → 552 MB |
| 3 | 646 → 578 ms | 663 → 557 ms | 531 → 531 MB | 540 → 536 MB |

Median first-check time fell from 654 to 575 ms. Median repeat-check time
fell from 611 to 556 ms. In an isolated Node run, ten warm checks per build
had medians of 481 and 405 ms. Peak browser memory varied between runs and
remained above 500 MB during design checks.

All 150 PCB tests and four browser workflows passed. All seven reference
boards produced the same check reports and CAM files after allowing for
report timestamps. Gerbonara independently read back the offline LED
release and the adversarial CAM preview.

### Uncut track vertices in design checks

Full connectivity checks still normalise uncut tracks with Clipper. If a
single returned ring matches the input cyclically, the result reuses the
existing point objects in Clipper's order. Changed contours and tracks cut
by drills use the normal result path. The classroom check shared 144,300 of
147,250 track vertices across 1,950 uncut tracks.

An isolated Node measurement held the board geometry and resulting
connectivity graph live, with garbage collection before and after
extraction. Median incremental retained heap across three processes per
build fell from 12.0 to 6.3 MB. Both builds returned 2,604 fragments.
The median of ten warm design checks per build fell from 403 to 386 ms.

Three pairs ran the full production filesystem workflow on the development
host. The second pair used the new build first. Peak values are sampled
whole-browser proportional memory in decimal megabytes.

| Pair | First check, previous → new | Repeat check, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 594 → 538 ms | 546 → 527 ms | 563 → 493 MB | 563 → 495 MB |
| 2 | 570 → 577 ms | 534 → 530 ms | 555 → 537 MB | 565 → 542 MB |
| 3 | 568 → 622 ms | 554 → 539 ms | 565 → 542 MB | 578 → 547 MB |

Peak memory fell for first and repeat checks in every pair. One new run
stayed below 500 MB for both checks, and two exceeded that target. All six
classroom runs reported zero findings.

All 151 PCB tests and four browser scenarios passed, including jumper
connectivity, clipped thermals and offline export. The seven reference
reports and manufacturing files matched after timestamp normalisation.
Gerbonara independently read back the LED release and the adversarial
geometry preview.

### Shared drill and slot outlines

Zone fill, connectivity extraction, fabrication checks and CAM preparation
use the same tessellated outline for each drill or slot in a geometry job.
The weak cache follows the lifetime of the drill object. A change to an
endpoint or width invalidates the outline. Clearance-expanded shapes and
outlines reconstructed from the exported drill files are still computed
from their own inputs.

Instrumenting one classroom design check recorded 550 requests for the 50
openings. Sharing reduced the number of tessellated base outlines from
550 to 50 and the number of base vertices created from 47,850 to 4,350.

Three pairs ran the full production filesystem workflow on the development
host. The second pair used the new build first. Memory figures are sampled
whole-browser proportional memory in decimal megabytes.

| Pair | First check, previous → new | Repeat check, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 563 → 542 ms | 545 → 558 ms | 522 → 493 MB | 532 → 503 MB |
| 2 | 532 → 552 ms | 561 → 522 ms | 514 → 510 MB | 520 → 517 MB |
| 3 | 599 → 544 ms | 574 → 543 ms | 524 → 509 MB | 550 → 551 MB |

All six classroom runs found zero issues. The median first-check peak
decreased from 522 to 509 MB and the repeat peak from 532 to 517 MB. Each
new run still exceeded 500 MB during at least one check.

All 152 PCB tests and four browser workflows passed, including opening
inspection, clipped thermals, connector slots and the offline LED release.
The seven reference reports and CAM files were identical after report
timestamp normalisation. Gerbonara independently read back the connector
preview and the LED manufacturing release.

### Packaged PCB worker jobs

Two experiments moved output code out of the normal PCB worker. One used
dynamic imports within the worker and one used separate editing and output
workers. Both passed the layout browser's fixture build, then failed to
start design checks in the production filesystem and Electron builds.
The packaged worker reported a missing Parcel module in both experiments.
The application uses the verified single PCB worker.

The production workspace runner now records the PCB check dialog's error
or findings immediately. Its classroom timing probe also reports the
worker failure as soon as the dialog displays it. A replay of the rejected
filesystem build reported the missing module at all three workspace
entries. A deliberately injected classroom worker failure reported its
original message. The restored production classroom workflow and native
Electron portable-board smoke test passed.

The restored filesystem build also displayed an embedded STEP model and
exported the connector CAM preview and the KiCad interchange fixture.
Gerbonara verified the connector slots and holes. The KiCad archive
members matched the previously verified board, DRC rules and export report
byte for byte.

The production runner selects each exported CAM layer when saving a review.
It handles a single-layer board without silkscreen and a KiCad bundle
without omissions. Worker errors in design checks, 3D inspection, CAM
preview and KiCad export are reported as soon as the corresponding
dialogue shows an alert.

A fresh filesystem run opened the embedded LED STEP model and exported
CAM and release-review archives for the connector and the plain board.
The archived review lists matched all exported Gerber and drill files,
and all output hashes matched. Gerbonara 1.6.3 verified the connector
slots and mounting holes. KiCad 9.0.9 resaved and reopened the interchange
coupon and applied the exported track-width rule. Both production runs
completed the workspace switches without retaining a PCB worker.
Injected CAM and KiCad worker failures both exited with the original
worker message in the recorded result.

### SVG track rendering during net selection

The PCB canvas reuses its track SVG elements when the selected net changes.
It applies highlight props to the selected net's paths. Track edits and
layer visibility still rebuild the underlying elements. The normal stroke
colors, hit targets and forced-colors highlights remain available.

Five browser scenarios covered routing, track edits, schematic and
simulation cross-probing, and the offline LED release. The packaged
Electron save and reopen test passed. Gerbonara independently read back
the LED release and the filter CAM preview.

Three pairs ran the full production filesystem workflow on the development
host. Pair 2 used the new build first. Peak values are sampled
whole-browser proportional memory in decimal megabytes.

| Pair | Refill peak, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: |
| 1 | 501 → 479 MB | 521 → 496 MB | 528 → 503 MB |
| 2 | 486 → 477 MB | 507 → 493 MB | 517 → 502 MB |
| 3 | 478 → 491 MB | 495 → 509 MB | 534 → 549 MB |

Median first-check peak fell from 507 to 496 MB. Median repeat-check peak
fell from 528 to 503 MB. Every classroom check found zero issues. In each
new run, the repeat check still exceeded 500 MB.

A separate diagnostic alternated two classroom nets 60 times per run and
timed each selection until the SVG highlight changed. Median latency was
8.2–8.4 ms before and 5.3–5.7 ms afterwards. P95 was 10.9–11.1 ms before
and 7.9–8.5 ms afterwards. The renderer's sampled proportional memory
rose by 8–11 MB across the sequence before the change and by 3–4 MB with
the new build. JavaScript heap samples varied between runs.

### Footprint highlights during net selection

The placed-footprint renderer receives an active net only when one of its
copper lands belongs to that net. It uses the physical pad list when no
copper outline is available. This keeps unrelated footprints eligible
for React's existing memoisation and preserves individual pad selection
and layer filtering.

Two pairs alternated the two classroom nets 60 times per run and waited
for both the selected pad and the selected track to update. Median
highlight latency fell from 5.3–5.5 to 4.1 ms, and P95 fell from 7.3–7.9
to 5.6–6.1 ms. JavaScript heap grew by 22.3–22.5 MB during the original
sequence and 7.0–7.3 MB with the change.

Three other pairs exercised the full production filesystem workflow.
Peak values are sampled whole-browser proportional memory in decimal
megabytes. The second pair ran the new build first.

| Pair | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: |
| 1 | 507 → 527 MB | 518 → 532 MB |
| 2 | 536 → 546 MB | 550 → 554 MB |
| 3 | 506 → 498 MB | 516 → 506 MB |

The direct selection improvement did not translate into a consistent
reduction in whole-workflow memory. All six runs reported zero findings.
Four browser scenarios and the native Electron portable-board test passed.
Gerbonara independently read back the LED release and filter CAM preview.

### Polygon boundary scans

Copper contact checks walk polygon vertices by index, including when they
build bounds or examine isolated point contacts. This avoids iterator
pairs in the inner edge loop. A yes-or-no boundary query stops at the
exact intersection predicate. The profile validator still calculates the
diagnostic location in the original edge order.

Three isolated V8 heap profiles per build estimated 276–277 MB of
cumulative allocations in the previous check and 165–167 MB in the new
check. The boundary-contact and bounds-iterator frames previously
accounted for about 111 MB per run and had no sampled allocations after the
change. This profile includes allocations collected during the check.
It measures allocation volume rather than the live heap or process peak.
The median of ten warm Node checks fell from 403 to 376 ms.

Three pairs ran the full production filesystem workflow on the development
host. The second pair ran the new build first. Values are sampled
whole-browser proportional memory in decimal megabytes.

| Pair | Refill peak, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: |
| 1 | 495 → 460 MB | 513 → 493 MB | 546 → 501 MB |
| 2 | 510 → 460 MB | 525 → 493 MB | 529 → 499 MB |
| 3 | 501 → 462 MB | 550 → 498 MB | 558 → 507 MB |

Every new first check stayed below 500 MB. Two repeat checks still
exceeded the target. The classroom checks reported zero findings.
All 152 PCB tests and four browser workflows passed, including located
cutout validation. The seven reference reports and CAM files matched
after report timestamp normalisation. Gerbonara independently read back
the offline LED release and adversarial preview.

### Writing Clipper input coordinates

The geometry kernel fills its existing 64-bit coordinate buffer through
a 32-bit view. The low word holds the validated nanometre coordinate and
the high word extends its sign. The views share the same buffer and agree
on byte order. Clipper still receives signed 64-bit coordinates and the
same ring order. The tests include both coordinate limits, a hole and a
smaller operation reusing the buffer.

The median of ten warm Node checks fell from 385 to 351 ms. Sampling
allocations, including those collected during the check, put coordinate
packing at 29.3–29.7 MB before the change and 1.9–2.1 MB afterward. These
figures measure allocation volume.

Three pairs ran the production filesystem classroom workflow on the
development host. The second pair ran the new build first. Memory values
are sampled whole-browser proportional memory in decimal megabytes.

| Pair | First check time, previous → new | Repeat check time, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 552 → 486 ms | 542 → 489 ms | 495 → 509 MB | 504 → 521 MB |
| 2 | 543 → 490 ms | 491 → 478 ms | 514 → 516 MB | 521 → 527 MB |
| 3 | 533 → 486 ms | 509 → 475 ms | 494 → 491 MB | 501 → 501 MB |

The new build ran every check faster. Its first-check memory peak passed
the 500 MB target in one run. All repeat peaks exceeded the target. Memory
at the start of the first check varied from 458 to 479 MB in the new build
and from 460 to 472 MB in the previous build. The memory qualification
remains open on the reference school laptop.

All 153 PCB tests and four browser workflows passed. The classroom
checks reported zero findings. The seven reference reports matched after
timestamp normalisation and their CAM files were byte-identical.
Gerbonara independently read back the offline LED, asymmetric connector
and adversarial exports.

### Reading Clipper result coordinates

The kernel reads result coordinates from the existing WebAssembly
buffer through a 32-bit view. It checks the sign extension and the
board range before accepting each coordinate. Single-ring intersection
checks translate the origin to the first vertex and use integer
arithmetic while all products and sums are safe. Larger results use
exact BigInt arithmetic. General polygon results retain the kernel's
ring start, winding and hole ownership.

All 153 PCB tests and four browser workflows passed. The geometry tests
include signed coordinates at both limits, an out-of-range offset, small
edge and point contacts, and an intersection requiring BigInt. The seven
reference reports and CAM files matched after report timestamp
normalisation. Gerbonara independently read back the LED release,
connector preview and adversarial preview.

Across three isolated check profiles per build, sampled allocation
volume fell from 140–142 MB to 101–105 MB. The profiler included
allocations collected during the check. In ten warm Node samples per
build, median check time fell from 355 to 328 ms.

Three pairs ran the full production filesystem classroom workflow on
the development host. The second pair ran the new build first. Memory
values are sampled whole-browser proportional memory.

| Pair | First check time, previous → new | Repeat check time, previous → new | First check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 500 → 512 ms | 503 → 520 ms | 493 → 491 MB | 501 → 501 MB |
| 2 | 494 → 496 ms | 489 → 505 ms | 492 → 510 MB | 501 → 517 MB |
| 3 | 515 → 482 ms | 470 → 485 ms | 509 → 491 MB | 516 → 502 MB |

Whole-browser memory ranges overlapped. Repeat checks took longer in
all three new runs, and all three repeat peaks exceeded 500 MB. The
classroom checks reported zero findings. Qualification on the reference
school laptop remains open.

### Structured design-check findings

The production filesystem workspace runner now reads the findings table
and counts data rows independently of the column headers. Two fresh
Chromium runs on the development host completed all three workspace
starts and switches, with zero findings on both the first and repeat
classroom checks and no unexpected cold resource requests.

| Run | First check | Repeat check | First peak | Repeat peak |
| --- | ---: | ---: | ---: | ---: |
| 1 | 571 ms | 550 ms | 511 MB | 519 MB |
| 2 | 509 ms | 464 ms | 496 MB | 505 MB |

Memory values use sampled whole-browser proportional memory in decimal
megabytes. Both repeat checks exceeded 500 MB. The reference school
laptop run remains open.

### Rounded contour allocation

Rounded tracks, drills, slots and circles now write their vertices directly
into the final contour. The two capsule arcs use the same angle calculation,
vertex order and rounding as before. A closed circle omits the duplicate
closing vertex while generating the contour. The tessellation and coordinate
limits are unchanged.

Three isolated Node profiles per build sampled 104–105 MB of allocations
during the classroom check before the change and 90–92 MB afterward. These
figures include allocations collected during the check. Median time over
ten warm Node checks changed from 336 to 333 ms.

The production filesystem runner made two pairs of full classroom workspace
runs on the development host. The second pair ran the new build first.
Memory values are sampled whole-browser proportional memory in decimal
megabytes.

| Pair | First check time, previous → new | Repeat check time, previous → new | First peak, previous → new | Repeat peak, previous → new |
| --- | ---: | ---: | ---: | ---: |
| 1 | 564 → 605 ms | 528 → 484 ms | 513.8 → 512.4 MB | 527.7 → 520.4 MB |
| 2 | 535 → 535 ms | 509 → 547 ms | 493.3 → 493.8 MB | 498.2 → 500.0 MB |

Both versions reported zero classroom findings and no unexpected cold
workspace resource requests. The paired whole-browser peaks overlap.
Both new repeat runs exceeded 500 MB before rounding. The reference
school laptop qualification remains open.

All 155 PCB tests and five browser workflows passed. Reports for references
A–F and J matched after timestamp normalisation. The corresponding
fabrication files were byte-identical. Gerbonara independently read back
the new browser exports for the LED lesson, connector and adversarial board.

### Plated contact and zone clearance experiment

The experiment reused a contact array when scanning the copper joined by
each plated barrel. Zone refill resolved a feature's clearance only when
that feature was considered as an obstacle. Node heap sampling across three
checks per build fell from 91–93 MB to 85–87 MB of total allocations.
All seven reference reports matched after timestamp normalisation and the
fabrication files were byte-identical.

Four production filesystem pairs ran the full workspace benchmark on the
development host. In pairs 2 and 4, the experiment ran first. Memory values
are sampled whole-browser proportional memory in decimal megabytes.

| Pair | First check time, baseline → experiment | Repeat check time, baseline → experiment | First peak, baseline → experiment | Repeat peak, baseline → experiment |
| --- | ---: | ---: | ---: | ---: |
| 1 | 533 → 551 ms | 601 → 538 ms | 502.0 → 515.2 MB | 515.4 → 526.0 MB |
| 2 | 538 → 566 ms | 508 → 476 ms | 492.2 → 501.2 MB | 500.0 → 509.1 MB |
| 3 | 509 → 510 ms | 453 → 471 ms | 515.8 → 526.9 MB | 523.3 → 531.3 MB |
| 4 | 477 → 480 ms | 452 → 439 ms | 494.4 → 523.0 MB | 504.3 → 530.7 MB |

The experiment was reverted after both check peaks rose in every pair.
All runs reported zero classroom findings. The plated net-tie regression
test remains in the suite. Reference school laptop qualification is open.

### Memory sample timing

The reference runner keeps a Windows PowerShell process open between
snapshots. It records when each process read starts and finishes relative to
the task. The pre-task snapshot and readings completing after the task
remain in the raw report. The reported task peak uses only readings that
completed before the task ended.

On the Linux development host, the production filesystem and mocked Drive
builds each passed two cold starts per workspace. The traced PCB run
completed the three workspace cycles and closed its workers. The Drive
run also displayed the embedded STEP model from a direct board open.
A controlled subprocess test exercised collector reuse and shutdown.
The PowerShell executable and Windows working sets still need validation on
the reference laptop.

The filesystem run reopened the classroom board under two filenames in
one warmed context. The first check on each open captured five eligible
memory readings and peaked at 498.7 MB and 569.3 MB respectively. The
repeat check after the second open peaked at 568.2 MB. The runner excluded
one reading that completed after that check and one that completed after
the second refill. All checks reported zero findings. After switching to
Circuit Design and collecting garbage, the renderer's sampled proportional
set size was 215 MB with no active PCB worker. These development-host
results show that a single open can miss the higher working set observed
after reopening the board.

### Direct PCB XML decoding

The PCB codec reads schema fields from the parsed XML document. Only unknown
optional elements are copied into the native board's extension data for future
saves. The decoder keeps the same XML validation and nesting limit. Three
isolated Node profiles per build sampled 57–58 MB of allocations during a
classroom file decode before the change and 48–49 MB afterward.

Two production filesystem pairs on the development host each opened the
classroom board twice in one browser context. The second pair ran the new
build first. Memory values are sampled whole-browser proportional memory
in decimal megabytes.

| Pair | First open check peak, previous → new | Second open check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: |
| 1 | 521.1 → 496.9 MB | 588.7 → 565.9 MB | 587.4 → 564.8 MB |
| 2 | 507.2 → 500.8 MB | 600.8 → 568.6 MB | 606.6 → 571.9 MB |

Second-open times were 336 → 1,185 ms and 317 → 314 ms. Every measured
open finished within three seconds. All checks reported zero findings.
After the second open, both builds exceeded the 500 MB memory target.
The reference school laptop qualification remains open.

All 155 PCB tests passed, including the expanded unsupported-node and
nesting checks. The filesystem, desktop renderer, native Electron, mocked
Drive, classroom lesson and daughterboard workflows passed. The seven
reference boards produced identical native files and manufacturing files.
Their reports matched after timestamp normalisation. Gerbonara independently
read back the fresh classroom release.

### Immutable PCB snapshots on open

The board validator reuses snapshots it has already validated and
recursively frozen. The file decoder and undo history therefore share the
same initial snapshot. New objects are validated and copied, including
optional fields in canonical key order. The copy now writes sorted fields
directly into the final object.

Three isolated Node profiles per build opened the classroom file and
created its undo history. Sampled allocations fell from 62–63 MB to
45–46 MB.

Two production filesystem pairs on the development host opened the
classroom board twice in one context. The second pair ran the new build
first. Memory is sampled whole-browser proportional memory in decimal
megabytes.

| Pair | First open check peak, previous → new | Second open check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: |
| 1 | 521.9 → 507.6 MB | 585.2 → 574.0 MB | 588.9 → 574.2 MB |
| 2 | 521.7 → 494.8 MB | 590.1 → 562.8 MB | 594.4 → 568.7 MB |

Second-open times were 1,194 → 304 ms and 1,192 → 1,168 ms. Each check
returned zero findings. The repeat peaks remain above 500 MB on the
development host.

All 155 PCB tests and five renderer workflows passed. Native board and
fabrication files matched for references A–F and J. Check reports matched
after timestamp normalisation. Gerbonara also read back the new classroom
release.

### Embedded STEP asset memory

PCB open and save verify embedded STEP data in bounded base64 chunks.
The decoder writes each chunk into the final byte array and keeps the
canonical base64 and SHA-256 checks. Three isolated Linux Node processes
per build decoded and verified a 32 MiB asset, the per-model limit. Peak
process RSS fell from 253.8–254.4 MB to 211.2–211.5 MB, including setup of
the encoded fixture. Decode and verification took 328–364 ms before and
262–299 ms afterward.

Refill and route-clearance workers receive the 2D input without embedded
STEP bytes. The portable board test traces these requests, checks that
design checks still use the digest of the full board, and opens its
embedded model offline. Native file storage and manufacturing use the full
board. The standard classroom benchmark has no STEP assets and retains its
separate memory qualification.

### Shared ruler pointer rendering

Circuit Design and PCB Design use the same ruler. The tick canvas is
repainted when its scale, scroll position or dimensions change. Moving
the pointer translates a separate one-pixel marker. Its position uses the
same drawing-to-pixel calculation as the ticks. In forced colors the
marker uses the system highlight color.

The PCB browser test observed no ruler canvas repaints or size resets
when the pointer moved with a fixed view. It checked both markers after
pan, zoom, and resizing. The offline LED workflow checked that both
schematic markers moved by the expected pixel distances. TypeScript and
three browser workflows passed. Gerbonara read the fresh LED release.

An initial marker using CSS positioning showed higher route-preview tail
latency in two pairs. The retained version uses a CSS transform. The
production filesystem tests reopened the board twice per context on the
development host. Memory is sampled whole-browser proportional memory
in decimal megabytes.

| Pair | Route-preview P95, previous → new | Second-open routing peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: |
| 1 | 17.2 → 16.9 ms | 531.5 → 528.6 MB | 569.7 → 567.5 MB |
| 2 | 17.2 → 18.6 ms | 552.8 → 608.3 MB | 588.0 → 604.4 MB |

All runs reported zero board findings. The marker change removes redundant
drawing commands. Whole-browser memory did not improve consistently and
remains above 500 MB after reopening the classroom board.

### XML attribute whitespace on open

The shared XML loader skips the attribute rewrite for markup without
literal tabs or line breaks. For quoted attributes with that whitespace,
it still preserves those characters as XML references. Comments, CDATA
and text keep their existing behavior.

Three isolated Node profiles per build opened the classroom board and
initialised its undo history. Sampled allocations fell from 45–46 MB
to about 40 MB. Two production filesystem pairs each opened the board
twice. The second pair ran the new build first. Memory values are sampled
whole-browser proportional memory in decimal megabytes.

| Pair | Second-open time, previous → new | Second-open check peak, previous → new | Repeat check peak, previous → new |
| --- | ---: | ---: | ---: |
| 1 | 1,189 → 1,175 ms | 563.4 → 565.5 MB | 564.0 → 571.7 MB |
| 2 | 292 → 1,176 ms | 563.2 → 571.0 MB | 569.0 → 567.5 MB |

Every measured open was within three seconds and all classroom checks
reported zero findings. Peak browser memory and open times varied between
pairs. The measured gain is in allocation volume, and the reference
school laptop qualification remains open.

All 156 PCB tests, 14 focused schematic and XML tests, and five
browser workflows passed. The seven reference boards produced identical
native and manufacturing files. Reports matched after timestamp
normalisation. Gerbonara independently read back the classroom release.

### Classroom open timing

The production runner now times a file open from the Open menu click
inside the page to the first animation frame with the named PCB active
and its drawing visible. It records the automation elapsed time
separately as `openHarnessMs`. Benchmarks use an English browser context
for their command locators. This timing series uses a different start and
completion observation from earlier entries.

Two production filesystem pairs opened the 2,000-track classroom board
twice in one browser context on the development host. The second pair
ran the new XML loader first. The in-page and automation elapsed times
were as follows.

| Build and run | First open | Second open | Automation elapsed, first / second |
| --- | ---: | ---: | ---: |
| Before XML whitespace change, 1 | 261 ms | 262 ms | 1,183 / 1,181 ms |
| After XML whitespace change, 1 | 256 ms | 232 ms | 1,175 / 274 ms |
| Before XML whitespace change, 2 | 262 ms | 247 ms | 1,176 / 1,160 ms |
| After XML whitespace change, 2 | 288 ms | 253 ms | 1,211 / 1,183 ms |

All eight in-page opens were under 300 ms. The earlier differences in
automation elapsed times overstated the differences observable in the
editor. Both new-build repeat checks remained above 500 MB of sampled
whole-browser proportional memory at 563–566 MB.

A direct PCB startup run measured 292 ms and 231 ms for the two file
opens. Whole-browser proportional memory peaked at 447.3 MB on the first
design check, 504.6 MB after the second open, and 508.9 MB on the repeat
check. The production runner also reopened an embedded STEP board and
saved a CAM preview, a manufacturing review, and a KiCad bundle. The
KiCad bundle members matched the independently checked export.

### Spatial searches during PCB checks

The copper clearance and zone width checks share a bounds tree. Its
search now walks branches and leaf entries directly, with the previous
visit order and comparison limits. The zone width checks also reuse the
candidate list between edges. The 156 PCB tests passed. Design-check
reports and CAM member bytes matched across references A–F and J after
excluding the report generation time.

Three isolated Node profiles per build checked the classroom board.
Sampled allocation volume fell from 90.9–95.9 MB to 85.4–88.3 MB,
including objects collected during the check. All six checks returned
zero findings.

Each production Chromium run cycled through the workspaces, opened the
classroom board twice under separate filenames and ran a third check on
the second open board. Values are peak sampled whole-browser proportional
memory in MB. The first two pairs overlapped other verification on the
host. The third pair ran on its own.

| Pair | Prior first / second / repeat | Updated first / second / repeat |
| --- | ---: | ---: |
| 1 | 511.3 / 588.1 / 578.9 | 518.1 / 559.3 / 555.4 |
| 2 | 500.4 / 566.0 / 571.3 | 490.6 / 563.7 / 565.5 |
| 3 | 491.0 / 557.5 / 560.8 | 491.4 / 561.8 / 558.5 |

The isolated browser pair took 475 / 513 / 518 ms before and
464 / 465 / 493 ms after. Every production run recorded zero findings,
workspace errors or unexpected cold assets. Memory stayed above 500 MB on
the second open and repeat checks in all three runs of the updated build. The laptop
gate still requires a run on the specified hardware.

### Placed-pad SVG geometry

The PCB view and footprint preview share SVG rendering for pad polygons,
circles and round-ended lines. The classroom board draws all 500 copper
lands from their placed shapes and skips tessellating 60,000 rounded
copper vertices in the renderer. Both views reuse the pad-shape bounds
for framing. Physical calculations continue to use tessellated polygons.
Matching through-hole lands share a polygon in physical calculations
while retaining their distinct copper layer and feature identities.

Three isolated profiles of classroom placement geometry sampled
6.8–7.1 MB of allocations before and 1.7–1.8 MB after. All 156 PCB tests
and seven browser scenarios passed. The production Electron editor
reopened and saved the offline portable board. Reports and CAM members
matched on references A–F and J, with separate Gerbonara read-back of the
LED release and the rotated connector preview.

Two production Chromium pairs ran the workspace-switch and inspection
sequence, opened the classroom board twice, then repeated the design
check. Whole-browser proportional memory peaks in MB were as follows.

| Pair | Prior first / second / repeat | Updated first / second / repeat |
| --- | ---: | ---: |
| 1 | 509.9 / 579.4 / 584.0 | 464.0 / 540.7 / 541.8 |
| 2 | 514.6 / 563.1 / 563.4 | 466.9 / 544.5 / 546.1 |

The first checks dropped below 500 MB in both pairs. The repeat peaks
fell by 42.2 MB and 17.3 MB. The updated build opened the second board
in 200–220 ms, measured from the Open command to the visible drawing.
The runner reported zero findings, workspace errors or unexpected cold
assets in all four runs.

A separate run entered PCB Design directly. Its first, second and repeat
checks peaked at 438.6 / 479.3 / 486.4 MB. The full workspace-switch sequence
still exceeded 500 MB on repeated checks on this development host.

### Shared ruler tick painting

Circuit Design and PCB Design now submit one canvas stroke per ruler
redraw. Chromium replayed fit, zoom, pan and resize on a voltage-divider
schematic and the classroom PCB. The fitted horizontal PCB ruler went
from 172 strokes to one. The tick positions and all 16 horizontal and
vertical canvas captures matched the previous build pixel for pixel.
The browser checked both pointer markers, repeated pan and zoom, ruler
toggle, KiCad footprint import and the classroom release. Gerbonara
independently read back the released LED artwork and drills.

Two production Chromium pairs repeated the full workspace sequence.
Repeat-check peaks were 490.0 and 553.1 MB before the change and 549.1 and
556.2 MB after it. Memory was already lower in the first prior-build run
before the classroom board opened. The runs establish fewer canvas
stroke calls and leave the effect on whole-browser memory uncertain.
Pan callback P95 stayed at 16.67 ms in all four runs.

### Copper connectivity allocations

Copper extraction reuses the bounds from its contact sweep. Plated
openings reuse one list of touching fragments, and terminal groups grow
without copying their previous members. Refill and airwires also reuse
uncut convex copper for physical islands, including pad lands. Rings
with cutouts, possible drill clipping, or near-coincident vertices still
go through the polygon kernel. The design check keeps the kernel's
winding and start vertex for its diagnostic geometry.

Three isolated classroom profiles per build sampled 85.4–90.0 MB of
design-check allocations before the change and 77.6–80.8 MB afterward.
Refill and airwire allocations fell from 40.1–41.6 MB to 31.1–32.4 MB.
These samples include objects collected during the measured jobs.
All 156 PCB tests and the five offline browser scenarios passed.
Independent CAM read-back verified the classroom LED and both regulator
cases. References A–F and J had matching fills, airwire endpoints,
clearances, design-check results and CAM files before and after the change.

Two production Chromium pairs cycled through the workspaces and opened the
classroom board twice. Repeat-check whole-browser peaks were 546.2 and
542.5 MB before the change and 562.2 and 546.7 MB afterward. The browser
started each updated repeat check at a higher baseline. Memory rose by
3.1 and 5.5 MB during those checks, compared with 9.0 and 7.9 MB before.
Whole-browser peaks remained above 500 MB. All four runs returned zero
findings and workspace errors.

### PCB history across edits

Each PCB revision still passes board validation. Its snapshot reuses
unchanged, already-frozen subtrees and copies new fields in canonical
order. A subtree moved to a deeper path is checked against the nesting
limit at that path. Route and track-edit replies carry the changed
routing fields so the renderer can retain the rest of the board snapshot.

Forty single-track edits to the classroom board retained 22.6 MB of
additional Node heap before the change and about 0.9 MB afterward in
three runs per build. The edit replay exercised PCB history directly.
Undo restored each track width, and redo yielded byte-identical native
files between builds. All 157 PCB tests passed, including checks for
external object mutation, nesting and Undo or Redo.

In a separate route on the bottom connector board with an embedded STEP
model, Node serialization of the worker result fell from 32,626 to 344
bytes. Assembling the returned routing fields with the original snapshot
produced identical native board bytes to serializing the full result.

The seven reference boards produced byte-identical native and CAM files
after an edit and undo. Their reports matched after excluding the generation
timestamp. Six browser scenarios passed, including route creation,
track and via edits, recovery and save/reopen. Gerbonara read back the
browser's classroom LED release and bottom connector preview.

A production Chromium pair cycled through the workspaces and opened the
classroom board twice. Whole-browser design-check peaks were 505.4 /
557.2 / 554.4 MB before and 469.9 / 546.5 / 551.7 MB after. The second
open took 206 ms before and 205 ms after. Both runs returned zero findings
and workspace errors. The repeat check still exceeded 500 MB on this host.

### Routing edits across the worker boundary

Route creation, rerouting and track edits now return removed track IDs,
added tracks, and any new vias. The worker validates clearance and board
structure and checks that reroutes and track edits preserve attached copper.
The editor applies them to the same snapshot it sent and commits through
the existing revision check and Undo history. Existing tracks, vias and
embedded assets can be shared by subsequent revisions.

Three Node replays per reply format committed 20 short routes to a board
with 2,000 existing tracks. Serializing the complete routing collections
took 347,856–351,086 bytes per reply. Serializing the changes took 241
bytes per reply. Retained heap over the starting board fell from 21.9 MB
to 4.0 MB. Each replay verified Undo, Redo and native reopen.

Two production Chromium pairs entered ten routes through the editor's
coordinate controls, then used Undo, Redo, Save and Open to verify the
2,010-track board. JSON measurement of the received replies fell from
400,093–401,831 bytes to 300–302 bytes per route. Additional live renderer
heap after garbage collection fell from 7.59–7.62 MB to 3.52–3.60 MB.
These figures cover the edit sequence on the development host.

All 157 PCB tests and seven browser scenarios passed, including delayed
reply cancellation, track and corner edits, branch routing, through-via
placement, and recovery. Gerbonara independently verified the classroom
LED release and the bottom connector preview.

Route cleanup uses the same board snapshot in the editor. The worker
returns the removed track IDs, replacement tracks and loop-preview
geometry. The editor retains the source board's assets, vias, unchanged
tracks and ordering. The Chromium test inspects the worker reply and
checks cancel, apply, Undo, Redo and native save with an embedded STEP
asset. [Routing cleanup test](../scripts/tests/layout-browser/pcb-workspace.spec.mjs)

The separate production filesystem classroom workload used the same
Playwright headless Chromium before and after the change. The isolated
runs peaked at 495.1 and 500.1 MB whole-browser PSS during the repeat
design check. Both opened two boards, reported zero findings and closed
their PCB workers. This workload did not invoke route cleanup.

### Classroom presentation and edit feedback

The compositor probe uses presentation timestamps from completed
Chromium pipeline reports for the classroom page. Reports that share a
presentation timestamp count once. Dropped frames, other renderer
processes and presentations outside the marked workload are excluded.
Each workload changed the PCB viewport 120 times and received 118 unique
presentation timestamps in the two development runs.

| Development browser | Pan fps / interval P95 | Zoom fps / interval P95 | Feedback median / P95 | Commit median / P95 |
| --- | ---: | ---: | ---: | ---: |
| Headless, direct PCB entry | 59.4 / 22.3 ms | 57.0 / 28.3 ms | 19.4 / 24.7 ms | 311.6 / 369.4 ms |
| Visible Chromium on Xvfb, full workspace sequence | 59.0 / 24.6 ms | 58.0 / 22.4 ms | 24.3 / 29.8 ms | 345.7 / 404.9 ms |

Both runs used Chromium 158 and software rendering. All ten route edits
displayed the checking message before commit and were then undone.
A repeat of the direct run measured 59.0 fps in pan, 58.9 fps in zoom,
and 17.9 ms P95 for feedback across five more route edits.
The full workspace sequence also sampled a 778 MB repeat-check peak on the
virtual display after two opens. The published laptop and its integrated
graphics still require their own measurements.

All 159 PCB tests and four browser scenarios passed. The delayed-worker
cases verified that route and track edits show the pending message and
that cancellation removes it without applying the edit. Gerbonara
independently read back the classroom release.

### Large-coordinate PCB rendering

Chromium capped large SVG length attributes and transform translations at
about 33.55 million SVG units. When the drawing used raw nanometres for
those values, pads, vias and footprint labels could collect near that
coordinate instead of appearing where placed.

Native SVG lines, circles and rectangles now use micrometre lengths with
a scale that maps them back to the drawing. Placement and text
translations use numeric SVG matrices. Board storage, snapping and
manufacturing geometry continue to use nanometres. The editor reuses
base track elements for copper that a local edit leaves intact.

Production Chromium screenshots of the 100-component classroom board
showed pads, vias and labels distributed across the board at standard and
narrow window widths and in forced colors. The rendered endpoints, widths
and colors of all 2,000 tracks agreed with the prior path rendering in
each view. The browser regression shifts the board across the origin,
checks the drawing at both ends, and selects a far track by clicking its
rendered position.

After the correction, production Chromium gave these development-host
results on the classroom board. All runs reported zero design-check
findings and workspace errors. Chromium used software rendering.

| PCB entry | Pan fps | Zoom fps | Before classroom open PSS | Repeat design-check peak PSS |
| --- | ---: | ---: | ---: | ---: |
| Headless, direct | 59.4 | 58.3 | 180 MB | 438 MB |
| Visible on Xvfb, direct | 59.4 | 58.9 | 463 MB | 721 MB |
| Visible on Xvfb, after workspace switching and 3D inspection | 54.9 | 52.7 | 569 MB | 761 MB |

The two direct runs each grew about 258 MB between the pre-open sample
and the repeat design-check peak. The 283 MB gap between the headless and
visible direct runs was already present before opening the board. Both
visible-window runs exceeded the 500 MB target. Reference-laptop
qualification remains open.

### Full Chromium launch comparison

With the same full Chromium executable and direct PCB entry, the headless
run used 387 MB before opening the board and peaked at 650 MB during the
repeat check. The visible run on Xvfb used 457 MB before opening the board
and peaked at 733 MB. Both ran two classroom opens, reported zero findings
and workspace errors, and presented pan and zoom at 58.9–59.2 fps.

Using the same executable reduced the observed gap at the repeat-check
peak to 83 MB. The reference laptop’s integrated GPU and stable browser
still need their own acceptance measurements.

The production filesystem run with workspace switching, 3D inspection,
connector CAM and KiCad export reached 843 MB PSS in the classroom repeat
check. All six entries completed, and the classroom checks reported zero
findings. Recalculating the run summaries from the raw process samples
reproduced the reported peaks. Gerbonara independently read the
connector preview.

### Clipper polygon ring transfer

The polygon kernel now validates each ring and writes it in the required
winding order directly into the coordinate buffer. A reversed ring uses
the same coordinates in reverse order. An empty clip set skips the
temporary native path, and a single output ring needs no hole-assignment
arrays. The test suite exercises reversed outlines and holes at the
coordinate limit and verifies that a rejected input leaves the next
operation usable.

Across three isolated Node profiles per build, sampled allocations for
one classroom design check fell from 78.2–82.5 MB to 74.8–75.7 MB. All
six checks reported zero findings. The samples include allocations
collected during the check.

The seven reference boards produced matching design-check reports apart
from timestamps and byte-identical CAM files. All 159 PCB tests,
five browser workflows and the production Electron offline open/save
test passed. Gerbonara independently read the classroom LED, connector,
RC filter and regulator outputs from the browser workflows.

Two visible Chromium pairs opened the classroom board twice and repeated
the design check. The second pair ran the new build first. Whole-browser
proportional memory peaks during the repeat check were 714 → 722 MB and
725 → 715 MB. Repeat-check time was 510 → 490 ms and 479 → 485 ms. Browser
memory stayed above the 500 MB target in all four runs.

### Memory after replacing and closing a PCB

The visible Chromium retention run opened six copies of the classroom
board under different filenames in Single File mode. Each open completed
selection, routing preview, refill and a design check. All six reported
zero findings and exactly 7,122 live DOM nodes after garbage collection.
There were no PCB workers at those checkpoints. After switching to
Circuit Design, the node count fell to 596. The runner then returned to
the last board, verified all 2,000 tracks and explicitly closed it.
The count returned to 596 with no PCB worker.

| After garbage collection | Live renderer JS heap | Whole-browser PSS | Anonymous PSS | File-backed PSS | Shared-memory PSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before opening the classroom board | 9 MB | 448 MB | 162 MB | 253 MB | 33 MB |
| After the first design check | 16 MB | 554 MB | 250 MB | 267 MB | 37 MB |
| After the sixth design check | 18 MB | 569 MB | 264 MB | 267 MB | 38 MB |
| Circuit Design with the board still open | 16 MB | 561 MB | 240 MB | 271 MB | 50 MB |
| Circuit Design after closing the board | 15 MB | 537 MB | 213 MB | 271 MB | 53 MB |

The five local route edits showed feedback within 18 ms and committed
within 249 ms. The report uses the visible drawing and confirmed route
waypoints before starting that probe. The highest sampled browser PSS
was 722 MB during the sixth design check. Closing the board released its
drawing and some process memory. The remaining PSS includes the warmed
browser, renderer and graphics resources on this development host.

### PCB worker memory at check completion

The production filesystem build ran two classroom board opens in a
visible Chromium window on Xvfb. A separate design check sampled the
worker before termination. It recorded 28.2 MB of live V8 heap, 51.2 MB of
V8 heap capacity and 16.9 MB of Clipper WASM capacity, with zero findings.
The worker closed before the retained Circuit Design snapshot. The two
ordinary classroom workloads in the same run peaked at 689 MB
whole-browser PSS. The worker completion counters use different scopes
from PSS. Dedicated GPU memory remains outside these measurements.

### Drill candidates during copper extraction

Copper extraction allocates a cutter list only when the copper bounds
meet a drill or slot. It scans the existing drill array directly and
compares contact pairs without unpacking them through iterators. It keeps
the same drill order, intersection rules and contact ordering.

Across three isolated Node profiles per build, sampled allocations for a
classroom design check fell from 71.1–76.7 MB to 66.9–68.0 MB. The refill
and airwire workload fell from 29.0–32.6 MB to 26.4–26.7 MB. The profiles
include allocations collected during each workload.

All seven reference boards produced matching fills, airwires and
design-check reports apart from timestamps. Their CAM files were
byte-identical. All 159 PCB tests, four Chromium workflows and the
production Electron offline open/save test passed. Gerbonara independently
read the classroom LED, connector and regulator files generated by the
browser.

Two visible Chromium pairs each opened the classroom board twice and
repeated the design check. The second pair ran the new build first.

| Pair | Repeat check before → after | Repeat-check PSS before → after |
| --- | ---: | ---: |
| 1 | 655 → 476 ms | 730 → 733 MB |
| 2 | 488 → 450 ms | 732 → 735 MB |

Worker V8 heap capacity at a separate check completion fell from
50.9–51.6 MB to 43.5 MB in these pairs. Clipper still reserved 16.9 MB.
Whole-browser PSS stayed above the 500 MB target.

### Production desktop and browser process memory

Two native Electron 44.9.0 runs and one full Chromium run used the same
classroom board on the Linux development host. Each opened two local
copies and completed refill, routing preview, cancellation and repeated
design checks. All opens drew 100 components, 2,000 tracks, 50 vias and
four zones. The checks reported zero findings and no PCB worker remained
after returning to Circuit Design.

| Run | Content viewport | Before open PSS | Repeat design-check peak PSS | Circuit Design after collection PSS |
| --- | ---: | ---: | ---: | ---: |
| Electron 44.9.0, first | 1200 × 773 | 327 MB | 638 MB | 449 MB |
| Electron 44.9.0, repeat | 1200 × 773 | 351 MB | 618 MB | 438 MB |
| Chromium 158 | 1920 × 1080 | 461 MB | 725 MB | 507 MB |

The runs used different Chromium versions and viewport sizes on a
virtual display, with software rendering. Electron exposed its graphics
feature status and device IDs. Its renderer string was unavailable in
that environment. The browser run exceeded the 500 MB target. Reference
hardware acceptance remains open.

### Reusing PCB connectivity results

Physical connectivity supplies the bare-copper graph when the board has
no net ties. A separate assembled graph is needed only for fitted
assembly links. The checker still validates declared links and measures
isolated point contacts. It also skips the fragment lookup when the
board has no findings or floating fragments to describe.

Three isolated Node profiles per build sampled 67.3–68.2 MB of
allocations for one classroom design check before the change and
64.9–66.0 MB afterward. The figures include allocations collected
during the check.

All seven reference boards produced identical CAM files and matching
design-check reports apart from timestamps. All 159 PCB tests, five
browser workflows and the production Electron offline open/save test
passed. The browser workflows included the single-sided timer with a
fitted jumper. Gerbonara independently read the LED, filter and
regulator outputs.

One production Chromium pair repeated the check after two classroom
opens. The before and after peaks were 732 and 734 MB PSS. The repeat
checks took 464 and 502 ms respectively. This pair remained above the
500 MB memory target.

### Timer CAM export

A CPU profile of CAM preparation for the single-sided Timer board showed
that Gerber ring ordering, copper-boundary contact tests, and boundary
distance calculations dominated the run. Use bounding boxes before exact
ring-inclusion and line-segment tests. Keep the same nearest-edge distances,
contact predicates and Gerber paint order for the candidate geometry.

On the Linux development host, instrumented Node runs measured 33.5 seconds
before the change and 3.2 seconds after it for the Timer CAM task. A second
run while the browser build and suites were active took 6.2 seconds. In the
first pair, the MCU sensor CAM task fell from 6.3 seconds to 0.9 seconds.
These runs measure CAM generation and read-back on the saved boards. They
exclude opening the editor and drawing the preview.

The geometry regression checks a 1 nm gap, shared edge and overlap inside
a dense cutout. The existing nested Gerber fixture checks dark copper
inside a cleared ring. [Geometry tests](../scripts/tests/pcb-geometry.test.mjs)
