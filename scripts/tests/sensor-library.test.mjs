import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { geometry, spiceArtworkSnapshot } from '../lib/library-artwork.mjs';
import { digitalArtworkSnapshot } from '../lib/digital-artwork.mjs';
import { sensorArtworkSnapshot } from '../lib/sensor-artwork.mjs';
import { serializeLibrary, librarySqlite } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const root = fileURLToPath(new URL('../../', import.meta.url));
let result, digital, master;
test.before(async () => {
  const read = (name) => readFile(new URL('../../' + name, import.meta.url));
  master = JSON.parse(await read('library-sources/inventory/all-symbols.json'));
  const spice = await spiceArtworkSnapshot(
    await read('bundled-libraries/spice/spice.tclib'),
    JSON.parse(await read('bundled-libraries/spice/spice.provenance.json')),
  );
  digital = await digitalArtworkSnapshot({
    root,
    spice,
    requirements: master.symbols,
  });
  result = await sensorArtworkSnapshot({
    root,
    digital,
    spice,
    requirements: master.symbols,
  });
});
test('all ten new symbols retain their exact pin contracts and explicit electrical terminals', () => {
  assert.equal(result.records.length, 10);
  for (const { xml, requirement: r, candidate: c } of result.records) {
    const m = geometry(xml);
    assert.equal(m.valid, true, c.id);
    assert.equal(m.absoluteGrid, true, c.id);
    assert.equal(m.duplicatePins, false, c.id);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const pins = Array.from(doc.getElementsByTagName('PIN'));
    assert.equal(pins.length, r.pins.length, c.id);
    for (const pin of r.pins) {
      const p = pins.find(
        (p) => p.getAttribute('number') === pin.logical_number,
      );
      assert.equal(p.textContent, pin.name);
      assert.equal(
        p.getAttribute('elec'),
        String(
          { input: 0, output: 1, passive: 4, power_input: 10 }[
            pin.electrical_type
          ],
        ),
      );
      assert.equal(p.getAttribute('which'), '0');
      assert.equal(
        p.getAttribute('direction'),
        String({ left: 3, right: 2, top: 1, bottom: 0 }[pin.side]),
      );
    }
  }
  const tp = result.records.find((r) => r.requirement.id === 'test_point');
  const d = new DOMParser().parseFromString(tp.xml, 'text/xml');
  assert.equal(d.getElementsByTagName('PIN').length, 1);
  assert.equal(d.getElementsByTagName('ELLIPSE').length, 1);
  assert.equal(d.getElementsByTagName('POLYGON').length, 0);
  const pin = d.getElementsByTagName('PIN')[0],
    circle = d.getElementsByTagName('ELLIPSE')[0];
  const p = pin.getAttribute('pos').split(',').map(Number),
    b = circle.getAttribute('b').split(',').map(Number);
  assert.equal(p[0], 0);
  assert.equal(
    p[1] - Number(pin.getAttribute('length')) / 5,
    b[1],
    'Native pin meets the open circle exactly',
  );
  assert.equal(circle.getAttribute('fill'), '0');
});
test('sensor/interface bundle is reproducible and contains embedded teaching simulation models', async () => {
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
    assert.equal(db.exec('SELECT count(*) FROM Name')[0].values[0][0], 10);
    assert.equal(db.exec('SELECT max(ppp) FROM Name')[0].values[0][0], 1);
    assert.equal(
      db.exec(
        "SELECT count(*) FROM Attribute WHERE AttName='$$SPICE' AND length(AttValue)>0",
      )[0].values[0][0],
      10,
    );
  } finally {
    db.close();
  }
});
test('sensor/interface pins place on grid through all orientations and survive drawing save/load', async () => {
  await runRegression(`
    import assert from 'node:assert/strict';
    import {ioXML, blank} from './src/io/ioXml';
    import {XMLBuilder} from './src/util/xmlbuilder';
    import {updateView} from './src/manipulators/updateView';
    import {updateSymbol} from './src/manipulators/updateSymbol';
    import {NetlistGenerator} from './src/io/netlists/netlistGenerator';
    import {makeNetForDrawing} from './src/web-worker/netlist';
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
    const tp=sheet.items[0];assert.equal(new updateSymbol(tp).active_points().length,1);
    tp.text.find(t=>t.description==='Ref').value='TP1';
    const [x,y]=new updateSymbol(tp).active_points()[0];
    const wired={...sheet,items:[tp,{NodeName:DocItemTypes.Wire,_id:900001,d_points:[[x,y],[x+25,y]],_magnetic:null},{NodeName:DocItemTypes.Power,_id:900002,point:[x+25,y],which:0,text:'TP_NET',hints:[]}]};
    const net=new NetlistGenerator();makeNetForDrawing({...drawing,sheets:[wired]},net);
    assert.ok(net.labels.TP_NET);assert.equal(net.nets[net.labels.TP_NET].filter(n=>n.reference==='TP1').length,1,'The test point connects its one real pin through a wire.');
    const out=io.to_dsn({...drawing,sheets:[sheet]},true,true).tostring();const xml=new XMLBuilder();xml.fromText(out);
    const restored=io.from_dsn(xml);
    assert.equal(restored.sheets[0].items.length,records.length);
    restored.sheets[0].items.forEach((s,i)=>assert.deepEqual(shapes(s),shapes(sheet.items[i])));
  `);
});
