import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { element, resource, label, makePin, body } from './digital-artwork.mjs';
import { drawFunctionalBlock } from './functional-artwork.mjs';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const nodes = (doc, tag) => Array.from(doc.getElementsByTagName(tag));
const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
const xy = (n, key = 'pos') => n.getAttribute(key).split(',').map(Number);
function add(doc, tag, attrs, text) {
  const n = element(doc, tag, attrs, text);
  doc.documentElement.appendChild(n);
  return n;
}
function line(doc, points, style = 3) {
  const n = add(doc, 'POLYGON', { pos: [0, 0], style, fill: 0, polygon: 0 });
  for (const p of points)
    n.appendChild(
      element(
        doc,
        'POINT',
        Array.isArray(p) ? { pos: p, arc: 0 } : { arc: 0, ...p },
      ),
    );
  return n;
}
function circle(doc, x, y, r, fill = 0) {
  return add(doc, 'ELLIPSE', {
    a: [x - r, y - r],
    b: [x + r, y + r],
    style: 3,
    fill,
  });
}
function arrow(doc, from, to) {
  line(doc, [from, to]);
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]],
    len = Math.hypot(dx, dy),
    u = [dx / len, dy / len];
  line(doc, [
    [to[0] - 0.8 * u[0] + 0.35 * u[1], to[1] - 0.8 * u[1] - 0.35 * u[0]],
    to,
    [to[0] - 0.8 * u[0] - 0.35 * u[1], to[1] - 0.8 * u[1] + 0.35 * u[0]],
  ]);
}
// Copy the corrected component primitives at their original scale, including
// their actual stroke/fill resources. Only the drawing origin changes.
function stamp(doc, base, dx, dy) {
  const source = parse(base.xml);
  for (const child of Array.from(source.documentElement.childNodes)) {
    const resourceNode = ['STYLE', 'FILL', 'FONT'].includes(child.nodeName);
    if (
      !resourceNode &&
      !['POLYGON', 'RECTANGLE', 'ELLIPSE'].includes(child.nodeName)
    )
      continue;
    const n = doc.importNode(child, true);
    if (resourceNode) n.setAttribute('id', Number(n.getAttribute('id')) + 100);
    else {
      for (const attr of ['style', 'fill', 'font'])
        if (n.hasAttribute(attr))
          n.setAttribute(attr, Number(n.getAttribute(attr)) + 100);
      for (const attr of ['pos', 'a', 'b'])
        if (n.hasAttribute(attr)) {
          const p = xy(n, attr);
          n.setAttribute(attr, [p[0] + dx, p[1] + dy].join(','));
        }
    }
    doc.documentElement.appendChild(n);
  }
}
function draw(reference, base, r, recipe, definition) {
  if (definition.drawing === 'am') {
    const built = drawFunctionalBlock(reference, r, recipe, 'AM', null),
      doc = parse(built.xml),
      x = built.width / 2,
      y = built.height / 2 - 1;
    for (const n of nodes(doc, 'TEXT'))
      if (n.textContent === 'AM') n.parentNode.removeChild(n);
    circle(doc, x, y, 1.6);
    line(doc, [
      [x - 0.9, y - 0.9],
      [x + 0.9, y + 0.9],
    ]);
    line(doc, [
      [x - 0.9, y + 0.9],
      [x + 0.9, y - 0.9],
    ]);
    label(doc, [x - 0.72, y + 4], 'AM');
    return new XMLSerializer().serializeToString(doc);
  }
  const doc = parse(reference.xml);
  for (const n of Array.from(doc.documentElement.childNodes))
    if (!['FONT', 'STYLE', 'FILL'].includes(n.nodeName))
      doc.documentElement.removeChild(n);
  const pin = (number, pos, dir, length = 20) =>
    makePin(
      doc,
      r.pins.find((p) => p.logical_number === String(number)),
      pos,
      dir,
      length,
    );
  switch (definition.drawing) {
    case 'test-point':
      pin(1, [0, 4], 0);
      circle(doc, 0, -0.8, 0.8);
      break;
    case 'piezo': {
      const source = parse(base.xml),
        p = nodes(source, 'PIN'),
        cx = xy(p[0])[0],
        cy = (xy(p[0])[1] + xy(p[1])[1]) / 2;
      stamp(doc, base, -cx, -cy);
      for (const original of p) {
        const n = original.getAttribute('number'),
          pos = xy(original);
        pin(
          n,
          [pos[0] - cx, pos[1] - cy],
          Number(original.getAttribute('direction')),
          Number(original.getAttribute('length')),
        );
      }
      add(doc, 'RECTANGLE', {
        a: [-1, -0.25],
        b: [1, 0.25],
        style: 3,
        fill: 0,
      });
      arrow(doc, [-4, -2], [-1.5, -0.5]);
      label(doc, [2.4, 0.9], 'PZ');
      label(doc, [-1.8, -2.2], '+');
      break;
    }
    case 'ph':
      circle(doc, 4, 4, 4);
      pin(1, [-4, 4], 3);
      pin(2, [4, 12], 0);
      label(doc, [3.3, 4.9], 'pH');
      break;
    case 'moisture':
      pin(1, [-4, 4], 3);
      pin(2, [12, 4], 2);
      line(doc, [
        [0, 4],
        [2, 4],
        [2, 2],
        [2, 6],
      ]);
      line(doc, [
        [8, 4],
        [6, 4],
        [6, 3],
        [6, 5],
      ]);
      for (const y of [2, 4, 6])
        line(doc, [
          [2, y],
          [4.5, y],
        ]);
      for (const y of [3, 5])
        line(doc, [
          [6, y],
          [3.5, y],
        ]);
      line(doc, [
        [4, -3],
        { pos: [2.9, -0.8], control: [2.5, -1] },
        { pos: [5.1, -0.8], control: [4, 1] },
        { pos: [4, -3], control: [5.5, -1] },
      ]);
      label(doc, [2.9, 8.5], 'H2O');
      break;
    case 'switch':
      body(doc, 'block', 12, 10, 0);
      pin(1, [-4, 3], 3);
      pin(2, [16, 3], 2);
      pin(3, [-4, 7], 3);
      pin(4, [6, 14], 0);
      circle(doc, 4, 3, 0.4);
      circle(doc, 8, 3, 0.4);
      line(doc, [
        [0, 3],
        [3.6, 3],
      ]);
      line(doc, [
        [8.4, 3],
        [12, 3],
      ]);
      line(doc, [
        [4, 3],
        [7.5, 1.5],
      ]);
      add(doc, 'RECTANGLE', { a: [4, 6], b: [8, 8], style: 3, fill: 0 });
      line(doc, [
        [0, 7],
        [4, 7],
      ]);
      line(doc, [
        [6, 10],
        [6, 8],
      ]);
      resource(doc, 'STYLE', 9, { STYLE: 2, COLOR: '000000', THICKNESS: 1 });
      line(
        doc,
        [
          [6, 6],
          [6, 3.6],
        ],
        9,
      );
      label(doc, [0.6, 2.2], 'A');
      label(doc, [10.7, 2.2], 'B');
      label(doc, [0.3, 6], 'CTRL+');
      label(doc, [4.2, 9.6], 'CTRL-');
      label(doc, [4.5, 7.7], '+');
      label(doc, [6.7, 7.7], '-');
      break;
    default:
      body(doc, 'block', 8, 8, 0);
      for (const p of r.pins)
        makePin(
          doc,
          p,
          p.side === 'top' ? [4, -4] : p.side === 'bottom' ? [4, 12] : [12, 4],
          p.side === 'top' ? 1 : p.side === 'bottom' ? 0 : 2,
          20,
        );
      label(doc, [2.9, 1.7], 'VCC');
      label(doc, [2.9, 7.5], 'GND');
      label(doc, [5.1, 4.9], 'OUT');
      if (definition.drawing === 'hall') {
        label(doc, [1.5, 4.9], 'H');
        arrow(doc, [-4, 4], [-0.5, 4]);
        label(doc, [-3.5, 2.8], 'B');
      } else if (definition.drawing === 'light') {
        const pins = nodes(parse(base.xml), 'PIN').map((p) => xy(p));
        stamp(
          doc,
          base,
          2.5 - (pins[0][0] + pins[1][0]) / 2,
          4 - (pins[0][1] + pins[1][1]) / 2,
        );
        arrow(doc, [-3, -1], [0.3, 3]);
        arrow(doc, [-3, 1], [0.3, 5]);
      } else if (definition.drawing === 'pressure') {
        line(doc, [[2, 2.5], { pos: [2, 5.5], control: [3.5, 4] }]);
        arrow(doc, [-3, 4], [1.5, 4]);
        label(doc, [-3, 2.8], 'p');
      } else if (definition.drawing === 'temperature') {
        circle(doc, 2, 5, 0.7);
        line(doc, [
          [1.65, 4.4],
          [1.65, 2.5],
          { pos: [2.35, 2.5], control: [2, 1.8] },
          [2.35, 4.4],
        ]);
        line(doc, [
          [2, 4.5],
          [2, 3],
        ]);
      } else throw Error('Unknown sensor drawing ' + definition.drawing);
  }
  return new XMLSerializer().serializeToString(doc);
}
export async function sensorArtworkSnapshot({
  root,
  digital,
  spice,
  requirements,
}) {
  const recipe = JSON.parse(
    await readFile(
      path.join(root, 'library-recipes/sensors-interfaces.json'),
      'utf8',
    ),
  );
  if (recipe.version !== 1) throw Error('Unsupported sensors recipe.');
  const reference = digital.records.find(
    (r) => r.candidate.id === recipe.style.reference,
  );
  const records = Object.entries(recipe.symbols).map(([id, definition], i) => {
    const r = requirements.find((r) => r.id === id);
    if (!r) throw Error('Unknown sensor/interface ' + id);
    const base = definition.base
      ? spice.records.find((r) => r.candidate.id === definition.base)
      : null;
    if (definition.base && !base)
      throw Error('Missing sensor base ' + definition.base);
    const xml = draw(reference, base, r, recipe, definition);
    const candidate = {
      id: 'derived:' + id,
      kind: 'derived',
      family: 'sensor-interface',
      canonicalId: id,
      baseCandidateId: base?.candidate.id || reference.candidate.id,
      baseXmlSha256: base?.candidate.xmlSha256 || reference.candidate.xmlSha256,
      recipePath: 'library-recipes/sensors-interfaces.json',
      bundleNameId: i + 1,
      bundlePath: recipe.output,
      derivedDefinition: { id, pins: r.pins.map((p) => p.logical_number) },
      names: [
        {
          nameId: i + 1,
          name: r.name,
          description: definition.convention,
          author: 'TinyCAD',
        },
      ],
      xmlSha256: hash(xml),
      derivationNote:
        definition.convention +
        ' Logical terminals only; sensing laws and simulation adapters remain separate.',
    };
    return { candidate, xml, requirement: r };
  });
  const provenance = {
    version: 1,
    id: recipe.id,
    name: recipe.name,
    styleReference: {
      id: reference.candidate.id,
      xmlSha256: reference.candidate.xmlSha256,
    },
    recipeSha256: hash(JSON.stringify(recipe)),
    sources: recipe.sources,
    notes: recipe.notes,
    entries: records.map(({ candidate: c }) => ({
      id: c.canonicalId,
      name: c.names[0].name,
      nameId: c.bundleNameId,
      symbolId: c.bundleNameId,
      xmlSha256: c.xmlSha256,
      baseCandidateId: c.baseCandidateId,
      baseXmlSha256: c.baseXmlSha256,
      convention: c.names[0].description,
    })),
  };
  const library = {
    name: recipe.name,
    names: records.map(({ candidate: c, requirement: r }) => ({
      NameID: c.bundleNameId,
      Name: c.names[0].name,
      SymbolID: c.bundleNameId,
      Type: 0,
      Reference: r.reference_prefix + '?',
      ppp: 1,
      Description: c.names[0].description,
      ShowName: 1,
      ShowRef: 0,
      DefRotate: 0,
      Attributes: [{ AttName: 'Package', AttValue: '', ShowAtt: 1 }],
    })),
    symbols: records.map(({ candidate: c, xml }) => ({
      SymbolId: c.bundleNameId,
      Data: xml,
    })),
  };
  return {
    records,
    recipe,
    provenance,
    library,
    fingerprint: hash(JSON.stringify(provenance)),
  };
}
