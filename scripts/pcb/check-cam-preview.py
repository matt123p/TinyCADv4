"""Check TinyCAD CAM fixture downloads with Gerbonara 1.6.3."""

import csv
import hashlib
import io
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

from gerbonara import ExcellonFile, GerberFile, __version__
from gerbonara.graphic_objects import Arc, Flash, Line, Region
from gerbonara.utils import MM


def expect(actual, expected, label):
    if actual != expected:
        raise ValueError(f"{label}: expected {expected}, got {actual}")


def dimensions(actual, expected, label, tolerance=1e-6):
    if len(actual) != len(expected) or any(
        not math.isclose(a, b, abs_tol=tolerance, rel_tol=0)
        for a, b in zip(actual, expected)
    ):
        raise ValueError(f"{label}: expected {expected}, got {actual}")


def region_contains(region, point):
    x, y = point
    outline = region.outline
    crossings = sum(
        (a[1] > y) != (b[1] > y) and
        x < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])
        for a, b in zip(outline, outline[1:] + outline[:1])
    )
    return crossings % 2 == 1


def assembly_markers(sheet):
    svg = "{http://www.w3.org/2000/svg}"
    return sorted(
        (marker.get("data-assembly-marker"), marker.get("data-pad"),
         float(marker.find(f"{svg}circle").get("cx")),
         float(marker.find(f"{svg}circle").get("cy")))
        for marker in sheet.findall(f"{svg}g/{svg}g[@data-assembly-marker]")
    )


def check(bundle, legend_text=False):
    def read(name):
        return bundle.read(name).decode("utf-8")

    def gerber(name):
        return GerberFile.from_string(read(name), filename=name)

    manifest = json.loads(read("manifest.json"))
    artwork = {
        "mask-top.gbr": ("Soldermask", "Top", "Negative", (4.4, 4.2, 5.6, 5)),
        "mask-bottom.gbr": ("Soldermask", "Bot", "Negative", (16, 9.4, 16.8, 10.6)),
        "paste-top.gbr": ("Paste", "Top", "Positive", (4.6, 4.4, 5.4, 4.8)),
        "paste-bottom.gbr": ("Paste", "Bot", "Positive", (16.2, 9.6, 16.6, 10.4)),
        "silk-top.gbr": ("Legend", "Top", "Positive", (4.1, 5.7, 5.9, 6)),
        "silk-bottom.gbr": ("Legend", "Bot", "Positive", (15, 9.1, 15.3, 10.9)),
    }
    glyph_probes = {}
    if legend_text:
        expect(manifest["legendFont"], "tinycad-pcb-strokes/1", "plotted font revision")
        artwork["silk-top.gbr"] = ("Legend", "Top", "Positive", (4, 5.6, 6, 6.1))
        artwork["silk-bottom.gbr"] = ("Legend", "Bot", "Positive", (14.9, 9, 15.4, 11))
        glyph_probes = {
            "silk-top.gbr": [(4.1, 5.85, True), (5.3, 5.7, True), (5.3, 5.97, False)],
            "silk-bottom.gbr": [(15.15, 10.9, True), (15.3, 9.5, True), (15.01, 9.5, False)],
        }
        expect(any(issue["code"] == "silk-text" for issue in json.loads(read("checks.json"))["issues"]),
               False, "supported legend glyph")
    expected_names = {
        *artwork, "copper-top.gbr", "copper-bottom.gbr", "profile.gbr",
        "plated.xnc", "non-plated.xnc", "bom.csv", "bom-fitted.csv", "placement.csv",
        "assembly.csv", "assembly-top.svg", "assembly-bottom.svg", "checks.json",
    }
    expect(sorted(bundle.namelist()), sorted(expected_names | {"manifest.json"}), "ZIP entries")
    expect(set(manifest["files"]), expected_names, "Hashed entries")
    for name, expected_hash in manifest["files"].items():
        expect(hashlib.sha256(bundle.read(name)).hexdigest(), expected_hash, name)
    expect(manifest["status"], "NOT RELEASED", "Package status")
    relative_to_check = json.loads(read("checks.json"))
    for key in ("revision", "boardId", "inputDigest", "fabrication"):
        expect(manifest[key], relative_to_check[key], f"Checks report {key}")
    expect(manifest["fabrication"]["profileId"], "classroom-v1", "Fabrication profile")
    expect(manifest["fabrication"]["thicknessNm"], 1600000, "Board thickness in nm")

    report = {}
    for name, (role, side, polarity, bounds) in artwork.items():
        layer = gerber(name)
        expect(layer.file_attrs.get(".FileFunction"), (role, side), name + " role")
        expect(layer.file_attrs.get(".FilePolarity"), (polarity,), name + " polarity")
        if len(layer.objects) != 1 or not isinstance(layer.objects[0], Region) or not layer.objects[0].polarity_dark:
            raise ValueError(f"Expected one aperture or legend region on {name}")
        low, high = layer.bounding_box(MM)
        dimensions((*low, *high), bounds, name + " bounds (mm)",
                   tolerance=0.0002 if name in glyph_probes else 1e-6)
        for x, y, expected in glyph_probes.get(name, []):
            expect(region_contains(layer.objects[0], (x, y)), expected, f"{name} glyph at {(x, y)}")
        report[name] = (*low, *high)

    for side, index, file_side, bounds in [
        ("top", "L1", "Top", (4.5, 3.5, 12.5, 4.9)),
        ("bottom", "L2", "Bot", (9.5, 3.5, 16.7, 10.5)),
    ]:
        name = f"copper-{side}.gbr"
        layer = gerber(name)
        expect(layer.file_attrs.get(".FileFunction"), ("Copper", index, file_side), name + " role")
        expect(layer.file_attrs.get(".FilePolarity"), ("Positive",), name + " polarity")
        expect(sum(isinstance(obj, Region) and not obj.polarity_dark for obj in layer.objects), 1, name + " slot voids")
        expect(sum(isinstance(obj, Region) and obj.polarity_dark for obj in layer.objects), 2, name + " copper regions")
        low, high = layer.bounding_box(MM)
        dimensions((*low, *high), bounds, name + " bounds (mm)", tolerance=0.005)
        report[name] = (*low, *high)

    profile = gerber("profile.gbr")
    expect(profile.file_attrs.get(".FileFunction"), ("Profile", "NP"), "Profile role")
    expect(sum(type(obj) is Line for obj in profile.objects), 4, "Outline edges")
    arcs = [obj for obj in profile.objects if isinstance(obj, Arc)]
    expect(len(arcs), 2, "Cutout arcs")
    low, high = profile.bounding_box(MM)
    dimensions((*low, *high), (-0.0005, -0.0005, 24.0005, 17.0005), "Outline stroke bounds (mm)")
    report["profile.gbr"] = (*low, *high)
    for arc in arcs:
        expect(arc.clockwise, False, "Cutout direction")
        dimensions(
            (arc.x1 + arc.cx, arc.y1 + arc.cy, math.hypot(arc.cx, arc.cy)),
            (20, 13, 0.5),
            "Cutout centre and radius (mm)",
        )

    plated = ExcellonFile.from_string(read("plated.xnc"), filename="plated.xnc")
    expect([type(obj) for obj in plated.objects], [Line], "Plated slots")
    slot = plated.objects[0]
    report["plated.xnc"] = (slot.x1, slot.y1, slot.x2, slot.y2, slot.aperture.diameter)
    dimensions(report["plated.xnc"], (10, 4, 12, 4, 0.6), "Plated slot (mm)")
    expect(plated.comments.count("#@! TF.FileFunction,Plated,1,2,PTH"), 1, "XNC slot plating attribute")

    nonplated = ExcellonFile.from_string(read("non-plated.xnc"), filename="non-plated.xnc")
    expect([type(obj) for obj in nonplated.objects], [Flash], "Non-plated holes")
    hole = nonplated.objects[0]
    report["non-plated.xnc"] = (hole.x, hole.y, hole.aperture.diameter)
    dimensions(report["non-plated.xnc"], (6, 12, 1.5), "Mounting hole (mm)")
    expect(nonplated.comments.count("#@! TF.FileFunction,NonPlated,1,2,NPTH"), 1, "XNC hole plating attribute")

    def csv_rows(name):
        return list(csv.DictReader(io.StringIO(read(name))))

    placements = csv_rows("placement.csv")
    expect([row["Reference"] for row in placements], ["U1"], "Fitted placements")
    rows = csv_rows("assembly.csv")
    fields = ("Reference", "Population", "X (mm)", "Y (mm)", "Side", "Rotation (deg)")
    expect([tuple(row[field] for field in fields) for row in rows], [
        ("U1", "Fitted", "4", "4", "top", "0"),
        ("U2", "DNP", "17", "11", "bottom", "90"),
    ], "Assembly placements")
    expect([(row["References"], row["Population"]) for row in csv_rows("bom.csv")],
           [("U1", "Fitted"), ("U2", "DNP")], "BOM population")
    expect([(row["References"], row["Population"]) for row in csv_rows("bom-fitted.csv")],
           [("U1", "Fitted")], "Fitted BOM population")

    svg = "{http://www.w3.org/2000/svg}"
    for side, ref, anchor_x in (("top", "U1", 4), ("bottom", "U2 (DNP)", 7)):
        sheet = ET.fromstring(read(f"assembly-{side}.svg"))
        expect(sheet.get("width"), "36mm", side + " drawing width")
        expect(sheet.get("height"), "34mm", side + " drawing height")
        expect(sheet.get("viewBox"), "-6 -23 36 34", side + " drawing view box")
        text = sheet.find(f"{svg}g/{svg}text")
        expect(text.text, ref, side + " drawing reference")
        dimensions((float(text.get("x")),), (anchor_x + 0.55,), side + " drawing label X")
        expect(any(p.get("d") == "M-5,8.5 H5" for p in sheet.findall(f"{svg}path")),
               True, side + " drawing scale mark")
    return {
        "gerbonara": __version__,
        "boardId": manifest["boardId"],
        "revision": manifest["revision"],
        "checkedBundleEntries": len(expected_names),
        "geometryMm": report,
    }


def check_classroom_led(bundle, dnp=False):
    def read(name):
        return bundle.read(name).decode("utf-8")

    manifest = json.loads(read("manifest.json"))
    if manifest.get("kind") == "tinycad-manufacturing-release":
        expect(manifest["status"], "RELEASED", "Manufacturing release status")
        expect(manifest["checks"]["readiness"], [], "Manufacturing release blockers")
        expect(manifest["schematic"]["state"], "current", "Release schematic parity")
        hashes = {output["filename"]: output["sha256"] for output in manifest["outputs"]}
        expect(set(manifest["cam"]["reviewedFiles"]),
               {name for name in hashes if name.endswith((".gbr", ".xnc"))},
               "Every fabrication file reviewed")
        board = ET.fromstring(read("board.dpn"))
        identity = board.find("DPNIDENTITY")
        expect(identity.get("id"), manifest["boardId"], "Frozen board identity")
        expect(int(identity.get("revision")), manifest["revision"], "Frozen board revision")
        parent = board.find("RELEASEPARENT")
        if parent is None:
            expect(manifest.get("parentRelease"), None, "No parent release")
        else:
            expect(manifest.get("parentRelease"), {
                "id": parent.get("id"),
                "revision": int(parent.get("revision")),
                "boardSha256": parent.get("board_sha256"),
            }, "Frozen release parent")
        expect(hashes["board.dpn"], manifest["nativeBoardSha256"], "Frozen board hash")
    else:
        hashes = manifest["files"]
    expect(set(bundle.namelist()), set(hashes) | {"manifest.json"}, "ZIP entries")
    for filename, sha256 in hashes.items():
        expect(hashlib.sha256(bundle.read(filename)).hexdigest(), sha256, filename + " hash")

    profile = GerberFile.from_string(read("profile.gbr"), filename="profile.gbr")
    expect([type(obj) for obj in profile.objects], [Line] * 4, "Outline edges")
    low, high = profile.bounding_box(MM)
    dimensions((*low, *high), (-0.0005, -0.0005, 40.0005, 22.0005), "Outline (mm)")
    plated = ExcellonFile.from_string(read("plated.xnc"), filename="plated.xnc")
    expect([type(obj) for obj in plated.objects], [Flash] * 6, "Plated round holes")
    expect(plated.comments.count("#@! TF.FileFunction,Plated,1,2,PTH"), 1, "Drill plating attribute")
    drills = sorted((round(obj.x, 4), round(obj.y, 4), round(obj.aperture.diameter, 4)) for obj in plated.objects)
    expect(drills, [(7, 7.75, 1), (7, 10.25, 1), (14.19, 7.75, 0.8),
                    (21.81, 7.75, 0.8), (28.73, 7.75, 0.9), (31.27, 7.75, 0.9)], "Drill coordinates and tools (mm)")
    top_assembly = ET.fromstring(read("assembly-top.svg"))
    expected_markers = [("pin-1", "1", 7.0, -7.75)]
    if not dnp:
        expected_markers.insert(0, ("cathode", "1", 31.27, -7.75))
    expect(assembly_markers(top_assembly), expected_markers, "Assembly markers on fitted parts")
    expect(assembly_markers(ET.fromstring(read("assembly-bottom.svg"))), [], "No bottom assembly marks")
    expect(any("Fit the LED cathode to the pad marked K." in text for text in top_assembly.itertext()),
           not dnp, "Assembly note for a fitted LED")
    expect(any(text == "D1 (DNP)" for text in top_assembly.itertext()), dnp, "LED DNP marking")
    nonplated = ExcellonFile.from_string(read("non-plated.xnc"), filename="non-plated.xnc")
    expect(len(nonplated.objects), 0, "Non-plated holes")

    drill_centres = [(x, y) for x, y, _ in drills]
    expected_top = [{(7, 7.75), (14.19, 7.75)}, {(21.81, 7.75), (28.73, 7.75)}, {(7, 10.25), (31.27, 7.75)}]
    for side, layer_index, face, expected in (
        ("top", "L1", "Top", expected_top),
        ("bottom", "L2", "Bot", [{centre} for centre in drill_centres]),
    ):
        name = f"copper-{side}.gbr"
        layer = GerberFile.from_string(read(name), filename=name)
        expect(layer.file_attrs.get(".FileFunction"), ("Copper", layer_index, face), name + " role")
        dark = [obj for obj in layer.objects if isinstance(obj, Region) and obj.polarity_dark]
        holes = [obj for obj in layer.objects if isinstance(obj, Region) and not obj.polarity_dark]
        expect(len(dark), len(expected), name + " copper islands")
        actual = [{centre for centre in drill_centres if region_contains(region, centre)} for region in dark]
        expect(sorted(map(sorted, actual)), sorted(map(sorted, expected)), name + " pad membership")
        expect([sum(region_contains(hole, centre) for hole in holes) for centre in drill_centres],
               [1] * 6, name + " clear drill voids")
    expect(json.loads(read("checks.json"))["issues"], [], "Design-check findings")
    def rows(name):
        return list(csv.DictReader(io.StringIO(read(name))))
    fitted = {"J1", "R1"} if dnp else {"J1", "R1", "D1"}
    expect({row["Reference"] for row in rows("placement.csv")}, fitted, "Fitted placement")
    expect({(row["References"], row["Quantity"], row["Population"]) for row in rows("bom-fitted.csv")},
           {(ref, "1", "Fitted") for ref in fitted}, "Fitted BOM")
    expected_population = {"J1": "Fitted", "R1": "Fitted", "D1": "DNP" if dnp else "Fitted"}
    expect({row["References"]: row["Population"] for row in rows("bom.csv")},
           expected_population, "Board BOM population")
    expect({row["Reference"]: row["Population"] for row in rows("assembly.csv")},
           expected_population, "Assembly population")
    return {
        "gerbonara": __version__,
        "boardId": manifest["boardId"],
        "revision": manifest["revision"],
        "outlineMm": [40, 22],
        "platedDrillsMm": drills,
        "topCopperIslands": 3,
        "bottomCopperIslands": 6,
    }


def check_timer_logic(bundle):
    def read(name):
        return bundle.read(name).decode("utf-8")

    manifest = json.loads(read("manifest.json"))
    expect(set(bundle.namelist()), set(manifest["files"]) | {"manifest.json"}, "ZIP entries")
    for filename, sha256 in manifest["files"].items():
        expect(hashlib.sha256(bundle.read(filename)).hexdigest(), sha256, filename + " hash")
    expect("copper-bottom.gbr" in bundle.namelist(), False, "Single copper layer")
    top = GerberFile.from_string(read("copper-top.gbr"), filename="copper-top.gbr")
    expect(top.file_attrs.get(".FileFunction"), ("Copper", "L1", "Top"), "Copper role")
    expect([has_copper(top, point) for point in [(32.78, 12.95), (32.78, 12.5), (40, 5)]],
           [False, True, True], "Clearance between the control pad and VCC, VCC route and ground pour")
    profile = GerberFile.from_string(read("profile.gbr"), filename="profile.gbr")
    expect([type(obj) for obj in profile.objects], [Line] * 4, "Outline edges")
    low, high = profile.bounding_box(MM)
    dimensions((*low, *high), (-0.0005, -0.0005, 76.0005, 48.0005), "Outline (mm)")

    plated = ExcellonFile.from_string(read("plated.xnc"), filename="plated.xnc")
    expect([type(obj) for obj in plated.objects], [Flash] * 32, "Plated part holes")
    expect(sorted(round(obj.aperture.diameter, 3) for obj in plated.objects),
           [0.8] * 20 + [0.85] * 8 + [1.0] * 4, "Plated drill tools (mm)")
    nonplated = ExcellonFile.from_string(read("non-plated.xnc"), filename="non-plated.xnc")
    expect([type(obj) for obj in nonplated.objects], [Flash] * 2, "Jumper holes")
    jumper_holes = sorted((obj.x, obj.y, obj.aperture.diameter) for obj in nonplated.objects)
    expect(jumper_holes, [(31, 18, 0.9), (43, 23, 0.9)], "JP1 holes (mm)")
    for drill in [*plated.objects, *nonplated.objects]:
        polarity = [obj.polarity_dark for obj in top.objects
                    if isinstance(obj, Region) and region_contains(obj, (drill.x, drill.y))]
        expect(any(polarity) and not polarity[-1], True, f"Clear copper at drill {(drill.x, drill.y)}")

    checks = json.loads(read("checks.json"))
    expect([issue["code"] for issue in checks["issues"]], ["bare-open-bridged"], "Design-check findings")
    expect(checks["jumperConnectivity"]["assembledOpenNets"], [], "Assembled opens")
    placements = list(csv.DictReader(io.StringIO(read("placement.csv"))))
    expect(sorted(row["Reference"] for row in placements),
           ["C1", "C2", "C3", "J1", "U1", "U2"], "Fitted device placements")
    return {
        "gerbonara": __version__,
        "boardId": manifest["boardId"],
        "revision": manifest["revision"],
        "outlineMm": [76, 48],
        "platedDrills": len(plated.objects),
        "jumperDrillsMm": jumper_holes,
    }


def check_connector(bundle):
    def read(name):
        return bundle.read(name).decode("utf-8")

    manifest = json.loads(read("manifest.json"))
    expect(manifest["status"], "NOT RELEASED", "Preview status")
    expect(set(bundle.namelist()), set(manifest["files"]) | {"manifest.json"}, "ZIP entries")
    for name, sha256 in manifest["files"].items():
        expect(hashlib.sha256(bundle.read(name)).hexdigest(), sha256, name + " hash")
    profile = GerberFile.from_string(read("profile.gbr"), filename="profile.gbr")
    expect([type(obj) for obj in profile.objects], [Line] * 4, "Outline edges")
    low, high = profile.bounding_box(MM)
    dimensions((*low, *high), (-0.0005, -0.0005, 44.0005, 32.0005), "Outline (mm)")

    plated = ExcellonFile.from_string(read("plated.xnc"), filename="plated.xnc")
    expect([type(obj) for obj in plated.objects], [Line] * 3, "Plated slots")
    expect("#@! TF.FileFunction,Plated,1,2,PTH" in plated.comments, True, "Plated drill file role")
    slots = sorted((*sorted(((obj.x1, obj.y1), (obj.x2, obj.y2))), obj.aperture.diameter)
                   for obj in plated.objects)
    expect(slots, [
        ((25.7, 10.5), (26.3, 10.5), 1),
        ((25.7, 16.5), (26.3, 16.5), 1),
        ((30.7, 13.2), (30.7, 13.8), 1),
    ], "Slot endpoints and finished widths (mm)")
    nonplated = ExcellonFile.from_string(read("non-plated.xnc"), filename="non-plated.xnc")
    expect([type(obj) for obj in nonplated.objects], [Flash] * 2, "Mounting holes")
    expect("#@! TF.FileFunction,NonPlated,1,2,NPTH" in nonplated.comments, True, "Non-plated drill file role")
    holes = sorted((obj.x, obj.y, obj.aperture.diameter) for obj in nonplated.objects)
    expect(holes, [(5, 5, 3.2), (39, 27, 3.2)], "Mounting holes (mm)")

    for side, index, designation in [("top", "L1", "Top"), ("bottom", "L2", "Bot")]:
        name = f"copper-{side}.gbr"
        copper = GerberFile.from_string(read(name), filename=name)
        expect(copper.file_attrs.get(".FileFunction"), ("Copper", index, designation), name + " role")
        for (x1, y1), (x2, y2), _ in slots:
            centre = ((x1 + x2) / 2, (y1 + y2) / 2)
            polarities = [obj.polarity_dark for obj in copper.objects
                          if isinstance(obj, Region) and region_contains(obj, centre)]
            expect(polarities, [True, False], f"{side} land and clear slot at {centre}")
    expect("silk-top.gbr" in bundle.namelist(), False, "Empty top legend omitted")
    silk = GerberFile.from_string(read("silk-bottom.gbr"), filename="silk-bottom.gbr")
    expect(silk.file_attrs.get(".FileFunction"), ("Legend", "Bot"), "Bottom legend role")
    expect(len(silk.objects), 1, "Bottom legend count")
    expect(region_contains(silk.objects[0], (26, 11.725)), True, "Bottom pin-1 mark")

    fields = ("Reference", "Package", "X (mm)", "Y (mm)", "Side", "Rotation (deg)")
    placements = list(csv.DictReader(io.StringIO(read("placement.csv"))))
    expect([tuple(row[field] for field in fields) for row in placements],
           [("J1", "PJ-102A", "26", "17", "bottom", "90")], "Fitted connector placement")
    svg = "{http://www.w3.org/2000/svg}"
    top = ET.fromstring(read("assembly-top.svg"))
    bottom = ET.fromstring(read("assembly-bottom.svg"))
    expect(top.findall(f"{svg}g/{svg}text"), [], "Top assembly omits the bottom connector")
    expect(assembly_markers(top), [], "No top assembly marker")
    expect(assembly_markers(bottom), [("pin-1", "1", 18.0, -10.5)],
           "Bottom pin-1 mark coincides with mirrored plated slot coordinates")
    reference = bottom.find(f"{svg}g/{svg}text")
    expect(reference.text, "J1", "Bottom assembly reference")
    dimensions((float(reference.get("x")), float(reference.get("y"))),
               (18.55, -17.45), "Mirrored assembly label with offset (mm)")
    return {"gerbonara": __version__, "boardId": manifest["boardId"], "slotsMm": slots, "mountingHolesMm": holes}


def check_replaced_led_drill(bundle):
    manifest = json.loads(bundle.read("manifest.json"))
    expect(manifest["status"], "NOT RELEASED", "Diagnostic status")
    for filename, sha256 in manifest["files"].items():
        expect(hashlib.sha256(bundle.read(filename)).hexdigest(), sha256, filename + " hash")
    plated = ExcellonFile.from_string(bundle.read("plated.xnc").decode("utf-8"), filename="plated.xnc")
    expect([type(obj) for obj in plated.objects], [Flash] * 6, "Plated openings")
    openings = sorted((obj.x, obj.y, obj.aperture.diameter) for obj in plated.objects)
    expect(openings, [(7, 7.75, 1), (7, 10.25, 1), (14.19, 7.75, 0.8),
                      (21.81, 7.75, 0.8), (28.73, 7.75, 0.9), (31.27, 5.75, 1.1)],
           "Five original openings and the relocated LED contact")
    report = json.loads(bundle.read("checks.json"))
    expect(sorted(item["code"] for item in report["issues"]),
           ["open", "route-review", "route-review", "route-review"], "Unresolved copper findings")
    return {"gerbonara": __version__, "boardId": manifest["boardId"], "revision": manifest["revision"],
            "replacedOpeningMm": [31.27, 5.75, 1.1]}


def check_zone_rebuild(baseline, release):
    before = json.loads(baseline.read("manifest.json"))
    after = json.loads(release.read("manifest.json"))
    expect(before["status"], "NOT RELEASED", "Baseline status")
    expect(after["status"], "RELEASED", "Regenerated release status")
    expect(before["boardId"], after["boardId"], "Same board")
    expect(after["revision"] > before["revision"], True, "Newer released revision")
    expect(after["checks"]["readiness"], [], "Release blockers")
    expect(after["rules"]["effective"]["clearanceNm"], 650000, "Updated clearance (nm)")
    after_hashes = {output["filename"]: output["sha256"] for output in after["outputs"]}
    for bundle, hashes in [(baseline, before["files"]), (release, after_hashes)]:
        expect(set(bundle.namelist()), set(hashes) | {"manifest.json"}, "ZIP entries")
        for filename, sha256 in hashes.items():
            expect(hashlib.sha256(bundle.read(filename)).hexdigest(), sha256, filename + " hash")

    def parse(bundle, filename):
        return GerberFile.from_string(bundle.read(filename).decode("utf-8"), filename=filename)

    for filename in ("copper-top.gbr", "plated.xnc", "non-plated.xnc"):
        expect(baseline.read(filename), release.read(filename), filename + " unaffected")
    probes = [(15.41, 7.75), (15.90, 7.75), (38.5, 14), (37.5, 14)]
    for bundle, width, expected in [(baseline, 40, [True] * 4), (release, 38, [False, True, False, True])]:
        profile = parse(bundle, "profile.gbr")
        low, high = profile.bounding_box(MM)
        dimensions((*low, *high), (-0.0005, -0.0005, width + 0.0005, 22.0005), "Outline (mm)")
        layer = parse(bundle, "copper-bottom.gbr")
        expect([has_copper(layer, point) for point in probes], expected,
               "Copper beyond pad clearance and at the board edge")
    return {"gerbonara": __version__, "boardId": after["boardId"],
            "previousRevision": before["revision"], "releasedRevision": after["revision"],
            "outlineWidthMm": [40, 38], "updatedClearanceMm": 0.65}


def has_copper(layer, point):
    polarity = [obj.polarity_dark for obj in layer.objects
                if isinstance(obj, Region) and region_contains(obj, point)]
    return bool(polarity and polarity[-1])


def check_regulators(baseline, clipped):
    before, after = (json.loads(bundle.read("manifest.json")) for bundle in (baseline, clipped))
    expect(before["boardId"], after["boardId"], "Same regulator board")
    expect(after["revision"], before["revision"] + 1, "One zone edit")
    for bundle, manifest in ((baseline, before), (clipped, after)):
        expect(manifest["status"], "NOT RELEASED", "Diagnostic status")
        expect(sorted(bundle.namelist()), sorted(set(manifest["files"]) | {"manifest.json"}), "ZIP entries")
        for name, sha256 in manifest["files"].items():
            expect(hashlib.sha256(bundle.read(name)).hexdigest(), sha256, name + " hash")
    for name in ("copper-top.gbr", "profile.gbr", "paste-top.gbr", "mask-top.gbr", "plated.xnc"):
        expect(baseline.read(name), clipped.read(name), name + " unaffected")

    def gerber(bundle, name):
        return GerberFile.from_string(bundle.read(name).decode("utf-8"), filename=name)

    paste = gerber(baseline, "paste-top.gbr")
    expected_pads = [
        (8.8, 12.95, .8, .55), (8.8, 12, .8, .55), (8.8, 11.05, .8, .55),
        (11.2, 11.05, .8, .55), (11.2, 12.95, .8, .55),
        *((x, y, 1.55, .6) for x in (25.3, 30.7) for y in (10.095, 11.365, 12.635, 13.905)),
        (28, 12, 2.71, 3.4),
    ]
    expect(len(paste.objects), len(expected_pads), "Paste apertures")
    actual_pads = []
    for obj in paste.objects:
        expect((type(obj), obj.polarity_dark), (Region, True), "Paste aperture type")
        (left, bottom), (right, top) = obj.bounding_box(MM)
        actual_pads.append(((left + right) / 2, (bottom + top) / 2, right - left, top - bottom))

    def by_centre(opening):
        return (round(opening[0], 5), round(opening[1], 5))

    for actual, expected in zip(sorted(actual_pads, key=by_centre), sorted(expected_pads, key=by_centre)):
        dimensions(actual, expected, "Paste centre and dimensions")

    drills = ExcellonFile.from_string(baseline.read("plated.xnc").decode("utf-8"), filename="plated.xnc")
    expect([type(obj) for obj in drills.objects], [Flash] * 3, "Through-via drill type")
    openings = sorted((obj.x, obj.y, obj.aperture.diameter) for obj in drills.objects)
    expect(openings, [(6.5, 12, .3), (28, 8, .3), (34, 13.905, .3)], "Plated drills and locations")

    top = gerber(baseline, "copper-top.gbr")
    probes = [(14, 13.19), (14, 13.22), (34, 11.625), (34, 11.655),
              (29.3, 12), (29.5, 12), (28.30, 9), (28.35, 9), (28, 8)]
    expect([has_copper(top, point) for point in probes],
           [True, False, True, False, True, False, True, False, False],
           "Output tracks, exposed pad, ground track and through-via opening")
    probes = [(28.65, 8.10), (28.65, 7.90), (28, 8.65), (27.35, 8), (28, 7.35), (28.55, 8.55), (28, 8)]
    for bundle, expected in [(baseline, [True] * 5 + [False, False]),
                             (clipped, [False, True, False, True, True, False, False])]:
        bottom = gerber(bundle, "copper-bottom.gbr")
        expect([has_copper(bottom, point) for point in probes], expected,
               "Bottom thermal spokes, diagonal clearance and via opening")
    issues = json.loads(clipped.read("checks.json"))["issues"]
    expect(sorted(item["code"] for item in issues), ["thermal-spoke-missing", "thermal-spoke-width"],
           "Connected copper with defective thermal spokes")
    narrow = next(item for item in issues if item["code"] == "thermal-spoke-width")
    dimensions((narrow["measuredNm"] / 1e6, narrow["requiredNm"] / 1e6), (.18, .30),
               "East spoke measured and requested width", .0002)
    expect(json.loads(baseline.read("checks.json"))["issues"], [], "Baseline findings")
    return {"gerbonara": __version__, "boardId": after["boardId"],
            "pasteApertures": len(expected_pads), "platedVias": len(openings),
            "missingSpoke": "North", "narrowSpoke": "East"}


def check_filter(bundle):
    manifest = json.loads(bundle.read("manifest.json"))
    expect(manifest["status"], "NOT RELEASED", "Diagnostic status")
    expect(sorted(bundle.namelist()), sorted(set(manifest["files"]) | {"manifest.json"}), "ZIP entries")
    for name, sha256 in manifest["files"].items():
        expect(hashlib.sha256(bundle.read(name)).hexdigest(), sha256, name + " hash")
    report = json.loads(bundle.read("checks.json"))
    expect(report["issues"], [], "Filter DRC findings")

    def gerber(name):
        return GerberFile.from_string(bundle.read(name).decode("utf-8"), filename=name)

    top = gerber("copper-top.gbr")
    bottom = gerber("copper-bottom.gbr")
    expect([has_copper(top, point) for point in [(17.5, 21.365), (17.5, 21.7), (21.19, 20.73)]],
           [True, False, False], "Top RC route, clearance and op-amp pin 3 hole")
    expect([has_copper(bottom, point) for point in [(18, 16), (18.32, 16), (18.65, 16), (25, 22)]],
           [True, False, True, True], "Bottom OUT route, plane gap, plane and op-amp feedback")
    expect([has_copper(bottom, (x, 5)) for x in (20.19, 22.73, 25.27, 27.81)],
           [False] * 4, "Ground pour relief between header pads")
    expect(has_copper(bottom, (20.19, 4.1)), True, "Ground pour beside the header relief")
    drills = ExcellonFile.from_string(bundle.read("plated.xnc").decode("utf-8"), filename="plated.xnc")
    expect([type(obj) for obj in drills.objects], [Flash] * 21, "Plated pad holes")
    expect(sorted(obj.aperture.diameter for obj in drills.objects), [.8] * 8 + [.85] * 8 + [1.05] * 5,
           "Resistor, capacitor, DIP and header drill diameters")
    rc_holes = {(13.81, 22, .8), (11.75, 15, .8), (21.19, 20.73, .85)}
    openings = {(obj.x, obj.y, obj.aperture.diameter) for obj in drills.objects}
    expect(rc_holes <= openings, True, "The three cross-probed RC terminals have plated holes")
    return {"gerbonara": __version__, "boardId": manifest["boardId"],
            "platedPadHoles": len(openings), "rcTerminals": sorted(rc_holes)}


def check_mcu_sensor(bundle):
    manifest = json.loads(bundle.read("manifest.json"))
    expect(manifest["status"], "NOT RELEASED", "Diagnostic status")
    expect(sorted(bundle.namelist()), sorted(set(manifest["files"]) | {"manifest.json"}), "ZIP entries")
    for name, sha256 in manifest["files"].items():
        expect(hashlib.sha256(bundle.read(name)).hexdigest(), sha256, name + " hash")
    expect(json.loads(bundle.read("checks.json"))["issues"], [], "Sensor PCB findings")

    def gerber(name):
        return GerberFile.from_string(bundle.read(name).decode("utf-8"), filename=name)

    top = gerber("copper-top.gbr")
    bottom = gerber("copper-bottom.gbr")
    for layer in (top, bottom):
        expect([has_copper(layer, (x, y)) for x in (16, 25, 33, 40)
                for y in (36.6, 36.75, 36.9)], [False] * 12, "Antenna edge copper exclusion")
    expect(has_copper(bottom, (26, 35.5)), True, "Ground plane below antenna area")
    for x in (27.11, 28.21, 29.31):
        for y in (28.6, 29.7, 30.8):
            expect(has_copper(top, (x + .23, y + .23)), True, "Module exposed ground land")
    expect([has_copper(top, (x, 24.905)) for x in (8.3, 13.7)], [True, True], "Sensor top pad rows")
    profile = gerber("profile.gbr")
    corners = {(obj.x1, obj.y1) for obj in profile.objects if isinstance(obj, Line)}
    expect(corners, {(0, 0), (0, 37), (54, 0), (54, 37)}, "Carrier perimeter")

    drills = ExcellonFile.from_string(bundle.read("plated.xnc").decode("utf-8"), filename="plated.xnc")
    diameters = [round(obj.aperture.diameter, 6) for obj in drills.objects]
    expect(diameters.count(1.05), 6, "Power and UART header holes")
    expect(set(diameters), {.3, 1.05}, "Drill sizes")
    placement = list(csv.reader(io.StringIO(bundle.read("placement.csv").decode("utf-8"))))
    expect(len(placement[1:]), 15, "Fitted components")
    return {"gerbonara": __version__, "boardId": manifest["boardId"],
            "centreLands": 9, "platedVias": diameters.count(.3), "headerHoles": 6}


def check_adversarial(bundle):
    manifest = json.loads(bundle.read("manifest.json"))
    expect(manifest["status"], "NOT RELEASED", "Diagnostic status")
    expect(sorted(bundle.namelist()), sorted(set(manifest["files"]) | {"manifest.json"}), "ZIP entries")
    for name, sha256 in manifest["files"].items():
        expect(hashlib.sha256(bundle.read(name)).hexdigest(), sha256, name + " hash")
    findings = json.loads(bundle.read("checks.json"))["issues"]
    expect(sum(item["code"] == "short" for item in findings), 2, "Touching and overlapping copper pairs")
    expect(sorted(item["measuredNm"] for item in findings if item["code"] == "copper-clearance"),
           [0, 0, 1], "Measured gaps")
    contacts = [item for item in findings if item["code"] == "copper-point-contact"]
    expect(len(contacts), 1, "Single fragile same-net contact")
    expect(contacts[0]["location"], {"x": 474100000, "y": 489000000}, "Located point contact")
    webs = [item for item in findings if item["code"] == "zone-minimum-width"]
    expect([(item["measuredNm"], item["requiredNm"]) for item in webs], [(1000, 180000)], "Zone web width finding")
    expect(webs[0]["location"]["x"], 475000500, "Located zone web")

    def gerber(name):
        return GerberFile.from_string(bundle.read(name).decode("utf-8"), filename=name)

    top = gerber("copper-top.gbr")
    expect([(type(obj), obj.polarity_dark) for obj in top.objects if obj.bounding_box(MM)[1][1] < 488],
           [(Region, True)] * 4, "Top copper islands from the three gap examples")
    copper_y = [481, 481.2, 484, 484.2, 487, 487.199999]
    expect(all(has_copper(top, (475, y)) for y in copper_y), True, "All six tracks present")
    expect(has_copper(top, (475, 481.1000005)), False, "Midpoint of the 1 nm gap")
    expect(has_copper(top, (475, 484.0999995)), True, "Copper just below the tangent")
    expect(has_copper(top, (475, 484.1000005)), True, "Copper just above the tangent")
    expect(has_copper(top, (475, 487.0999995)), True, "Midpoint of the 1 nm overlap")
    expect(has_copper(top, (474.1, 489.000001)), False, "No web at the isolated point contact")
    expect(has_copper(top, (473, 491.100001)), True, "Continuous copper at the shared edge")

    bottom = gerber("copper-bottom.gbr")
    expect(sorted(obj.polarity_dark for obj in bottom.objects), [False, False, True], "Zone and holes")
    outline = next(obj for obj in bottom.objects if obj.polarity_dark)
    expect(len(outline.outline) >= 2048, True, "Many-vertex contour survived export")
    probes = [(474.5, 484), (475.0005, 484), (476, 484), (474.5, 485.1)]
    expect([has_copper(bottom, point) for point in probes],
           [False, True, False, True], "Two cutouts, narrow copper web and surrounding zone")

    profile = gerber("profile.gbr")
    expect(sum(isinstance(obj, Line) for obj in profile.objects), 4, "Straight perimeter segments")
    arcs = [obj for obj in profile.objects if isinstance(obj, Arc)]
    expect(len(arcs), 2, "Analytic cutout segments")
    for arc in arcs:
        dimensions(arc.center, (492, 491), "Cutout centre")
        dimensions((math.hypot(arc.x1 - arc.center[0], arc.y1 - arc.center[1]),), (1,), "Cutout radius")
    drills = ExcellonFile.from_string(bundle.read("non-plated.xnc").decode("utf-8"), filename="non-plated.xnc")
    expect([type(obj) for obj in drills.objects], [Flash], "Non-plated drill geometry")
    opening = drills.objects[0]
    dimensions((opening.x, opening.y, opening.aperture.diameter), (492, 482, .8), "Non-plated drill")
    return {"gerbonara": __version__, "boardId": manifest["boardId"], "gapNm": 1,
            "zoneWebNm": 1000, "zoneVertices": len(outline.outline), "shorts": 2}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    fixture = parser.add_mutually_exclusive_group()
    fixture.add_argument("--legend-text", action="store_true")
    fixture.add_argument("--classroom-led", action="store_true")
    fixture.add_argument("--classroom-led-dnp", action="store_true")
    fixture.add_argument("--classroom-led-replacement", action="store_true")
    fixture.add_argument("--timer-logic", action="store_true")
    fixture.add_argument("--connector", action="store_true")
    fixture.add_argument("--adversarial", action="store_true")
    fixture.add_argument("--filter", action="store_true")
    fixture.add_argument("--mcu-sensor", action="store_true")
    fixture.add_argument("--regulator-baseline", type=Path)
    fixture.add_argument("--zone-baseline", type=Path)
    args = parser.parse_args()
    expect(__version__, "1.6.3", "Qualification reader version")
    with ZipFile(args.archive) as bundle:
        if args.adversarial:
            result = check_adversarial(bundle)
        elif args.regulator_baseline:
            with ZipFile(args.regulator_baseline) as before:
                result = check_regulators(before, bundle)
        elif args.zone_baseline:
            with ZipFile(args.zone_baseline) as before:
                result = check_zone_rebuild(before, bundle)
        elif args.classroom_led_replacement:
            result = check_replaced_led_drill(bundle)
        elif args.connector:
            result = check_connector(bundle)
        elif args.filter:
            result = check_filter(bundle)
        elif args.mcu_sensor:
            result = check_mcu_sensor(bundle)
        elif args.timer_logic:
            result = check_timer_logic(bundle)
        elif args.classroom_led or args.classroom_led_dnp:
            result = check_classroom_led(bundle, args.classroom_led_dnp)
        else:
            result = check(bundle, args.legend_text)
        print(json.dumps(result, indent=2))
