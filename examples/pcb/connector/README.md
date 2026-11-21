# Bottom-side connector reference

Open [Connector.tcproject](Connector.tcproject) in Project mode or [Connector.dpn](Connector.dpn) directly in Single File mode. The 44 × 32 mm, two-layer test coupon isolates connector fit and orientation. J1 is a Same Sky PJ-102A switched DC jack. The board embeds the reviewed device, the footprint, and its generated STEP envelope. The three contacts have individual net names and no traces. [PJ-102A recommended PCB layout](https://www.sameskydevices.com/product/resource/pj-102a.pdf#page=2)

J1 is on the bottom at (26, 17) mm with a 90° rotation in TinyCAD board coordinates. From the top, pad 3 sits to the right of pads 1 and 2. The bottom assembly drawing mirrors the view for inspection from the connector side and marks contact 1 at its slot.

| Pad or hole | Centre (mm) | Finished opening |
| --- | --- | --- |
| 1, centre contact | (26, 10.5) | 1.00 × 1.60 mm plated slot, along X |
| 2, sleeve | (26, 16.5) | 1.00 × 1.60 mm plated slot, along X |
| 3, sleeve switch | (30.7, 13.5) | 1.00 × 1.60 mm plated slot, along Y |
| Mounting holes | (5, 5) and (39, 27) | Ø3.20 mm non-plated, with bottom screw-head keep-outs |

The fixture uses a 1.6 mm board and preserves the manufacturer’s slot sizes. The generic classroom fabrication profile requires these slots to be at least 2.00 mm long. The fixture leaves the fabrication profile unset and is for digital read-back. Fabrication and fit testing still require a process that supports the specified slots and a physical jack.

## Reproduce the digital checks

Run the generator from the repo root. It checks slot endpoints, courtyard bounds, mounting keep-outs, the embedded STEP body and lead positions, and the expected profile findings.

```sh
node scripts/pcb/connector-reference.mjs examples/pcb/connector
```

The browser test opens a copied board with network access and catalogue requests blocked, moves the connector to the top at (16, 16) mm, then restores its angled bottom placement. It checks the 2D pad positions and the bottom 3D view, then downloads the CAM bundle. With Gerbonara 1.6.3 installed, run the independent checker against that download. It measures the drill axes and reads the top and bottom Gerbers and placement CSV.

```sh
npm run test:layout:browser -- scripts/tests/layout-browser/pcb-workspace.spec.mjs -g 'moves and flips the asymmetric'
python3 scripts/pcb/check-cam-preview.py --connector path/to/connector-cam-preview.zip
```
