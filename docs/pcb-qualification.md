# WP6 physical and usability qualification

Use this record with the [PCB qualification requirements](TinyCAD_PCB_Layout_Complete_Specification.md#285-output-and-physical-qualification). The packet contains digitally checked fixtures. Physical fabrication, assembly measurements, and observed sessions remain pending.

## Fabrication and assembly

Record the build, board ID, revision, archive SHA-256, chosen process, fabricator, and lot for every specimen. Confirm the actual package and finished-board requirements against the CAM artefacts before ordering. Record either the two independent fabrication results or equivalent independent CAM acceptance and one physical fabrication route, as specified in §28.5. Keep the fabricator’s acceptance with the archive it assessed.

| Fixture | Packet contents | Physical checks |
| --- | --- | --- |
| A · Classroom LED | The frozen manufacturing release produced by the offline browser exercise. The native board, fabrication drawing, BOM, assembly drawings, and checked Gerbers and drills are inside that archive. | Confirm a 40 × 22 mm board, six plated round holes, and part fit. Check J1 pin 1, the LED cathode, and the resistor pitch before soldering. Verify the bare net graph and then check the completed 5 V indicator. [LED lesson](../examples/pcb/led-classroom/README.md) |
| D · SMT regulators | The frozen manufacturing release for the unpowered 40 × 24 mm coupon. The baseline preview and clipped-thermal comparison are retained as digital evidence. | Check pin 1 orientation, both package pitches, the exposed land, paste alignment and bridges. Test the bare copper, record the visible joints and the method used to assess the exposed pad joint. This coupon uses test traces. Perform its electrical checks unpowered. [Regulator reference](../examples/pcb/regulator/README.md) |
| E · Bottom connector | The native board, independently read CAM preview, manufacturing review and supplier cover sheet. Use the review archive’s SHA-256 in the fabrication record. Obtain process acceptance for the three finished 1.00 × 1.60 mm plated slots. | Verify that the actual jack sits on the bottom in the documented orientation. Measure the axes and finish of all three plated slots, fit the jack without force, and check the two non-plated mounting holes and clearance below the board. [Connector reference](../examples/pcb/connector/README.md) |

Record actual board and hole dimensions and the units and resolution of the measuring instrument. Record mask registration, silk readability and bottom-side orientation against each applicable drawing. Include photographs or inspection evidence and identify any deviations by board revision and specimen.

### Fitted parts

Use the fitted BOM in each archive. The packet index records the manufacturer
and part number from the same BOM. Record the actual part and lot when a
marking or package label provides it. Dry fit before soldering and record the
fit and orientation for each reference.

| Fixture and reference | Manufacturer and part number | Check against the board |
| --- | --- | --- |
| A · J1 | JST `B2B-XH-A(LF)(SN)` | Two-position vertical XH header without a boss, 2.50 mm pitch and Ø1.00 mm holes. Align pin 1 with the board marker when viewed from the mounting side. [JST XH drawing](https://www.jst-mfg.com/product/pdf/eng/eXH.pdf) |
| A · R1 | YAGEO `MFR-12FTF52-330R` | 330 Ω, ±1%, 1/6 W axial resistor. Form the straight leads to the board's 7.62 mm spacing before insertion. The specified 0.45 ± 0.05 mm lead diameter fits the nominal Ø0.80 mm holes. [YAGEO MFR dimensions](https://yageogroup.com/content/Resource%20Library/Datasheet/YAGEO-MFR_DATASHEET.pdf) |
| A · D1 | Kingbright `WP7113ID` | Match the cathode to D1.1. The datasheet layout calls for 2.54 mm pitch and Ø0.90 mm holes. [Kingbright package drawing](https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf) |
| D · U1 | Diodes Incorporated `AP2112K-3.3TRG1` | Check the five-lead SOT25 against the 0.95 mm pitch and the pin 1 marker. [AP2112 datasheet](https://www.diodes.com/datasheet/download/AP2112.pdf) |
| D · U2 | Texas Instruments `TPS7A7002DDA` | Check the DDA package, 1.27 mm lead pitch, pin 1 and the exposed PowerPAD. [TI package drawing](https://www.ti.com/lit/ds/symlink/tps7a7002.pdf) |
| E · J1 | Same Sky `PJ-102A` | Check the jack's three tapered terminals against the finished plated slots and verify it seats on the bottom. [Same Sky PCB layout](https://www.sameskydevices.com/product/resource/pj-102a.pdf#page=2) |

### Electrical checks

Check continuity and isolation before mounting components. Record the meter setting, test points and readings. Use at least one accessible point from each intended copper group to test isolation between groups. Record any inaccessible test point and the method used to inspect it.

| Fixture | Expected bare-board continuity |
| --- | --- |
| A | J1.1 to R1.1, R1.2 to D1.2, and J1.2 to D1.1. The three groups are isolated on the bare board. |
| D | U1.1 to U1.3, U2.2 to U2.3, and U1.2 to U2.8 and U2 PowerPAD through the bottom ground plane. Check each of the three ground vias from both sides. Check U1.5, U2.6 and U2.7 to their respective output or feedback traces. The six named net groups are isolated from one another. U1.4 and U2.1, U2.4 and U2.5 remain unconnected. |
| E | Each plated slot connects its top and bottom lands. The three slots are isolated from one another on the bare coupon. Verify the installed jack against the vendor’s contact and switch diagram in both insertion states. |

After assembling A, apply regulated 5 V at J1 with pin 1 positive. Record supply voltage, whether the LED lights, its forward voltage and the series current. The simulation reference is approximately 1.903 V and 9.39 mA at 330 Ω. Use the fitted LED and resistor specifications when interpreting measured values. If any specimen differs from the intended graph or fit, record the cause, fix it where applicable and repeat the affected checks.

## Observed usability sessions

Use a fresh copy of the worksheet’s `exercise` folder for each participant. Use the same build, initial drawing and task prompt for novice and experienced participants. Record the actual app build, platform, cohort and duration of the standard introduction. Five novice sessions are required to evaluate the proposed four-of-five completion target. Record the experienced cohort size separately.

Give participants the task prompt and the built-in **First board guide**. Keep the routed reference and the checks below with the observer. Record every intervention, and count a novice as completing the task only if they obtain a valid release without an intervention that fixes their board.

**Participant task.** Open the supplied LED project. Place and connect the three components, save the board, run design checks and export a manufacturing release. Use the built-in help if needed.

Start timing when the participant receives the task in the open application.
Record the time of each candidate release download and retain its archive
with a copy of the PCB file saved at that point. After the session, check
each candidate in order. Use the first verified download for the
completion time. If none passes, record the session duration and furthest
step. Run the verifier from the repository root with Gerbonara 1.6.3.

```sh
python3 scripts/pcb/check-cam-preview.py --classroom-session-board session/LED.dpn \
  session/pcb-release.zip > session/independent-cam.json
```

The verifier matches the archived native board to the saved file, checks
the archive hashes and release evidence, and reads the plated lands and
copper to confirm the three terminal groups. Pad positions come from the
saved footprint placements, so the session can use different legal
placements and routes. Record the result and `releaseSha256` with the
participant code.

Record completion, time to first valid release, mapping mistakes, unrecovered editing errors and misunderstood checks. Record the step at which any issue occurred and the participant’s interpretation before giving help. Leave outcomes blank until observed. Use participant codes in the qualification record.

## PCB drawing accessibility

The PCB SVG uses the system canvas, foreground and highlight colors in
forced-colors mode. The populated classroom board was checked in Chromium
with light and dark forced palettes. Its outline, copper, drilled openings,
reference labels and selected net followed the active palette.

Blocked previews use a dashed stroke and an × at the route endpoint. The
clear preview uses a solid stroke. The browser test exercised a routing
region with forced colors enabled, verified both preview states and saved
the resulting legal track. Three other browser scenarios covered selection,
shared-editor navigation and the offline LED exercise. The native Electron
portable-board smoke test passed in its normal palette. This evidence
covers the drawing and route feedback requirements in
[§27.4](TinyCAD_PCB_Layout_Complete_Specification.md#274-accessibility-and-internationalisation).

## PCB findings keyboard access

The design-check controls, severity and coverage labels and measurements
follow the selected TinyCAD language. A 900 × 700 Chromium check exercised
German labels, the accessible severity description and a 0,8 mm routed
cutout finding. The saved report retained 800,000 nm and the canonical
severity and message. All nine supported locales contain the 45 strings
and their interpolation fields. Detailed finding messages and coverage
explanations retain the diagnostic engine’s wording.

The design-check dialog presents a findings table with severity and finding
columns. Each finding button exposes its severity as an accessible description.
At 900 × 700 in Chromium, the cutout test used Enter to open design checks,
Tab to reach the finding and its details, and Enter to locate the cutout and
return focus to the board drawing. The cutout kept its manufacturing release
block. Gerbonara independently read its 0.8 mm width against the 1 mm minimum.

The standalone board test verified that a waiver opens with focus on its reason
field. Cancelling restores focus to the waiver button. Saving moves focus to
Close while the report refreshes. The desktop renderer and mocked Drive
workflows exercised schematic cross-probing and parity findings in the table.

## Independent CAM evidence

The packet index covers the seven M1 reference boards A, B, C, D, E, F and J.
Each entry identifies the archive hash, board revision and corresponding
Gerbonara report. The reports include the plot roles, mask polarity, drill
plating, object counts and bounds for every supplied fabrication layer,
alongside each fixture's geometric checks. B, C, F and J are diagnostic
previews in `digital-evidence/`. J retains its intentional short, contact
and narrow-web findings.

## Reproduce the digital packet

Run from the repository root with the project's Playwright Chromium installed and Gerbonara 1.6.3 available to Python. Use a new output filename for each packet.

```sh
npm run test:layout:browser -- pcb-workspace.spec.mjs project-hierarchy.spec.mjs \
  --grep 'classroom LED exercise|checks both regulator packages|asymmetric connector|single-sided timer and logic reference|simulated RC node|copied MCU and sensor schematic|adversarial geometry reference' \
  --output .tmp/wp6-packet
npm run build:fs
node scripts/pcb/qualify-workspaces.mjs dist build/qualification/wp6-packet-workspaces.json \
  --cam-board=examples/pcb/connector/Connector.dpn \
  --cam-bundle=build/qualification/wp6-connector-source.zip \
  --release-review=build/qualification/wp6-connector-review.zip
python3 scripts/pcb/package-wp6-qualification.py .tmp/wp6-packet \
  build/qualification/wp6-connector-source.zip build/qualification/wp6-qualification-packet.zip \
  --connector-review build/qualification/wp6-connector-review.zip
```

The [packet builder](../scripts/pcb/package-wp6-qualification.py) runs the independent [CAM checker](../scripts/pcb/check-cam-preview.py), verifies archive status and hashes, and bundles the checked outputs, exercise, and blank qualification records. Verify an extracted packet with `sha256sum -c SHA256SUMS` from its root. Use the [reference laptop procedure](pcb-performance.md#reference-school-laptop) for the performance gate.
