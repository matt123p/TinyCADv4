"""Check the TinyCAD interchange coupon with the KiCad 9.0.9 PCB editor."""

import argparse
import json
import math
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

import pcbnew as pcb


def expect(actual, expected, label):
    if actual != expected:
        raise ValueError(f"{label}: expected {expected!r}, got {actual!r}")


def bounds(item):
    box = item.GetBoundingBox()
    return (*box.GetOrigin(), *box.GetEnd())


def outline(polygon):
    ring = polygon.COutline(0)
    return {tuple(ring.CPoint(i)) for i in range(ring.PointCount())}


def check_board(board):
    expect(board.GetDesignSettings().GetBoardThickness(), 1600000, "board thickness")
    parts = {part.GetReference(): part for part in board.GetFootprints()}
    expect(set(parts), {"U1", "U2", "U3", "MH1", "MH2"}, "references")
    top, bottom, custom = (parts[ref] for ref in ("U1", "U2", "U3"))
    expect(tuple(top.GetPosition()), (4000000, -4000000), "top placement")
    expect(tuple(bottom.GetPosition()), (17000000, -11000000), "bottom placement")
    expect(bottom.GetOrientationDegrees(), 90, "bottom rotation")
    expect(bottom.IsDNP(), True, "bottom DNP")
    expect(custom.IsLocked(), True, "custom locked")
    expect(custom.GetOrientationDegrees(), 30, "custom rotation")
    expect((top.GetLayer(), bottom.GetLayer(), custom.GetLayer()),
           (pcb.F_Cu, pcb.B_Cu, pcb.B_Cu), "footprint layers")

    pads = [list(footprint.Pads())[0] for footprint in (top, bottom, custom)]
    expect([pad.GetNumber() for pad in pads], ["1"] * 3, "pad numbers")
    expect([pad.GetNetname() for pad in pads], ["Top pad", "Bottom pad", "Bottom pad"], "pad nets")
    expect([tuple(pad.GetLayerSet().Seq()) for pad in pads],
           [(pcb.F_Cu,), (pcb.B_Cu,), (pcb.B_Cu, pcb.B_Mask)], "pad layers")
    expect(bounds(pads[0]), (4500000, -4900000, 5500000, -4300000), "top pad bounds")
    expect(bounds(pads[1]), (16100000, -10500000, 16700000, -9500000), "bottom pad bounds")

    local = [(-0.6, -0.5), (0.6, -0.5), (0.5, 0.4), (0, 0.7), (-0.6, 0.2)]
    s, c = math.sin(math.pi / 6), math.cos(math.pi / 6)
    expected_vertices = {
        (round((15 - x * c - y * s) * 1e6), round((-11 + x * s - y * c) * 1e6))
        for x, y in local
    }
    custom_land = pads[2].GetEffectivePolygon(pcb.B_Cu)
    expect(outline(custom_land), expected_vertices, "rotated bottom custom copper polygon")

    for part, artwork in [
        (top, {
            pcb.F_SilkS: (4100000, -6000000, 5900000, -5700000),
            pcb.F_Mask: (4400000, -5000000, 5600000, -4200000),
            pcb.F_Paste: (4600000, -4800000, 5400000, -4400000),
        }),
        (bottom, {
            pcb.B_SilkS: (15000000, -10900000, 15300000, -9100000),
            pcb.B_Mask: (16000000, -10600000, 16800000, -9400000),
            pcb.B_Paste: (16200000, -10400000, 16600000, -9600000),
        }),
    ]:
        expect({item.GetLayer(): bounds(item) for item in part.GraphicalItems()},
               artwork, part.GetReference() + " artwork bounds")
        expect(all(item.IsFilled() for item in part.GraphicalItems()), True, "filled artwork")

    slot = list(parts["MH1"].Pads())[0]
    expect(slot.GetAttribute(), pcb.PAD_ATTRIB_PTH, "slot plating")
    expect(tuple(slot.GetPosition()), (11000000, -4000000), "slot centre")
    expect(tuple(slot.GetDrillSize()), (2600000, 600000), "slot size")
    expect(bounds(slot), (9500000, -4500000, 12500000, -3500000), "slot copper bounds")
    hole = list(parts["MH2"].Pads())[0]
    expect(hole.GetAttribute(), pcb.PAD_ATTRIB_NPTH, "mounting hole plating")
    expect(tuple(hole.GetPosition()), (6000000, -12000000), "mounting hole centre")
    expect(tuple(hole.GetDrillSize()), (1500000, 1500000), "mounting hole diameter")

    tracks = list(board.GetTracks())
    expect(len(tracks), 3, "track and via count")
    via, = (track for track in tracks if isinstance(track, pcb.PCB_VIA))
    segments = sorted((track for track in tracks if track is not via), key=lambda track: track.GetLayer())
    front, back = segments
    expect(
        [(tuple(track.GetStart()), tuple(track.GetEnd()), track.GetWidth(), track.GetLayer())
         for track in segments],
        [((5000000, -4600000), (8000000, -4600000), 200000, pcb.F_Cu),
         ((8000000, -4600000), (8000000, -7000000), 300000, pcb.B_Cu)],
        "track geometry",
    )
    expect((via.TopLayer(), via.BottomLayer(), via.GetDrillValue(), via.GetWidth(pcb.F_Cu)),
           (pcb.F_Cu, pcb.B_Cu, 300000, 700000), "via span and geometry")
    expect([track.GetNetname() for track in tracks], ["Top pad"] * 3, "routed net")
    board.BuildConnectivity()
    connectivity = board.GetConnectivity()
    expect(len(connectivity.GetConnectedTracks(via)), 2, "tracks connected to via")
    expect([pad.GetParentFootprint().GetReference() for pad in connectivity.GetConnectedPads(front)],
           ["U1"], "pad connected to trace")

    edges = list(board.GetDrawings())
    expect([item.GetLayer() for item in edges], [pcb.Edge_Cuts] * 6, "profile layer")
    corners = [(0, 0), (24000000, 0), (24000000, -17000000), (0, -17000000)]
    lines = [edge for edge in edges if edge.GetShape() == pcb.SHAPE_T_SEGMENT]
    expect({frozenset([tuple(edge.GetStart()), tuple(edge.GetEnd())]) for edge in lines},
           {frozenset(pair) for pair in zip(corners, corners[1:] + corners[:1])}, "outline")
    arcs = [edge for edge in edges if edge.GetShape() == pcb.SHAPE_T_ARC]
    expect([(tuple(edge.GetCenter()), round(edge.GetRadius())) for edge in arcs],
           [((20000000, -13000000), 500000)] * 2, "circular cutout")

    zone, = board.Zones()
    expect((zone.GetNetname(), zone.GetLayer(), zone.GetAssignedPriority(), zone.GetPadConnection()),
           ("Bottom pad", pcb.B_Cu, 2, pcb.ZONE_CONNECTION_FULL), "editable zone settings")
    expect(outline(zone.Outline()),
           {(14000000, -8000000), (19000000, -8000000), (19000000, -12000000), (14000000, -12000000)},
           "zone outline")


def check_bundle(bundle, cli):
    expect(pcb.Version(), "9.0.9", "qualification KiCad")
    with ZipFile(bundle) as archive, TemporaryDirectory() as directory:
        board = Path(directory) / "Interchange.kicad_pcb"
        rules = board.with_suffix(".kicad_dru")
        report_name = "tinycad-export-report.json"
        expect(sorted(archive.namelist()), sorted([board.name, rules.name, report_name]), "archive entries")
        board.write_bytes(archive.read(board.name))
        rules.write_bytes(archive.read(rules.name))
        report = json.loads(archive.read(report_name))
        expect(report["target"]["fileVersion"], 20241229, "target file format")
        expect(report["counts"], {
            "footprints": 3, "pads": 3, "mechanicalHoles": 2, "tracks": 2,
            "vias": 1, "nets": 2, "profileEdges": 6, "zones": 1,
        }, "export counts")
        expect([(note["code"], note["objects"]) for note in report["notes"] if note["kind"] == "omission"],
               [("zone-policy", ["00000000-0000-4000-8000-000000000024"])], "declared omissions")
        expect([(net["name"], net["target"]["number"]) for net in report["nets"]],
               [("Top pad", 1), ("Bottom pad", 2)], "net mapping")
        loaded = pcb.LoadBoard(str(board))
        check_board(loaded)
        resaved = board.with_name("Resaved.kicad_pcb")
        expect(pcb.SaveBoard(str(resaved), loaded), True, "KiCad re-save")
        check_board(pcb.LoadBoard(str(resaved)))
        def width_findings(source):
            drc_file = source.with_suffix(".report.json")
            subprocess.run([cli, "pcb", "drc", "--format", "json", "-o", str(drc_file), str(source)],
                           check=True, capture_output=True, text=True)
            drc = json.loads(drc_file.read_text())
            return [item["description"] for item in drc["violations"] if item["type"] == "track_width"]

        constrained = width_findings(board)
        expect(len(constrained), 1, "width findings with exported rules")
        if "0.2500 mm" not in constrained[0] or "0.2000 mm" not in constrained[0]:
            raise ValueError(f"Unexpected exported track width finding: {constrained[0]}")
        baseline = board.with_name("WithoutRules.kicad_pcb")
        baseline.write_bytes(board.read_bytes())
        expect(width_findings(baseline), [], "width findings without exported rules")
        return {
            "kicad": pcb.Version(),
            "counts": report["counts"],
            "omissions": [note["code"] for note in report["notes"] if note["kind"] == "omission"],
            "drcRulesApplied": ["TinyCAD track width"],
            "resavedAndReopened": True,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--cli", default="kicad-cli")
    args = parser.parse_args()
    print(json.dumps(check_bundle(args.bundle, args.cli), indent=2))
