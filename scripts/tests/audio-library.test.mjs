import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { audioArtwork } from '../lib/audio-artwork.mjs';
import { serializeLibrary, librarySqlite } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';
import { layoutProofPage, audioProofIds } from '../lib/layout-proof-page.mjs';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const recipe = JSON.parse(
  await readFile(
    new URL('../../library-recipes/audio-music.json', import.meta.url),
    'utf8',
  ),
);
const result = audioArtwork(recipe),
  byId = Object.fromEntries(result.records.map((r) => [r.device.id, r]));

test('surveyed equipment preserves socket counts, cable types and distinct signal domains', () => {
  assert.equal(result.records.length, 99);
  const ports = (id) => byId[id].ports;
  for (const n of [4, 8, 12, 16, 24]) {
    const p = ports('mixer-analog-' + n);
    assert.equal(p.filter((p) => p.name.startsWith('MIC ')).length, n);
    assert.equal(p.filter((p) => p.name.startsWith('STEREO ')).length, 4);
    assert.ok(
      p.some((p) => p.name === 'MAIN L') && p.some((p) => p.name === 'MAIN R'),
    );
  }
  for (const n of [16, 32]) {
    assert.equal(
      ports('mixer-digital-' + n).filter((p) => p.name.startsWith('IN '))
        .length,
      n,
    );
    assert.equal(
      ports('mixer-digital-' + n).filter((p) => p.name.startsWith('OUT '))
        .length,
      8,
    );
  }
  assert.equal(ports('patchbay-trs-24').length, 48);
  assert.equal(byId['patchbay-trs-24'].bodyWidth, 64);
  assert.equal(byId['patchbay-trs-24'].bodyHeight, 12);
  assert.equal(
    ports('stagebox-digital-16').filter((p) => p.name.startsWith('IN ')).length,
    16,
  );
  assert.equal(
    ports('stagebox-digital-16').filter((p) => p.name.startsWith('OUT '))
      .length,
    8,
  );
  assert.notEqual(
    ports('connector-trs-balanced')[0].signal,
    ports('connector-trs-stereo')[0].signal,
  );
  assert.notEqual(
    ports('connector-midi-trs-a')[0].signal,
    ports('connector-midi-trs-b')[0].signal,
  );
  assert.notEqual(
    ports('connector-adat')[0].signal,
    ports('connector-spdif')[0].signal,
  );
  for (const id of [
    'speaker-pa-active',
    'speaker-monitor-active',
    'speaker-sub-active',
  ])
    assert.equal(ports(id)[0].signal, 'line');
  for (const id of [
    'speaker-pa-passive',
    'speaker-monitor-passive',
    'speaker-sub-passive',
  ])
    assert.equal(ports(id)[0].signal, 'speaker');
  const racks = result.records.filter((r) => r.device.kind === 'rack');
  assert.ok(racks.length >= 8);
  for (const r of racks) {
    assert.equal(r.bodyWidth, 64);
    assert.equal(r.bodyHeight, 12 * r.device.rack);
  }
});

test('each whole-cable connection is at the centre of a visible on-grid socket', () => {
  for (const r of result.records) {
    const doc = new DOMParser().parseFromString(r.xml, 'text/xml'),
      pins = Array.from(doc.getElementsByTagName('PIN'));
    assert.equal(pins.length, r.ports.length, r.device.id);
    assert.equal(
      new Set(r.ports.map((p) => `${p.x},${p.y}`)).size,
      r.ports.length,
      r.device.id,
    );
    assert.equal(new Set(r.ports.map((p) => p.number)).size, r.ports.length);
    for (const tag of ['IMAGE', 'METAFILE', 'POWER'])
      assert.equal(doc.getElementsByTagName(tag).length, 0);
    for (const p of r.ports) {
      assert.ok(
        [p.x, p.y].every((v) => Number.isInteger(v / 2)),
        r.device.id + ' normal grid',
      );
      const pin = pins.find((n) => n.getAttribute('number') === p.number);
      assert.equal(pin.getAttribute('pos'), `${p.x},${p.y}`);
      assert.equal(pin.textContent, p.name);
      assert.equal(pin.getAttribute('elec'), '4');
      assert.equal(pin.getAttribute('length'), '0');
      assert.equal(pin.getAttribute('show'), '0');
      const centred = ['ELLIPSE', 'RECTANGLE']
        .flatMap((t) => Array.from(doc.getElementsByTagName(t)))
        .some((n) => {
          const a = n.getAttribute('a').split(',').map(Number),
            b = n.getAttribute('b').split(',').map(Number);
          return (
            Math.abs((a[0] + b[0]) / 2 - p.x) < 1e-6 &&
            Math.abs((a[1] + b[1]) / 2 - p.y) < 1e-6
          );
        });
      assert.ok(centred, r.device.id + ' visible socket centre ' + p.name);
    }
    assert.ok(r.device.sources.length);
    for (const id of r.device.sources)
      assert.ok(
        recipe.references.some((s) => s.id === id),
        'Resolved research reference ' + id,
      );
  }
});

test('bundle is reproducible SQLite, registered and free of simulation attributes', async () => {
  const actual = await readFile(
    new URL('../../' + recipe.output, import.meta.url),
  );
  assert.deepEqual(
    await serializeLibrary(result.library, result.provenance),
    new Uint8Array(actual),
  );
  const config = JSON.parse(
    await readFile(
      new URL('../../bundled-libraries/config.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    config.libraries.find((l) => l.id === recipe.id).path,
    'audio-music/audio-music.tclib',
  );
  const db = new (await librarySqlite()).Database(actual);
  try {
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.equal(db.exec('SELECT count(*) FROM Name')[0].values[0][0], 99);
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

test('eighteen mixed audio resources fit at native size on A4 without overlap', async () => {
  const page = await layoutProofPage(result.records, audioProofIds);
  assert.equal(page.placements.length, 18);
  for (const a of page.placements)
    for (const b of page.placements)
      if (a !== b)
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          'No overlapping placed components',
        );
});

test('real editor places, rotates, saves and wires audio equipment through native socket contacts', async () => {
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
      ports: r.ports,
      xml: r.xml,
    })),
  )};
    const io=new ioXML(),drawing=blank();let sheet=drawing.sheets[0];
    for(const [i,r] of records.entries()){
      const x=new XMLBuilder();x.fromText(r.xml);const d=io.from_dsn(x);
      sheet=new updateView().handleSelectLibrarySymbol({},sheet,library.names[i],d.sheets.map(s=>s.items),[2000+i*2000,2000+i*3000]).sheet;
      const s=sheet.items.at(-1);s.text.find(t=>t.description==='Ref').value='A'+(i+1);
      const u=new updateSymbol(s),o=u.outline();assert.equal(u.active_points().length,r.ports.length,r.id);
      for(const [px,py,p] of u.active_points()){
        const fact=r.ports.find(f=>f.number===p.number);assert.equal(p.name,fact.name);assert.equal(p.elec,4);
        assert.equal(px,s.point[0]+fact.x*5-o.ref_point[0]);assert.equal(py,s.point[1]+fact.y*5-o.ref_point[1]);
      }
      for(let rotation=0;rotation<8;rotation++){
        const active=new updateSymbol({...s,rotation,_active_points:null}).active_points();assert.equal(active.length,r.ports.length);
        for(const [px,py] of active)assert.ok([px,py].every(v=>Number.isInteger(v/5)));
      }
    }
    const signature=s=>new updateSymbol(s).active_points().map(([x,y,p])=>[x,y,p.number,p.name,p.elec]);
    const saved=io.to_dsn({...drawing,sheets:[sheet]},true,true).tostring(),x=new XMLBuilder();x.fromText(saved);
    const restored=io.from_dsn(x).sheets[0];assert.deepEqual(restored.items.map(signature),sheet.items.map(signature));
    const symbol=id=>restored.items[records.findIndex(r=>r.id===id)];
    const connections=[
      ['mic-dynamic','MIC OUT','mixer-analog-8','MIC 1'],
      ['mixer-analog-8','MAIN L','speaker-pa-active','LINE IN'],
      ['computer-laptop','USB1','interface-2','USB'],
      ['interface-2','PHONES','headphones','STEREO IN'],
      ['keyboard-49','MIDI OUT','midi-thru-4','MIDI IN'],
      ['amp-power-stereo','OUT L','speaker-pa-passive','SPEAKER IN']
    ];
    const active=(id,name)=>new updateSymbol(symbol(id)).active_points().find(p=>p[2].name===name);
    const wires=connections.flatMap(([a,ap,b,bp],i)=>{
      const p=active(a,ap),q=active(b,bp);assert.ok(p&&q,'Known physical sockets');const xx=Math.max(p[0],q[0])+200+i*200;
      return [[[p[0],p[1]],[xx,p[1]]],[[xx,p[1]],[xx,q[1]]],[[xx,q[1]],[q[0],q[1]]]].map((points,j)=>({NodeName:'wire',_id:900000+i*3+j,d_points:points,_magnetic:null}));
    });
    const used=[...new Set(connections.flatMap(([a,ap,b])=>[a,b]))].map(symbol),netlist=new NetlistGenerator();
    makeNetForDrawing({...drawing,sheets:[{...restored,items:[...used,...wires]}]},netlist);
    const reference=s=>s.text.find(t=>t.description==='Ref').value;
    const selected=[];
    for(const [a,ap,b,bp] of connections){
      const p=active(a,ap),q=active(b,bp),net=Object.values(netlist.nets).find(n=>n.some(t=>t.reference===reference(symbol(a))&&t.pin===p[2].number));
      assert.ok(net?.some(t=>t.reference===reference(symbol(b))&&t.pin===q[2].number),a+' to '+b);selected.push(net);
    }
    assert.equal(new Set(selected).size,connections.length,'Independent cables remain separate nets');
  `);
});
