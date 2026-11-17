import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { networkArtwork, rackSize } from '../lib/network-artwork.mjs';
import { layoutProofPage, recordDrawing } from '../lib/layout-proof-page.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';
import { serializeLibrary, librarySqlite } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';

const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const recipe = JSON.parse(
  await readFile(
    new URL('../../library-recipes/network-layout.json', import.meta.url),
    'utf8',
  ),
);
const result = networkArtwork(recipe);
const xy = (value) => value.split(',').map(Number);

test('network sockets have separate on-grid cable endpoints inside their openings', () => {
  for (const record of result.records) {
    const doc = new DOMParser().parseFromString(record.xml, 'text/xml');
    const pins = Array.from(doc.getElementsByTagName('PIN'));
    assert.equal(
      pins.length,
      record.device.copper +
        (record.device.sfp || 0) +
        (record.device.fibre || 0),
      record.device.id,
    );
    assert.equal(
      new Set(pins.map((p) => p.getAttribute('number'))).size,
      pins.length,
    );
    assert.equal(
      new Set(pins.map((p) => p.getAttribute('pos'))).size,
      pins.length,
      'No shared cable endpoints',
    );
    assert.equal(
      doc.getElementsByTagName('IMAGE').length,
      0,
      'Native vectors only',
    );
    assert.equal(doc.getElementsByTagName('METAFILE').length, 0);
    const openings = Array.from(doc.getElementsByTagName('RECTANGLE')).filter(
      (r) => ['4', '6'].includes(r.getAttribute('fill')),
    );
    for (const pin of pins) {
      const [x, y] = xy(pin.getAttribute('pos'));
      assert.ok(
        [x, y].every((n) => Number.isInteger(n / 2)),
        record.device.id + ': normal-grid hotspot',
      );
      assert.equal(
        pin.getAttribute('which'),
        '0',
        'Ordinary terminal, not a hidden power net',
      );
      assert.equal(
        pin.getAttribute('length'),
        '0',
        'No stem protrudes outside the socket',
      );
      assert.equal(
        pin.getAttribute('show'),
        '0',
        'Port labels use faceplate text',
      );
      assert.equal(
        pin.getAttribute('elec'),
        '4',
        'Passive cable endpoint abstraction',
      );
      assert.ok(
        openings.some((r) => {
          const a = xy(r.getAttribute('a')),
            b = xy(r.getAttribute('b'));
          return (
            x > a[0] &&
            x < b[0] &&
            y > a[1] &&
            y < b[1] &&
            (b[0] - a[0]) * (b[1] - a[1]) < 40
          );
        }),
        record.device.id + ': terminal must lie inside a real socket opening',
      );
    }
    for (let i = 0; i < pins.length; i++)
      for (let j = i + 1; j < pins.length; j++) {
        const a = xy(pins[i].getAttribute('pos')),
          b = xy(pins[j].getAttribute('pos'));
        assert.ok(
          Math.abs(a[0] - b[0]) >= 2 || Math.abs(a[1] - b[1]) >= 2,
          record.device.id + ': socket artwork overlaps',
        );
      }
    if (record.device.rack) {
      const face = doc.getElementsByTagName('RECTANGLE')[0];
      assert.equal(face.getAttribute('a'), '0,0');
      assert.equal(
        face.getAttribute('b'),
        `${rackSize.width},${rackSize.height}`,
      );
    }
  }
  for (const count of [5, 8, 16, 24, 48])
    assert.ok(
      result.records.some(
        (r) =>
          r.device.kind === 'switch' &&
          r.device.copper === count &&
          !r.device.sfp &&
          !r.device.poePorts,
      ),
      `Common ${count}-port copper switch`,
    );
  const fivePortPoE = result.records.find(
    (r) => r.device.id === 'desktop-switch-5-poe',
  );
  assert.equal(
    fivePortPoE.ports.filter((p) => p.name.includes('/PoE+')).length,
    4,
  );
  assert.equal(
    fivePortPoE.ports.length,
    5,
    'Four powered ports plus a real uplink socket',
  );
});

test('network library is reproducible, packaged as SQLite and registered in the bundle catalogue', async () => {
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
    'network-layout/network-layout.tclib',
  );
  const db = new (await librarySqlite()).Database(actual);
  try {
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.equal(
      db.exec('SELECT count(*) FROM Name')[0].values[0][0],
      recipe.devices.length,
    );
    assert.equal(
      db.exec("SELECT count(*) FROM Attribute WHERE AttName LIKE '$$SPICE%'")[0]
        .values[0][0],
      0,
    );
    for (const [index, record] of result.records.entries()) {
      const data = db.exec(
        `SELECT Data FROM Symbol WHERE SymbolID=${index + 1}`,
      )[0].values[0][0];
      assert.equal(new TextDecoder().decode(data), record.xml);
    }
  } finally {
    db.close();
  }
});

test('actual editor placement preserves rack anchors, socket wiring, rotations and save/load', async () => {
  await runRegression(`
    import assert from 'node:assert/strict';
    import { ioXML, blank } from './src/io/ioXml';
    import { XMLBuilder } from './src/util/xmlbuilder';
    import { updateView } from './src/manipulators/updateView';
    import { updateSymbol } from './src/manipulators/updateSymbol';
    import { initialiseLayoutRuntime } from './scripts/layout/headless';
    import { NetlistGenerator } from './src/io/netlists/netlistGenerator';
    import { makeNetForDrawing } from './src/web-worker/netlist';
    initialiseLayoutRuntime();
    const library = ${JSON.stringify(result.library)};
    const records = ${JSON.stringify(
      result.records.map((r) => ({
        xml: r.xml,
        id: r.device.id,
        rack: !!r.device.rack,
        ports: r.ports,
      })),
    )};
    const io = new ioXML(), drawing = blank();
    let sheet = drawing.sheets[0], rackIndex = 0;
    const rackOrigins = [], symbols = [];
    for (const [i, record] of records.entries()) {
      const xml = new XMLBuilder(); xml.fromText(record.xml);
      const parsed = io.from_dsn(xml);
      const point = record.rack ? [2000, 300 + rackIndex++ * 40] : [5000, 300 + i * 500];
      sheet = new updateView().handleSelectLibrarySymbol({}, sheet, library.names[i], parsed.sheets.map(s => s.items), point).sheet;
      const symbol = sheet.items.at(-1);
      symbols.push(symbol);
      symbol.text.find(t => t.description === 'Ref').value = 'N' + (i + 1);
      assert.ok(symbol.text.every(t => !t.show), 'Metadata must not collide with stacked panels');
      const updater = new updateSymbol(symbol), outline = updater.outline();
      assert.equal(updater.active_points().length, record.ports.length, record.id);
      if (record.rack) {
        assert.deepEqual(outline.ref_point, [400, 40], record.id + ': common bottom-right insertion anchor');
        assert.deepEqual(outline.size, [400, 40], record.id + ': common rack envelope');
        rackOrigins.push([symbol.point[0] - 400, symbol.point[1] - 40]);
      }
      for (let rotation = 0; rotation < 8; rotation++) {
        const u = new updateSymbol({...symbol, rotation, _active_points: null});
        const active = u.active_points();
        assert.equal(active.length, record.ports.length);
        for (const [x,y] of active) assert.ok([x,y].every(n => Number.isInteger(n / 5)), record.id + ': rotated socket off-grid');
      }
      for (const [x,y,pin] of updater.active_points()) {
        const port = record.ports.find(p => p.number === pin.number);
        assert.equal(x, symbol.point[0] + port.x * 5 - outline.ref_point[0]);
        assert.equal(y, symbol.point[1] + port.y * 5 - outline.ref_point[1]);
      }
    }
    for (let i = 1; i < rackOrigins.length; i++) {
      assert.equal(rackOrigins[i][0], rackOrigins[0][0], 'Rack faces align horizontally');
      assert.equal(rackOrigins[i][1] - rackOrigins[i-1][1], 40, 'Rack faces stack edge-to-edge');
    }
    const signature = s => new updateSymbol(s).active_points().map(([x,y,p]) => [x,y,p.number,p.name]);
    const saved = io.to_dsn({...drawing, sheets:[sheet]}, true, true).tostring();
    const xml = new XMLBuilder(); xml.fromText(saved);
    const restored = io.from_dsn(xml).sheets[0];
    assert.deepEqual(restored.items.map(signature), symbols.map(signature), 'Socket positions and identities survive save/load');
    const source = restored.items[records.findIndex(r => r.id === 'desktop-switch-5-poe')];
    const target = restored.items[records.findIndex(r => r.id === 'ap-ceiling-1')];
    const a = new updateSymbol(source).active_points()[0], b = new updateSymbol(target).active_points()[0];
    const wires = [
      {NodeName:'wire',_id:900001,d_points:[[a[0],a[1]],[b[0],a[1]]],_magnetic:null},
      {NodeName:'wire',_id:900002,d_points:[[b[0],a[1]],[b[0],b[1]]],_magnetic:null},
    ];
    const netlist = new NetlistGenerator();
    makeNetForDrawing({...drawing,sheets:[{...restored,items:[source,target,...wires]}]},netlist);
    const references = [source.text.find(t=>t.description==='Ref').value,target.text.find(t=>t.description==='Ref').value];
    assert.ok(Object.values(netlist.nets).some(net => references.every(ref => net.some(n => n.reference === ref && n.pin === '1'))), 'A cable connects exactly the two intended socket terminals');
  `);
});

test('all network devices are about 30 percent size and fit on one A4 page at native scale', async () => {
  for (const record of result.records) {
    assert.equal(record.layout.scale, 0.3);
    for (const [size, original] of [
      [record.width, record.layout.sourceWidth],
      [record.height, record.layout.sourceHeight],
    ]) {
      assert.ok(
        size / original >= 0.3 && size / original <= 0.36,
        record.device.id + ': compact body size',
      );
    }
  }
  const proof = await layoutProofPage(
    result.records,
    result.records.map((record) => record.device.id),
  );
  assert.equal(proof.placements.length, recipe.devices.length);
  assert.equal(proof.placements.length, 47);
  assert.ok(proof.placements.every((placement) => placement.width < 450));
});

test('compact network panels retain readable fonts and uniform port-bank gaps', () => {
  for (const record of result.records) {
    const doc = new DOMParser().parseFromString(record.xml, 'text/xml');
    const heights = Array.from(doc.getElementsByTagName('FONT')).map((f) =>
      Number(f.getElementsByTagName('HEIGHT')[0].textContent),
    );
    assert.ok(
      heights.every((height) => height >= 5),
      record.device.id + ': labels must remain readable after compacting',
    );
    assert.ok(
      Math.max(...heights) >= 10,
      record.device.id + ': prominent device title',
    );
    for (const kind of ['rj45', 'sfp']) {
      const ports = record.ports.filter((p) => p.kind === kind);
      for (const y of new Set(ports.map((p) => p.y))) {
        const row = ports.filter((p) => p.y === y).sort((a, b) => a.x - b.x);
        if (row.length < 2) continue;
        const pitch = row[1].x - row[0].x;
        assert.ok(pitch >= 2 && pitch % 2 === 0);
        for (let i = 2; i < row.length; i++)
          assert.equal(
            row[i].x - row[i - 1].x,
            pitch,
            record.device.id + ': consistent adjacent port spacing',
          );
      }
    }
  }
  for (const id of ['desktop-firewall-6', 'rack-firewall-6-2sfp']) {
    const ports = result.records.find((r) => r.device.id === id).ports;
    const wan1 = ports.find((p) => p.name === 'WAN1'),
      wan2 = ports.find((p) => p.name === 'WAN2'),
      lan1 = ports.find((p) => p.name === 'LAN1');
    assert.equal(
      wan2.x - wan1.x,
      lan1.x - wan2.x,
      id + ': WAN/LAN boundary must not collapse',
    );
    assert.equal(wan2.x - wan1.x, 4, id + ': leave space for WAN/LAN labels');
  }
});

test('network faceplate labels render as complete single lines in the native renderer', async () => {
  const api = await layoutRuntime();
  for (const record of result.records) {
    const drawing = await recordDrawing(api, record);
    const svg = new DOMParser().parseFromString(
      api.renderCircuit(drawing.sheets[0]),
      'image/svg+xml',
    );
    const visible = Array.from(svg.getElementsByTagName('text')).map(
      (node) => node.textContent,
    );
    const xml = new DOMParser().parseFromString(record.xml, 'text/xml');
    for (const note of Array.from(xml.getElementsByTagName('NOTE_TEXT'))) {
      assert.ok(
        visible.includes(note.textContent),
        record.device.id + ': label wraps or clips: ' + note.textContent,
      );
    }
  }
});
