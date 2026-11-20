#!/usr/bin/env python3
"""Generate native footprint drafts and matching STEP envelope solids."""
import argparse
import base64
import gzip
import hashlib
import json
import math
import uuid
from pathlib import Path

NM_PER_MM = 1_000_000
DEFAULT_CATALOGUE = Path(__file__).with_name("starter-footprints.json")
NAMESPACE = uuid.UUID("fb3c47c0-918a-4fdf-8c54-a16090b2bea1")
ORIGIN = {"x": 0, "y": 0}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def uid(*parts):
    return str(uuid.uuid5(NAMESPACE, "/".join(map(str, parts))))


def sha256(contents):
    return hashlib.sha256(contents).hexdigest()


def point(x, y):
    return {"x": x, "y": y}


def land(width, height, round_land=False, radius=0):
    if round_land:
        if width != height:
            raise ValueError("A round pad needs equal width and height.")
        return {"kind": "capsule", "start": ORIGIN, "end": ORIGIN, "widthNm": width}
    left, bottom = -(width // 2), -(height // 2)
    if radius:
        if radius < 0 or radius * 2 >= min(width, height):
            raise ValueError("A rounded rectangle needs a radius below half its shorter side.")
        right, top = left + width, bottom + height
        corners = ((right - radius, top - radius), (left + radius, top - radius),
                   (left + radius, bottom + radius), (right - radius, bottom + radius))
        vertices = []
        for quadrant, (x, y) in enumerate(corners):
            for increment in range(5):
                angle = (quadrant * 4 + increment) * math.pi / 8
                vertices.append(point(x + round(radius * math.cos(angle)),
                                      y + round(radius * math.sin(angle))))
        return {"kind": "polygon", "vertices": vertices}
    return {
        "kind": "polygon",
        "vertices": [
            point(left, bottom),
            point(left + width, bottom),
            point(left + width, bottom + height),
            point(left, bottom + height),
        ],
    }


def positions(recipe):
    arrangement = recipe["terminals"]
    if arrangement["kind"] == "explicit":
        return [tuple(pair) for pair in arrangement["positionsNm"]]
    pitch = arrangement["pitchNm"]
    if arrangement["kind"] == "inline":
        return [((2 * i - arrangement["count"] + 1) * pitch // 2, 0)
                for i in range(arrangement["count"])]
    if arrangement["kind"] == "dual-row":
        count = arrangement["count"]
        if count % 2:
            raise ValueError("Dual-row packages need an even pin count.")
        half = count // 2
        axis = [(half - 1 - 2 * i) * pitch // 2 for i in range(half)]
        left = -(arrangement["rowSpacingNm"] // 2)
        right = arrangement["rowSpacingNm"] + left
        return [(left, y) for y in axis] + [(right, y) for y in reversed(axis)]
    if arrangement["kind"] == "grid":
        rows, columns = arrangement["rows"], arrangement["columns"]
        return [((2 * x - columns + 1) * pitch // 2,
                 (rows - 1 - 2 * y) * pitch // 2)
                for x in range(columns) for y in range(rows)]
    raise ValueError(f"Unsupported terminal arrangement {arrangement['kind']!r}.")


def svg_rect(layer, width, height, stroke):
    return {
        "kind": "rect", "layer": layer, "strokeNm": stroke, "filled": False,
        "start": point(-(width // 2), -(height // 2)),
        "end": point(width - width // 2, height - height // 2),
    }


def make_pad(recipe, label, x, y):
    pad = {**recipe["pad"], **recipe.get("padOverrides", {}).get(label, {})}
    width, height = pad["sizeNm"]
    mask = recipe["manufacturing"]["maskExpansionNm"]
    if pad.get("nonPlated"):
        if pad.get("drillNm", 0) <= 0:
            raise ValueError("A mounting hole needs an explicit drill.")
        return {
            "id": uid(recipe["id"], "pad", label), "label": label,
            "positionNm": point(x, y), "stack": {
                "copper": {}, "drill": {"start": ORIGIN, "end": ORIGIN,
                                        "widthNm": pad["drillNm"], "plated": False},
            },
        }
    round_land = pad["shape"] == "round" and (label != "1" or not pad.get("pinOneSquare", "drillNm" in pad))
    if "drillNm" in pad:
        drill = pad["drillNm"]
        annulus = recipe["manufacturing"]["minAnnulusNm"]
        if drill <= 0 or min(width, height) < drill + 2 * annulus:
            raise ValueError(f"{recipe['id']} pad {label} has an insufficient annulus.")
    radius = pad.get("cornerRadiusNm", 0)
    copper = land(width, height, round_land, radius)
    mask_land = land(width + 2 * mask, height + 2 * mask, round_land,
                     radius + mask if radius else 0)
    stack = {"copper": {"top": copper}, "mask": {"top": mask_land}}
    if "drillNm" in pad:
        stack["copper"]["bottom"] = copper
        stack["mask"]["bottom"] = mask_land
        stack["drill"] = {"start": ORIGIN, "end": ORIGIN,
                          "widthNm": pad["drillNm"], "plated": True}
    else:
        stack["paste"] = {"top": copper}
    return {"id": uid(recipe["id"], "pad", label), "label": label,
            "positionNm": point(x, y), "stack": stack}


def mm(nanometres):
    sign = "-" if nanometres < 0 else ""
    whole, fraction = divmod(abs(nanometres), NM_PER_MM)
    return f"{sign}{whole}.{fraction:06d}".rstrip("0").rstrip(".") + ("." if not fraction else "")


class Step:
    """Write closed, outward-wound planar solids with an explicit millimetre context."""
    def __init__(self):
        self.records = []

    def add(self, record):
        self.records.append(record)
        return "#" + str(len(self.records))

    def box(self, name, x, y, z, width, height, depth):
        left, bottom = x - width // 2, y - height // 2
        right, top = left + width, bottom + height
        corners = [(px, py, pz)
                   for pz in (z, z + depth)
                   for px, py in ((left, bottom), (right, bottom), (right, top), (left, top))]
        points = [self.add(f"CARTESIAN_POINT('',({','.join(map(mm, corner))}))")
                  for corner in corners]
        vertices = [self.add(f"VERTEX_POINT('',{position})") for position in points]
        edges = {}

        def direction(axis):
            return self.add(f"DIRECTION('',({','.join(f'{n}.' for n in axis)}))")

        def along(a, b):
            delta = [y - x for x, y in zip(corners[a], corners[b])]
            return direction(tuple(1 if n > 0 else -1 if n < 0 else 0 for n in delta))

        def oriented_edge(a, b):
            lo, hi = sorted((a, b))
            if (lo, hi) not in edges:
                vector = self.add(f"VECTOR('',{along(lo, hi)},1.)")
                line = self.add(f"LINE('',{points[lo]},{vector})")
                edges[lo, hi] = self.add(f"EDGE_CURVE('',{vertices[lo]},{vertices[hi]},{line},.T.)")
            orientation = ".T." if a == lo else ".F."
            return self.add(f"ORIENTED_EDGE('',*,*,{edges[lo, hi]},{orientation})")

        faces = []
        for indices, normal in (
            ((3, 2, 1, 0), (0, 0, -1)), ((4, 5, 6, 7), (0, 0, 1)),
            ((0, 1, 5, 4), (0, -1, 0)), ((1, 2, 6, 5), (1, 0, 0)),
            ((2, 3, 7, 6), (0, 1, 0)), ((3, 0, 4, 7), (-1, 0, 0)),
        ):
            edges_on_face = [oriented_edge(a, b) for a, b in zip(indices, (*indices[1:], indices[0]))]
            loop = self.add(f"EDGE_LOOP('',({','.join(edges_on_face)}))")
            boundary = self.add(f"FACE_OUTER_BOUND('',{loop},.T.)")
            origin = points[indices[0]]
            axis = self.add(f"AXIS2_PLACEMENT_3D('',{origin},{direction(normal)},{along(*indices[:2])})")
            plane = self.add(f"PLANE('',{axis})")
            faces.append(self.add(f"ADVANCED_FACE('',({boundary}),{plane},.T.)"))
        shell = self.add(f"CLOSED_SHELL('',({','.join(faces)}))")
        return self.add(f"MANIFOLD_SOLID_BREP('{name}',{shell})")

    def serialize(self, model_id, solids):
        mm_unit = self.add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))")
        radians = self.add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))")
        steradian = self.add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())")
        precision = self.add(f"UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.000001),{mm_unit},'distance_accuracy_value','')")
        context = self.add(
            f"(GEOMETRIC_REPRESENTATION_CONTEXT(3)"
            f" GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT(({precision}))"
            f" GLOBAL_UNIT_ASSIGNED_CONTEXT(({mm_unit},{radians},{steradian}))"
            f" REPRESENTATION_CONTEXT('','3D'))"
        )
        application = self.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
        self.add(f"APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,{application})")
        product_context = self.add(f"PRODUCT_CONTEXT('',{application},'mechanical')")
        product = self.add(f"PRODUCT('{model_id}','{model_id}','',({product_context}))")
        self.add(f"PRODUCT_RELATED_PRODUCT_CATEGORY('part','',({product}))")
        edition = self.add(f"PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',{product},.NOT_KNOWN.)")
        product_definition_context = self.add(f"PRODUCT_DEFINITION_CONTEXT('part definition',{application},'design')")
        definition = self.add(f"PRODUCT_DEFINITION('design','',{edition},{product_definition_context})")
        shape = self.add(f"PRODUCT_DEFINITION_SHAPE('','',{definition})")
        model = self.add(f"ADVANCED_BREP_SHAPE_REPRESENTATION('',({','.join(solids)}),{context})")
        self.add(f"SHAPE_DEFINITION_REPRESENTATION({shape},{model})")
        lines = [
            "ISO-10303-21;", "HEADER;",
            "FILE_DESCRIPTION(('TinyCAD dimensional envelope'),'2;1');",
            f"FILE_NAME('{model_id}.step','1970-01-01T00:00:00',('TinyCAD'),('TinyCAD'),'TinyCAD','TinyCAD','');",
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));", "ENDSEC;", "DATA;",
        ]
        lines.extend(f"#{index}={record};" for index, record in enumerate(self.records, 1))
        return ("\n".join([*lines, "ENDSEC;", "END-ISO-10303-21;", ""])).encode()


def generate(recipe):
    coords = positions(recipe)
    if len(coords) != len(set(coords)) or not coords:
        raise ValueError(f"{recipe['id']} has absent or overlapping terminal centres.")
    body = recipe["body"]
    width, height, depth = body["envelopeNm"]
    lift = body["standoffNm"]
    lead = recipe["lead"]
    pad_width, pad_height = recipe["pad"]["sizeNm"]
    if any(value <= 0 for value in (width, height, depth, *lead["crossSectionNm"], pad_width, pad_height)):
        raise ValueError(f"{recipe['id']} has a non-positive dimension.")
    if (sum(dimension ** 2 for dimension in lead["crossSectionNm"]) > recipe["pad"]["drillNm"] ** 2
        if "drillNm" in recipe["pad"]
        else any(dimension > copper for dimension, copper in zip(lead["crossSectionNm"], (pad_width, pad_height)))):
        raise ValueError(f"{recipe['id']} lead does not fit its pad or drill.")
    body_box = Step()
    solids = [body_box.box("body", 0, 0, lift, width, height, depth)]
    pads = []
    for i, (x, y) in enumerate(coords, 1):
        pads.append(make_pad(recipe, str(i), x, y))
        if pads[-1]["stack"].get("drill", {}).get("plated") is not False:
            solids.append(body_box.box(f"lead-{i}", x, y, -lead["protrusionNm"],
                                       *lead["crossSectionNm"], lift + depth // 2 + lead["protrusionNm"]))
    step = body_box.serialize(recipe["id"], solids)
    asset_name = recipe["id"] + ".step"
    asset_id = sha256(step)
    clearance = recipe["manufacturing"]["courtyardExpansionNm"]
    pad_sizes = [recipe.get("padOverrides", {}).get(str(i), {}).get("sizeNm", (pad_width, pad_height))
                 for i in range(1, len(coords) + 1)]
    outer_width = max(width, max(2 * abs(x) + sizes[0] for (x, _), sizes in zip(coords, pad_sizes)))
    outer_height = max(height, max(2 * abs(y) + sizes[1] for (_, y), sizes in zip(coords, pad_sizes)))
    pin_one = coords[0]
    graphics = [
        svg_rect("F.Fab", width, height, 100_000),
        svg_rect("F.CrtYd", outer_width + 2 * clearance, outer_height + 2 * clearance, 50_000),
        {"kind": "circle", "layer": "F.SilkS", "filled": True, "strokeNm": 100_000,
         "center": point(pin_one[0] - pad_width // 2 - 350_000, pin_one[1]),
         "end": point(pin_one[0] - pad_width // 2 - 250_000, pin_one[1])},
    ]
    if recipe["pad"].get("nonPlated"):
        graphics = graphics[:2]
    definition = {
        "id": uid(recipe["id"], "footprint"), "revision": recipe["revision"],
        "name": recipe["name"], "pads": pads, "graphics": graphics,
        "models": [{"kind": "step", "quality": "generated-envelope", "source": asset_name,
                    "assetId": asset_id, "offsetNm": [0, 0, 0],
                    "rotationMicrodegree": [0, 0, 0], "scale": [1, 1, 1]}],
    }
    definition["definitionDigest"] = "sha256:" + sha256(canonical(definition).encode())
    footprint = {
        "format": "tinycad-footprint", "version": 1,
        "provenance": {"kind": "authored", "source": recipe["source"], "revision": recipe["revision"]},
        "definition": definition,
        "assets": [{"id": asset_id, "mediaType": "model/step", "source": recipe["source"],
                    "license": recipe["license"], "base64": base64.b64encode(step).decode()}],
    }
    return footprint, step


def reviewed_devices(directory, definitions):
    if directory is None:
        return []
    if not directory.is_dir():
        raise ValueError(f"Reviewed device directory does not exist: {directory}.")
    output = []
    identities = set()
    for source in sorted(directory.glob("*.tcdevice.json")):
        device = json.loads(source.read_text(encoding="utf-8"))
        footprint = device.get("footprint", {})
        review = device.get("review", {})
        if (device.get("format") != "tinycad-device" or device.get("version") != 1
                or not all(isinstance(review.get(key), str) and review[key].strip()
                           for key in ("by", "evidence"))):
            raise ValueError(f"{source.name} needs a valid TinyCAD device and a review record.")
        if footprint != definitions.get(footprint.get("id")):
            raise ValueError(f"{source.name} does not match an exact generated footprint revision.")
        key = (device.get("id"), device.get("revision"))
        if key in identities:
            raise ValueError(f"{source.name} repeats a device UUID and revision.")
        identities.add(key)
        output.append(device)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--catalogue", type=Path, default=DEFAULT_CATALOGUE)
    parser.add_argument("--bundle", type=Path, help="Also write a gzip catalogue for the editor.")
    parser.add_argument("--reviewed-devices", type=Path, help="Include exported devices with review records.")
    parser.add_argument("--reviewed-bundle", type=Path, help="Write the reviewed device catalogue.")

    args = parser.parse_args()
    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))
    if catalogue["version"] != 1:
        raise ValueError("Unsupported starter catalogue version.")
    args.destination.mkdir(parents=True, exist_ok=True)
    variants = []
    bundle = []
    definitions = {}
    names = set()
    for recipe in catalogue["variants"]:
        name = recipe["id"]
        if not name.isascii() or not name.replace("-", "").isalnum() or name in names:
            raise ValueError(f"Invalid or duplicate package ID {name!r}.")
        names.add(name)
        footprint, step = generate(recipe)
        native_name = name + ".tcfootprint.json"
        step_name = name + ".step"
        definition = footprint["definition"]
        definitions[definition["id"]] = definition
        (args.destination / native_name).write_text(canonical(footprint) + "\n", encoding="utf-8")
        (args.destination / step_name).write_bytes(step)
        if args.bundle:
            item = {"id": name, "family": recipe["family"], "footprint": footprint}
            if "documentation" in recipe:
                evidence = recipe["documentation"]
                if set(evidence["pinoutByPad"]) != {pad["label"] for pad in footprint["definition"]["pads"]}:
                    raise ValueError(f"{name} has a missing or unknown documented pad.")
                item["documentation"] = evidence
                item["bodyNm"] = recipe["body"]["envelopeNm"][:2]
            bundle.append(item)
        variants.append({"id": name, "family": recipe["family"], "footprint": native_name,
                         "step": step_name, "stepSha256": sha256(step), "pinCount": len(footprint["definition"]["pads"]),
                         "status": "unreviewed"})
    (args.destination / "index.json").write_text(canonical({"version": 1, "variants": variants}) + "\n", encoding="utf-8")
    if args.bundle:
        args.bundle.parent.mkdir(parents=True, exist_ok=True)
        with args.bundle.open("wb") as output:
            with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
                compressed.write(canonical({"version": 1, "variants": bundle}).encode("utf-8"))
    if args.reviewed_bundle:
        approved = reviewed_devices(args.reviewed_devices, definitions)
        args.reviewed_bundle.parent.mkdir(parents=True, exist_ok=True)
        args.reviewed_bundle.write_text(
            canonical({"version": 1, "devices": approved}) + "\n", encoding="utf-8"
        )




if __name__ == "__main__":
    main()
