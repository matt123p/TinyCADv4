import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { geometry, spiceArtworkSnapshot } from '../lib/library-artwork.mjs';
import { digitalArtworkSnapshot } from '../lib/digital-artwork.mjs';
import { functionalArtworkSnapshot } from '../lib/functional-artwork.mjs';
import { serializeLibrary, librarySqlite } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const root = fileURLToPath(new URL('../../', import.meta.url));
let result, digital, master;
test.before(async () => {
  const read = (name) => readFile(new URL('../../' + name, import.meta.url));
  master = JSON.parse(await read('docs/symbol-libraries/all-symbols.json'));
  const spice = await spiceArtworkSnapshot(
    await read('bundled-libraries/spice/spice.tclib'),
    JSON.parse(await read('bundled-libraries/spice/spice.provenance.json')),
  );
  digital = await digitalArtworkSnapshot({
    root,
    spice,
    requirements: master.symbols,
  });
  result = await functionalArtworkSnapshot({
    root,
    digital,
    requirements: master.symbols,
  });
});
test('all 14 functional interfaces retain their logical ports, sides, electrical types and digital styling', () => {
  assert.equal(result.records.length, 17);
  assert.deepEqual(
    new Set(result.records.map((r) => r.requirement.id)),
    new Set(
      master.symbols.filter((r) => r.folder.startsWith('09 ')).map((r) => r.id),
    ),
  );
  for (const { xml, requirement, candidate } of result.records) {
    const m = geometry(xml);
    assert.equal(m.valid, true, candidate.id);
    assert.equal(m.absoluteGrid, true, candidate.id);
    assert.equal(m.duplicatePins, false, candidate.id);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const pins = Array.from(doc.getElementsByTagName('PIN'));
    assert.equal(pins.length, requirement.pins.length);
    for (const pin of requirement.pins) {
      const p = pins.find(
        (p) => p.getAttribute('number') === pin.logical_number,
      );
      assert.equal(p.textContent, pin.name);
      assert.equal(
        p.getAttribute('direction'),
        String({ left: 3, right: 2, top: 1, bottom: 0 }[pin.side]),
      );
      assert.equal(
        p.getAttribute('elec'),
        String(
          {
            input: 0,
            output: 1,
            bidirectional: 5,
            passive: 4,
            power_input: 10,
          }[pin.electrical_type],
        ),
      );
      assert.equal(p.getAttribute('length'), '20');
      assert.equal(
        p.getAttribute('which'),
        pin.name.endsWith('_N')
          ? '1'
          : pin.name === 'CLOCK' && candidate.clockEdge
          ? candidate.clockEdge === 'rising'
            ? '2'
            : '3'
          : '0',
      );
    }
    for (const tag of ['FONT', 'FILL', 'STYLE']) {
      const resources = (text) =>
        Array.from(
          new DOMParser()
            .parseFromString(text, 'text/xml')
            .getElementsByTagName(tag),
        ).map((n) => n.toString());
      assert.deepEqual(
        resources(xml),
        resources(
          digital.records.find((r) => r.requirement.id === 'full_adder').xml,
        ),
      );
    }
    assert.ok(m.bodyWidthMm >= 16);
    assert.ok(m.bodyHeightMm >= 8);
  }
});
test('functional bundle is reproducible and contains embedded teaching simulation models', async () => {
  const bytes = await serializeLibrary(result.library, result.provenance);
  assert.deepEqual(
    bytes,
    new Uint8Array(
      await readFile(new URL('../../' + result.recipe.output, import.meta.url)),
    ),
  );
  const SQL = await librarySqlite(),
    db = new SQL.Database(bytes);
  try {
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.equal(db.exec('SELECT count(*) FROM Name')[0].values[0][0], 17);
    assert.equal(db.exec('SELECT max(ppp) FROM Name')[0].values[0][0], 1);
    assert.equal(
      db.exec(
        "SELECT count(*) FROM Attribute WHERE AttName='$$SPICE' AND length(AttValue)>0",
      )[0].values[0][0],
      17,
    );
  } finally {
    db.close();
  }
});
test('functional pins place on grid through all orientations and survive drawing save/load', async () => {
  await runRegression(`
    import assert from 'node:assert/strict';
    import {ioXML, blank} from './src/io/ioXml';
    import {XMLBuilder} from './src/util/xmlbuilder';
    import {updateView} from './src/manipulators/updateView';
    import {updateSymbol} from './src/manipulators/updateSymbol';
    import {DocItemTypes} from './src/model/dsnItem';
    globalThis.document={createElement:()=>({getContext:()=>({measureText:text=>({width:String(text).length*3.6,actualBoundingBoxDescent:2})})})};
    const createDoc=XMLBuilder.prototype.createDoc;XMLBuilder.prototype.createDoc=function(name){createDoc.call(this,name);this.insert=this.xmlDoc.documentElement;};
    const stringify=XMLBuilder.prototype.tostring;XMLBuilder.prototype.tostring=function(){function normalize(node){if(node.attributes)for(let i=0;i<node.attributes.length;i++)node.attributes[i].value=String(node.attributes[i].value);if(node.nodeType===3||node.nodeType===4)node.data=String(node.data);for(let child=node.firstChild;child;child=child.nextSibling)normalize(child);}normalize(this.xmlDoc);return stringify.call(this);};
    const library=${JSON.stringify(result.library)}, records=${JSON.stringify(
    result.records.map((r) => ({
      xml: r.xml,
      count: r.requirement.pins.length,
    })),
  )};
    const drawing=blank(), io=new ioXML();let sheet=drawing.sheets[0];
    for(const [i,record]of records.entries()){
      const xml=new XMLBuilder();xml.fromText(record.xml);const doc=io.from_dsn(xml);
      sheet=new updateView().handleSelectLibrarySymbol({},sheet,library.names[i],doc.sheets.map(s=>s.items),[100+i*300,100]).sheet;
      const symbol=sheet.items.at(-1);assert.equal(new updateSymbol(symbol).power_pins().length,0,'All functional references/supplies remain explicit.');
      for(let rotation=0;rotation<8;rotation++){
        const u=new updateSymbol({...symbol,rotation,_active_points:null});
        assert.equal(u.active_points().length,record.count);
        for(const [x,y]of u.active_points())assert.ok([x,y].every(v=>Math.abs(v/5-Math.round(v/5))<1e-6));
      }
    }
    const shapes=s=>new updateSymbol(s).outline().items.filter(p=>p.NodeName===DocItemTypes.Pin).map(p=>[p.number,p.name,p.which,p.elec]);
    const out=io.to_dsn({...drawing,sheets:[sheet]},true,true).tostring();const xml=new XMLBuilder();xml.fromText(out);
    const restored=io.from_dsn(xml);
    assert.equal(restored.sheets[0].items.length,records.length);
    restored.sheets[0].items.forEach((s,i)=>assert.deepEqual(shapes(s),shapes(sheet.items[i])));
  `);
});
