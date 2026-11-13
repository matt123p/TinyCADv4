# Two-person podcast studio

A host-and-guest recording setup built from **Audio & Music**. Two dynamic microphones feed a four-input podcast mixer; each participant has a separate headphone output, and a laptop records over USB. All six component instances are embedded in the drawing.

## Follow the audio

| Cable | From | To | Purpose |
| --- | --- | --- | --- |
| Balanced microphone XLR | MIC1 OUT | MIX1 MIC 1 | Host voice |
| Balanced microphone XLR | MIC2 OUT | MIX1 MIC 2 | Guest voice |
| Stereo headphone cable | MIX1 HP 1 | HP1 STEREO IN | Host monitoring |
| Stereo headphone cable | MIX1 HP 2 | HP2 STEREO IN | Guest monitoring |
| USB data/audio cable | MIX1 USB HOST | PC1 USB 1 | Recording and playback |

Each socket is one **whole-cable endpoint**. An XLR endpoint does not expose its individual contacts, and a headphone jack represents stereo audio rather than a balanced mono line. Cable crossings without dots are separate connections. The example uses two instances of the same embedded microphone definition and two of the same headphone definition.

## Set up a recording

Power the mixer and laptop as required by the actual equipment; mains/barrel power inputs are outside these symbols' interfaces. Set microphone gain while speaking at normal performance level, select the mixer as the recording application's input/output device, and check its USB routing. Whether the recording receives individual channels or a stereo mix depends on the actual mixer and software.

Use mixer headphone monitoring for the performers, with comfortable listening levels. Avoid monitoring the same input through delayed software playback at the same time. This example assumes ordinary passive dynamic microphones; configure phantom power according to the microphones actually used. Spare microphone, headphone, main-output and phone sockets are intentionally open.

These are generic equipment faces with the listed socket functions, not a specific manufacturer's wiring diagram. There is no acoustic or SPICE simulation.

## Make it your own

Choose **Open drawing** and expand the setup with a guest microphone, powered monitors or a recording interface from **Standard → Audio & Music**. Match mic, line, headphone and speaker-level interfaces when substituting equipment. Use **Save As** and reopen **Explanation** while editing.

Background: [Yamaha cables and connectors](https://usa.yamaha.com/audio/portable-pa/explore/pa-beginners-guide/equipments/cable.html), [Focusrite recording setup guide](https://support.focusrite.com/hc/en-gb/articles/24232528717970-What-is-the-easiest-way-to-record).
