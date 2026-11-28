# Stereo transistor headphone amplifier

Choose **Open project** and select a parent folder. TinyCAD creates an **Amplifier Example** folder and opens **Stereo amplifier.dsn** in Project mode. To reopen the project later, open **Stereo transistor amplifier.tcproject** in TinyCAD.

This example drives a small stereo headphone load and models an external, regulated 12 V DC supply.

| Drawing | Role |
| --- | --- |
| Stereo amplifier.dsn | U1 and U2 reference the same mono drawing with separate left and right audio nets. U3 supplies the common 12 V rail and return. V1 and V2 supply test tones, and R1 and R2 model separate 32 Ω loads. |
| Mono amplifier.dsn | A 2N3904 common-emitter Class A stage drives a diode-biased 2N3904/2N3906 Class AB emitter follower. The channel has an AC-coupled input and output and a local supply bypass. |
| Power supply.dsn | An ideal source models the regulated adapter. A 0.47 Ω series resistor, a 470 µF reservoir and a 100 nF bypass filter the shared rail. A 10 kΩ resistor discharges the reservoir. |

The **Stereo transient** sheet runs for 20 ms. The inputs are 100 mV peak at 1 kHz and 1.6 kHz. The output transistors are lightly biased to reduce crossover distortion. Class C is useful in tuned RF stages, while this example needs to pass a broadband audio signal. [MIT audio amplification lecture](https://web.mit.edu/6.117/www/lec2.pdf)

## Review checks

The saved transient preset produced about 0.33 V RMS and 3.5 mW into each 32 Ω load in ngspice at 27 °C. The flattened TinyCAD netlist resolved all three instances and matched all hierarchy ports. The analog pin types in the bundled artwork and the repeated shared-rail markers give pin-direction and power-to-power notices in the full DRC. The supply and audio connections were checked against the flattened netlist. This circuit has been simulated and has no hardware test results.

## Component sources

The project embeds artwork from TinyCAD’s bundled **SPICE essentials** library. The named transistors and diodes use the bundled OpenJellyBean models. All three voltage sources use TinyCAD’s **Simulation → Insert Source** command. The stereo drawing uses two sine sources and the power supply drawing uses a 12 V DC source.

| Component | Bundled name ID / symbol ID | Placement |
| --- | --- | --- |
| Resistor (US) | 25 / 24 | All resistors |
| Capacitor | 4 / 4 | Mono C1, C3, C5 and PSU C2 |
| Electrolytic capacitor | 5 / 5 | Mono C2, C4 and PSU C1 |
| NPN transistor | 9 / 9 | Mono Q1 and Q2, configured as 2N3904 |
| PNP transistor | 10 / 10 | Mono Q3, configured as 2N3906 |
| Diode | 13 / 13 | Mono D1 and D2, configured as 1N4148 |

The transistor artwork preserves the bundled symbol geometry and uses the onsemi TO-92 lead numbering E–B–C for pins 1–2–3. C3 is a 47 µF bipolar capacitor. C4 is a 470 µF polarized output capacitor with its positive terminal toward the amplifier. [2N3904 datasheet](https://www.onsemi.com/pdf/datasheet/2n3904-d.pdf) · [2N3906 datasheet](https://www.onsemi.com/pdf/datasheet/2n3906-d.pdf) · [OpenJellyBean models](https://github.com/xdylanm/openjellybean)
