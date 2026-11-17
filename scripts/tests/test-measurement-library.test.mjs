import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { testMeasurementArtwork } from '../lib/test-measurement-artwork.mjs';
import { serializeLibrary, librarySqlite } from '../lib/library-from-sql.mjs';
import {
  layoutProofPage,
  testMeasurementProofIds,
  recordDrawing,
} from '../lib/layout-proof-page.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { runRegression } from './run-regression.mjs';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const recipe = JSON.parse(
  await readFile(
    new URL('../../library-recipes/test-measurement.json', import.meta.url),
    'utf8',
  ),
);
const result = testMeasurementArtwork(recipe),
  byId = Object.fromEntries(result.records.map((r) => [r.device.id, r]));

test('lab inventory distinguishes separate conductors, complete cables, sensor leads and fluid hoses', () => {
  assert.equal(result.records.length, 78);
  assert.equal(new Set(result.records.map((r) => r.device.category)).size, 7);
  const ports = (id) => byId[id].ports,
    names = (id) => ports(id).map((p) => p.name);
  for (const n of [1, 2, 3, 4]) {
    const ps = ports('psu-' + n);
    assert.equal(ps.filter((p) => p.signal === 'dc').length, n * 2);
    assert.equal(ps.filter((p) => p.signal === 'earth').length, 1);
    assert.ok(
      ps.filter((p) => p.signal !== 'usb').every((p) => p.unit === 'conductor'),
    );
  }
  assert.deepEqual(names('psu-remote-sense').slice(0, 4), [
    'FORCE +',
    'FORCE -',
    'SENSE +',
    'SENSE -',
  ]);
  assert.deepEqual(names('smu').slice(0, 5), [
    'FORCE HI',
    'FORCE LO',
    'SENSE HI',
    'SENSE LO',
    'GUARD',
  ]);
  for (const n of [2, 4])
    assert.equal(
      ports('scope-' + n).filter((p) => p.signal === 'scope').length,
      n,
    );
  assert.equal(
    ports('scope-mso').filter((p) => p.signal === 'logic-pod').length,
    2,
  );
  assert.equal(
    ports('logic-analyzer').filter((p) => p.signal === 'logic').length,
    16,
  );
  assert.equal(
    ports('daq-8').filter((p) => p.signal === 'analog-input').length,
    16,
  );
  assert.equal(
    ports('logger-rtd-4').filter((p) => p.signal === 'rtd').length,
    16,
  );
  assert.equal(
    ports('logger-tc-8').filter((p) => p.signal === 'thermocouple').length,
    8,
  );
  assert.ok(ports('logger-tc-8').every((p) => p.unit === 'cable'));
  assert.deepEqual(names('probe-rtd-2'), ['A', 'B']);
  assert.deepEqual(names('probe-rtd-3'), ['A', 'B1', 'B2']);
  assert.deepEqual(names('probe-rtd-4'), ['A1', 'A2', 'B1', 'B2']);
  assert.deepEqual(names('probe-passive'), ['TIP', 'GROUND CLIP', 'SCOPE']);
  assert.deepEqual(names('lcr').slice(0, 4), ['LCUR', 'LPOT', 'HPOT', 'HCUR']);
  assert.deepEqual(
    ports('relay-spdt').map((p) => p.number),
    ['A1', 'A2', '11', '12', '14'],
  );
  assert.equal(ports('relay-dpdt').length, 8);
  assert.equal(ports('relay-board-4').length, 18);
  for (const r of result.records.filter((r) => r.device.kind === 'heater')) {
    assert.equal(r.ports.length, 2);
    assert.ok(r.ports.every((p) => p.unit === 'conductor'));
  }
  assert.equal(ports('chiller').filter((p) => p.unit === 'hose').length, 2);
  assert.notEqual(
    ports('probe-ph')[0].signal,
    ports('scope-2')[0].signal,
    'BNC shape does not establish signal compatibility',
  );
});

test('native active points sit at visible terminal/socket centres on the normal grid', () => {
  for (const r of result.records) {
    const doc = new DOMParser().parseFromString(r.xml, 'text/xml'),
      pins = Array.from(doc.getElementsByTagName('PIN'));
    assert.equal(pins.length, r.device.ports.length, r.device.id);
    assert.equal(new Set(r.ports.map((p) => p.number)).size, r.ports.length);
    assert.equal(
      new Set(r.ports.map((p) => `${p.x},${p.y}`)).size,
      r.ports.length,
      r.device.id,
    );
    for (const tag of ['IMAGE', 'METAFILE', 'POWER'])
      assert.equal(doc.getElementsByTagName(tag).length, 0);
    for (const p of r.ports) {
      assert.ok(
        [p.x, p.y].every((n) => Number.isInteger(n / 2)),
        r.device.id + ' normal-grid endpoint',
      );
      assert.ok(['conductor', 'cable', 'hose'].includes(p.unit));
      const pin = pins.find((n) => n.getAttribute('number') === p.number);
      assert.equal(pin.getAttribute('pos'), `${p.x},${p.y}`);
      assert.equal(pin.textContent, p.name);
      assert.equal(pin.getAttribute('which'), '0');
      assert.equal(pin.getAttribute('length'), '0');
      assert.equal(pin.getAttribute('elec'), '4');
      const centred = ['ELLIPSE', 'RECTANGLE']
        .flatMap((t) => Array.from(doc.getElementsByTagName(t)))
        .some((n) => {
          const a = n.getAttribute('a').split(',').map(Number),
            b = n.getAttribute('b').split(',').map(Number);
          return (
            b[0] - a[0] <= 4 &&
            b[1] - a[1] <= 4 &&
            Math.abs((a[0] + b[0]) / 2 - p.x) < 1e-6 &&
            Math.abs((a[1] + b[1]) / 2 - p.y) < 1e-6
          );
        });
      assert.ok(centred, r.device.id + ' visible socket ' + p.name);
    }
    for (const id of r.device.sources)
      assert.ok(
        recipe.references.some((s) => s.id === id),
        'Resolved primary reference ' + id,
      );
  }
});

test('all native rendered captions and terminal labels fit their preview envelopes', async () => {
  const api = await layoutRuntime();
  for (const r of result.records) {
    const drawing = await recordDrawing(api, r),
      svg = api.renderCircuit(drawing.sheets[0]);
    const doc = new DOMParser().parseFromString(svg, 'text/xml');
    const texts = Array.from(doc.getElementsByTagName('text')).map((n) =>
      n.textContent.normalize('NFKC').replaceAll('−', '-'),
    );
    assert.ok(
      texts.includes(r.device.short),
      r.device.id + ' complete caption',
    );
    for (const p of r.ports)
      assert.ok(
        texts.includes(p.label),
        r.device.id + ' visible terminal label ' + p.label,
      );
    const b = api.circuitBounds(drawing.sheets[0]);
    assert.ok(
      b.x1 <= 0 && b.x2 >= r.width * 5,
      r.device.id + ' full horizontal envelope',
    );
    assert.ok(
      b.y2 >= r.height * 5,
      r.device.id + ' caption included in envelope',
    );
  }
});

test('bundle is reproducible SQLite, registered for packaging, with no simulation models', async () => {
  const actual = await readFile(
    new URL('../../' + recipe.output, import.meta.url),
  );
  assert.deepEqual(
    await serializeLibrary(result.library, result.provenance),
    new Uint8Array(actual),
  );
  const catalog = JSON.parse(
    await readFile(
      new URL('../../bundled-libraries/config.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    catalog.libraries.find((l) => l.id === recipe.id).path,
    'test-measurement/test-measurement.tclib',
  );
  const db = new (await librarySqlite()).Database(actual);
  try {
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.equal(db.exec('SELECT count(*) FROM Name')[0].values[0][0], 78);
    assert.equal(
      db.exec("SELECT count(*) FROM Attribute WHERE AttName LIKE '$$SPICE%'")[0]
        .values[0][0],
      0,
    );
    for (const [i, r] of result.records.entries())
      assert.equal(
        new TextDecoder().decode(
          db.exec(`SELECT Data FROM Symbol WHERE SymbolID=${i + 1}`)[0]
            .values[0][0],
        ),
        r.xml,
      );
  } finally {
    db.close();
  }
});

test('eighteen mixed lab resources fit actual A4 at native placement size without overlap', async () => {
  const page = await layoutProofPage(result.records, testMeasurementProofIds);
  assert.equal(page.placements.length, 18);
  for (const a of page.placements)
    for (const b of page.placements)
      if (a !== b)
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          'No overlapping lab equipment',
        );
});

test('real editor placement, rotation, save/load and electrical/coax/RTD/thermal setup wiring', async () => {
  await runRegression(`
  import assert from 'node:assert/strict';
  import {ioXML,blank} from './src/io/ioXml';
  import {XMLBuilder} from './src/util/xmlbuilder';
  import {updateView} from './src/manipulators/updateView';
  import {updateSymbol} from './src/manipulators/updateSymbol';
  import {initialiseLayoutRuntime} from './scripts/layout/headless';
  import {NetlistGenerator} from './src/io/netlists/netlistGenerator';
  import {makeNetForDrawing} from './src/web-worker/netlist';
  initialiseLayoutRuntime();
  const library=${JSON.stringify(result.library)},records=${JSON.stringify(
    result.records.map((r) => ({
      id: r.device.id,
      xml: r.xml,
      ports: r.ports,
    })),
  )};
  const io=new ioXML(),drawing=blank();let sheet=drawing.sheets[0];
  for(const [i,r] of records.entries()){
   const x=new XMLBuilder();x.fromText(r.xml);const d=io.from_dsn(x);
   sheet=new updateView().handleSelectLibrarySymbol({},sheet,library.names[i],d.sheets.map(s=>s.items),[2000+i*2000,2000+i*3000]).sheet;
   const s=sheet.items.at(-1);s.text.find(t=>t.description==='Ref').value='T'+(i+1);
   const u=new updateSymbol(s),o=u.outline();assert.equal(u.active_points().length,r.ports.length,r.id);
   for(const [px,py,p] of u.active_points()){
    const fact=r.ports.find(f=>f.number===p.number);assert.equal(p.name,fact.name);assert.equal(p.elec,4);
    assert.equal(px,s.point[0]+fact.x*5-o.ref_point[0]);assert.equal(py,s.point[1]+fact.y*5-o.ref_point[1]);
   }
   for(let rotation=0;rotation<8;rotation++){
    const active=new updateSymbol({...s,rotation,_active_points:null}).active_points();assert.equal(active.length,r.ports.length);
    for(const [px,py] of active)assert.ok([px,py].every(v=>Number.isInteger(v/5)),r.id+' rotated endpoints');
   }
  }
  const signature=s=>new updateSymbol(s).active_points().map(([x,y,p])=>[x,y,p.number,p.name,p.elec]);
  const saved=io.to_dsn({...drawing,sheets:[sheet]},true,true).tostring(),x=new XMLBuilder();x.fromText(saved);
  const restored=io.from_dsn(x).sheets[0];assert.deepEqual(restored.items.map(signature),sheet.items.map(signature));
  const symbol=id=>restored.items[records.findIndex(r=>r.id===id)];
  const pairs=[
   ['generator-1','OUT 1','scope-4','CH 1'],
   ...['A1','A2','B1','B2'].map(n=>['probe-rtd-4',n,'logger-rtd-4','RTD1 '+n]),
   ['pid-controller','SSR+','relay-ssr','CONTROL +'],['pid-controller','SSR-','relay-ssr','CONTROL -'],
   ['source-ac','AC OUT L','relay-ssr','LOAD A'],['relay-ssr','LOAD B','heater-cartridge','HEATER A'],
   ['source-ac','AC OUT N','heater-cartridge','HEATER B'],
   ['psu-1','OUT 1 +','pid-controller','PWR+'],['psu-1','OUT 1 -','pid-controller','PWR-'],
   ['probe-tc-immersion','TYPE K PLUG','logger-tc-8','TC 1'],
   ['chiller','FLUID OUT','pump-peristaltic','FLUID IN']
  ];
  const active=(id,name)=>new updateSymbol(symbol(id)).active_points().find(p=>p[2].name===name);
  const reference=s=>s.text.find(t=>t.description==='Ref').value;
  for(const [a,ap,b,bp] of pairs){
   const p=active(a,ap),q=active(b,bp);assert.ok(p&&q,'Known named connection');
   const exit=(id,p)=>{
    const pts=new updateSymbol(symbol(id)).active_points();
    const above=pts.filter(v=>v[0]===p[0]&&v[1]<p[1]);
    return above.length?Math.max(...pts.map(v=>v[1]))+200:Math.min(...pts.map(v=>v[1]))-200;
   };
   const yy=exit(a,p),zz=exit(b,q),xx=Math.max(...new updateSymbol(symbol(a)).active_points().map(v=>v[0]),...new updateSymbol(symbol(b)).active_points().map(v=>v[0]))+500;
   const path=[[p[0],p[1]],[p[0],yy],[xx,yy],[xx,zz],[q[0],zz],[q[0],q[1]]];
   const wires=path.slice(1).map((v,i)=>({NodeName:'wire',_id:900000+i,d_points:[path[i],v],_magnetic:null}));
   const netlist=new NetlistGenerator();makeNetForDrawing({...drawing,sheets:[{...restored,items:[symbol(a),symbol(b),...wires]}]},netlist);
   const net=Object.values(netlist.nets).find(n=>n.some(t=>t.reference===reference(symbol(a))&&t.pin===p[2].number));
   assert.ok(net?.some(t=>t.reference===reference(symbol(b))&&t.pin===q[2].number),a+'/'+ap+' to '+b+'/'+bp);
   assert.equal(net.filter(t=>t.symbol).length,2,'Cable touches exactly the intended two endpoints: '+a+'/'+ap);
  }
 `);
});
