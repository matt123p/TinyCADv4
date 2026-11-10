# Teaching symbol-library inventory

Generated from the curated assignments and the ten course catalogues. The JSON files are the authoritative handoff; this file is a readable checklist.

Libraries: **10**. Experiments: **214**. Library symbol records: **478**. Distinct reusable types: **112**.

Built-in lab equipment and probes are excluded from the generation requirements. Existing-tool notes identify tools already supplied by this branch; do not generate them as library symbols.

Each folder is proposed metadata, not an implemented library-browser feature. Logical terminals are not package pinouts. An entry is an inventory requirement, not a finished symbol or executable model.

## GCSE Physics — AQA 8463

[JSON](libraries/gcse-physics-aqa.json) · [Use cases](../17-gcse-physics-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe, Student oscilloscope, two differential channels, Student function generator.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | G18 |
| potentiometer | Potentiometer | 01 Passives/Resistors | G13, G14 |
| resistance_wire | Resistance-wire test section | 01 Passives/Resistors | G01 |
| resistor | Fixed resistor | 01 Passives/Resistors | G02, G03, G04, G09, G10, G15 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | Common support |
| diode | Signal diode | 02 Semiconductors/Diodes | G06, G17 |
| led | Light-emitting diode | 02 Semiconductors/Diodes | G17, G18 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | G12, G14 |
| ntc | NTC thermistor | 03 Sensors/Resistive | G11, G13 |
| switch_spst | SPST switch | 04 Switches/Manual | G10, G18 |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | Common support |
| source_dc | DC voltage source | 05 Sources/Voltage | Common support |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | G08, G16 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | G16 |
| lamp | Filament lamp | 06 Outputs/Lamps | G05, G18 |
| ammeter | Ammeter | 10 Instruments/Conventional | G07 |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | G07 |
| voltmeter | Voltmeter | 10 Instruments/Conventional | G07 |
| bnc | BNC-style signal connection | 11 Connections/Connectors | G16 |
| connector2 | Two-way connector | 11 Connections/Connectors | G18 |
| connector3 | Three-way connector | 11 Connections/Connectors | Common support |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | G18 |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## A-level Physics — AQA 7408, including optional Electronics

[JSON](libraries/a-level-physics-aqa.json) · [Use cases](../18-a-level-physics-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe, Student oscilloscope, two differential channels, Student function generator.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | A03, A04, A14, A16, A23, A25, A27, A28, A29, A30, A31, A38, A40 |
| capacitor_plates | Parallel-plate experimental capacitor | 01 Passives/Capacitors | A15 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | A03, A04, A16, A38 |
| capacitor_variable | Variable capacitor | 01 Passives/Capacitors | A25 |
| inductor | Inductor | 01 Passives/Inductors | A25 |
| potentiometer | Potentiometer | 01 Passives/Resistors | A08, A11, A12, A26, A38 |
| resistance_wire | Resistance-wire test section | 01 Passives/Resistors | A01 |
| resistor | Fixed resistor | 01 Passives/Resistors | A02, A05, A09, A10, A13, A19, A27, A28, A29, A30, A31, A40 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | A02, A11 |
| diode | Signal diode | 02 Semiconductors/Diodes | A07 |
| diode_rectifier | Rectifier diode | 02 Semiconductors/Diodes | Optional extension |
| photodiode | Photodiode | 02 Semiconductors/Diodes | A23 |
| zener | Zener diode | 02 Semiconductors/Diodes | A22 |
| mosfet_n | N-channel enhancement MOSFET | 02 Semiconductors/Transistors | A20, A21 |
| hall_sensor | Hall-effect sensor | 03 Sensors/Powered | A24 |
| light_sensor | Voltage-output light sensor | 03 Sensors/Powered | A39 |
| temperature_sensor | Voltage-output temperature sensor | 03 Sensors/Powered | A39 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | A12 |
| ntc | NTC thermistor | 03 Sensors/Resistive | A08 |
| controlled_switch | Voltage-controlled analogue switch | 04 Switches/Controlled | A41 |
| switch_spdt | SPDT changeover switch | 04 Switches/Manual | A04, A16 |
| switch_spst | SPST switch | 04 Switches/Manual | A03, A10 |
| behavioural_current | Behavioural current source | 05 Sources/Behavioural | A23 |
| behavioural_voltage | Behavioural voltage source | 05 Sources/Behavioural | A32, A42 |
| battery | Battery | 05 Sources/Cells | A10 |
| cell | Cell | 05 Sources/Cells | A02, A10, A13 |
| vcvs | Voltage-controlled voltage source | 05 Sources/Controlled | A29 |
| current_source | Independent current source | 05 Sources/Current | A14 |
| source_dc | DC voltage source | 05 Sources/Voltage | A20 |
| source_fm | FM voltage source | 05 Sources/Voltage | A43 |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | A03, A14, A17, A18, A21, A24, A27, A28, A29, A30, A31, A33, A36, A37, A38, A40, A41, A43 |
| source_pwl | Piecewise-linear voltage source | 05 Sources/Voltage | A32 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | A17, A18, A25, A27, A28, A29, A30, A31, A32, A33, A41, A42, A43 |
| lamp | Filament lamp | 06 Outputs/Lamps | A06 |
| opamp | Operational amplifier | 07 Analogue/Amplifiers | A23, A27, A28, A29, A30, A31 |
| comparator | Voltage comparator | 07 Analogue/Comparators | A26, A32 |
| am_modulator | AM modulator functional circuit | 07 Analogue/Modulation | A42 |
| timer_555 | 555 timer | 07 Analogue/Timers | A38 |
| counter_bcd | BCD counter | 08 Digital/Counters | A36 |
| counter_binary3_sync | 3-bit synchronous binary counter | 08 Digital/Counters | A36, A37 |
| counter_johnson | Johnson counter, 4-stage | 08 Digital/Counters | A36 |
| gate_and | AND gate, 2-input | 08 Digital/Gates | A34, A35, A37 |
| gate_buffer | Logic buffer | 08 Digital/Gates | A32 |
| gate_nand | NAND gate, 2-input | 08 Digital/Gates | A34, A35, A37 |
| gate_nor | NOR gate, 2-input | 08 Digital/Gates | A34, A35, A37 |
| gate_not | NOT gate / inverter | 08 Digital/Gates | A34, A35, A37 |
| gate_or | OR gate, 2-input | 08 Digital/Gates | A34, A35, A37 |
| gate_xor | XOR gate, 2-input | 08 Digital/Gates | A34, A35, A37 |
| adc4 | ADC functional block, 4-bit illustration | 09 Functional Blocks/Interfaces | A33, A39 |
| channel | Communication channel block | 09 Functional Blocks/Interfaces | A39, A40 |
| dac4 | DAC functional block, 4-bit illustration | 09 Functional Blocks/Interfaces | A39 |
| data_logger | Data-logger interface | 09 Functional Blocks/Interfaces | A39 |
| output_transducer | Output transducer block | 09 Functional Blocks/Interfaces | A39 |
| pcm_encoder | PCM encoder functional block | 09 Functional Blocks/Interfaces | A33, A39 |
| receiver | Communication receiver block | 09 Functional Blocks/Interfaces | A39 |
| sampler | Sample-and-hold functional block | 09 Functional Blocks/Interfaces | A33 |
| tdm_switch | Time-division multiplexer block | 09 Functional Blocks/Interfaces | A41 |
| transmitter | Communication transmitter block | 09 Functional Blocks/Interfaces | A39 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| bnc | BNC-style signal connection | 11 Connections/Connectors | A17, A18, A43 |
| connector2 | Two-way connector | 11 Connections/Connectors | Common support |
| connector3 | Three-way connector | 11 Connections/Connectors | Common support |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | A15 |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## BTEC First Certificate in Engineering — selected Unit 8

[JSON](libraries/btec-first-engineering.json) · [Use cases](../19-btec-first-engineering-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | F10, F11, F12 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | F10, F11, F12 |
| potentiometer | Potentiometer | 01 Passives/Resistors | F02, F09 |
| resistor | Fixed resistor | 01 Passives/Resistors | F01, F16 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | Common support |
| diode_rectifier | Rectifier diode | 02 Semiconductors/Diodes | F13 |
| led | Light-emitting diode | 02 Semiconductors/Diodes | F04, F09, F11, F12 |
| thyristor | Thyristor / SCR | 02 Semiconductors/Thyristors | F08 |
| bjt_npn | NPN bipolar transistor | 02 Semiconductors/Transistors | F05, F06, F09, F13 |
| bjt_pnp | PNP bipolar transistor | 02 Semiconductors/Transistors | F05 |
| darlington_npn | NPN Darlington pair | 02 Semiconductors/Transistors | F06, F09 |
| darlington_pnp | PNP Darlington pair | 02 Semiconductors/Transistors | F06 |
| mosfet_n | N-channel enhancement MOSFET | 02 Semiconductors/Transistors | F07 |
| mosfet_p | P-channel enhancement MOSFET | 02 Semiconductors/Transistors | F07 |
| piezo_sensor | Piezoelectric sensor | 03 Sensors/Generating | Optional extension |
| solar_cell | Solar cell | 03 Sensors/Generating | F14 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | F02, F09 |
| moisture_sensor | Moisture sensor | 03 Sensors/Resistive | Optional extension |
| ntc | NTC thermistor | 03 Sensors/Resistive | F02, F09 |
| push_break | Push-to-break switch | 04 Switches/Manual | F03, F08 |
| push_make | Push-to-make switch | 04 Switches/Manual | F03, F08, F11, F15 |
| switch_spdt | SPDT changeover switch | 04 Switches/Manual | F03 |
| switch_spst | SPST switch | 04 Switches/Manual | F16 |
| relay_coil | Relay-coil electrical equivalent | 04 Switches/Relays | F13 |
| relay_spdt | Relay with SPDT contacts | 04 Switches/Relays | F13 |
| battery | Battery | 05 Sources/Cells | F14 |
| cell | Cell | 05 Sources/Cells | Common support |
| source_dc | DC voltage source | 05 Sources/Voltage | Common support |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | F10, F15 |
| buzzer | Buzzer electrical interface | 06 Outputs/Audio | F09 |
| speaker | Loudspeaker electrical interface | 06 Outputs/Audio | F12 |
| seven_segment_anode | Seven-segment display, common anode | 06 Outputs/Displays | F15 |
| seven_segment_cathode | Seven-segment display, common cathode | 06 Outputs/Displays | F15 |
| lamp | Filament lamp | 06 Outputs/Lamps | F05 |
| comparator | Voltage comparator | 07 Analogue/Comparators | F09 |
| timer_555 | 555 timer | 07 Analogue/Timers | F11, F12 |
| microcontroller | Generic microcontroller interface | 09 Functional Blocks/Interfaces | F15 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| connector2 | Two-way connector | 11 Connections/Connectors | F17 |
| connector3 | Three-way connector | 11 Connections/Connectors | F17 |
| test_point | Test point | 11 Connections/Terminals | F16 |
| annotation | Text / block annotation | 12 Editor Primitives | F17 |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## BTEC National Extended Diploma Applied Science (2016) — selected Unit 15

[JSON](libraries/btec-applied-science-2016.json) · [Use cases](../20-btec-national-applied-science-2016-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe, Student oscilloscope, two differential channels, Student function generator.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | S06, S07, S08, S16, S18 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | S06, S07, S10 |
| potentiometer | Potentiometer | 01 Passives/Resistors | S03, S11, S12 |
| resistor | Fixed resistor | 01 Passives/Resistors | S01, S02, S18 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | S04 |
| diode | Signal diode | 02 Semiconductors/Diodes | S05 |
| diode_rectifier | Rectifier diode | 02 Semiconductors/Diodes | S10 |
| led | Light-emitting diode | 02 Semiconductors/Diodes | S05, S14 |
| bjt_npn | NPN bipolar transistor | 02 Semiconductors/Transistors | S14 |
| wheatstone_bridge | Wheatstone bridge | 03 Sensors/Bridges | S13 |
| ph_probe | High-impedance pH probe interface | 03 Sensors/Generating | S17 |
| piezo_sensor | Piezoelectric sensor | 03 Sensors/Generating | S16 |
| thermocouple | Thermocouple | 03 Sensors/Generating | S15 |
| light_sensor | Voltage-output light sensor | 03 Sensors/Powered | S17 |
| pressure_sensor | Voltage-output pressure sensor | 03 Sensors/Powered | S17 |
| temperature_sensor | Voltage-output temperature sensor | 03 Sensors/Powered | S17 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | S11 |
| moisture_sensor | Moisture sensor | 03 Sensors/Resistive | S17 |
| ntc | NTC thermistor | 03 Sensors/Resistive | S12 |
| strain_gauge | Strain gauge | 03 Sensors/Resistive | S13 |
| switch_spdt | SPDT changeover switch | 04 Switches/Manual | S06 |
| switch_spst | SPST switch | 04 Switches/Manual | Common support |
| reed_switch | Reed switch | 04 Switches/Sensed | S14 |
| behavioural_current | Behavioural current source | 05 Sources/Behavioural | S16 |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | S04 |
| source_dc | DC voltage source | 05 Sources/Voltage | S15 |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | S06, S07, S08, S09 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | S08, S09, S10 |
| lamp | Filament lamp | 06 Outputs/Lamps | S05 |
| opamp | Operational amplifier | 07 Analogue/Amplifiers | S13, S15, S16 |
| data_logger | Data-logger interface | 09 Functional Blocks/Interfaces | S17 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| bnc | BNC-style signal connection | 11 Connections/Connectors | S09 |
| connector2 | Two-way connector | 11 Connections/Connectors | Common support |
| connector3 | Three-way connector | 11 Connections/Connectors | S17 |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | Common support |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## BTEC National Applied Science AAQ Extended Certificate — Units 3 and 4

[JSON](libraries/btec-applied-science-aaq.json) · [Use cases](../21-btec-aaq-applied-science-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| resistance_wire | Resistance-wire test section | 01 Passives/Resistors | Q04, Q05 |
| resistor | Fixed resistor | 01 Passives/Resistors | Q02, Q03, Q12 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | Q13 |
| diode | Signal diode | 02 Semiconductors/Diodes | Q07 |
| led | Light-emitting diode | 02 Semiconductors/Diodes | Q08 |
| photodiode | Photodiode | 02 Semiconductors/Diodes | Q11 |
| solar_cell | Solar cell | 03 Sensors/Generating | Q13, Q14 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | Q10 |
| ntc | NTC thermistor | 03 Sensors/Resistive | Q09 |
| switch_spst | SPST switch | 04 Switches/Manual | Common support |
| behavioural_current | Behavioural current source | 05 Sources/Behavioural | Q11 |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | Common support |
| source_dc | DC voltage source | 05 Sources/Voltage | Common support |
| lamp | Filament lamp | 06 Outputs/Lamps | Q03, Q06 |
| ammeter | Ammeter | 10 Instruments/Conventional | Q01 |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Q01 |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Q01 |
| connector2 | Two-way connector | 11 Connections/Connectors | Common support |
| connector3 | Three-way connector | 11 Connections/Connectors | Common support |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | Q05, Q14 |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## BTEC National Extended Diploma Electrical and Electronic Engineering — selected Unit 19

[JSON](libraries/btec-national-electrical-electronic-engineering.json) · [Use cases](../22-btec-national-electrical-electronic-engineering-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe, Student oscilloscope, two differential channels, Student function generator.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | N10, N12, N13, N14, N16, N20 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | N04 |
| potentiometer | Potentiometer | 01 Passives/Resistors | N09, N11 |
| resistor | Fixed resistor | 01 Passives/Resistors | N12, N13, N14, N20 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | Common support |
| diode | Signal diode | 02 Semiconductors/Diodes | N01, N20 |
| diode_rectifier | Rectifier diode | 02 Semiconductors/Diodes | N01, N02, N03, N04 |
| led | Light-emitting diode | 02 Semiconductors/Diodes | N06 |
| zener | Zener diode | 02 Semiconductors/Diodes | N05 |
| bjt_npn | NPN bipolar transistor | 02 Semiconductors/Transistors | N07, N09, N10, N20 |
| bjt_pnp | PNP bipolar transistor | 02 Semiconductors/Transistors | N07, N09, N10 |
| jfet_n | N-channel JFET | 02 Semiconductors/Transistors | N08 |
| jfet_p | P-channel JFET | 02 Semiconductors/Transistors | N08 |
| mosfet_n | N-channel enhancement MOSFET | 02 Semiconductors/Transistors | N08 |
| mosfet_p | P-channel enhancement MOSFET | 02 Semiconductors/Transistors | N08 |
| switch_spst | SPST switch | 04 Switches/Manual | Common support |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | Common support |
| source_dc | DC voltage source | 05 Sources/Voltage | Common support |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | N07, N08, N10, N12, N13, N14, N16, N18, N19 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | N02, N03, N04, N10, N12, N13, N14 |
| opamp | Operational amplifier | 07 Analogue/Amplifiers | N12, N13, N14, N20 |
| comparator | Voltage comparator | 07 Analogue/Comparators | N11 |
| counter_binary3_async | 3-bit asynchronous binary counter | 08 Digital/Counters | N19 |
| counter_binary3_sync | 3-bit synchronous binary counter | 08 Digital/Counters | N19 |
| gate_and | AND gate, 2-input | 08 Digital/Gates | N15, N16, N17, N20 |
| gate_buffer | Logic buffer | 08 Digital/Gates | N16 |
| gate_nand | NAND gate, 2-input | 08 Digital/Gates | N15, N16, N17 |
| gate_nor | NOR gate, 2-input | 08 Digital/Gates | N15, N16, N17 |
| gate_not | NOT gate / inverter | 08 Digital/Gates | N15, N16, N17 |
| gate_or | OR gate, 2-input | 08 Digital/Gates | N15, N16, N17 |
| gate_xor | XOR gate, 2-input | 08 Digital/Gates | N15, N16, N17 |
| shift_register3 | 3-stage shift register | 08 Digital/Registers | N19 |
| flipflop_d | D flip-flop | 08 Digital/Storage | N18, N19 |
| flipflop_jk | J-K flip-flop | 08 Digital/Storage | N18, N19 |
| latch_rs | R-S latch | 08 Digital/Storage | N18 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| bnc | BNC-style signal connection | 11 Connections/Connectors | N10 |
| connector2 | Two-way connector | 11 Connections/Connectors | N21 |
| connector3 | Three-way connector | 11 Connections/Connectors | N21 |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | N21 |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## BTEC HNC Electrical and Electronic Engineering for England (2024) — Unit 4019

[JSON](libraries/btec-hnc-electrical-electronic-engineering.json) · [Use cases](../23-btec-hnc-electrical-electronic-engineering-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe, Student oscilloscope, two differential channels, Student function generator.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | H07, H08, H09, H10, H11, H15, H17, H18 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | H12 |
| inductor | Inductor | 01 Passives/Inductors | H07, H08, H09, H11 |
| potentiometer | Potentiometer | 01 Passives/Resistors | H05 |
| resistor | Fixed resistor | 01 Passives/Resistors | H01, H17, H18 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | H04 |
| diode | Signal diode | 02 Semiconductors/Diodes | H13 |
| diode_rectifier | Rectifier diode | 02 Semiconductors/Diodes | H12 |
| led | Light-emitting diode | 02 Semiconductors/Diodes | H14 |
| zener | Zener diode | 02 Semiconductors/Diodes | H13 |
| bjt_npn | NPN bipolar transistor | 02 Semiconductors/Transistors | H15 |
| bjt_pnp | PNP bipolar transistor | 02 Semiconductors/Transistors | H15 |
| jfet_n | N-channel JFET | 02 Semiconductors/Transistors | H16 |
| jfet_p | P-channel JFET | 02 Semiconductors/Transistors | H16 |
| mosfet_n | N-channel enhancement MOSFET | 02 Semiconductors/Transistors | H16 |
| mosfet_p | P-channel enhancement MOSFET | 02 Semiconductors/Transistors | H16 |
| light_sensor | Voltage-output light sensor | 03 Sensors/Powered | H20 |
| pressure_sensor | Voltage-output pressure sensor | 03 Sensors/Powered | H20 |
| temperature_sensor | Voltage-output temperature sensor | 03 Sensors/Powered | H20 |
| switch_spst | SPST switch | 04 Switches/Manual | H19 |
| relay_spdt | Relay with SPDT contacts | 04 Switches/Relays | H19 |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | Common support |
| vcvs | Voltage-controlled voltage source | 05 Sources/Controlled | H17 |
| current_source | Independent current source | 05 Sources/Current | H01, H02, H03 |
| source_dc | DC voltage source | 05 Sources/Voltage | H02, H03 |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | H06, H08, H09, H10, H15, H17, H18 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | H06, H07, H09, H10, H11, H12, H15, H17, H18 |
| opamp | Operational amplifier | 07 Analogue/Amplifiers | H17, H18, H20 |
| gate_and | AND gate, 2-input | 08 Digital/Gates | H19 |
| gate_nand | NAND gate, 2-input | 08 Digital/Gates | H19 |
| gate_nor | NOR gate, 2-input | 08 Digital/Gates | H19 |
| gate_not | NOT gate / inverter | 08 Digital/Gates | H19 |
| gate_or | OR gate, 2-input | 08 Digital/Gates | H19 |
| gate_xor | XOR gate, 2-input | 08 Digital/Gates | H19 |
| data_logger | Data-logger interface | 09 Functional Blocks/Interfaces | H20 |
| plc_interface | PLC input/output interface | 09 Functional Blocks/Interfaces | H20 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| bnc | BNC-style signal connection | 11 Connections/Connectors | H06 |
| connector2 | Two-way connector | 11 Connections/Connectors | Common support |
| connector3 | Three-way connector | 11 Connections/Connectors | Common support |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | Common support |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## First-year physics degree — representative electronic-circuit strand

[JSON](libraries/degree-year1-physics.json) · [Use cases](../24-first-year-degree-physics-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe, Student oscilloscope, two differential channels, Student function generator.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | P05, P06, P08, P09, P10, P11, P13, P14, P18 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | P05, P06 |
| inductor | Inductor | 01 Passives/Inductors | P07, P08, P09, P10, P11 |
| potentiometer | Potentiometer | 01 Passives/Resistors | P03, P15 |
| resistor | Fixed resistor | 01 Passives/Resistors | P01, P14, P18 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | P02 |
| bjt_npn | NPN bipolar transistor | 02 Semiconductors/Transistors | P13 |
| light_sensor | Voltage-output light sensor | 03 Sensors/Powered | P17, P19 |
| pressure_sensor | Voltage-output pressure sensor | 03 Sensors/Powered | P17 |
| temperature_sensor | Voltage-output temperature sensor | 03 Sensors/Powered | P17, P19 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | P17 |
| ntc | NTC thermistor | 03 Sensors/Resistive | P17 |
| switch_spdt | SPDT changeover switch | 04 Switches/Manual | P06 |
| switch_spst | SPST switch | 04 Switches/Manual | Common support |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | Common support |
| current_source | Independent current source | 05 Sources/Current | P01 |
| source_dc | DC voltage source | 05 Sources/Voltage | P02 |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | P05, P06, P07, P08, P12, P13, P14 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | P09, P10, P11, P12, P13, P14 |
| opamp | Operational amplifier | 07 Analogue/Amplifiers | P14, P17, P19 |
| comparator | Voltage comparator | 07 Analogue/Comparators | P15 |
| gate_and | AND gate, 2-input | 08 Digital/Gates | P16 |
| gate_buffer | Logic buffer | 08 Digital/Gates | P15 |
| gate_nand | NAND gate, 2-input | 08 Digital/Gates | P16 |
| gate_nor | NOR gate, 2-input | 08 Digital/Gates | P16 |
| gate_not | NOT gate / inverter | 08 Digital/Gates | P16 |
| gate_or | OR gate, 2-input | 08 Digital/Gates | P16 |
| gate_xor | XOR gate, 2-input | 08 Digital/Gates | P16 |
| data_logger | Data-logger interface | 09 Functional Blocks/Interfaces | P19 |
| microcontroller | Generic microcontroller interface | 09 Functional Blocks/Interfaces | P19 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| bnc | BNC-style signal connection | 11 Connections/Connectors | P12, P13 |
| connector2 | Two-way connector | 11 Connections/Connectors | Common support |
| connector3 | Three-way connector | 11 Connections/Connectors | P19 |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | Common support |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## First-year electronics degree — representative circuit/device/digital strand

[JSON](libraries/degree-year1-electronics.json) · [Use cases](../25-first-year-degree-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe, Student function generator, Student oscilloscope, two differential channels.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | E06, E07, E08, E09, E10, E14, E16, E17, E22 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | E12 |
| inductor | Inductor | 01 Passives/Inductors | E06, E07, E08, E10 |
| potentiometer | Potentiometer | 01 Passives/Resistors | E13 |
| resistor | Fixed resistor | 01 Passives/Resistors | E01, E16, E17 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | E04 |
| diode | Signal diode | 02 Semiconductors/Diodes | E11 |
| diode_rectifier | Rectifier diode | 02 Semiconductors/Diodes | E12 |
| led | Light-emitting diode | 02 Semiconductors/Diodes | E25, E26 |
| bjt_npn | NPN bipolar transistor | 02 Semiconductors/Transistors | E13, E14, E25, E26 |
| bjt_pnp | PNP bipolar transistor | 02 Semiconductors/Transistors | E13 |
| jfet_n | N-channel JFET | 02 Semiconductors/Transistors | E15 |
| jfet_p | P-channel JFET | 02 Semiconductors/Transistors | E15 |
| mosfet_n | N-channel enhancement MOSFET | 02 Semiconductors/Transistors | E15, E25 |
| mosfet_p | P-channel enhancement MOSFET | 02 Semiconductors/Transistors | E15 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | E26 |
| ntc | NTC thermistor | 03 Sensors/Resistive | E26 |
| switch_spdt | SPDT changeover switch | 04 Switches/Manual | E06 |
| switch_spst | SPST switch | 04 Switches/Manual | Common support |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | Common support |
| current_source | Independent current source | 05 Sources/Current | E01, E02, E03 |
| source_dc | DC voltage source | 05 Sources/Voltage | E02, E03 |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | E06, E08, E09, E10, E14, E15, E16, E17, E19, E20, E21, E22, E24, E25 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | E07, E08, E09, E12, E14, E16, E17 |
| opamp | Operational amplifier | 07 Analogue/Amplifiers | E16, E17, E26 |
| comparator | Voltage comparator | 07 Analogue/Comparators | E26 |
| full_adder | 1-bit full adder | 08 Digital/Arithmetic | E23 |
| decoder2to4 | 2-to-4 decoder | 08 Digital/Combinational | E19 |
| encoder4to2 | 4-to-2 encoder | 08 Digital/Combinational | E19 |
| mux2 | 2-to-1 multiplexer | 08 Digital/Combinational | E19 |
| counter_binary3_async | 3-bit asynchronous binary counter | 08 Digital/Counters | E21 |
| counter_binary3_sync | 3-bit synchronous binary counter | 08 Digital/Counters | E21 |
| gate_and | AND gate, 2-input | 08 Digital/Gates | E18, E19, E22, E23 |
| gate_buffer | Logic buffer | 08 Digital/Gates | E22 |
| gate_nand | NAND gate, 2-input | 08 Digital/Gates | E18, E22 |
| gate_nor | NOR gate, 2-input | 08 Digital/Gates | E18, E22 |
| gate_not | NOT gate / inverter | 08 Digital/Gates | E18, E19, E22 |
| gate_or | OR gate, 2-input | 08 Digital/Gates | E18, E19, E22, E23 |
| gate_xnor | XNOR gate, 2-input | 08 Digital/Gates | E18, E22 |
| gate_xor | XOR gate, 2-input | 08 Digital/Gates | E18, E22, E23 |
| shift_register3 | 3-stage shift register | 08 Digital/Registers | E21 |
| flipflop_d | D flip-flop | 08 Digital/Storage | E20, E24 |
| latch_d | D latch | 08 Digital/Storage | E20 |
| data_logger | Data-logger interface | 09 Functional Blocks/Interfaces | E26 |
| fpga | Generic FPGA interface | 09 Functional Blocks/Interfaces | E25 |
| microcontroller | Generic microcontroller interface | 09 Functional Blocks/Interfaces | E25 |
| state_machine | State-machine functional block | 09 Functional Blocks/Interfaces | E24 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| bnc | BNC-style signal connection | 11 Connections/Connectors | E14 |
| connector2 | Two-way connector | 11 Connections/Connectors | Common support |
| connector3 | Three-way connector | 11 Connections/Connectors | E24, E25, E26 |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | Common support |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |

## First-year engineering degrees — shared electronics and discipline applications

[JSON](libraries/degree-year1-engineering.json) · [Use cases](../26-first-year-degree-engineering-electronics-experiments.md)

Already provided; do not generate: Student current-limited bench supply, Student multimeter, three sockets, Voltage probe, Differential voltage probe, Series current probe.

| Symbol ID | Name | Proposed folder | Coverage / role |
| --- | --- | --- | --- |
| capacitor | Non-polarised capacitor | 01 Passives/Capacitors | GY06, GY08, GY09, GY10, GY11, GY14, GY15 |
| capacitor_polarised | Polarised capacitor | 01 Passives/Capacitors | GY12 |
| inductor | Inductor | 01 Passives/Inductors | GY07, GY08, GY09, GY10 |
| potentiometer | Potentiometer | 01 Passives/Resistors | GY01 |
| resistor | Fixed resistor | 01 Passives/Resistors | GY02, GY05, GY14, GY15 |
| rheostat | Variable resistor / rheostat | 01 Passives/Resistors | Common support |
| diode | Signal diode | 02 Semiconductors/Diodes | GY12 |
| diode_rectifier | Rectifier diode | 02 Semiconductors/Diodes | GY12, GY13 |
| bjt_npn | NPN bipolar transistor | 02 Semiconductors/Transistors | GY13, GY18 |
| mosfet_n | N-channel enhancement MOSFET | 02 Semiconductors/Transistors | GY13, GY18 |
| mosfet_p | P-channel enhancement MOSFET | 02 Semiconductors/Transistors | Optional extension |
| wheatstone_bridge | Wheatstone bridge | 03 Sensors/Bridges | GY17 |
| solar_cell | Solar cell | 03 Sensors/Generating | Optional extension |
| thermocouple | Thermocouple | 03 Sensors/Generating | GY17 |
| hall_sensor | Hall-effect sensor | 03 Sensors/Powered | GY17 |
| pressure_sensor | Voltage-output pressure sensor | 03 Sensors/Powered | GY17, GY18 |
| temperature_sensor | Voltage-output temperature sensor | 03 Sensors/Powered | GY17, GY18 |
| ldr | Light-dependent resistor | 03 Sensors/Resistive | GY17 |
| ntc | NTC thermistor | 03 Sensors/Resistive | GY17 |
| strain_gauge | Strain gauge | 03 Sensors/Resistive | GY17 |
| switch_spst | SPST switch | 04 Switches/Manual | Common support |
| relay_coil | Relay-coil electrical equivalent | 04 Switches/Relays | GY13 |
| relay_spdt | Relay with SPDT contacts | 04 Switches/Relays | Optional extension |
| behavioural_current | Behavioural current source | 05 Sources/Behavioural | Optional extension |
| behavioural_voltage | Behavioural voltage source | 05 Sources/Behavioural | Optional extension |
| battery | Battery | 05 Sources/Cells | Common support |
| cell | Cell | 05 Sources/Cells | Common support |
| current_source | Independent current source | 05 Sources/Current | GY02, GY03, GY04 |
| source_dc | DC voltage source | 05 Sources/Voltage | GY03, GY04 |
| source_pulse | Pulse / step voltage source | 05 Sources/Voltage | GY06, GY07, GY08, GY11, GY13, GY14, GY15 |
| source_sine | Sinusoidal voltage source | 05 Sources/Voltage | GY08, GY09, GY10, GY11, GY12, GY14, GY15 |
| opamp | Operational amplifier | 07 Analogue/Amplifiers | GY14, GY15, GY17, GY18 |
| gate_and | AND gate, 2-input | 08 Digital/Gates | GY16 |
| gate_nand | NAND gate, 2-input | 08 Digital/Gates | GY16 |
| gate_nor | NOR gate, 2-input | 08 Digital/Gates | GY16 |
| gate_not | NOT gate / inverter | 08 Digital/Gates | GY16 |
| gate_or | OR gate, 2-input | 08 Digital/Gates | GY16 |
| gate_xor | XOR gate, 2-input | 08 Digital/Gates | GY16 |
| data_logger | Data-logger interface | 09 Functional Blocks/Interfaces | GY18 |
| microcontroller | Generic microcontroller interface | 09 Functional Blocks/Interfaces | GY18 |
| plc_interface | PLC input/output interface | 09 Functional Blocks/Interfaces | GY18 |
| ammeter | Ammeter | 10 Instruments/Conventional | Common support |
| ohmmeter | Ohmmeter | 10 Instruments/Conventional | Common support |
| voltmeter | Voltmeter | 10 Instruments/Conventional | Common support |
| connector2 | Two-way connector | 11 Connections/Connectors | Common support |
| connector3 | Three-way connector | 11 Connections/Connectors | GY18 |
| test_point | Test point | 11 Connections/Terminals | Common support |
| annotation | Text / block annotation | 12 Editor Primitives | Common support |
| ground | SPICE reference ground | 12 Editor Primitives | Common support |
| junction | Connected junction | 12 Editor Primitives | Common support |
| net_label | Net label | 12 Editor Primitives | Common support |
| no_connect | No-connect marker | 12 Editor Primitives | Common support |
| wire | Wire | 12 Editor Primitives | Common support |
