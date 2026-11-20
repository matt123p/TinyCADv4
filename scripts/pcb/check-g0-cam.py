"""Independently check the emitted G0 fixture with Gerbonara 1.6.3."""

import json
import math
import sys
from pathlib import Path

from gerbonara import ExcellonFile, GerberFile
from gerbonara.graphic_objects import Arc, Flash, Line, Region
from gerbonara.utils import MM


def close(actual, expected, label):
    if len(actual) != len(expected) or any(
        not math.isclose(a, b, abs_tol=1e-6, rel_tol=0)
        for a, b in zip(actual, expected)
    ):
        raise ValueError(f"{label}: expected {expected}, got {actual}")


def check(directory):
    layers = []
    for name, role in [("top", ("Copper", "L1", "Top")), ("bottom", ("Copper", "L2", "Bot"))]:
        layer = GerberFile.open(directory / f"copper-{name}.gbr")
        if layer.file_attrs.get(".FileFunction") != role or not layer.objects or any(
            not isinstance(item, Region) for item in layer.objects
        ):
            raise ValueError(f"Unexpected copper role or objects on {name}")
        if not any(not item.polarity_dark for item in layer.objects):
            raise ValueError(f"No clear copper region on {name}")
        layers.append({"layer": name, "regions": len(layer.objects), "boundsMm": layer.bounding_box(MM)})

    profile = GerberFile.open(directory / "profile.gbr")
    lines = [item for item in profile.objects if type(item) is Line]
    arcs = [item for item in profile.objects if isinstance(item, Arc)]
    if profile.file_attrs.get(".FileFunction") != ("Profile", "NP") or len(lines) != 4 or len(arcs) != 2:
        raise ValueError("Expected a rectangular profile and a two-arc cutout")
    lower, upper = profile.bounding_box(MM)
    close((*lower, *upper), (-0.0005, -0.0005, 14.0005, 10.0005), "Profile stroke bounds")
    for arc in arcs:
        close((arc.x1 + arc.cx, arc.y1 + arc.cy, math.hypot(arc.cx, arc.cy)), (12, 8, 0.5), "Cutout centre and radius")
        if arc.clockwise:
            raise ValueError("Cutout arc direction changed")

    plated = ExcellonFile.open(directory / "plated.xnc", plated=True)
    flashed = [item for item in plated.objects if isinstance(item, Flash)]
    slots = [item for item in plated.objects if type(item) is Line]
    if len(flashed) != 1 or len(slots) != 1 or len(plated.objects) != 2:
        raise ValueError("Expected one plated via and one plated slot")
    close((flashed[0].x, flashed[0].y, flashed[0].aperture.diameter), (3.434936, 3.442820, 0.3), "Plated via")
    slot = slots[0]
    close((slot.x1, slot.y1, slot.x2, slot.y2, slot.aperture.diameter),
          (5.346410, 4.2, 4.653590, 3.8, 0.5), "Plated slot")
    nonplated = ExcellonFile.open(directory / "non-plated.xnc", plated=False)
    if len(nonplated.objects) != 1 or not isinstance(nonplated.objects[0], Flash):
        raise ValueError("Expected one non-plated mounting hole")
    hole = nonplated.objects[0]
    close((hole.x, hole.y, hole.aperture.diameter), (12, 2, 1), "Mounting hole")
    return {"layers": layers, "profileLines": len(lines), "profileArcs": len(arcs),
            "platedDrills": len(flashed), "platedSlots": len(slots), "nonPlatedDrills": len(nonplated.objects)}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/pcb/check-g0-cam.py <fixture manufacturing directory>")
    print(json.dumps(check(Path(sys.argv[1])), indent=2))
