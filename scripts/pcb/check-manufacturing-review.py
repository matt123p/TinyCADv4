"""Cross-check a browser manufacturing review against the CAM preview it froze."""

import csv
import hashlib
import io
import json
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile


def expect(actual, expected, label):
    if actual != expected:
        raise ValueError(f"{label}: expected {expected!r}, got {actual!r}")


def check(diagnostic, review):
    manifest = json.loads(review.read("manifest.json"))
    expect(manifest["kind"], "tinycad-manufacturing-review", "review kind")
    expect(manifest["status"], "NOT RELEASED", "review status")
    expect(manifest["timestampMode"], "normalized", "deterministic mode")
    expect(manifest["timestamp"], "2000-01-01T00:00:00.000Z", "normalized timestamp")
    expect(manifest["cam"]["geometryVerified"], True, "CAM read-back verification")
    expect(manifest["cam"]["reviewedFiles"],
           ["non-plated.xnc", "plated.xnc", "profile.gbr", "silk-bottom.gbr"],
           "explicitly reviewed layers and drill files")

    outputs = {item["filename"]: item for item in manifest["outputs"]}
    expect(sorted(review.namelist()), sorted([*outputs, "manifest.json"]), "review archive members")
    expect(sorted(outputs), sorted((set(diagnostic.namelist()) - {"manifest.json"}) | {
               "board.dpn", "fabrication.svg", "drill-tools.csv", "drill-openings.csv",
           }),
           "same diagnostic payload set plus frozen native board")
    for name, record in outputs.items():
        payload = review.read(name)
        expect(len(payload), record["bytes"], name + " length")
        expect(hashlib.sha256(payload).hexdigest(), record["sha256"], name + " hash")
        if name in diagnostic.namelist() and name != "checks.json":
            expect(payload == diagnostic.read(name), True, name + " preserved preview bytes")

    source = ET.fromstring(review.read("board.dpn"))
    identity = source.find("DPNIDENTITY").attrib
    expect(identity["id"], manifest["boardId"], "native board identity")
    expect(int(identity["revision"]), manifest["revision"], "native board revision")
    expect(manifest["nativeBoardSha256"], outputs["board.dpn"]["sha256"], "native board hash")
    expect(outputs["board.dpn"]["role"], "native-board", "native board role")

    def rows(filename):
        return list(csv.reader(io.StringIO(review.read(filename).decode())))[1:]

    expect(rows("drill-tools.csv"), [
        ["plated.xnc", "T01", "PTH", "0.6", "0", "1"],
        ["non-plated.xnc", "T01", "NPTH", "1.5", "1", "0"],
    ], "read-back drill tools and plating")
    expect(rows("drill-openings.csv"), [
        ["plated.xnc", "T01", "PTH", "Slot", "0.6", "10", "4", "12", "4"],
        ["non-plated.xnc", "T01", "NPTH", "Round", "1.5", "6", "12", "6", "12"],
    ], "read-back opening coordinates and finished widths")
    drawing = ET.fromstring(review.read("fabrication.svg"))
    expect(drawing.attrib["viewBox"], "-5 -32 92 46", "fabrication drawing 1:1 viewBox")
    svg = "{http://www.w3.org/2000/svg}"
    marked = [
        (path.get("data-source"), path.get("data-tool"))
        for path in drawing.findall(f"{svg}path") if path.get("data-tool")
    ]
    expect(marked, [("plated.xnc", "T01"), ("non-plated.xnc", "T01")], "drawn openings")

    check_report = json.loads(review.read("checks.json"))
    preview_report = json.loads(diagnostic.read("checks.json"))
    expect(check_report.pop("generatedAt"), manifest["timestamp"], "normalized check report timestamp")
    preview_report.pop("generatedAt")
    expect(check_report, preview_report, "same DRC and parity evidence")
    expect(check_report["issues"], manifest["checks"]["issues"], "manifest issues")
    expect(check_report["coverage"], manifest["checks"]["coverage"], "manifest coverage")
    blockers = manifest["checks"]["readiness"]
    expect(any(item["code"] == "check-coverage" for item in blockers), True, "incomplete check coverage")
    expect(manifest["fabrication"]["profileId"], "classroom-v1", "fabrication profile")
    expect(manifest["rules"]["effective"]["minWidthNm"], 250000, "effective track width")
    return {
        "reviewId": manifest["reviewId"],
        "revision": manifest["revision"],
        "payloads": len(outputs),
        "releaseBlockers": len(blockers),
        "status": manifest["status"],
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python3 scripts/pcb/check-manufacturing-review.py <CAM ZIP> <review ZIP>")
    with ZipFile(sys.argv[1]) as diagnostic, ZipFile(sys.argv[2]) as review:
        print(json.dumps(check(diagnostic, review), indent=2))
