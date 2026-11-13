# Home solar and battery plan

A conceptual home-energy plan using **Solar power and batteries**. Its ten embedded symbols show a rooftop array, DC battery, hybrid inverter, isolation switches, grid meter, home fuse box and household loads. The supplied library's larger artwork is arranged on an **A3 landscape** page.

## Follow the energy paths

| Connection | From | To |
| --- | --- | --- |
| Solar array | PV1 PV DC | PVISO1 PV IN |
| Isolated PV feed | PVISO1 PV OUT | INV1 PV DC |
| Battery | BAT1 BATT DC | BISO1 BATT IN |
| Isolated battery feed | BISO1 BATT OUT | INV1 BATT DC |
| Inverter AC | INV1 HOME AC | ACISO1 AC IN |
| Home solar connection | ACISO1 AC OUT | CU1 SOLAR AC |
| Grid supply | GRID1 GRID AC | METER1 GRID AC |
| Metered supply | METER1 HOME AC | CU1 AC IN |
| Household branch | CU1 HOME | HOME1 HOME AC |

The array and battery have separate DC connections to the hybrid inverter. The inverter's AC connection and the metered grid supply join the distribution equipment through separate ports. A crossing without a junction dot does not connect the two cables. Each equipment port represents a **whole cable or logical link**; it does not specify individual live, neutral, earth or DC conductors. The drawing does not model internal switching or energy flow numerically.

## What the plan assumes

The inverter is compatible with the selected PV string and battery. Battery communication/BMS wiring, inverter backup output and the fuse box EV branch are intentionally open. An actual battery system may require the data connection before it can operate; add it using the selected manufacturers' instructions. No backup/islanding arrangement is implied.

This is a planning example, with no SPICE model or installation specification. Equipment ratings, string design, protection, earthing, cable sizing, export control and applicable installation requirements must be established for the actual system. Isolation symbols describe locations in the plan, not a complete protection scheme. Circuit-checker notices about open logical ports and wires entering symbol envelopes are expected.

## Make it your own

Choose **Open drawing**, then add an EV charger, monitoring or further home loads from **Standard → Solar power and batteries**. Keep cable functions labelled, distinguish backup loads from ordinary household loads and use **Save As** for your version. The complete explanations remain available through **Explanation**.
