# SMD regulator copper reference

Open [Regulators.tcproject](Regulators.tcproject) in Project mode or [Regulators.dpn](Regulators.dpn) in Single File mode. The 40 × 24 mm coupon exercises regulator device maps, surface-mount copper and paste, and thermal relief. Both device maps, footprint geometries and datasheet links are embedded. The coupon isolates these checks with test traces. Powered regulator operation would require a complete application circuit and bench qualification.

- U1 is a Diodes AP2112K-3.3 in SOT25, also called SOT-23-5. Pin 4 is explicitly NC. VIN and EN share the input net. The lands are 0.80 × 0.55 mm with 0.95 mm pitch, as shown in the manufacturer's layout. The coupon uses 0.05 mm corner radii. [AP2112 datasheet, pin descriptions and SOT25 land pattern](https://www.diodes.com/datasheet/download/AP2112.pdf)
- U2 is a TI TPS7A7002 in DDA0008B PowerPAD SOIC. Pins 1, 4 and 5 are explicitly NC. EN and IN share the input net. The 2.71 × 3.40 mm exposed land has its own PowerPAD assignment and joins GND through a track and a plated via beside the package. The coupon uses the nominal solderable dimensions for copper, mask and paste. [TPS7A7002 datasheet, pin functions and DDA0008B land and stencil drawings](https://www.ti.com/lit/ds/symlink/tps7a7002.pdf)

The bottom zone connects the three ground vias through 0.30 mm spokes with a 0.30 mm thermal gap. **Run design checks…** should find zero issues. Use **Edit zone…** to add the following cutouts to the zone.

```text
28.58, 8.03
28.72, 8.03
28.72, 8.29
28.58, 8.29

27.7, 8.58
28.3, 8.58
28.3, 8.72
27.7, 8.72
```

The cutouts remove the north spoke and narrow the east spoke to about 0.18 mm. Ground remains connected through the south and west spokes. Both defects appear in design checks and block manufacturing release. Undo restores the baseline fill.

## Rebuild and compare CAM

From the repository root, generate the native sample and the two diagnostic bundles. Run the second command with Gerbonara 1.6.3 installed. It checks hashes, 14 paste apertures, three plated drills, both output track widths, the exposed land and the copper at the modified spokes.

```sh
node scripts/pcb/regulator-reference.mjs examples/pcb/regulator build/qualification/regulator
python3 scripts/pcb/check-cam-preview.py \
  --regulator-baseline build/qualification/regulator/baseline.zip \
  build/qualification/regulator/clipped.zip
```

The browser acceptance test saves the same two previews from the offline
editor. It reviews every CAM layer and exports
`regulator-manufacturing-release.zip` from the baseline. The clipped
revision still fails the release rules. The coupon uses the PCB-only
release path and records its unlinked schematic state.

After checking the two previews with `--regulator-baseline`, verify the
release against that checked baseline.

```sh
python3 scripts/pcb/check-cam-preview.py --regulator-release regulator-baseline.zip regulator-manufacturing-release.zip
```

The checker verifies the release manifest, all payload hashes, the native
board identity and revision, and byte-identical fabrication files.
Physical fabrication and unpowered bench qualification are separate
steps. [Browser acceptance test](../../../scripts/tests/layout-browser/project-hierarchy.spec.mjs)
