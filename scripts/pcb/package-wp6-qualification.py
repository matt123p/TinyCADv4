"""Package the digitally verified fixtures and blank WP6 qualification records."""

import argparse
import csv
import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[2]
README = """# TinyCAD WP6 qualification packet

Follow the [facilitator and bench instructions](docs/pcb-qualification.md).
Give each participant a copy of **exercise/**. The rest of the packet is
for the observer or bench team.

- **fabrication/A-led/** contains the manufacturing release from the offline LED lesson.
- **fabrication/D-regulators/** contains the release and source for the unpowered SMT coupon.
- **fabrication/E-connector/** contains the source, CAM preview, and manufacturing review for the original coupon. Use the cover sheet to obtain process acceptance for its plated slots.
- **digital-evidence/** contains independent read-back results for all seven M1 reference boards, with previews and regression archives.
- **records/** contains blank bench and session records. Fabrication, assembly, observed sessions and reference-laptop measurements are pending.

`packet.json` identifies the exact board revisions, archive digests and source
checkout used to assemble the packet, and the fitted parts from each bench
archive. Run `sha256sum -c SHA256SUMS` from the extracted folder to check the files.
Source links in the documentation refer to the TinyCAD checkout.
"""
TASK = """# Classroom board task

Open **LED.tcproject** in TinyCAD. Place and connect the three components,
save the board, run design checks, and export a manufacturing release.
Use the built-in **First board guide** as needed.
"""
CONNECTOR_REVIEW = """# Connector coupon process review

Please assess the attached **connector-source-review.zip** for a 44 × 32 mm,
two-layer coupon with nominal 1.6 mm board thickness. This is a request for
process and CAM review. TinyCAD marks the archive **NOT RELEASED**.

- Board ID `{board_id}`, revision {revision}
- Review archive SHA-256 `{review_hash}`
- Native board SHA-256 `{native_hash}`

The archive contains the fabrication drawing, the tool and opening tables,
and the separate plated and non-plated Excellon files. The three slots
have round ends. Confirm that the process can hold the finished
dimensions **after plating**. Please report achievable tolerances and
any required changes to the files or openings.

| J1 opening | Centre in board coordinates (mm) | Finished size | Axis |
| --- | --- | --- | --- |
{slots}

The two mounting holes are non-plated, Ø3.20 mm. J1 mounts on the bottom.
Check the plated slot axes and positions in the unmirrored board data.
Use the bottom assembly drawing to check the connector-side orientation.

The coupon follows the PJ-102A recommended layout. Its slots have a 1.6:1
length-to-width ratio. JLCPCB publishes a 2:1 guideline, while PCBWay lists
sub-2:1 ratios in its advanced capabilities. These published limits
inform the review request. Record the supplier’s response and the exact
archive digest in the fabrication record. [Same Sky PCB layout](https://jp.sameskydevices.com/product/resource/pj-102a.pdf#page=2) · [JLCPCB slot guidance](https://jlcpcb.com/help/article/instructions-for-ordering#20-about-plated-slots) · [PCBWay advanced capabilities](https://www.pcbway.com/capabilities.html)
"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def artifact(results, filename):
    found = list(results.rglob(filename))
    if len(found) != 1:
        raise ValueError(f"Expected one {filename} under {results}, found {len(found)}.")
    return found[0]


def readback(*args):
    checker = ROOT / "scripts/pcb/check-cam-preview.py"
    return subprocess.run(
        [sys.executable, str(checker), "--all-layers", *map(str, args)],
        check=True, stdout=subprocess.PIPE,
    ).stdout


def archive_manifest(data, status):
    with ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["status"] != status:
            raise ValueError(f"Expected archive status {status}, found {manifest['status']}.")
        if "outputs" in manifest:
            for item in manifest["outputs"]:
                if sha256(archive.read(item["filename"])) != item["sha256"]:
                    raise ValueError(f"Archive hash mismatch for {item['filename']}.")
        return manifest


def fitted_parts(data, source_board):
    native = ElementTree.parse(source_board)
    expected = {}
    for component in native.findall("./COMPONENTDEFS/COMPONENTDEF"):
        procurement = component.find("PROCUREMENT")
        if procurement is None:
            raise ValueError(f"{source_board.name} is missing procurement for {component.get('ref')}.")
        expected[component.get("ref")] = (procurement.get("manufacturer"), procurement.get("mpn"))
    with ZipFile(io.BytesIO(data)) as archive:
        rows = csv.DictReader(io.StringIO(archive.read("bom-fitted.csv").decode()))
        parts = {}
        for row in rows:
            refs = [ref.strip() for ref in row["References"].split(",")]
            manufacturer = row["Manufacturer"].strip()
            mpn = row["MPN"].strip()
            if row["Population"] != "Fitted" or not manufacturer or not mpn:
                raise ValueError(f"Fitted parts {row['References']} require a manufacturer and MPN.")
            if int(row["Quantity"]) != len(refs):
                raise ValueError(f"Fitted quantity differs from the references for {mpn}.")
            for ref in refs:
                if ref in parts or expected.get(ref) != (manufacturer, mpn):
                    raise ValueError(f"Fitted part {ref!r} is repeated or differs from {source_board.name}.")
                parts[ref] = {"reference": ref, "manufacturer": manufacturer, "mpn": mpn}
    if expected.keys() != parts.keys():
        raise ValueError(f"Missing fitted references {', '.join(sorted(expected.keys() - parts.keys()))}.")
    return [parts[ref] for ref in sorted(parts)]


def checkout_fingerprint():
    files = subprocess.check_output([
        "git", "ls-files", "-z", "--cached", "--others", "--exclude-standard",
        "--", "src", "electron", "shared", "styles", "examples/pcb", "scripts/pcb",
        "scripts/tests/layout-browser", "package.json", "package-lock.json", ".parcelrc",
    ], cwd=ROOT).split(b"\0")
    listing = []
    for name in sorted(set(files) - {b""}):
        source = ROOT / name.decode()
        if source.is_file():
            listing.append(f"{sha256(source.read_bytes())}  {name.decode()}\n")
    return sha256("".join(listing).encode())


def connector_review_cover(preview_data, review_data, native, independent):
    preview = archive_manifest(preview_data, "NOT RELEASED")
    review = archive_manifest(review_data, "NOT RELEASED")
    if review["kind"] != "tinycad-manufacturing-review" or review["profile"] is not None:
        raise ValueError("Expected the unreleased connector process review.")
    if any(preview[key] != review[key] for key in ("boardId", "revision")):
        raise ValueError("Connector review and preview have different board revisions.")
    fabrication = {
        name: digest for name, digest in preview["files"].items()
        if name.endswith((".gbr", ".xnc"))
    }
    review_files = {item["filename"]: item["sha256"] for item in review["outputs"]}
    if not {"board.dpn", "fabrication.svg", "drill-tools.csv", "drill-openings.csv"} <= review_files.keys():
        raise ValueError("Connector review is missing its board, drawing or drill tables.")
    native_hash = sha256(native)
    if review_files["board.dpn"] != native_hash or review["nativeBoardSha256"] != native_hash:
        raise ValueError("Connector review differs from the included native board.")
    if (
        not review["cam"]["geometryVerified"]
        or set(fabrication) != set(review["cam"]["reviewedFiles"])
        or any(review_files.get(name) != digest for name, digest in fabrication.items())
    ):
        raise ValueError("Connector review CAM files differ from the independently read preview.")
    slots = []
    for start, end, width in independent["slotsMm"]:
        x, y = ((a + b) / 2 for a, b in zip(start, end))
        length = width + abs(start[0] - end[0]) + abs(start[1] - end[1])
        axis = "X" if start[1] == end[1] else "Y"
        slots.append(f"| {len(slots) + 1} | ({x:g}, {y:g}) | {width:.2f} × {length:.2f} mm plated | {axis} |")
    return CONNECTOR_REVIEW.format(
        board_id=review["boardId"], revision=review["revision"],
        review_hash=sha256(review_data), native_hash=review["nativeBoardSha256"],
        slots="\n".join(slots),
    ).encode()


def package(results, connector_source, connector_source_review, destination):
    led = artifact(results, "led-manufacturing-release.zip")
    led_saved = artifact(results, "led-saved-before-release.dpn")
    regulator = artifact(results, "regulator-manufacturing-release.zip")
    baseline = artifact(results, "regulator-baseline.zip")
    clipped = artifact(results, "regulator-clipped.zip")
    connector = artifact(results, "connector-cam-preview.zip")
    review = artifact(results, "connector-manufacturing-review.zip")

    files = {
        "README.md": README.encode(),
        "exercise/TASK.md": TASK.encode(),
        "digital-evidence/led.json": readback("--classroom-led", led),
        "digital-evidence/led-session-readback.json": readback("--classroom-session-board", led_saved, led),
        "digital-evidence/regulators.json": readback("--regulator-baseline", baseline, clipped),
        "digital-evidence/regulator-release.json": readback("--regulator-release", baseline, regulator),
        "digital-evidence/connector-source.json": readback("--connector", connector_source),
        "digital-evidence/connector-browser.json": readback("--connector", connector),
        "digital-evidence/regulator-baseline.zip": baseline.read_bytes(),
        "digital-evidence/regulator-clipped-thermal.zip": clipped.read_bytes(),
        "digital-evidence/connector-browser-preview.zip": connector.read_bytes(),
        "digital-evidence/connector-browser-review.zip": review.read_bytes(),
    }
    archive_manifest(files["digital-evidence/connector-browser-review.zip"], "NOT RELEASED")
    for source in [
        "docs/pcb-qualification.md", "docs/pcb-performance.md", "docs/pcb-g0.md",
        "docs/TinyCAD_PCB_Layout_Complete_Specification.md",
        "examples/pcb/led-classroom/README.md", "examples/pcb/regulator/README.md",
        "examples/pcb/connector/README.md", "examples/pcb/timer-logic/README.md",
        "examples/pcb/op-amp-filter/README.md", "examples/pcb/mcu-sensor/README.md",
        "examples/pcb/adversarial-geometry/README.md",
    ]:
        files[source] = (ROOT / source).read_bytes()
    for source, target, names in [
        ("led-classroom/Exercise", "exercise", ["LED.dpn", "LED.dzn", "LED.tcproject"]),
        ("regulator", "fabrication/D-regulators", ["Regulators.dpn", "Regulators.tcproject"]),
        ("connector", "fabrication/E-connector", ["Connector.dpn", "Connector.tcproject"]),
    ]:
        for name in names:
            files[f"{target}/{name}"] = (ROOT / "examples/pcb" / source / name).read_bytes()

    connector_folder = "fabrication/E-connector/"
    review_data = connector_source_review.read_bytes()
    preview_data = connector_source.read_bytes()
    files[connector_folder + "connector-source-preview.zip"] = preview_data
    files[connector_folder + "FABRICATOR-REVIEW.md"] = connector_review_cover(
        preview_data, review_data,
        files[connector_folder + "Connector.dpn"],
        json.loads(files["digital-evidence/connector-source.json"]),
    )

    fixtures = []
    record = io.StringIO()
    writer = csv.writer(record, lineterminator="\n")
    writer.writerow([
        "fixture", "board_id", "revision", "archive_sha256", "app_build", "fabricator",
        "process", "lot", "cam_acceptance_record", "specimen_code", "inspection_date",
        "technician_code", "disposition", "notes",
    ])
    fixture_sources = ROOT / "examples/pcb"
    for fixture, source, target, status, source_board in [
        ("A", led, "fabrication/A-led/led-manufacturing-release.zip", "RELEASED",
         fixture_sources / "led-classroom/Reference/LED.dpn"),
        ("D", regulator, "fabrication/D-regulators/regulator-manufacturing-release.zip", "RELEASED",
         fixture_sources / "regulator/Regulators.dpn"),
        ("E", connector_source_review, connector_folder + "connector-source-review.zip", "NOT RELEASED",
         fixture_sources / "connector/Connector.dpn"),
    ]:
        data = source.read_bytes()
        manifest = archive_manifest(data, status)
        digest = sha256(data)
        files[target] = data
        if fixture == "E":
            native = ElementTree.fromstring(files["fabrication/E-connector/Connector.dpn"])
            identity = native.find("./DPNIDENTITY")
            if (identity.attrib["id"], int(identity.attrib["revision"])) != (
                manifest["boardId"], manifest["revision"],
            ):
                raise ValueError("Connector preview differs from the included native revision.")
        fixtures.append({
            "fixture": fixture, "archive": target, "sha256": digest,
            "boardId": manifest["boardId"], "revision": manifest["revision"],
            "softwareArchiveStatus": status, "physicalQualification": "pending",
            "fittedParts": fitted_parts(data, source_board),
        })
        writer.writerow([fixture, manifest["boardId"], manifest["revision"], digest, *[""] * 10])

    references = {}
    for fixture, flag, archive, source_board in [
        ("B", "--timer-logic", "timer-cam-preview.zip", "timer-logic/Timer.dpn"),
        ("C", "--filter", "filter-cam-preview.zip", "op-amp-filter/Filter.dpn"),
        ("F", "--mcu-sensor", "mcu-sensor-cam.zip", "mcu-sensor/Sensor.dpn"),
        ("J", "--adversarial", "adversarial-cam-preview.zip", "adversarial-geometry/Geometry.dpn"),
    ]:
        source = artifact(results, archive)
        evidence = f"digital-evidence/{Path(archive).stem}.json"
        path = f"digital-evidence/{archive}"
        files[path] = source.read_bytes()
        manifest = archive_manifest(files[path], "NOT RELEASED")
        identity = ElementTree.parse(fixture_sources / source_board).find("./DPNIDENTITY")
        if (identity.get("id"), int(identity.get("revision"))) != (manifest["boardId"], manifest["revision"]):
            raise ValueError(f"Fixture {fixture} preview differs from its checked-in source revision.")
        files[evidence] = readback(flag, source)
        references[fixture] = (path, evidence, manifest)
    for fixture, path, evidence, status in [
        ("A", fixtures[0]["archive"], "digital-evidence/led.json", "RELEASED"),
        ("D", fixtures[1]["archive"], "digital-evidence/regulator-release.json", "RELEASED"),
        ("E", connector_folder + "connector-source-preview.zip", "digital-evidence/connector-source.json", "NOT RELEASED"),
    ]:
        references[fixture] = (path, evidence, archive_manifest(files[path], status))

    reference_cam = [{
        "fixture": fixture, "archive": path, "archiveSha256": sha256(files[path]),
        "readback": evidence, "boardId": manifest["boardId"], "revision": manifest["revision"],
        "softwareArchiveStatus": manifest["status"],
    } for fixture, (path, evidence, manifest) in sorted(references.items())]

    files["records/fabrication.csv"] = record.getvalue().encode()
    headers = {
        "bench-observations": "fixture,specimen_code,stage,check,measurement,unit,instrument_and_setting,result,evidence,deviation_and_retest",
        "usability-events": "participant_code,elapsed_seconds,step,event,participant_interpretation,observer_intervention,result",
        "usability-sessions": "participant_code,cohort,app_build,platform,introduction_duration_seconds,elapsed_seconds,first_valid_release_seconds,completed,furthest_step,mapping_mistakes,unrecovered_errors,misunderstood_checks,board_fixing_intervention,release_sha256,independent_cam_result,notes",
    }
    for name, header in headers.items():
        files[f"records/{name}.csv"] = (header + "\n").encode()

    files["packet.json"] = (json.dumps({
        "sourceHead": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "checkoutFingerprint": checkout_fingerprint(),
        "verification": "Offline browser acceptance and Gerbonara 1.6.3 read-back",
        "fixtures": fixtures, "referenceCam": reference_cam, "observedUsability": "pending", "referenceLaptop": "pending",
    }, indent=2) + "\n").encode()
    files["SHA256SUMS"] = "".join(f"{sha256(data)}  {name}\n" for name, data in sorted(files.items())).encode()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "x") as archive:
        for name, data in sorted(files.items()):
            archive.writestr(ZipInfo(name), data, compress_type=ZIP_DEFLATED)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("browser_results", type=Path)
    parser.add_argument("connector_preview", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--connector-review", required=True, type=Path)
    arguments = parser.parse_args()
    package(arguments.browser_results, arguments.connector_preview, arguments.connector_review, arguments.output)
    print(arguments.output)
