import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spiceArtworkSnapshot, geometry } from '../lib/library-artwork.mjs';
import { digitalArtworkSnapshot } from '../lib/digital-artwork.mjs';
import { librarySqlite, serializeLibrary } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const root = fileURLToPath(new URL('../../', import.meta.url));
const nodes = (doc, tag) => Array.from(doc.getElementsByTagName(tag));
const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
let result, master;
test.before(async () => {
  const [bytes, p, m] = await Promise.all([
    readFile(path.join(root, 'bundled-libraries/spice/spice.tclib')),
    readFile(
      path.join(root, 'bundled-libraries/spice/spice.provenance.json'),
      'utf8',
    ),
    readFile(path.join(root, 'docs/symbol-libraries/all-symbols.json'), 'utf8'),
  ]);
  master = JSON.parse(m);
  const spice = await spiceArtworkSnapshot(bytes, JSON.parse(p));
  result = await digitalArtworkSnapshot({
    root,
    spice,
    requirements: master.symbols,
  });
});
const record = (id) =>
  result.records.find((r) => r.candidate.id === 'derived:' + id);
test('one generic unit replaces the selected NAND package, with 741 dimensions and yellow fill', () => {
  const nand = record('gate_nand'),
    doc = parse(nand.xml),
    m = geometry(nand.xml);
  assert.equal(result.provenance.source.source.nameId, 9279);
  assert.equal(result.provenance.source.source.symbolId, 160);
  assert.equal(m.parts, 1);
  assert.equal(m.sheets, 1);
  assert.equal(m.pinCount, 5);
  assert.equal(m.bodyWidthMm, 8);
  assert.equal(m.bodyHeightMm, 8);
  assert.deepEqual(
    nodes(doc, 'PIN')
      .map((p) => p.getAttribute('number'))
      .sort(),
    ['1', '2', '3', '4', '5'],
  );
  assert.ok(nodes(doc, 'PIN').every((p) => p.getAttribute('part') === '0'));
  const fill = nodes(doc, 'FILL').find((n) => n.getAttribute('id') === '1');
  assert.equal(fill.getElementsByTagName('COLOR')[0].textContent, '80FFFF');
  assert.equal(
    result.library.names.find((n) => n.NameID === nand.candidate.bundleNameId)
      .ppp,
    1,
  );
});
test('all 21 digital contracts have unique logical pins, on-grid connection points and native hidden rails', () => {
  const requirements = master.symbols.filter((r) => r.folder.startsWith('08 '));
  assert.equal(requirements.length, 21);
  assert.equal(result.records.length, 28);
  assert.deepEqual(
    new Set(result.records.map((r) => r.candidate.canonicalId)),
    new Set(requirements.map((r) => r.id)),
  );
  for (const { candidate: c, xml, requirement: r } of result.records) {
    const m = geometry(xml);
    assert.equal(m.absoluteGrid, true, c.id);
    assert.equal(m.duplicatePins, false, c.id);
    assert.deepEqual(
      m.pins.map((p) => p.number).sort(),
      r.pins.map((p) => p.logical_number).sort(),
      c.id,
    );
    const pins = nodes(parse(xml), 'PIN'),
      power = pins.filter((p) => p.getAttribute('which') === '4');
    assert.equal(power.length, 2);
    assert.deepEqual(
      power.map((p) => p.textContent),
      ['VCC', 'VSS'],
    );
    assert.ok(power.every((p) => p.getAttribute('elec') === '10'));
    assert.ok(
      pins
        .filter((p) => p.getAttribute('which') !== '4')
        .every((p) => p.getAttribute('length') === '20'),
      c.id + ' 4 mm signal leads',
    );
    assert.ok(
      pins.every((p) => p.getAttribute('which') !== '5'),
      'Power pins must use native Power, not generic Hidden.',
    );
  }
});
test('inverted outputs and active-low controls use Dot; edge inputs use Clock or DotClock; latches are level-sensitive', () => {
  for (const id of ['gate_nand', 'gate_nor', 'gate_xnor', 'gate_not'])
    assert.equal(
      nodes(parse(record(id).xml), 'PIN')
        .find((p) => p.textContent === 'Y')
        .getAttribute('which'),
      '1',
      id,
    );
  for (const id of ['gate_and', 'gate_or', 'gate_xor', 'gate_buffer'])
    assert.equal(
      nodes(parse(record(id).xml), 'PIN')
        .find((p) => p.textContent === 'Y')
        .getAttribute('which'),
      '0',
      id,
    );
  for (const id of result.recipe.clockedSymbols) {
    const rising = nodes(parse(record(id).xml), 'PIN'),
      falling = nodes(parse(record(id + '-falling').xml), 'PIN');
    assert.equal(
      rising.find((p) => p.textContent === 'CLK').getAttribute('which'),
      '2',
    );
    assert.equal(
      falling.find((p) => p.textContent === 'CLK').getAttribute('which'),
      '3',
    );
    assert.deepEqual(
      rising.map((p) => p.getAttribute('pos')),
      falling.map((p) => p.getAttribute('pos')),
    );
  }
  for (const id of ['flipflop_d', 'flipflop_jk'])
    for (const name of ['SET_N', 'RESET_N', 'Q_N'])
      assert.equal(
        nodes(parse(record(id).xml), 'PIN')
          .find((p) => p.textContent === name)
          .getAttribute('which'),
        '1',
      );
  for (const id of ['latch_d', 'latch_rs'])
    assert.ok(
      nodes(parse(record(id).xml), 'PIN').every(
        (p) => !['2', '3', '8', '10'].includes(p.getAttribute('which')),
      ),
    );
});
test('packaged digital library matches generated artwork and is reproducible without the private SQL dump', async () => {
  const bytes = await serializeLibrary(result.library, result.provenance);
  assert.deepEqual(
    bytes,
    await serializeLibrary(result.library, result.provenance),
  );
  assert.deepEqual(
    bytes,
    new Uint8Array(await readFile(path.join(root, result.recipe.output))),
  );
  const SQL = await librarySqlite(),
    db = new SQL.Database(bytes);
  try {
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.equal(db.exec('SELECT count(*) FROM Name')[0].values[0][0], 28);
    assert.equal(db.exec('SELECT max(ppp) FROM Name')[0].values[0][0], 1);
    assert.equal(
      db.exec(
        "SELECT count(*) FROM Attribute WHERE AttName='$$SPICE' AND length(AttValue)>0",
      )[0].values[0][0],
      28,
    );
  } finally {
    db.close();
  }
});
test('editor placement, rotations, save/load and netlisting preserve native pin shapes and connect hidden rails by name', async () => {
  await runRegression(`
import assert from 'node:assert/strict';
import{ioXML,blank}from'./src/io/ioXml';import{XMLBuilder}from'./src/util/xmlbuilder';
import{updateView}from'./src/manipulators/updateView';import{updateSymbol}from'./src/manipulators/updateSymbol';
import{NetlistGenerator}from'./src/io/netlists/netlistGenerator';import{makeNetForDrawing}from'./src/web-worker/netlist';
import{DocItemTypes}from'./src/model/dsnItem';
globalThis.document={createElement:()=>({getContext:()=>({measureText:text=>({width:String(text).length*3.6,actualBoundingBoxDescent:2})})})};
const createDoc=XMLBuilder.prototype.createDoc;XMLBuilder.prototype.createDoc=function(name){createDoc.call(this,name);this.insert=this.xmlDoc.documentElement;};
const stringify=XMLBuilder.prototype.tostring;XMLBuilder.prototype.tostring=function(){function normalize(node){if(node.attributes)for(let i=0;i<node.attributes.length;i++)node.attributes[i].value=String(node.attributes[i].value);if(node.nodeType===3||node.nodeType===4)node.data=String(node.data);for(let child=node.firstChild;child;child=child.nextSibling)normalize(child);}normalize(this.xmlDoc);return stringify.call(this);};
const library=${JSON.stringify(result.library)},records=${JSON.stringify(
    result.records.map((r) => ({ id: r.candidate.id, xml: r.xml })),
  )};
const io=new ioXML(),drawing=blank();let sheet=drawing.sheets[0];
for(const [i,record]of records.entries()){
 const xml=new XMLBuilder();xml.fromText(record.xml);const doc=io.from_dsn(xml);
 const placed=new updateView().handleSelectLibrarySymbol({},sheet,library.names[i],doc.sheets.map(s=>s.items),[i*250+100,100]);sheet=placed.sheet;
 const symbol=sheet.items.at(-1);symbol.text.find(t=>t.description==='Ref').value='U'+(i+1);
 const updater=new updateSymbol(symbol);assert.equal(updater.power_pins().length,2,record.id);
 assert.equal(updater.active_points().length,doc.sheets[0].items.filter(p=>p.NodeName===DocItemTypes.Pin&&p.which!==4).length);
 for(let rotation=0;rotation<8;rotation++){
  const u=new updateSymbol({...symbol,rotation,_active_points:null});
  for(const[x,y]of [...u.active_points(),...u.power_pins()])assert.ok([x,y].every(v=>Math.abs(v/5-Math.round(v/5))<1e-6),record.id+' off-grid');
 }
 const visible=new updateSymbol({...symbol,show_power:true,_active_points:null});assert.equal(visible.active_points().length,updater.active_points().length+2);
}
sheet={...sheet,items:[...sheet.items,{NodeName:DocItemTypes.Power,_id:999901,point:[20000,20000],which:0,text:'VCC',hints:[]},{NodeName:DocItemTypes.Power,_id:999902,point:[20000,21000],which:0,text:'VSS',hints:[]}]};
const net=new NetlistGenerator();makeNetForDrawing({...drawing,sheets:[sheet]},net);
for(const name of ['VCC','VSS']){assert.ok(net.labels[name],name+' named rail');const members=net.nets[net.labels[name]];assert.equal(members.filter(n=>n.reference).length,records.length,name+' all hidden pins auto-connect');assert.ok(members.some(n=>n.parent?.NodeName===DocItemTypes.Power),name+' connects to the visible power symbol');assert.equal(net.eprops[net.labels[name]].power_inputs,records.length);}
assert.notEqual(net.labels.VCC,net.labels.VSS);
const out=io.to_dsn({...drawing,sheets:[{...sheet,items:sheet.items.filter(i=>i.NodeName===DocItemTypes.Symbol)}]},true,true).tostring();
const xml=new XMLBuilder();xml.fromText(out);const restored=io.from_dsn(xml);
for(const [i,item]of restored.sheets[0].items.entries()){
 const u=new updateSymbol(item);assert.equal(u.power_pins().length,2);assert.deepEqual(u.power_pins().map(p=>p[2].name),['VCC','VSS']);
 const original=sheet.items.filter(s=>s.NodeName===DocItemTypes.Symbol)[i];
 const shapes=symbol=>new updateSymbol(symbol).outline().items.filter(p=>p.NodeName===DocItemTypes.Pin).map(p=>[p.number,p.which,p.name]);
 assert.deepEqual(shapes(item),shapes(original),'Save/load retains all native pin shapes.');
}
`);
});
