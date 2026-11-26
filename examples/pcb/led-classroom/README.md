# Classroom LED board

Open `Exercise/LED.tcproject` to place and route a 5 V LED indicator. The project contains the schematic and a two-layer board with the three device mappings already applied. Open `Reference/LED.tcproject` to compare with a placed and routed version. Copy the entire project folder before editing. The boards embed their footprints and STEP models for offline use.

| Reference | Part | Reference placement (X, Y, rotation) | Assembly check |
| --- | --- | --- | --- |
| J1 | JST B2B-XH-A, two-pin connector | 7 mm, 9 mm, 90° | Pin 1 is 5 V. Pin 2 is ground. Check the harness polarity before connecting it. |
| R1 | 330 Ω axial resistor, 7.62 mm lead spacing | 18 mm, 7.75 mm, 0° | Check lead fit at actual size. Either resistor orientation works. |
| D1 | 5 mm red through-hole LED, 2.54 mm lead spacing | 30 mm, 7.75 mm, 180° | Match the actual LED cathode to pad 1 and the marked end on the board. |

1. Open **LED.dzn** and trace the three nets. **5V** joins J1.1 to R1.1, **LED_A** joins R1.2 to D1.2, and **GND** joins D1.1 to J1.2.
2. Open the **LED operating point** sheet and choose **Run**. The two measurements show forward voltage and the series current through R1. The reference model gives about 1.903 V and 9.39 mA at 330 Ω. Change the **Value** field of R1 to `470` and run again. The current should drop to about 6.63 mA. Restore `330` before working with the reference PCB. The simulation uses TinyCAD’s built-in DC Source V1 set to 5 V and an illustrative red LED model. J1 is the physical power connector. R1 and D1 use artwork from the bundled SPICE essentials library. D1 retains the PCB footprint’s cathode on pin 1.
3. Open **LED.dpn**, then choose **First board guide** under **More PCB commands** to open the **First board guide**. Confirm the 40 × 22 mm outline and the classroom fabrication profile. Preview each footprint in **Unplaced components**, then use the coordinates in the table to place it on the top side.
4. Use 0.50 mm top-layer tracks. Join J1.1 to R1.1 and R1.2 to D1.2. Join J1.2 to D1.1 along the far side of those two tracks, with waypoints near (7, 16) and (31.25, 16) mm. The schematic labels this return `GND`, and the board lists it as net `0`.
5. Run design checks. Follow each finding to its object. Open **Fabrication → Manufacturing preview** and inspect both copper layers, the outline, and all six drill openings.
6. Print the assembly drawing at 100% and measure its 10 mm mark. Compare the actual parts against the printed pattern before ordering or assembling a physical sample.

The reference passes TinyCAD's implemented geometry, connectivity, parity, and fabrication checks. Its operating point was checked with the native ngspice engine. Physical board and print qualification are pending.

Regenerate the two folders and recheck their reference output from the repository root.

```sh
node scripts/pcb/led-classroom-project.mjs /tmp/tinycad-led-lesson
```

Add `--verify-native` when the native ngspice engine has been built. This also checks both measurements against the model and the 5 V supply.

## Verify the browser workflow

The browser acceptance test copies the lesson and completes it in a fresh Chromium session with network and library requests blocked. It saves the routed board and downloads its CAM preview. Gerbonara 1.6.3 checks the downloaded outline, six plated drills, top-layer connections, isolated bottom-layer lands, fitted components and file hashes. The read-back also checks that the assembly drawing marks the LED cathode and connector pin 1 and keeps the resistor unmarked.

```sh
npm run test:layout:browser -- project-hierarchy.spec.mjs --grep 'completes the classroom LED'
python3 scripts/pcb/check-cam-preview.py --classroom-led "$(find .tmp/layout-browser-results -name led-cam-preview.zip -print -quit)"
```
