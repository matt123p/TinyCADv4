# Amplifier routing regression fixtures

`amplifier.dsn` is the original TinyCAD `examples/circuits/AMP.DSN` drawing,
“Transistor Amplifier”, authored by Matt Pyne in 1995. It contains Q1 ZTX650,
Q2 BC140, the phono input, and speaker shown in the reported auto-layout bug.
Source: https://github.com/matt123p/TinyCAD/tree/master/examples/circuits

`amplifier-with-pin-loops.dsn` captures the actual High auto-layout output before
the hidden-pin correction. Keep this broken geometry: it tests that another run
repairs existing loops as well as preventing loops on the original circuit.

The transistor symbol uses hidden connection points (`which=5`) with a legacy
stored length of 30. Those stems and pin names are not drawn, and their stored
directions point inward for this symbol. Treating them as visible pin leads
creates precisely the small return bends at the emitter and collector.
