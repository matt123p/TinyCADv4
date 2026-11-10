import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import {
  spiceArtworkSnapshot,
  derivedArtworkSnapshot,
  geometry,
} from '../symbol-review/catalog.mjs';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);
const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
const nodes = (doc, tag) => Array.from(doc.getElementsByTagName(tag));
const xy = (node, attr = 'pos') =>
  node.getAttribute(attr).split(',').map(Number);
const serialized = (node) => new XMLSerializer().serializeToString(node);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
let spice, derived, db;
test.before(async () => {
  const bytes = await readFile(
    new URL('../../bundled-libraries/spice/spice.tclib', import.meta.url),
  );
  const p = JSON.parse(
    await readFile(
      new URL(
        '../../bundled-libraries/spice/spice.provenance.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  spice = await spiceArtworkSnapshot(bytes, p);
  derived = derivedArtworkSnapshot(
    spice,
    JSON.parse(
      await readFile(
        new URL('../../library-recipes/derived-symbols.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const SQL = await librarySqlite();
  db = new SQL.Database(new Uint8Array(bytes));
});
test.after(() => db.close());
const base = (id) =>
  spice.records.find((r) => r.candidate.id === 'spice:' + id);
const asset = (id) =>
  derived.records.find((r) => r.candidate.id === 'derived:' + id);
const pinSignature = (xml) => nodes(parse(xml), 'PIN').map(serialized);
function polyPoints(node) {
  const origin = xy(node);
  return nodes(node, 'POINT').map((p) => xy(p).map((v, i) => v + origin[i]));
}
function bodyPoints(xml) {
  const doc = parse(xml),
    rect = nodes(doc, 'RECTANGLE')[0];
  if (rect) {
    const a = xy(rect, 'a'),
      b = xy(rect, 'b');
    return [a, [a[0], b[1]], b, [b[0], a[1]]];
  }
  return polyPoints(
    nodes(doc, 'POLYGON').find((p) => nodes(p, 'POINT').length === 10),
  );
}
test('US zigzag matches the EU body envelope, leads and pin positions exactly', () => {
  for (const id of ['resistor', 'potentiometer', 'trimmer-resistor']) {
    const eu = base(id),
      us = base(id + '-us');
    assert.deepEqual(pinSignature(us.xml), pinSignature(eu.xml));
    const a = bodyPoints(eu.xml),
      b = bodyPoints(us.xml);
    for (const axis of [0, 1]) {
      near(
        Math.min(...a.map((p) => p[axis])),
        Math.min(...b.map((p) => p[axis])),
      );
      near(
        Math.max(...a.map((p) => p[axis])),
        Math.max(...b.map((p) => p[axis])),
      );
    }
    const line = nodes(parse(us.xml), 'POLYGON').find(
      (p) => nodes(p, 'POINT').length === 10,
    );
    const points = polyPoints(line);
    near(points[0][0], 80);
    near(points[0][1], 41.4);
    near(points.at(-1)[0], 80);
    near(points.at(-1)[1], 46.6);
    for (let i = 0; i < points.length; i++) {
      near(points[i][0] + points.at(-i - 1)[0], 160);
      near(points[i][1] + points.at(-i - 1)[1], 88);
    }
    const attributes = (nameId) =>
      db.exec(
        'SELECT AttName,AttValue,ShowAtt FROM Attribute WHERE NameID=' +
          nameId +
          ' ORDER BY AttName',
      )[0].values;
    assert.deepEqual(
      attributes(eu.candidate.bundleNameId),
      attributes(us.candidate.bundleNameId),
      'Style variants preserve every SPICE field.',
    );
  }
});
test('every resistor-based derived type has both styles with identical terminals and retained base bodies', () => {
  for (const id of [
    'rheostat',
    'ntc',
    'ldr',
    'strain_gauge',
    'wheatstone_bridge',
  ]) {
    const eu = asset(id + '-eu'),
      us = asset(id + '-us');
    assert.ok(eu && us);
    assert.deepEqual(pinSignature(eu.xml), pinSignature(us.xml));
    assert.equal(
      eu.candidate.baseXmlSha256,
      base('resistor').candidate.xmlSha256,
    );
    assert.equal(
      us.candidate.baseXmlSha256,
      base('resistor-us').candidate.xmlSha256,
    );
    if (id !== 'wheatstone_bridge') {
      assert.equal(
        serialized(nodes(parse(eu.xml), 'RECTANGLE')[0]),
        serialized(nodes(parse(base('resistor').xml), 'RECTANGLE')[0]),
      );
      const zigzag = (doc) =>
        nodes(parse(doc), 'POLYGON').find(
          (p) => nodes(p, 'POINT').length === 10,
        );
      assert.equal(
        serialized(zigzag(us.xml)),
        serialized(zigzag(base('resistor-us').xml)),
      );
    } else {
      for (const [record, count] of [
        [eu, 5],
        [us, 10],
      ]) {
        const bodies = nodes(parse(record.xml), 'POLYGON').filter(
          (p) => nodes(p, 'POINT').length === count,
        );
        assert.equal(bodies.length, 4);
        const reference = bodyPoints(
          count === 5 ? base('resistor').xml : base('resistor-us').xml,
        );
        if (count === 5) reference.push(reference[0]);
        const length = (pts) =>
          pts
            .slice(1)
            .reduce(
              (sum, p, i) =>
                sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]),
              0,
            );
        for (const body of bodies)
          near(length(polyPoints(body)), length(reference));
      }
    }
  }
});
test('diode and FET derivatives keep their corrected base bodies and on-grid pins', () => {
  for (const id of ['photodiode', 'solar_cell', 'thyristor']) {
    const original = parse(base('diode').xml),
      built = parse(asset(id).xml);
    for (const body of nodes(original, 'POLYGON'))
      assert.ok(
        nodes(built, 'POLYGON').some((n) => serialized(n) === serialized(body)),
        id + ' preserves the existing diode body.',
      );
    assert.deepEqual(
      nodes(built, 'PIN').slice(0, 2).map(serialized),
      nodes(original, 'PIN').map(serialized),
    );
  }
  for (const [id, parent] of [
    ['jfet_n', 'nmos'],
    ['jfet_p', 'pmos'],
  ]) {
    assert.deepEqual(
      pinSignature(asset(id).xml),
      pinSignature(base(parent).xml),
    );
    assert.equal(
      serialized(nodes(parse(asset(id).xml), 'ELLIPSE')[0]),
      serialized(nodes(parse(base(parent).xml), 'ELLIPSE')[0]),
    );
  }
  for (const id of ['darlington_npn', 'darlington_pnp']) {
    const doc = parse(asset(id).xml);
    assert.equal(nodes(doc, 'PIN').length, 3);
    assert.equal(nodes(doc, 'ELLIPSE').length, 2);
  }
  for (const record of derived.records) {
    const m = geometry(record.xml);
    assert.equal(m.valid, true);
    assert.equal(m.absoluteGrid, true);
    assert.equal(m.duplicatePins, false);
    assert.equal(m.pinCount, record.candidate.derivedDefinition.pins.length);
  }
});

test('derived artwork places on-grid through all rotations and mirrors in the editor', async () => {
  const { runRegression } = await import('./run-regression.mjs');
  await runRegression(`
import assert from 'node:assert/strict';
import {ioXML,blank} from './src/io/ioXml';
import {XMLBuilder} from './src/util/xmlbuilder';
import {updateView} from './src/manipulators/updateView';
import {updateSymbol} from './src/manipulators/updateSymbol';
globalThis.document={createElement:()=>({getContext:()=>({measureText:text=>({width:String(text).length*6,actualBoundingBoxDescent:2})})})};
const records=${JSON.stringify(
    derived.records.map((r) => ({
      id: r.candidate.id,
      xml: r.xml,
      pins: r.candidate.metrics.pinCount,
    })),
  )};
for(const [i,record]of records.entries()){
 const xml=new XMLBuilder();xml.fromText(record.xml);
 const io=new ioXML(),doc=io.from_dsn(xml),drawing=blank();
 const name={NameID:i+1,Name:record.id,SymbolID:i+1,Reference:'X?',ppp:1,Description:'Derived artwork',ShowName:1,ShowRef:0,DefRotate:0,Attributes:[]};
 const placed=new updateView().handleSelectLibrarySymbol({},drawing.sheets[0],name,doc.sheets.map(s=>s.items),[100,100]);
 const symbol=placed.sheet.items.at(-1);
 for(let rotation=0;rotation<8;rotation++){
  const pins=new updateSymbol({...symbol,rotation,_active_points:null}).active_points();assert.equal(pins.length,record.pins,record.id);
  for(const[x,y]of pins)assert.ok([x,y].every(v=>Math.abs(v/5-Math.round(v/5))<1e-6),record.id+' rotation '+rotation+' off-grid');
 }
}
`);
});
