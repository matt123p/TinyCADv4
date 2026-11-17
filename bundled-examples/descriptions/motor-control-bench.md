# DC motor and limit-control bench

A small automation example combining **Motors & Motion**, **Embedded processors and smart home**, and **Test & Measurement**. A USB-powered ESP32 controls a generic PWM/direction motor driver, a geared DC motor and a normally-closed roller limit switch. A separate bench supply provides motor power. All five components are embedded.

## Follow the connections

| Net | Connections |
| --- | --- |
| VMOTOR | PSU1 OUT 1 + → DRV1 VIN |
| 0, common return | PSU1 OUT 1 −, DRV1 GND, DRV1 SIG GND, U1 J1-14 GND, LIMIT1 COM |
| Motor lead 1 | DRV1 M1 → M1 M1 |
| Motor lead 2 | DRV1 M2 → M1 M2 |
| PWM | U1 J3-9 GPIO18 → DRV1 PWM |
| DIR | U1 J3-8 GPIO19 → DRV1 DIR |
| ENABLE | U1 J1-9 GPIO25 → DRV1 EN |
| LIMIT_NC | U1 J1-11 GPIO27 → LIMIT1 NC |

Matching control labels form connected nets. Native **VMOTOR** and **0** power markers connect the motor supply and common return. Common 0 is the signal reference, not an automatic protective-earth connection. The PSU chassis-earth terminal, LIMIT1 NO terminal and spare ESP32 headers are intentionally open. The motor's two leads are individual conductors.

## Control sequence

The intended firmware starts with enable inactive, configures GPIO27 as an input with a pull-up, and only permits motion while the normally-closed contact is closed. The input is low in its normal closed state and high when the limit opens or its lead breaks. Set direction while stopped, then apply PWM on GPIO18. Disable the driver when the input becomes high. Firmware and any hardware reset-state biasing are not included; select a driver with documented inactive startup behaviour or add the required biasing from its datasheet.

This assumes a complete driver module with **3.3 V-compatible** control inputs and an appropriate enable polarity. Select actual motor/driver/supply ratings, current limiting, flyback handling and local supply decoupling from the hardware instructions. VMOTOR must not feed the ESP32 header. Power the ESP32 through USB only in this example.

## Make it your own

Choose **Open drawing**, add an encoder or a second limit from **Standard → Motors & Motion**, and **Save As**. This is a wiring starting point with no firmware, motion or SPICE simulation; the limit logic is not a certified emergency-stop function. Spare-header and extended power/driver notices are expected from circuit checking. Reopen **Explanation** for the connection table.

ESP32 header reference: [Espressif DevKitC V4 guide](https://docs.espressif.com/projects/esp-idf/en/v4.4.1/esp32/hw-reference/esp32/get-started-devkitc.html). The driver is a generic module interface, not the pinout of a particular commercial IC.
