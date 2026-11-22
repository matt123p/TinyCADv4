# Wi-Fi temperature node

The resistors and capacitors use the bundled SPICE essentials symbols. The ESP32-C3 module and TMP75 retain their package-specific definitions.

Reference F exercises dense placement, routing regions, copper fills and reviewed footprint updates. The stand-alone schematic is [Sensor.dsn](Sensor.dsn) and its drawing preview is [Sensor.svg](Sensor.svg).

Open [Sensor.tcproject](Sensor.tcproject) and then [Sensor.dpn](Sensor.dpn). PCB Design shows the MCU and boot straps, sensor and supply, and UART service placement areas. The two bottom ground zones and the antenna routing region are saved in the board. The board embeds the reviewed device maps, footprint geometry and supplied model assets so a copied project can open with the libraries offline.

U1 is an Espressif ESP32-C3-WROOM-02-N4 module with the on-board antenna. U2 is a Texas Instruments TMP75IDR in the D0008A SOIC-8 package. GPIO4 and GPIO5 carry the I²C bus. The three TMP75 address inputs connect to common ground for address 0x48. J1 supplies regulated 3.3 V and provides the common return for the UART/boot header J2. The enable RC and three boot strap resistors follow the module's reset and boot recommendations. [Espressif module datasheet](https://documentation.espressif.com/esp32-c3-wroom-02_datasheet_en.html) · [Espressif hardware guidelines](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/schematic-checklist.html) · [TI TMP75 datasheet](https://www.ti.com/lit/ds/symlink/tmp75.pdf)

The MCU land pattern follows Espressif figure 11-1. The nine centre lands map to the same module ground terminal, pin 19. The TMP75 land pattern uses the 5.40 mm row spacing and the 1.55 × 0.60 mm lands in TI drawing 4214825/C. The board edge is at the start of the module antenna area, with the antenna overhanging the board. Real hardware also needs a suitable enclosure clearance, conducted power verification, and RF qualification. [Module placement guidance](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/pcb-layout-design.html#general-principles-of-pcb-layout-for-modules-positioning-a-module-on-a-base-board)

The schematic uses TinyCAD public library geometry for R1–R7 (R, symbol/name 94/94, owner `matt`), C1–C4 (C, 69/69, owner `matt`), J1 (HEADER-2, 1196/10364, owner `gwp`), and J2 (HEADER-4, 1194/10362, owner `gwp`). The header pin names and electrical types were assigned for their circuit roles. The MCP library returned no compatible symbols for ESP32-C3-WROOM-02, ESP32-C3, TMP75 or LM75. The generated IC symbols use their datasheet pin tables.

The native schematic compiles to 11 named nets and nine intentional no-connects. Its electrical rule check passes in the current editor. Test coverage includes repeated markers on the shared rails, two different rails wired together, and conflicts between power output pins. The project generator independently checks the membership of both rails.

## Check the fixture

In **PCB Design**, run design checks and open **CAM read-back preview…**. In **Routing regions**, edit **Antenna edge keepout** and change the outline's lower Y coordinates from 36.55 mm to 30 mm. Run design checks again to find routed copper in the expanded exclusion. Use **Undo** to restore the original region.

Run the generator to reproduce the reference, check its native round trip and exercise a footprint ECO. It moves the TMP75 SDA land in a candidate revision and verifies that the ECO identifies the affected copper and newly open SDA net. The distributed board keeps the manufacturer land pattern.

```sh
node scripts/pcb/mcu-sensor-reference.mjs examples/pcb/mcu-sensor/Sensor.dsn build/qualification/reference-f build/qualification/reference-f/cam.zip
python3 scripts/pcb/check-cam-preview.py build/qualification/reference-f/cam.zip --mcu-sensor
```

The independent CAM check uses Gerbonara 1.6.3 and reads both copper layers, the carrier outline, and the plated drill file.
