# ESP32 climate and display station

A room monitor using **Embedded processors and smart home**: an ESP32 DevKitC V4, an Adafruit BME280 temperature/humidity/pressure breakout and a DFRobot Gravity DFR0486 OLED. The drawing embeds all three boards and opens without loading a library. The OLED front and rear are two views of **one** module; connect to its rear header.

## Follow the connections

Matching **SDA** and **SCL** labels are connected nets. Native **3V3** and **0** markers join the power and common-return nets across the page. Each wire meets the labelled header pad, rather than the edge of the PCB.

| Net | U1 ESP32 DevKitC V4 | ENV1 BME280 | DISP1 OLED |
| --- | --- | --- | --- |
| 3V3 | J1-1, 3V3 | JP2-1, VIN | I2C-1, VCC |
| 0 | J1-14, GND | JP2-3, GND **and** JP2-5, SDO/ADR | I2C-2, GND |
| SCL | J3-3, GPIO22 | JP2-4, SCK/SCL | I2C-3, SCL |
| SDA | J3-6, GPIO21 | JP2-6, SDI/SDA | I2C-4, SDA |

The grounded BME280 address pad selects **0x76**. Leave its 3Vo output and CS pin open for this I2C arrangement. Spare ESP32 headers are available for expansion. Use the named board revisions; similarly shaped clones can have different headers.

## Power and program it

Power the ESP32 through USB and use its 3V3 header output for both modules. Do not simultaneously inject another supply into its 5V or 3V3 header. This is a short, local 3.3 V I2C bus using the modules' onboard pull-ups. Check the total pull-up loading if adding modules.

Firmware must select GPIO21/GPIO22 for I2C, scan for the OLED's configured address, initialize its SSD1306 driver, read the BME280 at 0x76 and update the display. Firmware is not included; the drawing has no SPICE model. Open-header and power/driver classification notices from circuit checking are expected for these PCB layout symbols.

## Make it your own

Choose **Open drawing**, add a light sensor or button from **Standard → Embedded processors and smart home**, and use **Save As** to keep your version. Reopen **Explanation** to refer to this pin table while editing.

Pin and supply references: [Espressif DevKitC V4 guide](https://docs.espressif.com/projects/esp-idf/en/v4.4.1/esp32/hw-reference/esp32/get-started-devkitc.html), [Adafruit BME280 pinouts](https://learn.adafruit.com/adafruit-bme280-humidity-barometric-pressure-temperature-sensor-breakout/pinouts), [DFRobot DFR0486](https://wiki.dfrobot.com/dfr0486).
