import { XMLBuilder } from '../util/xmlbuilder';
import { children, parseXml, validateXml } from './validation';
import { ioXML } from '../io/ioXml';
import { updateSymbol } from '../manipulators/updateSymbol';

export function insertSymbol(args: any) {
  const component = validateXml(args.componentDefinition);
  if (!component.valid) throw new Error(JSON.stringify(component));
  const xml = parseXml(args.definition, true),
    symbol = parseXml(args.componentDefinition, false);
  const root = xml.xmlDoc.documentElement;
  const sheet =
    root.nodeName === 'TinyCAD'
      ? args.sheet === 1
        ? root
        : undefined
      : children(root).filter((n) =>
          ['TinyCAD', 'HierarchicalSymbol'].includes(n.nodeName),
        )[args.sheet - 1];
  if (!sheet) throw new Error('Unknown sheet.');
  if (
    !args.name.trim() ||
    !args.reference.trim() ||
    /[?*]/.test(args.reference)
  )
    throw new Error('Provide a name and assigned reference, e.g. U1.');
  const existing = new ioXML().from_dsn(xml);
  for (const s of existing.sheets)
    for (const item of s.items)
      if (
        item.NodeName === 'symbol' &&
        item.text.some(
          (f) =>
            f.description === 'Ref' &&
            f.value.toLowerCase() === args.reference.toLowerCase(),
        )
      )
        throw new Error('Reference already exists; choose a unique reference.');
  if (
    Array.from(symbol.getElementsByTagName('PIN')).some(
      (n: any) => Number(n.getAttribute('part')) !== 0,
    )
  )
    throw new Error('insert_symbol accepts single-unit symbols (part=0).');
  const builder = new XMLBuilder();
  builder.xmlDoc = xml.xmlDoc;
  builder.insert = sheet;
  const reusable =
    args.componentId &&
    children(sheet).find(
      (node) =>
        node.nodeName === 'SYMBOLDEF' &&
        children(node).some(
          (child) =>
            child.nodeName === 'GUID' &&
            child.textContent === `chat-component-${args.componentId}`,
        ),
    );
  let id = reusable ? reusable.getAttribute('id') : '';
  if (!reusable) {
    const resources = children(symbol.xmlDoc.documentElement);
    const mappings: Record<string, Map<string, string>> = {};
    for (const kind of ['FONT', 'STYLE', 'FILL']) {
      let nextId =
        Math.max(
          0,
          ...children(sheet)
            .filter((n) => n.nodeName === kind)
            .map((n) => Number(n.getAttribute('id'))),
        ) + 1;
      mappings[kind.toLowerCase()] = new Map();
      for (const node of resources.filter((n) => n.nodeName === kind)) {
        const clone = xml.xmlDoc.importNode(node, true),
          id = String(nextId++);
        mappings[kind.toLowerCase()].set(node.getAttribute('id'), id);
        clone.setAttribute('id', id);
        sheet.appendChild(clone);
      }
    }
    id = String(
      Math.max(
        0,
        ...children(sheet)
          .filter((n) => n.nodeName === 'SYMBOLDEF')
          .map((n) => Number(n.getAttribute('id'))),
      ) + 1,
    );
    if (Number(id) > 1000000) throw new Error('No free symbol-definition ID.');
    const def = builder.appendChild('SYMBOLDEF', null, { id });
    def.appendChild('NAME', args.name, { type: 0 });
    def.appendChild(
      'GUID',
      args.componentId
        ? `chat-component-${args.componentId}`
        : `chat-${id}-${args.reference}`,
    );
    def.appendChild('REF', args.reference.replace(/\d+$/, '?'), { type: 0 });
    def.appendChild('DESCRIPTION', args.description || args.name);
    def.appendChild('PPP', '1');
    def.appendChild('REF_POINT', null, { pos: '0,0', power: 0, part: 1 });
    const artwork = def.appendChild('TinyCAD');
    const remap = (n: any) => {
      for (const kind of ['font', 'style', 'fill']) {
        const mapped = mappings[kind].get(n.getAttribute(kind));
        if (mapped !== undefined) n.setAttribute(kind, mapped);
      }
      children(n).forEach(remap);
    };
    for (const node of resources.filter(
      (n) =>
        !['FONT', 'STYLE', 'FILL', 'NAME', 'DETAILS', 'OPTIONS'].includes(
          n.nodeName,
        ),
    )) {
      const clone = xml.xmlDoc.importNode(node, true);
      remap(clone);
      artwork.insert.appendChild(clone);
    }
  }
  const instance = builder.appendChild('SYMBOL', null, {
    id,
    pos: `${args.x},${args.y}`,
    part: 0,
    rotate: args.rotate ?? 0,
    show_power: 1,
    can_scale: 0,
    scale_x: 1,
    scale_y: 1,
  });
  instance.appendChild('FIELD', null, {
    pos: '0,-5',
    description: 'Name',
    value: args.name,
    type: 0,
    show: 1,
  });
  instance.appendChild('FIELD', null, {
    pos: '0,-2.6',
    description: 'Ref',
    value: args.reference,
    type: 0,
    show: 1,
  });
  (args.attributes || []).forEach((a: any, i: number) => {
    if (['ref', 'name'].includes(a.name.toLowerCase()))
      throw new Error(
        'Use name/reference fields rather than duplicate attributes.',
      );
    instance.appendChild('FIELD', null, {
      pos: `0,${-7.4 - i * 2.4}`,
      description: a.name,
      value: a.value,
      type: 0,
      show: 0,
    });
  });
  const rank = (n: any) =>
    [
      'NAME',
      'DETAILS',
      'FONT',
      'STYLE',
      'FILL',
      'SYMBOLDEF',
      'OPTIONS',
    ].indexOf(n.nodeName);
  children(sheet)
    .sort((a, b) => (rank(a) < 0 ? 99 : rank(a)) - (rank(b) < 0 ? 99 : rank(b)))
    .forEach((n) => sheet.appendChild(n));
  const definition = xml.tostring();
  const validation = validateXml(definition, true);
  if (!validation.valid) throw new Error(JSON.stringify(validation));
  const drawing = new ioXML().from_dsn(parseXml(definition, true));
  const placed = drawing.sheets[args.sheet - 1].items.find(
    (item) =>
      item.NodeName === 'symbol' &&
      item.text.some(
        (f) => f.description === 'Ref' && f.value === args.reference,
      ),
  );
  if (!placed || placed.NodeName !== 'symbol')
    throw new Error('Inserted symbol failed native roundtrip.');
  const pins = new updateSymbol(placed).active_points().map(([x, y, pin]) => ({
    number: pin.number,
    name: pin.name,
    electricalType: pin.elec,
    x: x / 5,
    y: y / 5,
  }));
  return { definition, reference: args.reference, pins };
}
