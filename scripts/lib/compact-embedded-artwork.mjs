import { createRequire } from 'node:module';
import { note, escapeXML, textWidth } from './layout-artwork.mjs';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const xy = (s) => s.split(',').map(Number),
  snap = (n) => Math.round(n / 2) * 2;
const close = (a, b) => Math.abs(a - b) < 0.001;
export function compactEmbedded(record) {
  const d = record.device,
    s = d.category === 'controller' ? 1 / 3 : 1 / 4,
    sx = s,
    sy = s,
    groups = new Map();
  for (const p of record.pins) {
    const key = d.kind === 'pi' ? 'GPIO' : p.number.split('-')[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const pins = [];
  for (const list of groups.values()) {
    const map = (axis, scale) => {
      const src = [...new Set(list.map((p) => p[axis]))].sort((a, b) => a - b),
        result = new Map();
      let previous = -Infinity;
      for (const n of src) {
        const target = Math.max(snap(n * scale), previous + 2);
        result.set(n, target);
        previous = target;
      }
      return result;
    };
    const mx = map('x', sx),
      my = map('y', sy);
    for (const p of list) pins.push({ ...p, x: mx.get(p.x), y: my.get(p.y) });
  }
  // Keep native terminal order stable as well as pin identities.
  pins.sort(
    (a, b) =>
      record.pins.findIndex((p) => p.number === a.number) -
      record.pins.findIndex((p) => p.number === b.number),
  );
  const doc = new DOMParser().parseFromString(record.xml, 'text/xml'),
    serialize = (n) => new XMLSerializer().serializeToString(n),
    resources = [],
    art = [];
  const rawBoxes = [...groups.values()].map((ps) => [
    Math.min(...ps.map((p) => p.x)) - 3,
    Math.min(...ps.map((p) => p.y)) - 3,
    Math.max(...ps.map((p) => p.x)) + 3,
    Math.max(...ps.map((p) => p.y)) + 3,
  ]);
  for (const n of Array.from(doc.documentElement.childNodes).filter(
    (n) => n.nodeType === 1,
  )) {
    if (['FONT', 'STYLE', 'FILL'].includes(n.nodeName)) {
      resources.push(serialize(n));
      continue;
    }
    if (['PIN', 'NOTE_TEXT', 'TEXT'].includes(n.nodeName)) continue;
    if (['RECTANGLE', 'ELLIPSE'].includes(n.nodeName)) {
      const a = xy(n.getAttribute('a')),
        b = xy(n.getAttribute('b'));
      if (
        n.nodeName === 'RECTANGLE' &&
        (record.pins.some(
          (p) =>
            close(a[0], p.x - 2) &&
            close(a[1], p.y - 2) &&
            close(b[0], p.x + 2) &&
            close(b[1], p.y + 2),
        ) ||
          rawBoxes.some((v) => v.every((q, i) => close(q, [...a, ...b][i]))))
      )
        continue;
      if (
        n.nodeName === 'ELLIPSE' &&
        record.pins.some(
          (p) =>
            close(a[0], p.x - 0.8) &&
            close(a[1], p.y - 0.8) &&
            close(b[0], p.x + 0.8) &&
            close(b[1], p.y + 0.8),
        )
      )
        continue;
    }
    const scale = (node) => {
      for (const attr of ['a', 'b', 'pos'])
        if (node.hasAttribute?.(attr)) {
          const [x, y] = xy(node.getAttribute(attr));
          node.setAttribute(
            attr,
            `${+(x * sx).toFixed(5)},${+(y * sy).toFixed(5)}`,
          );
        }
      for (const child of Array.from(node.childNodes || []))
        if (child.nodeType === 1) scale(child);
    };
    scale(n);
    art.push(serialize(n));
  }
  const bodyWidth = Math.ceil((record.width * sx) / 2) * 2,
    bodyHeight = Math.ceil((record.height * sy) / 2) * 2;
  const rect = (x, y, w, h, fill) =>
    art.push(
      `<RECTANGLE a="${x},${y}" b="${x + w},${
        y + h
      }" style="1" fill="${fill}"/>`,
    );
  const ellipse = (x, y, w, h, fill) =>
    art.push(
      `<ELLIPSE a="${x},${y}" b="${x + w},${y + h}" style="1" fill="${fill}"/>`,
    );
  for (const list of groups.values()) {
    const ps = pins.filter((p) => list.some((v) => v.number === p.number)),
      xs = ps.map((p) => p.x),
      ys = ps.map((p) => p.y);
    if (
      list[0].number.startsWith('CONN') ||
      d.kind === 'display' ||
      ['uno', 'nano', 'mega', 'pi'].includes(d.kind)
    )
      rect(
        Math.min(...xs) - 1,
        Math.min(...ys) - 1,
        Math.max(...xs) - Math.min(...xs) + 2,
        Math.max(...ys) - Math.min(...ys) + 2,
        d.kind === 'display' ? 6 : 4,
      );
  }
  const label = (p) => {
    let value = p.name.replace(/GPIO(?=\d)/g, '');
    if (d.kind === 'pi')
      value = `${p.number}:G${value.split('/')[0]}`
        .replace('G3V3', '3V3')
        .replace('G5V', '5V')
        .replace('GGND', 'GND');
    return value;
  };
  for (const p of pins) {
    rect(
      p.x - 0.7,
      p.y - 0.7,
      1.4,
      1.4,
      p.name === 'GND' ? 5 : [9, 10].includes(p.electricalType) ? 8 : 7,
    );
    ellipse(p.x - 0.23, p.y - 0.23, 0.46, 0.46, 4);
    const value = p.number.startsWith('ICSP')
      ? p.number.split('-').at(-1)
      : label(p);
    if (p.number.startsWith('ICSP'))
      art.push(note(p.x + 0.6, p.y + 0.5, value, { size: 6 }));
    else if (p.side === 'left') art.push(note(p.x + 1.4, p.y + 0.5, value));
    else if (p.side === 'right')
      art.push(note(p.x - 1.4 - textWidth(value) + 1.2, p.y + 0.5, value));
    else {
      const above = d.kind === 'pi' ? p.side === 'top' : p.side === 'bottom';
      art.push(
        note(p.x, above ? p.y - 1.4 : p.y + 1.4, value, {
          vertical: true,
          above,
          colour:
            above && p.y - 1.4 - textWidth(value) < 0 ? '263645' : 'f4f8f6',
        }),
      );
    }
    art.push(
      `<PIN pos="${p.x},${p.y}" which="0" elec="${
        p.electricalType
      }" direction="${
        { left: 2, right: 3, top: 0, bottom: 1 }[p.side]
      }" part="0" number="${escapeXML(
        p.number,
      )}" show="0" length="0" number_pos="0" centre_name="0">${escapeXML(
        p.name,
      )}</PIN>`,
    );
  }
  art.push(
    note(1, bodyHeight + 3, d.short, { size: 8, font: 2, colour: '263645' }),
  );
  if (d.kind === 'display') {
    art.push(note(1, 2, 'FRONT', { colour: '263645' }));
    art.push(
      note((d.boardWidth + 24) * sx + 1, 2, 'REAR / PINS', {
        colour: '263645',
      }),
    );
  }
  let height = bodyHeight + 6;
  if (['uno', 'nano', 'mega'].includes(d.kind)) {
    art.push(
      note(1, bodyHeight + 6, 'ISP: 1 MISO  2 5V  3 SCK', { colour: '263645' }),
    );
    art.push(
      note(1, bodyHeight + 9, '4 MOSI  5 RST  6 GND', { colour: '263645' }),
    );
    height += 6;
  }
  return {
    ...record,
    width: bodyWidth,
    height,
    pins,
    layout: {
      scale: s,
      bodyWidth,
      bodyHeight,
      normalGrid: 2,
      labelFontSize: 6,
      rearX: d.kind === 'display' ? (d.boardWidth + 24) * sx : null,
    },
    xml: '<TinyCAD>\n' + [...resources, ...art].join('\n') + '\n</TinyCAD>\n',
  };
}
