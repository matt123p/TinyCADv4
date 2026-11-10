import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { digest, geometry } from './library-artwork.mjs';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const nodes = (doc, tag) => Array.from(doc.getElementsByTagName(tag));
const xy = (n, attr = 'pos') => n.getAttribute(attr).split(',').map(Number);
const directions = { 0: [0, -1], 1: [0, 1], 2: [-1, 0], 3: [1, 0] };

export async function selectedSqlArtwork(root, requirement, decision) {
  const raw = await readFile(
    path.join(
      root,
      'library-sources/teaching',
      decision.candidateId.replace(':', '-') + '.xml',
    ),
    'utf8',
  );
  if (digest(raw) !== decision.xmlSha256)
    throw Error('Selected SQL artwork changed: ' + requirement.id);
  const doc = new DOMParser().parseFromString(raw, 'text/xml'),
    pins = nodes(doc, 'PIN');
  const id = requirement.id,
    changes = [];
  if (id === 'relay_spdt') {
    const xs = pins.map((n) => xy(n)[0]),
      left = Math.min(...xs),
      right = Math.max(...xs),
      ys = pins.filter((p) => xy(p)[0] === right).map((p) => xy(p)[1]),
      top = Math.min(...ys),
      bottom = Math.max(...ys);
    for (const pin of pins) {
      const [x, y] = xy(pin);
      pin.setAttribute(
        'number',
        x === left ? (y === top ? 1 : 2) : y === top ? 5 : y === bottom ? 4 : 3,
      );
    }
    changes.push(
      'Renumbered coil and COM/NC/NO terminals by position; repaired duplicate source numbers.',
    );
  } else if (id === 'connector3') {
    for (const pin of pins)
      if (Number(pin.getAttribute('number')) > 3)
        pin.parentNode.removeChild(pin);
    const rect = nodes(doc, 'RECTANGLE')[0];
    rect.setAttribute('a', '12,6');
    rect.setAttribute('b', '16,18');
    changes.push(
      'Reduced the four-way source to three contacts and moved the body to meet the native pin ends.',
    );
  } else if (
    ['push_make', 'push_break', 'buzzer', 'reed_switch'].includes(id)
  ) {
    const ends = pins.map((pin) => {
      const p = xy(pin);
      if (id === 'reed_switch') return p;
      const v = directions[pin.getAttribute('direction')],
        length = Number(pin.getAttribute('length')) / 5;
      return [p[0] + v[0] * length, p[1] + v[1] * length];
    });
    const center = [
        (ends[0][0] + ends[1][0]) / 2,
        (ends[0][1] + ends[1][1]) / 2,
      ],
      distance = Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]);
    const reed = id === 'reed_switch',
      scale = (reed ? 6.2 : 5.2) / distance;
    const point = (p) => {
      const x = (p[0] - center[0]) * scale,
        y = (p[1] - center[1]) * scale;
      return reed ? [-y, x + 4.5] : [x, y];
    };
    for (const node of Array.from(doc.getElementsByTagName('*'))) {
      if (['POINT'].includes(node.nodeName)) {
        for (const attr of ['pos', 'control', 'control2'])
          if (node.hasAttribute(attr))
            node.setAttribute(
              attr,
              xy(node, attr)
                .map((v) => v * scale)
                .join(','),
            );
      } else if (
        [
          'PIN',
          'POLYGON',
          'RECTANGLE',
          'ELLIPSE',
          'TEXT',
          'JUNCTION',
          'WIRE',
        ].includes(node.nodeName)
      )
        for (const attr of ['pos', 'a', 'b'])
          if (node.hasAttribute(attr))
            node.setAttribute(attr, point(xy(node, attr)).join(','));
    }
    // Polygon points are relative vectors: rotation must not add the origin.
    if (reed)
      for (const n of nodes(doc, 'POINT'))
        for (const attr of ['pos', 'control', 'control2'])
          if (n.hasAttribute(attr)) {
            const [x, y] = xy(n, attr);
            n.setAttribute(attr, [-y, x].join(','));
          }
    pins.forEach((pin, i) => {
      const end = point(ends[i]);
      let dir = Number(pin.getAttribute('direction'));
      if (reed) dir = i === 0 ? 1 : 0;
      const v = directions[dir];
      pin.setAttribute('direction', dir);
      pin.setAttribute('length', 7);
      pin.setAttribute(
        'pos',
        end.map((n, j) => Math.round((n - v[j] * 1.4) * 1e7) / 1e7).join(','),
      );
    });
    changes.push(
      'Resized around the original lead contacts, with 1.4 mm native pins and on-grid anchors.' +
        (reed
          ? ' Rotated vertically; body is about 120% of the resistor length.'
          : ''),
    );
  }
  const actual = nodes(doc, 'PIN');
  for (const pin of actual) {
    // Physical 555 pins match the inventory; other preserved drawings use the
    // explicit selected logical-to-source mapping. Repaired drawings use 1..N.
    const logical = requirement.pins.find(
      (p) => String(p.logical_number) === pin.getAttribute('number'),
    );
    if (!logical)
      throw Error(
        'Unmapped selected pin ' + id + ':' + pin.getAttribute('number'),
      );
    pin.textContent = logical.name;
    pin.setAttribute('part', 0);
    pin.setAttribute('which', 0);
    pin.setAttribute(
      'elec',
      { input: 0, output: 1, bidirectional: 5, passive: 4, power_input: 10 }[
        logical.electrical_type
      ],
    );
    if (id.startsWith('seven_segment')) pin.setAttribute('show', 0);
  }
  const xml = new XMLSerializer().serializeToString(doc),
    m = geometry(xml);
  if (
    !m.valid ||
    !m.absoluteGrid ||
    m.duplicatePins ||
    actual.length !== requirement.pins.length
  )
    throw Error(
      'Invalid adapted selected artwork ' + id + ': ' + JSON.stringify(m),
    );
  return {
    xml,
    changes,
    source: decision.source,
    sourceSha256: decision.xmlSha256,
    xmlSha256: digest(xml),
  };
}
