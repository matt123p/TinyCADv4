import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { embeddedArtwork } from '../lib/embedded-artwork.mjs';
import { serializeLibrary, librarySqlite } from '../lib/library-from-sql.mjs';
import { runRegression } from './run-regression.mjs';
import {
  layoutProofPage,
  embeddedProofIds,
} from '../lib/layout-proof-page.mjs';
const { DOMParser } = createRequire(import.meta.url)('common-xml-features');
const recipe = JSON.parse(
  await readFile(
    new URL('../../library-recipes/embedded-smart-home.json', import.meta.url),
    'utf8',
  ),
);
const result = embeddedArtwork(recipe),
  byId = Object.fromEntries(result.records.map((r) => [r.device.id, r]));
const xy = (value) => value.split(',').map(Number);
const names = (id, header) =>
  byId[id].pins
    .filter((p) => p.number.startsWith(header + '-'))
    .sort(
      (a, b) =>
        Number(a.number.split('-').at(-1)) - Number(b.number.split('-').at(-1)),
    )
    .map((p) => p.name);

test('physical board variants retain independently checked header order and electrical semantics', () => {
  assert.equal(result.records.length, 44);
  for (const r of result.records.filter(
    (r) => r.device.category === 'controller',
  ))
    for (const p of r.pins.filter((p) => ['3V3', '5V'].includes(p.name)))
      assert.equal(p.electricalType, 10, 'USB-powered controller supply rail');
  assert.deepEqual(names('esp32-devkitc-v4', 'J1'), [
    '3V3',
    'EN',
    'GPIO36/VP',
    'GPIO39/VN',
    'GPIO34',
    'GPIO35',
    'GPIO32',
    'GPIO33',
    'GPIO25',
    'GPIO26',
    'GPIO27',
    'GPIO14',
    'GPIO12',
    'GND',
    'GPIO13',
    'SD2/GPIO9',
    'SD3/GPIO10',
    'CMD/GPIO11',
    '5V',
  ]);
  assert.deepEqual(names('esp32s3-devkitc1', 'J3'), [
    'GND',
    'TX/GPIO43',
    'RX/GPIO44',
    'GPIO1',
    'GPIO2',
    'GPIO42',
    'GPIO41',
    'GPIO40',
    'GPIO39',
    'GPIO38/LED',
    'GPIO37',
    'GPIO36',
    'GPIO35',
    'GPIO0',
    'GPIO45',
    'GPIO48',
    'GPIO47',
    'GPIO21',
    'GPIO20/D+',
    'GPIO19/D-',
    'GND',
    'GND',
  ]);
  assert.deepEqual(names('nodemcu-esp8266', 'J1').slice(0, 6), [
    'A0',
    'RSV',
    'RSV',
    'SD3/GPIO10',
    'SD2/GPIO9',
    'SD1/GPIO8',
  ]);
  assert.deepEqual(names('lolin-d1-mini', 'J1'), [
    'RST',
    'A0',
    'D0/GPIO16',
    'D5/GPIO14',
    'D6/GPIO12',
    'D7/GPIO13',
    'D8/GPIO15',
    '3V3',
  ]);
  assert.deepEqual(names('adafruit-bme280', 'JP2'), [
    'VIN',
    '3Vo',
    'GND',
    'SCK/SCL',
    'SDO/ADR',
    'SDI/SDA',
    'CS',
  ]);
  assert.deepEqual(names('adafruit-sht31', 'JP2'), [
    'VDD',
    'GND',
    'SCL',
    'SDA',
    'ADDR',
    'RST',
    'ALERT',
  ]);
  assert.deepEqual(names('adafruit-tsl2591', 'JP1'), [
    'VIN',
    'GND',
    '3Vo',
    'INT',
    'SDA',
    'SCL',
  ]);
  assert.deepEqual(names('adafruit-vl53l0x', 'JP1'), [
    'VIN',
    '2v8',
    'GND',
    'GPIO',
    'XSHUT',
    'SCL',
    'SDA',
  ]);
  assert.deepEqual(names('adafruit-qt1010', 'JP1'), [
    'LEDA',
    'VDD',
    'OUT',
    'GND',
  ]);
  assert.deepEqual(names('adafruit-qt1012', 'JP1'), [
    'LEDA',
    'VDD',
    'TIME',
    'OUT',
    'GND',
  ]);
  for (const id of ['gravity-dht22', 'gravity-ds18b20'])
    assert.deepEqual(names(id, 'J1').slice(1), ['VCC', 'GND']);
  assert.deepEqual(names('gravity-soil', 'J1'), ['GND', 'VCC', 'AOUT']);
  assert.deepEqual(names('gravity-relay', 'J2'), ['COM', 'EMPTY', 'NO', 'NC']);
  assert.equal(
    byId['gravity-relay'].pins.find((p) => p.name === 'NC').electricalType,
    4,
    'Normally closed contact is not a no-connect pin',
  );
  assert.equal(
    byId['gravity-relay'].pins.find((p) => p.name === 'EMPTY').electricalType,
    6,
  );
  assert.deepEqual(
    byId['hc-sr04'].pins.map((p) => p.name),
    ['VCC', 'TRIG', 'ECHO', 'GND'],
  );
  assert.match(byId['hc-sr04'].device.notes, /5 V output/);
  for (const id of [
    'adafruit-aht20',
    'adafruit-bh1750',
    'adafruit-mpu6050',
    'adafruit-scd41',
  ]) {
    for (const header of ['CONN3', 'CONN4'])
      assert.deepEqual(names(id, header), ['GND', 'VIN', 'SDA', 'SCL']);
  }
  assert.equal(
    byId['adafruit-mpu6050'].pins.length,
    20,
    'Both main rows and both QT ports',
  );
  for (const model of [3, 4, 5]) {
    const pins = byId['raspberry-pi-' + model].pins;
    assert.equal(pins.length, 40);
    assert.deepEqual(
      pins.slice(0, 6).map((p) => p.name),
      ['3V3', '5V', 'GPIO2/SDA1', '5V', 'GPIO3/SCL1', 'GND'],
    );
    assert.equal(pins[26].name, 'GPIO0/ID_SD');
    assert.equal(pins[27].name, 'GPIO1/ID_SC');
    assert.ok(
      pins[0].y > pins[1].y,
      'Odd pins are the inner row, component-side view',
    );
    assert.deepEqual(
      pins.slice(-2).map((p) => p.name),
      ['GND', 'GPIO21'],
    );
  }
  for (const id of ['arduino-uno', 'arduino-nano', 'arduino-mega'])
    assert.equal(names(id, 'ICSP').length, 6);
  assert.equal(byId['arduino-mega'].pins.length, 98);
  for (const [id, numbers] of [
    ['esp32-devkitc-v4', ['J1-3', 'J1-4', 'J1-5', 'J1-6']],
    ['esp32s3-devkitc1', ['J1-14']],
    ['arduino-nano', ['L-10', 'L-11']],
  ])
    for (const number of numbers)
      assert.equal(
        byId[id].pins.find((p) => p.number === number).electricalType,
        0,
        'Input-only terminal ' + id + '/' + number,
      );
});

test('display modules retain header polarity, UART direction, unused contacts and rear-only wiring', () => {
  const displays = result.records.filter(
    (r) => r.device.category === 'display',
  );
  assert.equal(displays.length, 8);
  assert.deepEqual(names('display-lcd1602', 'I2C'), [
    'VCC',
    'GND',
    'SCL',
    'SDA',
  ]);
  assert.deepEqual(names('display-oled12864', 'I2C'), [
    'VCC',
    'GND',
    'SCL',
    'SDA',
  ]);
  assert.deepEqual(names('display-nextion28', 'UART'), [
    '5V',
    'TX',
    'RX',
    'GND',
  ]);
  for (const h of ['P1', 'P2'])
    assert.deepEqual(names('display-tft18', h), [
      'VCC',
      'GND',
      'DIN',
      'CLK',
      'CS',
      'DC',
      'RST',
      'BL',
    ]);
  const leftToRight = (id) =>
    [...byId[id].pins].sort((a, b) => a.x - b.x).map((p) => p.name);
  assert.deepEqual(
    leftToRight('display-oled12864'),
    ['SDA', 'SCL', 'GND', 'VCC'],
    'Rear OLED header must not be mirrored',
  );
  assert.deepEqual(
    leftToRight('display-nextion28'),
    ['GND', 'RX', 'TX', '5V'],
    'Rear UART header must not be mirrored',
  );
  assert.deepEqual(
    [...byId['display-lcd1602'].pins]
      .sort((a, b) => a.y - b.y)
      .map((p) => p.name),
    ['VCC', 'GND', 'SCL', 'SDA'],
  );
  const cap = byId['display-touch28'];
  assert.deepEqual(names('display-touch28', 'L4'), [
    'VCC',
    'GND',
    'MISO/NC',
    'MOSI',
    'SCLK',
    'LCD_CS',
    'LCD_DC',
    'LCD_RST',
    'LCD_BL',
    'TP_SDA',
    'TP_SCL',
    'TP_INT',
    'TP_RST',
  ]);
  assert.equal(cap.pins.find((p) => p.name === 'MISO/NC').electricalType, 6);
  assert.equal(cap.pins.find((p) => p.name === 'TP_INT').electricalType, 1);
  assert.equal(cap.pins.find((p) => p.name === 'TP_SDA').electricalType, 5);
  const serial = byId['display-nextion28'];
  assert.equal(serial.pins.find((p) => p.name === 'TX').electricalType, 1);
  assert.equal(serial.pins.find((p) => p.name === 'RX').electricalType, 0);
  assert.equal(serial.pins.find((p) => p.name === '5V').electricalType, 9);
  for (const [id, headers] of [
    ['display-epaper213', ['P3']],
    ['display-epaper29', ['P1']],
    ['display-epaper42', ['P1', 'P2']],
  ]) {
    for (const h of headers)
      assert.deepEqual(names(id, h), [
        'VCC',
        'GND',
        'DIN',
        'CLK',
        'CS',
        'DC',
        'RST',
        'BUSY',
      ]);
    assert.equal(
      byId[id].pins.find((p) => p.name === 'BUSY').electricalType,
      1,
    );
  }
  for (const r of displays) {
    assert.ok(
      r.device.sourceFiles.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)),
    );
    assert.match(
      r.device.view,
      /Front face at left; rear wiring view at right/,
    );
    assert.ok(
      r.pins.every((p) => p.x >= r.layout.rearX),
      'No connections on the illustrative front face',
    );
  }
});

test('every terminal is an explicit on-grid pad, with unique identity and vector-only artwork', () => {
  for (const record of result.records) {
    const { device } = record,
      doc = new DOMParser().parseFromString(record.xml, 'text/xml');
    const pins = Array.from(doc.getElementsByTagName('PIN'));
    assert.equal(pins.length, device.pins.length, device.id);
    assert.equal(
      new Set(pins.map((p) => p.getAttribute('number'))).size,
      pins.length,
    );
    assert.equal(
      new Set(pins.map((p) => p.getAttribute('pos'))).size,
      pins.length,
      device.id + ': distinct physical contacts',
    );
    assert.ok(
      device.sources.length &&
        device.sources.every((s) => s.startsWith('https://')),
    );
    for (const tag of ['IMAGE', 'METAFILE', 'POWER'])
      assert.equal(doc.getElementsByTagName(tag).length, 0);
    const pads = Array.from(doc.getElementsByTagName('RECTANGLE')).filter(
      (r) => {
        const a = xy(r.getAttribute('a')),
          b = xy(r.getAttribute('b'));
        return (
          Math.abs(b[0] - a[0] - 1.4) < 1e-6 &&
          Math.abs(b[1] - a[1] - 1.4) < 1e-6
        );
      },
    );
    for (const p of pins) {
      const [x, y] = xy(p.getAttribute('pos'));
      assert.ok(
        [x, y].every((v) => Number.isInteger(v / 2)),
        device.id + ': normal-grid hotspot',
      );
      assert.equal(p.getAttribute('which'), '0');
      assert.equal(p.getAttribute('length'), '0');
      assert.equal(p.getAttribute('show'), '0');
      assert.ok(
        pads.some((r) => {
          const a = xy(r.getAttribute('a'));
          return (
            Math.abs(a[0] + 0.7 - x) < 1e-6 && Math.abs(a[1] + 0.7 - y) < 1e-6
          );
        }),
        'Connection must centre on its copper pad',
      );
      const fact = device.pins.find(
        (f) => f.number === p.getAttribute('number'),
      );
      assert.equal(p.textContent, fact.name);
      assert.equal(Number(p.getAttribute('elec')), fact.electricalType);
    }
  }
});

test('native bundle is deterministic SQLite and registered for all application targets', async () => {
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
    'embedded-smart-home/embedded-smart-home.tclib',
  );
  const db = new (await librarySqlite()).Database(actual);
  try {
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.equal(db.exec('SELECT count(*) FROM Name')[0].values[0][0], 44);
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

test('real editor placement, rotation, save/load and four-wire ESP32/BME280 connectivity', async () => {
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
    const library=${JSON.stringify(result.library)};
    const records=${JSON.stringify(
      result.records.map((r) => ({
        id: r.device.id,
        xml: r.xml,
        pins: r.pins,
      })),
    )};
    const io=new ioXML(),drawing=blank();let sheet=drawing.sheets[0];const symbols=[];
    for(const [i,record] of records.entries()){
      const xml=new XMLBuilder();xml.fromText(record.xml);const parsed=io.from_dsn(xml);
      sheet=new updateView().handleSelectLibrarySymbol({},sheet,library.names[i],parsed.sheets.map(s=>s.items),[2000+i*1800,2000+i*3000]).sheet;
      const symbol=sheet.items.at(-1);symbols.push(symbol);symbol.text.find(t=>t.description==='Ref').value='U'+(i+1);
      const u=new updateSymbol(symbol),outline=u.outline();
      assert.equal(u.active_points().length,record.pins.length,record.id);
      for(const [x,y,pin] of u.active_points()){
        const fact=record.pins.find(p=>p.number===pin.number);assert.ok(fact,record.id+': terminal identity');
        assert.equal(pin.name,fact.name);assert.equal(pin.elec,fact.electricalType);
        assert.equal(x,symbol.point[0]+fact.x*5-outline.ref_point[0]);
        assert.equal(y,symbol.point[1]+fact.y*5-outline.ref_point[1]);
      }
      for(let rotation=0;rotation<8;rotation++){
        const active=new updateSymbol({...symbol,rotation,_active_points:null}).active_points();
        assert.equal(active.length,record.pins.length);
        for(const [x,y] of active)assert.ok([x,y].every(v=>Number.isInteger(v/5)),record.id+': rotated terminal grid');
      }
    }
    const signature=s=>new updateSymbol(s).active_points().map(([x,y,p])=>[x,y,p.number,p.name,p.elec]);
    const saved=io.to_dsn({...drawing,sheets:[sheet]},true,true).tostring();const xml=new XMLBuilder();xml.fromText(saved);
    const restored=io.from_dsn(xml).sheets[0];assert.deepEqual(restored.items.map(signature),symbols.map(signature));
    const esp=restored.items[records.findIndex(r=>r.id==='esp32-devkitc-v4')],bme=restored.items[records.findIndex(r=>r.id==='adafruit-bme280')];
    const pairs=[['J1-1','JP2-1'],['J1-14','JP2-3'],['J3-3','JP2-4'],['J3-6','JP2-6']];
    const terminal=(s,n)=>new updateSymbol(s).active_points().find(p=>p[2].number===n);
    const wires=pairs.flatMap(([a,b],i)=>{
      const p=terminal(esp,a),q=terminal(bme,b),x=Math.max(p[0],q[0])+200+i*100;
      return [[[p[0],p[1]],[x,p[1]]],[[x,p[1]],[x,q[1]]],[[x,q[1]],[q[0],q[1]]]].map((points,j)=>({NodeName:'wire',_id:900000+i*3+j,d_points:points,_magnetic:null}));
    });
    const netlist=new NetlistGenerator();makeNetForDrawing({...drawing,sheets:[{...restored,items:[esp,bme,...wires]}]},netlist);
    const refs=[esp,bme].map(s=>s.text.find(t=>t.description==='Ref').value);
    const selected=[];
    for(const [a,b] of pairs){
      const net=Object.values(netlist.nets).find(n=>n.some(p=>p.reference===refs[0]&&p.pin===a));
      assert.ok(net?.some(p=>p.reference===refs[1]&&p.pin===b),'Intended ESP32/BME280 physical pair '+a+'/'+b);selected.push(net);
    }
    assert.equal(new Set(selected).size,4,'Power, ground, SDA and SCL must remain distinct nets');
  `);
});

test('eighteen mixed controller, sensor and display resources fit at native size on A4', async () => {
  const page = await layoutProofPage(result.records, embeddedProofIds);
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
