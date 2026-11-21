# Adversarial geometry reference

Open [Geometry.tcproject](Geometry.tcproject) in Project mode or [Geometry.dpn](Geometry.dpn) in Single File mode. The 30 × 20 mm diagnostic coupon starts at X 468 mm, Y 477 mm. The large origin exercises integer nanometre geometry and CAM coordinates near the native board limit.

| Fixture feature | Expected result |
| --- | --- |
| Two foreign tracks separated by 1 nm | Clearance finding with a measured gap of 0.000001 mm. Separate copper islands. |
| Two foreign tracks tangent along an edge | Short and a measured clearance of zero. |
| Two foreign tracks overlapping by 1 nm | Short and a measured clearance of zero. |
| Same-net tracks tangent at one point | Located fragile-contact finding at X 474.1 mm, Y 489 mm. The graph records the contact and the finding blocks release. |
| Same-net tracks sharing a 4 mm edge | Continuous copper with no isolated-point finding. |
| A 2,051-vertex zone outline with two cutouts | Design checks measure the 1 µm copper web and block release against the 180 µm minimum. The diagnostic export retains both holes and the web for independent inspection. |
| Circular board cutout and a non-plated hole | Gerber retains the two profile arcs and Excellon retains the 0.8 mm drill. |

The generator also tests a one-nanometre outline gap and repairs it explicitly. It rejects a tangent cutout and a 100 nm gap at the curved boundary, accepts 101 nm, and confirms that a zone above the outline vertex budget is rejected. A translated copy near the origin must give the same fill rings and connectivity findings. Unchanged native saves and repeated CAM payloads must match byte for byte.

## Reproduce the digital checks

```sh
node scripts/pcb/adversarial-reference.mjs build/qualification/adversarial
```

The generator prints elapsed times, the filled vertex count and the WASM heap allocation. On the Linux development host, the translated run completed in under half a second and the kernel allocated about 16.1 MiB. The browser test opens the copied sample offline, checks the findings and downloads a diagnostic CAM bundle. With Gerbonara 1.6.3 installed, run the independent check against that download.

```sh
python3 scripts/pcb/check-cam-preview.py --adversarial path/to/adversarial-cam-preview.zip
```

[Offline browser acceptance test](../../../scripts/tests/layout-browser/project-hierarchy.spec.mjs)
