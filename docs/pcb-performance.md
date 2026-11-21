# PCB classroom performance

The production browser runner measures the classroom workload from [§27.1](TinyCAD_PCB_Layout_Complete_Specification.md#271-proposed-measurable-performance-targets). The generated board has 100 components, 500 pads, 2,000 tracks, 50 vias and four zones. Its filenames vary between opens so that each warm sample reads and parses the board again.

```sh
npm run build:fs
node scripts/pcb/classroom-fixture.mjs build/classroom.dpn
node scripts/pcb/qualify-workspaces.mjs dist build/qualification/classroom.json \
  --classroom-board=build/classroom.dpn --classroom-samples=10 --cold-samples=10
```

For the reference laptop, use the hardware record described in the [WP1 benchmark](pcb-g0.md#reference-laptop-run) and add `--headed --channel=chrome` or `--headed --channel=msedge` to run the locally installed stable browser. The JSON records the exact browser version, graphics renderer, available CPUs and viewport. It keeps the raw durations, renderer heap samples, resource requests and live worker URLs.

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

The reference-school-laptop budget still needs its own cold and warm results, process and worker memory, GPU evidence where available, continuous pan and zoom presentation rate, local edit feedback, and worker stop timing. The table above records UI cancellation latency and point-to-point zoom updates. Renderer V8 heap excludes browser process RSS, worker heaps and GPU memory.
