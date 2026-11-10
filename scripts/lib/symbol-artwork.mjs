import { createRequire } from 'node:module';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const list = (node, tag) => Array.from(node.getElementsByTagName(tag));
const xy = (node, attr = 'pos') =>
  node.getAttribute(attr).split(',').map(Number);
const fmt = (values) => values.map((n) => Number(n.toFixed(7))).join(',');
const near = (a, b) => Math.abs(a - b) < 1e-6;
const serialize = (doc) => new XMLSerializer().serializeToString(doc);
const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
function element(doc, tag, attributes = {}, text) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, Array.isArray(value) ? fmt(value) : String(value));
  if (text !== undefined) node.appendChild(doc.createTextNode(text));
  return node;
}
function root(doc) {
  return doc.documentElement.nodeName === 'TinyCAD'
    ? doc.documentElement
    : list(doc, 'TinyCAD')[0];
}
function drawingStyle(doc) {
  return list(doc, 'STYLE')
    .filter(
      (node) =>
        node.hasAttribute('id') &&
        node.getElementsByTagName('THICKNESS').length,
    )
    .sort(
      (a, b) =>
        Math.abs(
          Number(a.getElementsByTagName('THICKNESS')[0]?.textContent) - 1,
        ) -
        Math.abs(
          Number(b.getElementsByTagName('THICKNESS')[0]?.textContent) - 1,
        ),
    )[0]
    .getAttribute('id');
}
function polygon(doc, points, { fill = '0', style, part } = {}) {
  const node = element(doc, 'POLYGON', {
    pos: [0, 0],
    style: style || drawingStyle(doc),
    fill,
    ...(part === undefined ? {} : { part }),
  });
  for (const point of points)
    node.appendChild(element(doc, 'POINT', { pos: point, arc: 0 }));
  root(doc).appendChild(node);
  return node;
}
function solidFill(doc) {
  const found = list(doc, 'FILL').find(
    (n) =>
      n.getElementsByTagName('INDEX')[0]?.textContent === '0' &&
      n.getElementsByTagName('COLOR')[0]?.textContent === '000000',
  );
  if (found) return found.getAttribute('id');
  const id =
    Math.max(0, ...list(doc, 'FILL').map((n) => Number(n.getAttribute('id')))) +
    1;
  const fill = element(doc, 'FILL', { id });
  fill.appendChild(element(doc, 'INDEX', {}, '0'));
  fill.appendChild(element(doc, 'COLOR', {}, '000000'));
  root(doc).appendChild(fill);
  return String(id);
}
function line(doc, points) {
  return polygon(doc, points);
}
function arrow(doc, from, to) {
  line(doc, [from, to]);
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    length = Math.hypot(dx, dy),
    u = [dx / length, dy / length];
  polygon(
    doc,
    [
      to,
      [to[0] - 0.8 * u[0] + 0.35 * u[1], to[1] - 0.8 * u[1] - 0.35 * u[0]],
      [to[0] - 0.8 * u[0] - 0.35 * u[1], to[1] - 0.8 * u[1] + 0.35 * u[0]],
      to,
    ],
    { fill: solidFill(doc) },
  );
}
function text(doc, position, value) {
  let font = list(doc, 'FONT').find(
    (n) => n.getElementsByTagName('HEIGHT')[0]?.textContent === '-7',
  );
  if (!font) {
    font = element(doc, 'FONT', {
      id:
        Math.max(
          0,
          ...list(doc, 'FONT').map((n) => Number(n.getAttribute('id'))),
        ) + 1,
    });
    for (const [tag, value] of Object.entries({
      HEIGHT: -7,
      WIDTH: 0,
      WEIGHT: 400,
      ITALIC: 0,
      UNDERLINE: 0,
      STRIKEOUT: 0,
      CHARSET: 0,
      FACENAME: 'Arial',
    }))
      font.appendChild(element(doc, tag, {}, String(value)));
    root(doc).appendChild(font);
  }
  root(doc).appendChild(
    element(
      doc,
      'TEXT',
      {
        pos: position,
        direction: 3,
        font: font.getAttribute('id'),
        color: '000000',
      },
      value,
    ),
  );
}
function pin(doc, number) {
  const p = list(doc, 'PIN').find(
    (n) => n.getAttribute('number') === String(number),
  );
  if (!p) throw Error('Missing base pin ' + number);
  return p;
}
function newPin(doc, number, name, position, direction, length = 10) {
  const p = element(
    doc,
    'PIN',
    {
      pos: position,
      number,
      direction,
      length,
      part: 0,
      which: 0,
      elec: 0,
      show: 0,
      number_pos: 0,
      centre_name: 0,
    },
    name,
  );
  root(doc).appendChild(p);
  return p;
}
function graphics(doc) {
  return Array.from(root(doc).childNodes).filter((n) =>
    ['PIN', 'POLYGON', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'JUNCTION'].includes(
      n.nodeName,
    ),
  );
}
function translate(node, dx, dy) {
  for (const attr of ['pos', 'a', 'b'])
    if (node.hasAttribute(attr))
      node.setAttribute(
        attr,
        fmt(xy(node, attr).map((v, i) => v + [dx, dy][i])),
      );
}

// Preserve the exact 2 × 5.2 mm IEC body envelope and both 1.4 mm leads.
// Eight alternating peaks give the zigzag 180-degree symmetry about its center.
export function applyUSResistor(doc) {
  const matches = list(doc, 'RECTANGLE').filter((node) => {
    const a = xy(node, 'a'),
      b = xy(node, 'b');
    return near(Math.abs(a[0] - b[0]), 2) && near(Math.abs(a[1] - b[1]), 5.2);
  });
  if (matches.length !== 1)
    throw Error(
      'US resistor needs exactly one standard 2 × 5.2 mm European resistor body.',
    );
  const body = matches[0],
    a = xy(body, 'a'),
    b = xy(body, 'b'),
    cx = (a[0] + b[0]) / 2,
    top = Math.min(a[1], b[1]),
    height = Math.abs(a[1] - b[1]);
  const points = [[cx, top]];
  for (let i = 0; i < 8; i++)
    points.push([cx + (i % 2 ? 1 : -1), top + (height * (i + 0.5)) / 8]);
  points.push([cx, top + height]);
  const zigzag = polygon(doc, points, {
    style: body.getAttribute('style'),
    fill: '0',
  });
  body.parentNode.replaceChild(zigzag, body);
}
export function usResistorXml(xml) {
  const doc = parse(xml);
  applyUSResistor(doc);
  return serialize(doc);
}
function addResistorMarks(doc, kind) {
  const one = xy(pin(doc, 1)),
    two = xy(pin(doc, 2)),
    cx = one[0],
    cy = (one[1] + two[1]) / 2;
  if (kind === 'rheostat') arrow(doc, [cx - 3, cy + 3], [cx + 3, cy - 3]);
  else if (kind === 'ntc') {
    line(doc, [
      [cx - 2.5, cy + 3],
      [cx + 2.5, cy - 3],
      [cx + 4, cy - 3],
    ]);
    text(doc, [cx + 2.7, cy - 3.2], '-t°');
  } else if (kind === 'ldr') {
    root(doc).appendChild(
      element(doc, 'ELLIPSE', {
        a: [cx - 4, cy - 4],
        b: [cx + 4, cy + 4],
        style: drawingStyle(doc),
        fill: 0,
      }),
    );
    arrow(doc, [cx - 6.5, cy - 5.5], [cx - 3.5, cy - 2.5]);
    arrow(doc, [cx - 6.5, cy - 3.5], [cx - 3.5, cy - 0.5]);
  } else if (kind === 'strain_gauge') {
    arrow(doc, [cx - 2, cy], [cx - 4, cy]);
    arrow(doc, [cx + 2, cy], [cx + 4, cy]);
    text(doc, [cx + 2.5, cy - 2], 'ε');
  } else throw Error('Unknown resistor decoration ' + kind);
}
function bridge(doc) {
  const bodies = graphics(doc).filter(
    (n) => n.nodeName === 'RECTANGLE' || n.nodeName === 'POLYGON',
  );
  if (bodies.length !== 1)
    throw Error('Bridge requires an undecorated resistor base.');
  const base = bodies[0],
    points =
      base.nodeName === 'RECTANGLE'
        ? (() => {
            const a = xy(base, 'a'),
              b = xy(base, 'b');
            return [a, [b[0], a[1]], b, [a[0], b[1]], a];
          })()
        : list(base, 'POINT').map((p) => xy(p).map((v, i) => v + xy(base)[i]));
  const ends = [xy(pin(doc, 1)), xy(pin(doc, 2))],
    origin = ends[0].map((v, i) => (v + ends[1][i]) / 2);
  const style = base.getAttribute('style');
  for (const node of graphics(doc)) node.parentNode.removeChild(node);
  const corners = [
    [80, 36],
    [88, 44],
    [80, 52],
    [72, 44],
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i],
      b = corners[(i + 1) % 4],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      u = b.map((v, k) => (v - a[k]) / length),
      c = a.map((v, k) => (v + b[k]) / 2);
    const at = (x, y) => [
      c[0] + u[1] * x + u[0] * y,
      c[1] - u[0] * x + u[1] * y,
    ];
    polygon(
      doc,
      points.map((p) => at(p[0] - origin[0], p[1] - origin[1])),
      { style },
    );
    line(doc, [a, at(0, -2.6)]);
    line(doc, [at(0, 2.6), b]);
  }
  newPin(doc, 1, 'EXC+', [80, 34], 1);
  newPin(doc, 2, 'EXC-', [80, 54], 0);
  newPin(doc, 3, 'SIG+', [90, 44], 2);
  newPin(doc, 4, 'SIG-', [70, 44], 3);
}
function jfet(doc, pChannel) {
  // Retain the MOSFET's enclosure, D/S terminals and grid; replace the insulated
  // gate/channel marks with the junction gate and correct polarity arrow.
  for (const node of graphics(doc))
    if (!['PIN', 'ELLIPSE'].includes(node.nodeName))
      node.parentNode.removeChild(node);
  const gate = pin(doc, 2),
    g = xy(gate),
    d = xy(pin(doc, 3)),
    s = xy(pin(doc, 4)),
    cy = (d[1] + s[1]) / 2;

  const channelX = d[0] - 2;
  line(doc, [
    [d[0], d[1] + 2],
    [d[0], cy - 3],
    [channelX, cy - 3],
    [channelX, cy + 3],
    [s[0], cy + 3],
    [s[0], s[1] - 2],
  ]);
  line(doc, [
    [g[0] + Number(gate.getAttribute('length')) / 5, g[1]],
    [channelX, g[1]],
  ]);
  if (pChannel) arrow(doc, [channelX, g[1]], [channelX - 1.5, g[1]]);
  else arrow(doc, [channelX - 1.5, g[1]], [channelX, g[1]]);
}
function darlington(doc) {
  const b = xy(pin(doc, 1)),
    e = xy(pin(doc, 2)),
    c = xy(pin(doc, 3)),
    dx = 10,
    dy = 4;
  const copies = graphics(doc).map((n) => n.cloneNode(true));
  pin(doc, 2).parentNode.removeChild(pin(doc, 2));
  for (const node of copies) {
    translate(node, dx, dy);
    if (node.nodeName === 'PIN' && node.getAttribute('number') !== '2')
      continue;
    root(doc).appendChild(node);
  }
  line(doc, [
    [e[0], e[1] - 2],
    [e[0], b[1] + dy],
    [b[0] + dx + 3, b[1] + dy],
  ]);
  line(doc, [
    [c[0], c[1]],
    [c[0] + dx, c[1]],
    [c[0] + dx, c[1] + dy + 2],
  ]);
}
export function deriveSymbol(xml, kind) {
  const doc = parse(xml);
  if (['rheostat', 'ntc', 'ldr', 'strain_gauge'].includes(kind))
    addResistorMarks(doc, kind);
  else if (kind === 'wheatstone_bridge') bridge(doc);
  else if (['photodiode', 'solar_cell'].includes(kind)) {
    const a = xy(pin(doc, 1)),
      k = xy(pin(doc, 2)),
      cx = a[0],
      cy = (a[1] + k[1]) / 2;
    if (kind === 'solar_cell') {
      root(doc).appendChild(
        element(doc, 'ELLIPSE', {
          a: [cx - 4, cy - 4],
          b: [cx + 4, cy + 4],
          style: drawingStyle(doc),
          fill: 0,
        }),
      );
      text(doc, [cx + 1, cy - 4], '+');
      text(doc, [cx + 1, cy + 4], '-');
    }
    arrow(doc, [cx + 6, cy - 4], [cx + 2.7, cy - 1]);
    arrow(doc, [cx + 6, cy - 1.5], [cx + 2.7, cy + 1.5]);
  } else if (kind === 'thyristor') {
    const a = xy(pin(doc, 1)),
      k = xy(pin(doc, 2)),
      gate = [a[0] - 4, k[1]];
    newPin(doc, 3, 'G', gate, 3, 5);
    line(doc, [
      [gate[0] + 1, gate[1]],
      [a[0] - 1.5, k[1] - 2.4],
    ]);
  } else if (kind === 'jfet_n' || kind === 'jfet_p')
    jfet(doc, kind === 'jfet_p');
  else if (kind === 'darlington_npn' || kind === 'darlington_pnp')
    darlington(doc);
  else throw Error('Unknown derived symbol ' + kind);
  return serialize(doc);
}
