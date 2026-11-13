# DC load and waveform bench

Two independent laboratory setups using **Test & Measurement**: a DC supply driving an electronic load with voltage measured in parallel, and a waveform generator connected to an oscilloscope. All five instruments are embedded for standalone editing on an **A4 landscape** page.

## Upper setup: measure the loaded supply

| Net | Connections |
| --- | --- |
| DC positive | PSU1 OUT 1 + → LOAD1 LOAD 1 + and DMM1 INPUT HI |
| DC return | PSU1 OUT 1 − → LOAD1 LOAD 1 − and DMM1 INPUT LO |

The junction dots show the meter's parallel branches. Other crossings do not join. Each binding-post connection represents an individual conductor. The DMM is in **DC voltage mode**; its current input and remote-sense terminals are deliberately unused. Connecting a current input across this supply would be a different and incorrect arrangement.

Start with a suitable low-voltage supply setting and current limit, then configure a load mode and current within the equipment ratings. Check load dissipation as voltage multiplied by current. Increase the load in controlled steps and observe the voltage on the meter. The drawing does not configure instruments or calculate results.

## Lower setup: inspect a waveform

Connect **GEN1 OUT 1** to **SCOPE1 CH1** with a BNC coax cable. These sockets represent a complete cable, including its reference/shield, rather than just its centre conductor. This setup has no connection to the DC load circuit above it.

Choose a signal amplitude, offset, frequency, scope termination and input range suitable for the actual instruments. A generator's amplitude can depend on its selected load impedance. Start with a modest sine wave and set CH1 as the trigger source; adjust the vertical and time scales to display several cycles.

## Extend the bench

Choose **Open drawing**, add a second meter, data-acquisition unit or temperature probe from **Standard → Test & Measurement**, then **Save As**. Connect each new instrument using the appropriate conductor, complete-cable or hose interface.

Spare ports, the PSU chassis-earth post and scope calibration terminals are open intentionally. No output-to-chassis bond is drawn. Actual instrument grounding must be checked before combining setups. These are physical equipment layouts with no SPICE instrument models; notices about spare ports and cables entering instrument faces are expected. Use **Explanation** to return to these instructions.
