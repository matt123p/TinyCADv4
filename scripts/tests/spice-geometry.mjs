import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const list = (node, tag) => Array.from(node.getElementsByTagName(tag));
const xy = (node, attr = 'pos') =>
  node.getAttribute(attr).split(',').map(Number);
const near = (a, b, message) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`);
const midpoint = (a, b) => a.map((value, i) => (value + b[i]) / 2);
function points(node) {
  if (node.tagName === 'POLYGON') {
    const origin = xy(node);
    return list(node, 'POINT').map((point) =>
      xy(point).map((value, i) => value + origin[i]),
    );
  }
  return [xy(node, 'a'), xy(node, 'b')];
}
function bounds(shapes) {
  const all = shapes.flatMap(points);
  assert.ok(all.length);
  return [0, 1].map((axis) => [
    Math.min(...all.map((p) => p[axis])),
    Math.max(...all.map((p) => p[axis])),
  ]);
}
function center(shapes) {
  return bounds(shapes).map(([a, b]) => (a + b) / 2);
}
function pin(doc, number) {
  const result = list(doc, 'PIN').find(
    (p) => p.getAttribute('number') === number,
  );
  assert.ok(result, 'Missing pin ' + number);
  return result;
}
function centered(doc, shapes, numbers, axes = [0, 1]) {
  const expected = midpoint(...numbers.map((number) => xy(pin(doc, number))));
  const actual = center(shapes);
  for (const axis of axes)
    near(actual[axis], expected[axis], 'Body centered between terminals');
}
function sameLead(doc, a, b) {
  near(
    Number(pin(doc, a).getAttribute('length')),
    Number(pin(doc, b).getAttribute('length')),
    'Equal lead lengths',
  );
}

export function checkSpiceGeometry(library) {
  const docs = new Map(
    library.names.map((name) => [
      name.Name,
      new DOMParser().parseFromString(
        library.symbols.find((s) => s.SymbolID === name.SymbolID).Data,
        'text/xml',
      ),
    ]),
  );
  for (const [name, doc] of docs) {
    for (const p of list(doc, 'PIN'))
      for (const value of xy(p))
        near(value, Math.round(value), name + ' pin on 1 mm grid');
  }
  for (const name of [
    'Resistor',
    'Potentiometer',
    'Trimmer resistor',
    'Capacitor',
    'Electrolytic capacitor',
    'Trimmer capacitor',
  ]) {
    const doc = docs.get(name);
    centered(doc, list(doc, 'RECTANGLE'), ['1', '2']);
    sameLead(doc, '1', '2');
  }
  // The resistor is centered on its pin axis, with each lead ending exactly
  // at the corresponding body edge. Check model coordinates, not raster pixels.
  const resistor = docs.get('Resistor');
  const [xBounds, yBounds] = bounds(list(resistor, 'RECTANGLE'));
  near(
    xBounds[0] + xBounds[1],
    2 * xy(pin(resistor, '1'))[0],
    'Resistor left/right balance',
  );
  near(
    xy(pin(resistor, '2'))[1] +
      Number(pin(resistor, '2').getAttribute('length')) / 5,
    yBounds[0],
    'Resistor top lead meets body',
  );
  near(
    xy(pin(resistor, '1'))[1] -
      Number(pin(resistor, '1').getAttribute('length')) / 5,
    yBounds[1],
    'Resistor bottom lead meets body',
  );
  for (const name of ['Inductor', 'Inductor with core']) {
    const doc = docs.get(name);
    centered(doc, list(doc, 'POLYGON'), ['1', '2'], [1]);
    sameLead(doc, '1', '2');
  }
  for (const name of [
    'NPN transistor',
    'PNP transistor',
    'N-channel MOSFET',
    'P-channel MOSFET',
  ]) {
    const doc = docs.get(name),
      bipolar = name.includes('transistor');
    const pair = bipolar ? ['2', '3'] : ['3', '4'];
    centered(doc, list(doc, 'ELLIPSE'), pair, [1]);
    sameLead(doc, ...pair);
  }
  for (const name of [
    'Diode',
    'Zener diode (5.1 V)',
    'LED (red)',
    'LED (green)',
    'LED (blue)',
    'LED (yellow)',
  ]) {
    const doc = docs.get(name);
    const triangle = list(doc, 'POLYGON').find(
      (node) => node.getAttribute('fill') !== '0',
    );
    const cathode = list(doc, 'POLYGON').find((node) => {
      const p = points(node);
      return (
        p.length === 2 &&
        Math.abs(p[0][1] - p[1][1]) < 1e-6 &&
        Math.abs(p[0][0] - p[1][0]) > 2
      );
    });
    assert.ok(triangle && cathode, name + ' triangle and cathode');
    centered(doc, [triangle], ['1', '2']);
    sameLead(doc, '1', '2');
    const body = bounds([triangle])[1];
    near(
      xy(pin(doc, '1'))[1] + Number(pin(doc, '1').getAttribute('length')) / 5,
      body[0],
      name + ' anode contact',
    );
    near(
      xy(pin(doc, '2'))[1] - Number(pin(doc, '2').getAttribute('length')) / 5,
      body[1],
      name + ' cathode contact',
    );
    near(points(cathode)[0][1], body[1], name + ' cathode bar meets tip');
  }
  const amp = docs.get('741 op-amp');
  centered(amp, list(amp, 'POLYGON'), ['3', '6'], [0]);
  centered(amp, list(amp, 'POLYGON'), ['3', '2'], [1]);
  centered(amp, list(amp, 'POLYGON'), ['7', '4'], [1]);
  const transformer = docs.get('Transformer');
  const coils = list(transformer, 'POLYGON').filter(
    (node) => xy(node)[0] !== 83,
  );
  const primary = coils.filter((node) => xy(node)[0] === 80);
  const secondary = coils.filter((node) => xy(node)[0] === 84.4);
  assert.equal(primary.length, 6);
  assert.equal(secondary.length, 6);
  centered(transformer, primary, ['1', '2'], [1]);
  centered(transformer, secondary, ['3', '4'], [1]);
  near(
    xy(pin(transformer, '1'))[1],
    xy(pin(transformer, '3'))[1],
    'Transformer top terminal alignment',
  );
  near(
    xy(pin(transformer, '2'))[1],
    xy(pin(transformer, '4'))[1],
    'Transformer bottom terminal alignment',
  );
  const key = (p) => p.map((value) => value.toFixed(6)).join(',');
  const reflected = primary
    .flatMap(points)
    .map(([x, y]) => key([166 - x, y]))
    .sort();
  assert.deepEqual(
    secondary.flatMap(points).map(key).sort(),
    reflected,
    'Transformer windings mirror about core',
  );
  const dots = list(transformer, 'ELLIPSE');
  assert.equal(dots.length, 2);
  near(
    center([dots[0]])[0] + center([dots[1]])[0],
    166,
    'Transformer dot mirror',
  );
  near(center([dots[0]])[1], center([dots[1]])[1], 'Transformer dot height');
  centered(
    transformer,
    list(transformer, 'POLYGON').filter((node) => xy(node)[0] === 83),
    ['1', '2'],
    [1],
  );
  for (const name of ['XTAL (quartz crystal)', 'Ceramic resonator']) {
    const doc = docs.get(name);
    centered(doc, list(doc, 'POLYGON'), ['1', '2']);
    sameLead(doc, '1', '2');
  }
  for (const name of ['DC / AC voltage source', 'DC / AC current source']) {
    const doc = docs.get(name);
    centered(doc, list(doc, 'ELLIPSE'), ['1', '2']);
    sameLead(doc, '1', '2');
  }
  const current = docs.get('DC / AC current source');
  centered(current, list(current, 'POLYGON'), ['1', '2']);
  console.log(
    'Symbol geometry passed: centered bodies, balanced leads, mirrored transformer, and all terminal coordinates on-grid.',
  );
}
