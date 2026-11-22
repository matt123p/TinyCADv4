# Buffered op-amp filter reference

Open [Filter.tcproject](Filter.tcproject) and select [Filter.dzn](Filter.dzn) or [Filter.dpn](Filter.dpn) in the project tree. The project associates one schematic with a 46 × 38 mm, two-layer PCB. [Schematic preview](Filter.svg)

R1 (10 kΩ) and C1 (100 nF) make the low-pass node **RC**. The LM741CN buffers **RC** to **OUT** at unity gain. C2 and C3 are 100 nF bypass capacitors for the two supply rails. J1 pins 1 through 5 carry **IN**, **OUT**, **+12V**, **−12V**, and **0**, respectively. The schematic uses bundled SPICE essentials artwork for the passives and the 741 body. The LM741CN retains its eight physical pins, with offset-null pins 1 and 5 and NC pin 8 marked intentionally unconnected. [TI LM741 PDIP pin table](https://www.ti.com/lit/ds/symlink/lm741.pdf#page=3)

## Trace the signal

In the **Low-pass AC response** sheet, run AC analysis and compare **RC** and **OUT**. The saved gain and phase measurements evaluate the expected 159.15 Hz corner. Bundled ngspice measured −2.99 dB and −44.89° at 158.49 Hz, the nearest sampled frequency. The circuit uses an illustrative single-pole small-signal op-amp model, an ideal generator and ideal split supplies at J1. Bench measurements and hardware qualification remain separate.

From the board's actions menu, choose **Cross-probe schematic…** and select **R1 pad 2**. The schematic selects R1 and highlights its pin 2. Choose **Find in PCB…** and **Show net on board**. The PCB highlights both RC tracks and lists C1 pin 1, R1 pin 2 and U1 pin 3 under **Schematic net terminals**.

## Rebuild and check manufacturing geometry

With the bundled native ngspice engine built, run the generator from the repository root. It regenerates the board and verifies exact pin membership, PCB pad sources, copper connectivity and the saved AC analysis.

```sh
node scripts/pcb/filter-reference.mjs examples/pcb/op-amp-filter/Filter.dzn build/qualification/filter
```

The offline browser acceptance test downloads `filter-cam-preview.zip`. With Gerbonara 1.6.3 installed, run the checker against that bundle. It checks the two copper layers, all 21 plated holes and the locations of the three RC terminals.

```sh
python3 scripts/pcb/check-cam-preview.py --filter path/to/filter-cam-preview.zip
```

## Symbol sources and schematic checks

| References | TinyCAD public symbol and source |
| --- | --- |
| U1 | 741, symbol 169 and name 9288, matt. Kept the triangular artwork, corrected electrical pin types, and added the unused PDIP leads from the TI pin table. |
| R1 | R, symbol and name 94, matt. |
| C1–C3 | C, symbol and name 69, matt. |
| J1 | Pin 5x1, symbol 700 and name 9834, a100n. Completed the missing pin 5 name and used the same pin-number visibility as the other four pins. |

The native generator verifies the six schematic nets and all three no-connect markers after reopening the drawing. The public TinyCAD validator used for the artwork reports three power-marker ERC diagnostics on split-supply and return nets and five layout-envelope diagnostics near pin exits and annotations. Its tidy passes preserved physical and logical connectivity through serialization. The public validator used the schematic artwork with PCB identity attributes stripped to fit its schema. The saved native drawing retains those attributes, and the offline project test verifies their use.
