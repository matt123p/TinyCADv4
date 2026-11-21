#!/usr/bin/env python3
"""Build the offline SPICE model picker catalog from pinned, local inputs."""

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tomllib
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "library-sources/openjellybean"
LIBRARY = ROOT / "bundled-libraries/spice/spice.tclib"
OUTPUT = LIBRARY.with_name("openjellybean.json")
CIRCSIM_OUTPUT = LIBRARY.with_name("circsim.json")
CIRCSIM_SOURCE = ROOT / "library-sources/circsim"
ADDITIONAL_SOURCES = ROOT / "library-sources/spice-catalogs"
BASIC_SOURCE = ROOT / "library-recipes/spice-basic-models.json"
CIRCSIM_REVISION = "059858b15671c3edaf4c62f944ecb8c7420ae1d4"
CIRCSIM_SHA256 = {
    "LICENSE": "0167f740b37ace1c64df1124214d97bb17330c99b21d3968d82600ef702df4af",
    "discrete-extra.lib.txt": "67dcbc524da16ae4d1f7a89a21d4d1171850c3de9682d9895144f6785c3a2cf9",
    "mosfet.lib.txt": "fb7d17768470a7f3f66a06f50562f471834c73bb81ca3029262106dbdf917a02",
    "opamp.lib.txt": "32785375cd3e3a9a8ccf08629c6b27c9eb89320cde1bda00ad346aac819735de",
    "opto.lib.txt": "bc63caf06f34b9fe52895afc95fe97df593f70a24339c63444a0c157ca5f263f",
    "regulators.lib.txt": "8a9244044c26c6ad262ea7d3380be97accb77c8c2a8d47f0fed17827398fadc8",
    "timer555.lib.txt": "693736042cffa88ee7472dbc5b465fe20baeae445ee20990ca1d500fdb57fe38",
}
REVISION = "0d0d9b659b202368dc419f8276bacb1e39694915"
UPSTREAM_LIBRARY_URL = f"https://github.com/xdylanm/openjellybean/blob/{REVISION}/jellybean.lib"
LIBRARY_SHA256 = "bc0304fe2fae01979bcbd6eb74466a3b25e8a632088ffa7ce19b385ada799163"

PRIMITIVES = {
    "npn": ("Q", "NPN", ("collector", "base", "emitter")),
    "pnp": ("Q", "PNP", ("collector", "base", "emitter")),
    "nmos": ("M", "VDMOS", ("drain", "gate", "source")),
    "pmos": ("M", "VDMOS", ("drain", "gate", "source")),
    "njfet": ("J", "NJF", ("drain", "gate", "source")),
    "pjfet": ("J", "PJF", ("drain", "gate", "source")),
    "diode": ("D", "D", ("anode", "cathode")),
    "schottky": ("D", "D", ("anode", "cathode")),
    "led": ("D", "D", ("anode", "cathode")),
}
PORT_ROLES = {
    "zener": {"a": "anode", "k": "cathode"},
    "pot": {"a": "end A", "w": "wiper", "b": "end B"},
    "opamp": {"inp": "non-inverting input", "inn": "inverting input", "out": "output"},
}
SUPPLY_ROLES = {"vcc": "positive supply", "vee": "negative supply"}
for kind, sections in (("opamp2", 2), ("opamp4", 4)):
    PORT_ROLES[kind] = {
        f"{pin}{section}": f"{role} {section}"
        for section in range(1, sections + 1)
        for pin, role in PORT_ROLES["opamp"].items()
    }
for kind in ("opamp", "opamp2", "opamp4"):
    PORT_ROLES[kind].update(SUPPLY_ROLES)

FAMILY_DESCRIPTIONS = {
    "npn": "General-purpose NPN bipolar transistor",
    "pnp": "General-purpose PNP bipolar transistor",
    "nmos": "Small-signal N-channel MOSFET with a modelled body diode",
    "pmos": "Small-signal P-channel MOSFET with a modelled body diode",
    "njfet": "N-channel JFET",
    "pjfet": "P-channel JFET",
    "schottky": "Schottky diode",
}


def description(model_id, kind, aliases, definition):
    if kind in FAMILY_DESCRIPTIONS:
        return f"{FAMILY_DESCRIPTIONS[kind]}. Typical stand-in for {', '.join(aliases)}."
    if kind == "diode":
        return f"Fast small-signal switching diode. Typical stand-in for {', '.join(aliases)}."
    if kind == "led":
        return f"Electrical model of a {aliases[0]}."
    if kind == "zener":
        if model_id == "ZENER_OJ":
            return "Generic zener with adjustable voltage, test current, dynamic resistance and knee softness."
        voltage, current = re.search(r"\bVZ=(\S+) IZT=(\S+)m\b", definition).groups()
        return f"{aliases[0]} zener diode, modelled at {voltage} V and a {current} mA test current."
    if kind == "pot":
        return "Linear potentiometer with adjustable end-to-end resistance and wiper position."
    if model_id == "OPAMP_OJ":
        return "Generic single op-amp with configurable gain, bandwidth, slew rate and output limits."
    if kind == "opamp":
        return f"One amplifier section for {', '.join(aliases)}, with five SPICE terminals."
    if kind in ("opamp2", "opamp4"):
        package = "eight-pin dual" if kind == "opamp2" else "14-pin quad"
        return f"Complete {package} {aliases[0]} op-amp package with shared supply pins."
    raise ValueError(f"Missing description for {model_id} ({kind})")


def definitions(spice):
    """Extract top-level definitions, preserving local definitions inside subcircuits."""
    lines = spice.splitlines(keepends=True)
    index = 0
    while index < len(lines):
        match = re.match(r"^\.(model|subckt)\s+(\w+)\s+", lines[index], re.I)
        if not match:
            index += 1
            continue
        form, model_id = match.groups()
        start = index
        index += 1
        if form.lower() == "subckt":
            depth = 1
            while index < len(lines) and depth:
                directive = lines[index].lower().split(maxsplit=1)[:1]
                if directive == [".subckt"]:
                    depth += 1
                elif directive == [".ends"]:
                    depth -= 1
                index += 1
            if depth:
                raise ValueError(f"Unterminated subcircuit {model_id}")
        else:
            while index < len(lines) and lines[index].lstrip().startswith("+"):
                index += 1
        yield model_id, form.lower(), "".join(lines[start:index]), start + 1


def model_declaration(definition):
    first, *remaining = definition.splitlines()
    header = [first]
    for line in remaining:
        if not line.lstrip().startswith("+"):
            break
        header.append(line.lstrip()[1:].strip())
    return " ".join(header).split(maxsplit=2)[2]


def read_models(spice):
    metadata = tomllib.loads((SOURCE / "models.toml").read_text(encoding="utf-8"))
    models = {}
    for model_id, form, definition, source_line in definitions(spice):
        if model_id in models:
            raise ValueError(f"Duplicate model ID {model_id}")
        info = metadata[model_id]
        kind = info["kind"]
        aliases = info.get("stand_in_for", [])
        declaration = model_declaration(definition)
        parameters = {}
        if form == "model":
            designator, model_type, roles = PRIMITIVES[kind]
            if declaration.split("(", 1)[0].strip() != model_type:
                raise ValueError(f"Unexpected primitive type for {model_id}")
            terminals = [{"role": role} for role in roles]
        else:
            designator = "X"
            ports, _, defaults = declaration.partition(" params:")
            port_names = ports.split()
            if len(port_names) != len(PORT_ROLES[kind]) or set(port_names) != PORT_ROLES[kind].keys():
                raise ValueError(f"Unexpected terminal list for {model_id}")
            terminals = [{"port": port, "role": PORT_ROLES[kind][port]} for port in port_names]
            parameters = dict(pair.split("=", 1) for pair in defaults.split())
        models[model_id] = {
            "id": model_id,
            "kind": kind,
            "description": description(model_id, kind, aliases, definition),
            "source": {
                "name": "OpenJellyBean",
                "revision": REVISION,
                "url": f"{UPSTREAM_LIBRARY_URL}#L{source_line}",
            },
            "aliases": aliases,
            "datasheetReference": info["source"],
            "designator": designator,
            "terminals": terminals,
            "parameterDefaults": parameters,
            "definition": definition,
            "compatibleComponents": [],
        }
    if models.keys() != metadata.keys():
        raise ValueError("OpenJellyBean definitions and metadata differ")
    return models


# Each rule anchors the mapping to the actual shipped pin numbers AND labels.
# Tuples in the final field are ordered exactly as the model's SPICE terminals.
POT_RULE = ("pot", {"1": "", "2": "", "3": "Wiper"}, ("1", "3", "2"), ("POT_OJ",))
BJT_PINS = {"1": "B", "2": "E", "3": "C"}
MOS_PINS = {"2": "G", "3": "D", "4": "S"}
DIODE_PINS = {"1": "", "2": ""}
LM358_PINS = ("1OUT", "1IN-", "1IN+", "V-", "2IN+", "2IN-", "2OUT", "V+")
LM324_PINS = (
    "1OUT", "1IN-", "1IN+", "V+", "2IN+", "2IN-", "2OUT",
    "3OUT", "3IN-", "3IN+", "V-", "4IN+", "4IN-", "4OUT",
)
MAPPINGS = {
    "LM358": (
        "opamp2",
        {str(number): label for number, label in enumerate(LM358_PINS, 1)},
        tuple(map(str, range(1, 9))),
        ("LM358_DUAL_OJ",),
    ),
    "LM324": (
        "opamp4",
        {str(number): label for number, label in enumerate(LM324_PINS, 1)},
        tuple(map(str, range(1, 15))),
        ("LM324_QUAD_OJ",),
    ),
    "Potentiometer": POT_RULE,
    "Trimmer resistor": POT_RULE,
    "Potentiometer (US)": POT_RULE,
    "Trimmer resistor (US)": POT_RULE,
    "NPN transistor": ("npn", BJT_PINS, ("3", "1", "2"), ("2N3904_OJ", "BC547B_OJ")),
    "PNP transistor": ("pnp", BJT_PINS, ("3", "1", "2"), ("2N3906_OJ", "BC557B_OJ")),
    "N-channel MOSFET": ("nmos", MOS_PINS, ("3", "2", "4"), ("2N7000_OJ",)),
    "P-channel MOSFET": ("pmos", MOS_PINS, ("3", "2", "4"), ("BS250_OJ",)),
    "Diode": ("diode", DIODE_PINS, ("1", "2"), ("1N4148_OJ", "1N5819_OJ", "BAT54_OJ", "B140_OJ")),
    "Zener diode (5.1 V)": ("zener", DIODE_PINS, ("1", "2"), ("BZX79C5V1_OJ", "1N4733A_OJ", "ZENER_OJ")),
    **{
        f"LED ({colour})": ("led", DIODE_PINS, ("1", "2"), (f"LED_{colour.upper()}_OJ",))
        for colour in ("red", "green", "blue")
    },
}


def add_compatibility(models):
    with closing(sqlite3.connect(LIBRARY.as_uri() + "?mode=ro", uri=True)) as library:
        rows = library.execute("""
            SELECT Name.NameID, Name.Name, Name.SymbolID, Name.ppp, Symbol.Data
            FROM Name JOIN Symbol USING (SymbolID)
            WHERE EXISTS (SELECT 1 FROM Attribute
                WHERE Attribute.NameID = Name.NameID AND AttName = '$$SPICE' AND AttValue <> '')
            ORDER BY Name.NameID
        """).fetchall()
        pot_attributes = set(library.execute("""
            SELECT NameID, AttName FROM Attribute WHERE AttName IN ('Value', 'Wiper')
        """))
    observed = set()
    uncovered = []
    for name_id, name, symbol_id, units, xml in rows:
        component = {"libraryId": "spice", "nameId": name_id, "symbolId": symbol_id, "name": name}
        if name not in MAPPINGS:
            uncovered.append(component)
            continue
        if name in observed:
            raise ValueError(f"Ambiguous bundled symbol name {name}")
        observed.add(name)
        kind, expected, ordered_pins, model_ids = MAPPINGS[name]
        pins = sorted(
            ({"number": pin.attrib["number"], "name": pin.text or "",
              "part": int(pin.get("part", 0)), "which": int(pin.get("which", 0))}
             for pin in ET.fromstring(xml).iter("PIN")),
            key=lambda pin: pin["number"],
        )
        expected_pins = [
            {"number": number, "name": label, "part": 0, "which": 0}
            for number, label in sorted(expected.items())
        ]
        if units != 1 or pins != expected_pins or set(ordered_pins) != expected.keys():
            raise ValueError(f"Bundled SPICE pin layout changed for {name}")
        compatibility = {
            **component,
            "pinLayout": sorted(expected, key=int),
            "pinsInModelOrder": ordered_pins,
        }
        if kind == "pot":
            if not {(name_id, "Value"), (name_id, "Wiper")} <= pot_attributes:
                raise ValueError(f"Potentiometer attributes changed for {name}")
            compatibility["parameterAttributes"] = {"R": "Value", "POS": "Wiper"}
        for model_id in model_ids:
            model = models[model_id]
            allowed_kinds = {"diode", "schottky"} if kind == "diode" else {kind}
            if model["kind"] not in allowed_kinds or len(model["terminals"]) != len(ordered_pins):
                raise ValueError(f"Incompatible pairing of {name} with {model_id}")
            model["compatibleComponents"].append(compatibility)
    if observed != MAPPINGS.keys():
        raise ValueError(f"Bundled SPICE symbols missing: {', '.join(sorted(MAPPINGS.keys() - observed))}")
    return uncovered


# Select the first two gap fillers and the next additions proposed for TinyCAD.
# Helper subcircuits ship with their callers and are kept out of search results.
CIRCSIM_MODELS = {
    "opamp": {
        "opamp_core": None,
        "LM741": ("opamp", "Single 741 op-amp. Models nominal gain, bandwidth, slew rate and offset. Offset-null pins are omitted.", ("UA741",)),
        "LM393": ("comparator", "One LM393 comparator channel. Open-collector output requires a pull-up.", ("LM2903",)),
        "LM339_QUAD": ("comparator", "Complete LM339 quad comparator with open-collector outputs.", ("LM339", "LM2901")),
        "NE5532": ("opamp2", "Complete dual audio op-amp with shared supply pins.", ("NE5532P", "NE5532D")),
    },
    "discrete-extra": {
        "LED_YELLOW": ("led", "Generic yellow indicator LED fitted to 2.10 V at 20 mA. Electrical behaviour only.", ("yellow LED",)),
    },
    "timer555": {
        "NE555": ("timer", "Behavioural 555 timer with trigger, threshold, reset and discharge terminals.", ("LM555", "555")),
    },
    "opto": {
        "PC817": ("optocoupler", "Phototransistor optocoupler with a constant typical current transfer ratio.", ("EL817", "LTV-817")),
        "4N35": ("optocoupler", "Phototransistor optocoupler with constant current transfer ratio. Base terminal is omitted.", ()),
    },
    "regulators": {
        "reg_lin": None,
        "reg_lin_ref": None,
        "7805": ("regulator", "Behavioural 5 V linear regulator with dropout and current limiting.", ("LM7805", "L7805")),
        "TL431": ("reference", "Behavioural adjustable shunt reference with a nominal 2.495 V reference.", ("TL431A", "TL432")),
        "LM317": ("regulator", "Behavioural adjustable linear regulator with a nominal 1.25 V OUT-to-ADJ reference.", ("LM317T",)),
    },
    "mosfet": {
        "MIRLZ44N": ("nmos", "Logic-level 55 V N-channel power MOSFET.", ("IRLZ44N",)),
        "MIRF540N": ("nmos", "100 V N-channel power MOSFET.", ("IRF540N",)),
        "MIRF3205": ("nmos", "55 V low-resistance N-channel power MOSFET.", ("IRF3205",)),
        "MIRF9540N": ("pmos", "100 V P-channel power MOSFET.", ("IRF9540N",)),
    },
}
CIRCSIM_PINS = {
    "LM741": (19, 19, "741 op-amp", ("3", "2", "6", "7", "4")),
    "LED_YELLOW": (18, 18, "LED (yellow)", ("1", "2")),
    "MIRLZ44N": (11, 11, "N-channel MOSFET", ("3", "2", "4")),
    "MIRF540N": (11, 11, "N-channel MOSFET", ("3", "2", "4")),
    "MIRF3205": (11, 11, "N-channel MOSFET", ("3", "2", "4")),
    "MIRF9540N": (12, 12, "P-channel MOSFET", ("3", "2", "4")),
}
CIRCSIM_PORTS = {
    "inp": "non-inverting input", "inn": "inverting input", "out": "output",
    "vcc": "positive supply", "vee": "negative supply", "gnd": "ground",
    "vin": "input supply", "vout": "output", "adj": "adjust", "ref": "reference",
    "a": "anode", "k": "cathode", "c": "collector", "e": "emitter",
    "trig": "trigger", "ctrl": "control voltage", "thres": "threshold", "disch": "discharge",
}


def circsim_source(filename):
    text = (CIRCSIM_SOURCE / filename).read_text(encoding="utf-8")
    if hashlib.sha256(text.encode("utf-8")).hexdigest() != CIRCSIM_SHA256[filename]:
        raise ValueError(f"circsim source {filename} does not match the pinned SHA-256")
    return text


def build_circsim():
    models = []
    pack = []
    with closing(sqlite3.connect(LIBRARY.as_uri() + "?mode=ro", uri=True)) as library:
        for filename, selected in CIRCSIM_MODELS.items():
            original = circsim_source(f"{filename}.lib.txt")
            available = {name: (form, definition, line) for name, form, definition, line in definitions(original)}
            for name, entry in selected.items():
                form, definition, line = available[name]
                pack.append(definition)
                if entry is None:
                    continue
                kind, summary, aliases = entry
                if form == "model":
                    designator, _, roles = PRIMITIVES[kind]
                    terminals = [{"role": role} for role in roles]
                    defaults = ""
                else:
                    designator = "X"
                    fields = re.split(r"\s+params:\s*", model_declaration(definition), maxsplit=1, flags=re.I)
                    ports, defaults = (fields + [""])[:2]
                    terminals = [{"port": port, "role": CIRCSIM_PORTS.get(port, port)} for port in ports.split()]
                compatible = []
                if name in CIRCSIM_PINS:
                    name_id, symbol_id, label, mapping = CIRCSIM_PINS[name]
                    found = library.execute("SELECT Name, Data, ppp FROM Name JOIN Symbol USING (SymbolID) WHERE NameID = ? AND SymbolID = ?", (name_id, symbol_id)).fetchone()
                    if found is None or found[0] != label or found[2] != 1:
                        raise ValueError(f"Missing bundled symbol {label}")
                    pins = [pin.attrib["number"] for pin in ET.fromstring(found[1]).iter("PIN")]
                    if sorted(pins) != sorted(mapping) or len(mapping) != len(terminals):
                        raise ValueError(f"Pin contract changed for {label}")
                    compatible.append({"libraryId": "spice", "nameId": name_id, "symbolId": symbol_id, "name": label,
                                       "pinLayout": sorted(pins, key=int), "pinsInModelOrder": mapping})
                models.append({
                    "id": name, "kind": kind, "description": summary, "aliases": aliases,
                    "source": {"name": "circsim", "revision": CIRCSIM_REVISION,
                               "url": f"https://github.com/epim/circsim/blob/{CIRCSIM_REVISION}/resources/models/{filename}.lib#L{line}"},
                    "designator": designator, "terminals": terminals,
                    "parameterDefaults": dict(pair.split("=", 1) for pair in defaults.split()),
                    "definition": definition, "compatibleComponents": compatible,
                })
    spice = "* TinyCAD selection of circsim models\n\n" + "\n".join(pack)
    return {"schemaVersion": 1, "pack": {
        "id": "circsim", "version": CIRCSIM_REVISION[:12], "revision": CIRCSIM_REVISION,
        "filename": f"circsim_{CIRCSIM_REVISION[:12]}.lib",
        "sha256": hashlib.sha256(spice.encode("utf-8")).hexdigest(), "license": "MIT",
        "licenseText": circsim_source("LICENSE"), "spice": spice,
    }, "models": models}


def build_additional_catalogs():
    manifest = json.loads((ADDITIONAL_SOURCES / "manifest.json").read_text(encoding="utf-8"))
    with closing(sqlite3.connect(LIBRARY.as_uri() + "?mode=ro", uri=True)) as library:
        for catalog in manifest:
            native_only = catalog.get("requiresXspice", False)
            models, pack_text = [], []
            for source in catalog["sources"]:
                path = ADDITIONAL_SOURCES / source["file"]
                data = path.read_text(encoding="utf-8").encode("utf-8")
                if hashlib.sha256(data).hexdigest() != source["sha256"]:
                    raise ValueError(f"Unexpected model source bytes in {path}")
                file_models = {name: (form, text, line) for name, form, text, line in definitions(data.decode("utf-8"))}
                for name, metadata in source["models"].items():
                    form, definition, line = file_models[name]
                    if metadata.get("replaceModelType"):
                        old, new = metadata["replaceModelType"]
                        definition, count = re.subn(
                            rf"^(\.model\s+\S+\s+){re.escape(old)}\b",
                            rf"\g<1>{new}", definition, flags=re.M | re.I,
                        )
                        if count != 1:
                            raise ValueError(f"Expected one {old} model card in {name}")
                        definition = definition.replace("\n", f"\n* TinyCAD adaptation: {old} card uses {new}.\n", 1)
                    if metadata.get("localParameters"):
                        header, body = definition.split("\n", 1)
                        for parameter, default in metadata.get("defaults", {}).items():
                            header, count = re.subn(rf"\b{re.escape(parameter)}=\S+", f"{parameter}={default}", header)
                            if count != 1:
                                raise ValueError(f"Missing parameter {parameter} in {name}")
                        values = " ".join(f"{key}={value}" for key, value in metadata["localParameters"].items())
                        definition = (header + "\n* TinyCAD adaptation: local nominal process parameters and numeric defaults.\n"
                                      + ".param " + values + "\n" + body)
                    pin_roles = metadata["roles"]
                    if form == "subckt":
                        ports = re.split(r"\s+params:|\s+\w+\s*=", model_declaration(definition), maxsplit=1, flags=re.I)[0].split()
                        if len(ports) != len(pin_roles):
                            raise ValueError(f"Unexpected port count in {name}")
                        terminals = [{"port": port, "role": role} for port, role in zip(ports, pin_roles)]
                    else:
                        terminals = [{"role": role} for role in pin_roles]
                    mappings = []
                    for label, mapping in metadata.get("compatible", {}).items():
                        found = library.execute(
                            "SELECT NameID, SymbolID, Data, ppp FROM Name JOIN Symbol USING (SymbolID) WHERE Name = ?",
                            (label,),
                        ).fetchone()
                        if not found or found[3] != 1:
                            raise ValueError(f"Missing bundled single-part symbol {label}")
                        name_id, symbol_id, xml, _ = found
                        pins = sorted((pin.attrib["number"] for pin in ET.fromstring(xml).iter("PIN")), key=int)
                        if sorted(mapping, key=int) != pins or len(mapping) != len(terminals):
                            raise ValueError(f"Pin contract changed for {label}")
                        mappings.append({"libraryId": "spice", "nameId": name_id, "symbolId": symbol_id,
                                         "name": label, "pinLayout": pins, "pinsInModelOrder": mapping})
                    url = source["url"]
                    if url.startswith("https://github.com/"):
                        url += f"#L{line + source.get('lineOffset', 0)}"
                    models.append({
                        "id": name, "kind": metadata["kind"], "description": metadata["description"],
                        "aliases": metadata.get("aliases", []),
                        "source": {"name": catalog["name"], "revision": catalog["revision"], "url": url,
                                   **({"archiveMember": source["archiveMember"]} if "archiveMember" in source else {})},
                        "designator": "X" if form == "subckt" else metadata["designator"],
                        "terminals": terminals, "parameterDefaults": metadata.get("defaults", {}),
                        "definition": definition, "compatibleComponents": mappings,
                    })
                    pack_text.append(definition.rstrip())
            revision = catalog["revision"]
            spice = f"* TinyCAD selection from {catalog['name']}\n\n" + "\n\n".join(pack_text) + "\n"
            yield LIBRARY.with_name(f"{catalog['id']}.json"), {
                "schemaVersion": 1, **({"requiresXspice": True} if native_only else {}),
                "pack": {
                    "id": catalog["id"], "version": revision[:12], "revision": revision,
                    "filename": f"{catalog['id']}_{revision[:12]}.lib",
                    "sha256": hashlib.sha256(spice.encode("utf-8")).hexdigest(),
                    "license": catalog["license"],
                    "licenseText": (ADDITIONAL_SOURCES / catalog["notice"]).read_text(encoding="utf-8"),
                    "spice": spice,
                },
                "models": models,
            }


def build_basic_catalog(openjellybean):
    raw = BASIC_SOURCE.read_text(encoding="utf-8")
    revision = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    source = {"name": "TinyCAD Basic", "revision": revision,
              "url": "https://github.com/matt123p/TinyCADv4/blob/main/library-recipes/spice-basic-models.json"}
    models, templates, defaults = [], {}, {}
    with closing(sqlite3.connect(LIBRARY.as_uri() + "?mode=ro", uri=True)) as library:
        symbols = {
            name: (name_id, symbol_id, sorted({pin.attrib["number"] for pin in ET.fromstring(xml).iter("PIN")}, key=int))
            for name_id, symbol_id, name, xml in library.execute(
                "SELECT NameID, SymbolID, Name, Data FROM Name JOIN Symbol USING (SymbolID)")
        }
        for profile in json.loads(raw):
            model_id = profile["id"]
            pins = profile["pins"]
            mappings = []
            for name in profile["components"]:
                name_id, symbol_id, layout = symbols[name]
                if name in defaults or sorted(pins, key=int) != layout:
                    raise ValueError(f"Invalid Basic model assignment for {name}")
                mappings.append({"libraryId": "spice", "nameId": name_id, "symbolId": symbol_id,
                                 "name": name, "pinLayout": layout, "pinsInModelOrder": pins})
                defaults[name] = {
                    "template": profile["instance"],
                    "binding": {"packId": "basic", "revision": revision, "modelId": model_id,
                                "label": profile["label"], "source": source, "pins": pins,
                                "parameters": {}, "previous": []},
                }
            templates[model_id] = {key: profile[key] for key in ("instance", "prologue", "templatePins", "attributes")}
            models.append({"id": model_id, "label": profile["label"], "kind": profile["kind"],
                           "description": profile["description"], "aliases": profile["components"],
                           "source": source, "designator": "", "parameterDefaults": {},
                           "terminals": [{"role": role} for role in profile["terminals"]],
                           "compatibleComponents": mappings})
        for model_id in ("LM358_DUAL_OJ", "LM324_QUAD_OJ"):
            model = next(entry for entry in openjellybean["models"] if entry["id"] == model_id)
            for mapping in model["compatibleComponents"]:
                pins = mapping["pinsInModelOrder"]
                defaults[mapping["name"]] = {
                    "template": "XTC_$(ref) " + " ".join(f"%({pin})" for pin in pins) + " " + model_id,
                    "binding": {"packId": "openjellybean", "revision": REVISION, "modelId": model_id,
                                "source": model["source"], "pins": pins, "parameters": {}, "previous": []},
                }
        if defaults.keys() != symbols.keys():
            raise ValueError("Every SPICE essentials symbol needs a default catalog model")
    spice = json.dumps(templates, ensure_ascii=False, separators=(",", ":"))
    return {"schemaVersion": 1, "pack": {
        "id": "basic", "version": revision[:12], "revision": revision, "filename": f"basic_{revision[:12]}.lib",
        "format": "templates", "sha256": hashlib.sha256(spice.encode("utf-8")).hexdigest(),
        "license": "GPL-3.0-only", "licenseText": "TinyCAD Basic SPICE templates are licensed under GNU GPL version 3.\nhttps://www.gnu.org/licenses/gpl-3.0.html",
        "spice": spice,
    }, "models": models, "defaults": defaults}


def link_spice_library(defaults, check):
    if check:
        library = sqlite3.connect(LIBRARY.as_uri() + "?mode=ro", uri=True)
    else:
        library = sqlite3.connect(LIBRARY)
    with closing(library), library:
        changed = False
        for name_id, name in library.execute("SELECT NameID, Name FROM Name"):
            default = defaults[name]
            fields = {"$$SPICE": default["template"],
                      "$$CATALOG_MODEL": json.dumps(default["binding"], ensure_ascii=False, separators=(",", ":"))}
            existing = dict(library.execute(
                "SELECT AttName, AttValue FROM Attribute WHERE NameID=? AND AttName IN ('$$SPICE','$$CATALOG_MODEL','$$SPICE_PROLOG','$$SPICE_EPILOG')",
                (name_id,)))
            if existing == fields:
                continue
            if check:
                raise ValueError(f"Bundled default link is out of date for {name}")
            library.execute(
                "DELETE FROM Attribute WHERE NameID=? AND AttName IN ('$$SPICE','$$CATALOG_MODEL','$$SPICE_PROLOG','$$SPICE_EPILOG')",
                (name_id,))
            library.executemany("INSERT INTO Attribute (NameID, AttName, AttValue, ShowAtt) VALUES (?, ?, ?, 2)",
                                [(name_id, key, value) for key, value in fields.items()])
            changed = True
        if changed:
            library.commit()
            library.execute("VACUUM")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check that the committed catalog is current")
    args = parser.parse_args()
    spice = (SOURCE / "jellybean.lib.txt").read_text(encoding="utf-8")
    if hashlib.sha256(spice.encode("utf-8")).hexdigest() != LIBRARY_SHA256:
        raise ValueError("OpenJellyBean library does not match the pinned SHA-256")
    models = read_models(spice)
    uncovered = add_compatibility(models)
    catalog = {
        "schemaVersion": 1,
        "pack": {
            "id": "openjellybean",
            "version": re.search(r"^\* Version (\S+)", spice, re.M)[1],
            "revision": REVISION,
            "filename": "openjellybean_0_6_0.lib",
            "sha256": LIBRARY_SHA256,
            "license": "MIT",
            "licenseText": (SOURCE / "LICENSE").read_text(encoding="utf-8"),
            "spice": spice,
        },
        "models": list(models.values()),
        "uncoveredComponents": uncovered,
    }
    basic = build_basic_catalog(catalog)
    for filename, source_catalog in ((OUTPUT, catalog), (CIRCSIM_OUTPUT, build_circsim()),
                                     (LIBRARY.with_name("basic.json"), basic), *build_additional_catalogs()):
        output = json.dumps(source_catalog, ensure_ascii=False, indent=2) + "\n"
        if args.check:
            if not filename.is_file() or filename.read_text(encoding="utf-8") != output:
                parser.exit(1, f"{filename.relative_to(ROOT)} is out of date. Regenerate the catalog.\n")
        else:
            filename.write_text(output, encoding="utf-8", newline="\n")
    link_spice_library(basic["defaults"], args.check)


if __name__ == "__main__":
    main()
