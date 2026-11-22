# Timer and logic reference board

Open `Timer.tcproject` in TinyCAD. The schematic and single-sided PCB contain six physical components. Four schematic gates share one U2 package. The board embeds the footprints, device mappings and STEP models. Copy the folder before making edits.

| Reference | Part | Fixture function |
| --- | --- | --- |
| U1 | TLC555CP, PDIP-8 | Trigger and threshold share the input. RESET is tied high. The timer output feeds the NAND stage. |
| U2 | SN74HC00N, PDIP-14 | Gate A inverts the timer output. Gates B–D have grounded inputs and unconnected outputs. Pin 14 joins VCC and pin 7 joins ground through the schematic's hidden-power convention. |
| J1 | JST B4B-XH-A, four circuits | Pins 1–4 carry 5 V, ground, input and output. |
| C1 | 10 nF, radial, 2.50 mm pitch | Bypasses the timer control pin. |
| C2, C3 | 100 nF, radial, 2.50 mm pitch | Decouple the two packages. |
| JP1 | Fitted wire link | Joins the TIMER copper islands. The drill file identifies its two holes as non-plated. |

The 555 is used as a Schmitt receiver. Its output and the two inputs of NAND gate A share the TIMER net. The fixture uses a 5 V supply and a common ground. Its capacitors come from the bundled SPICE essentials library. The bundled Digital logic NAND body retains the quad package’s physical pins and hidden power assignments. [TLC555CP pinout and electrical specifications](https://www.ti.com/lit/ds/symlink/tlc555.pdf) · [SN74HC00N pinout and electrical specifications](https://www.ti.com/lit/ds/symlink/sn74hc00.pdf)

## What to verify

- The schematic contains U2A through U2D. The PCB contains one U2 with fourteen pads. Both hidden power pins resolve to their intended physical nets.
- The board editor shows one copper layer and one fitted jumper. The PCB design check reports one intentional bare-copper open and zero assembled opens. Set JP1 to DNP to see the TIMER open in the assembled view.
- CAM contains a 76 × 48 mm outline, 32 plated component holes and two unplated jumper holes. The board is a digital acceptance fixture. Physical fabrication and electrical measurement are pending.

The schematic uses TinyCAD library artwork for the NE555 timer (symbol 755, name 9891), quad NAND (symbol 1, name 1), capacitor (symbol 69, name 69) and four-pin header (symbol 1194, name 10362). The timer pin labels and electrical types were adapted for TLC555CP. The connector pin stems face its body. The schematic uses a GND alias on net 0 so the legacy NAND power pin can retain its datasheet name.

The library validator reports legacy power and alias diagnostics and a multipart coverage diagnostic. The fixture generator checks the physical terminal membership and all four placed units independently. Layout cleanup preserved serialized connectivity and reported remaining annotation and symbol-envelope diagnostics.

## Regenerate and verify

```sh
node scripts/pcb/timer-logic-board.mjs examples/pcb/timer-logic/Timer.dsn /tmp/tinycad-timer-reference /tmp/tinycad-timer-cam
python3 -m zipfile -c /tmp/tinycad-timer-cam.zip /tmp/tinycad-timer-cam/*
python3 scripts/pcb/check-cam-preview.py --timer-logic /tmp/tinycad-timer-cam.zip
npm run test:layout:browser -- project-hierarchy.spec.mjs --grep 'single-sided timer and logic'
```

The CAM check uses Gerbonara 1.6.3.
