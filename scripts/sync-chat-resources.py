#!/usr/bin/env python3
"""Refresh the bundled skill and schema from a TinyCAD.net checkout.

Usage: python3 scripts/sync-chat-resources.py [../TinyCAD.net]
The browser receives text/resources through read_skill_reference, never MCP.
"""
import copy
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

source = Path(sys.argv[1] if len(sys.argv) > 1 else '../TinyCAD.net')
destination = Path(__file__).resolve().parents[1] / 'src/chat/skill'
files = [Path('SKILL.md'), *sorted(Path('references') / p.name for p in (source / 'skills/tinycad/references').glob('*.md')),
         *sorted(Path('assets') / p.name for p in (source / 'skills/tinycad/assets').iterdir() if p.is_file())]
resources = {p.as_posix(): (source / 'skills/tinycad' / p).read_text(encoding='utf-8') for p in files}
resources['references/spice-models.md'] = (destination / 'spice-models.md').read_text(encoding='utf-8')
(destination / 'resources.json').write_text(json.dumps(resources, indent=2) + '\n')
root = ET.fromstring((source / 'tinycad-net-service/TinyCAD.File.Service/Schema/TinyCADSchema.xsd').read_text(encoding='utf-16'))
ns = {'xs': 'http://www.w3.org/2001/XMLSchema'}
xs = '{' + ns['xs'] + '}'
def convert(node):
    return dict(kind=node.tag.split('}')[-1], **node.attrib, children=[convert(c) for c in node])
(destination / 'schema.json').write_text(json.dumps(convert(root), indent=2) + '\n')
# Mirror the legacy compatibility changes in ComponentValidator.cs.
drawing = copy.deepcopy(root)
def type_named(name):
    return drawing.find(f"xs:complexType[@name='{name}']", ns)
for attr in type_named('symbolType').iter(xs + 'attribute'):
    if attr.get('name') in ['scale_x', 'scale_y', 'can_scale', 'show_power']:
        attr.set('use', 'optional')
for attr in type_named('pinType').iter(xs + 'attribute'):
    if attr.get('name') == 'centre_name':
        attr.set('use', 'optional')
for element in type_named('symbolDefType').iter(xs + 'element'):
    if element.get('name') in ['GUID', 'REF_POINT']:
        element.set('minOccurs', '0')
ET.SubElement(type_named('wireType'), xs + 'attribute', name='net_type', type='xs:string', use='optional')
sequence = type_named('tinyCadSheetsType').find('xs:sequence', ns)
sequence.remove(sequence.find('xs:element', ns))
choice = ET.Element(xs + 'choice', minOccurs='1', maxOccurs='unbounded')
for name in ['TinyCAD', 'HierarchicalSymbol']:
    ET.SubElement(choice, xs + 'element', name=name, type='tinycad')
sequence.insert(0, choice)
# Current editor drawings persist document/sheet identities and simulation setup.
identity = ET.SubElement(drawing, xs + 'complexType', name='dsnIdentityType')
ET.SubElement(identity, xs + 'attribute', name='id', type='xs:string', use='required')
sequence.insert(0, ET.Element(xs + 'element', name='DSNIDENTITY', type='dsnIdentityType', minOccurs='0'))
packs = ET.SubElement(drawing, xs + 'complexType', name='spiceModelPacksType')
content = ET.SubElement(packs, xs + 'simpleContent')
extension = ET.SubElement(content, xs + 'extension', base='xs:string')
ET.SubElement(extension, xs + 'attribute', name='version', type='xs:string', use='required')
sequence.insert(1, ET.Element(xs + 'element', name='SPICE_MODEL_PACKS', type='spiceModelPacksType', minOccurs='0'))
ET.SubElement(type_named('tinycad'), xs + 'attribute', name='id', type='xs:string', use='optional')
simulation = ET.SubElement(drawing, xs + 'complexType', name='simulationSheetType')
content = ET.SubElement(simulation, xs + 'simpleContent')
extension = ET.SubElement(content, xs + 'extension', base='xs:string')
for name in ['id', 'name', 'version']:
    ET.SubElement(extension, xs + 'attribute', name=name, type='xs:string', use='required')
ET.SubElement(choice, xs + 'element', name='SimulationSheet', type='simulationSheetType')
for element in type_named('detailsType').iter(xs + 'element'):
    if element.get('name') == 'GUIDES':
        element.set('minOccurs', '0')
options = type_named('optionsType').find('xs:sequence', ns)
options.tag = xs + 'all'
for option in options:
    option.set('minOccurs', '0')
for name in ['FONT', 'STYLE', 'SCROLLBAR']:
    ET.SubElement(options, xs + 'element', name=name, type='xs:string', minOccurs='0')
(destination / 'drawing-schema.json').write_text(json.dumps(convert(drawing), indent=2) + '\n')
print(f'Updated {len(resources)} skill resources and both validation schemas.')
