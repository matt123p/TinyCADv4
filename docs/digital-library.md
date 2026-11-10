# Digital logic library

**Digital logic** is a standard bundled library built from the NAND reference selected during artwork review. Enable it in the library chooser. It loads on selection in browser and desktop versions.

There are **21 canonical symbol types and 28 library entries**. Each logical symbol is one part, with generic terminal numbers rather than a commercial IC package pinout. The seven clocked types each have separate rising-edge and falling-edge entries.

## Adapted NAND reference

The selected source is SQL **SymbolID 160 / NameID 9279**, by **matt**. Its extracted drawing is checked in as [nand-reference.xml](../library-sources/digital/nand-reference.xml). The original is a four-part device; the adapted reference is a single two-input NAND.

The [recipe](../library-recipes/digital.json) records the original source fingerprint, adaptation and family definitions. Adaptation:

- Extracts the first gate and discards the other three gate units.
- Preserves the selected flat-left, curved-right outline, scaling its body to the 741's **8 × 8 mm** envelope.
- Uses the 741's pale yellow fill, thin black strokes and **4 mm signal leads**.
- Keeps connection points on the **1 mm grid**.
- Uses logical pins **1 A, 2 B, 3 Y, 4 VCC, 5 VSS**. Original package supply numbers 14 and 7 are retained only in source provenance.
- Uses TinyCAD's native inverted-output **Dot** pin shape.
- Uses native **Power** pins for VCC and VSS, hidden by default.

All other digital drawings use this outline style, fill, lead length, pin conventions and typography. Gates use the matching ANSI outline; more complex functions use labelled rectangular blocks. Dense blocks can grow to fit their terminal labels while retaining the same lead length and pin spacing.

## Contents

| Group | Symbols |
| --- | --- |
| Combinational gates | AND, NAND, OR, NOR, XOR, XNOR, buffer and NOT. |
| Combinational blocks | Full adder, 2-to-4 decoder, 4-to-2 encoder and 2-to-1 multiplexer. |
| Counters | BCD, 3-bit asynchronous binary, 3-bit synchronous binary and 4-stage Johnson. |
| Sequential logic | 3-stage shift register, D flip-flop, J-K flip-flop, D latch and R-S latch. |

NAND, NOR, XNOR and NOT outputs use **Dot** (`which=1`). Complementary `Q_N` outputs and active-low `SET_N`/`RESET_N` controls also use Dot.

Clocked inputs use **Clock** (`which=2`) for rising-edge entries and **DotClock** (`which=3`) for falling-edge entries. These are actual native pin shapes, not decorative lines. Level-sensitive latch enable/set/reset inputs have no clock marker. Counter and register control names follow the teaching inventory's logical contract; they do not establish a real device's control timing or package pins.

## Hidden power connections

The supply pins use native **Power** shape (`which=4`) and electrical type **Power Input**. Their names are **VCC** and **VSS**, so TinyCAD connects them to the corresponding named supply nets. The teaching inventory's logical `VDD` role maps to the library's positive rail named VCC.

Place or label your supply rails **VCC** and **VSS**. Connect VSS to circuit ground or the appropriate negative supply as required; the symbol does not silently equate VSS with node 0. The editor's **Show power pins** option exposes the terminals when explicit wiring or inspection is wanted. Generic Hidden (`which=5`) is not used for supplies.

## Generation and verification

```sh
npm run libraries:digital
npm run libraries:package
npm run test:digital
```

Generation requires the checked-in NAND XML, teaching inventory and SPICE library for the 741 style reference. It does not need the private SQL dump. It writes:

- `bundled-libraries/digital/digital.tclib`
- `bundled-libraries/digital/digital.provenance.json`

The source selection, style reference and every generated drawing hash are retained in provenance. Repeated generation produces identical library bytes.

Tests cover inventory coverage, logical pin numbering, one-part extraction, grid alignment, body dimensions, fill, native inversion/clock markers, both clock edges, actual editor placement through rotations/mirrors, drawing save/load, and hidden supply connections to named power rails in the real netlist generator. The teaching/course builders retain both clock-edge variants and the shared artwork selections.

Every entry embeds a configurable educational SPICE model. See [model behaviour, parameters and tests](teaching-simulation-models.md). Physical footprints and manufacturer-specific timing remain separate.
