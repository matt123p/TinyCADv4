// Build review inputs from the actual bundled SQLite libraries. Final drawings
// are the public MCP auto-tidy results, never an independently edited copy.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { librarySqlite } from './lib/library-from-sql.mjs';
import { layoutRuntime } from './lib/layout-runtime.mjs';
import { recordDrawing } from './lib/layout-proof-page.mjs';
import { escapeXML } from './lib/layout-artwork.mjs';

const api = await layoutRuntime(),
  SQL = await librarySqlite();
const catalog = JSON.parse(
  await fs.readFile('bundled-libraries/config.json', 'utf8'),
);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const libraries = new Map();
const out = 'build/library-examples';
await fs.mkdir(out, { recursive: true });
for (const lib of catalog.libraries.filter((l) =>
  [
    'embedded-smart-home',
    'solar',
    'audio-music',
    'test-measurement',
    'motors-motion',
  ].includes(l.id),
)) {
  const bytes = await fs.readFile('bundled-libraries/' + lib.path);
  const db = new SQL.Database(bytes);
  const rows = db.exec(
    'SELECT n.NameID,n.SymbolID,n.Name,s.Data,n.Reference,n.Description FROM Name n JOIN Symbol s ON s.SymbolID=n.SymbolID',
  )[0].values;
  const provenance = JSON.parse(
    await fs.readFile(
      `bundled-libraries/${lib.id}/${lib.id}.provenance.json`,
      'utf8',
    ),
  );
  libraries.set(lib.id, {
    lib,
    hash: sha(bytes),
    rows,
    entries: provenance.entries,
  });
  db.close();
}
const font = `<FONT id="1"><HEIGHT>12</HEIGHT><WIDTH>0</WIDTH><WEIGHT>400</WEIGHT><ITALIC>0</ITALIC><UNDERLINE>0</UNDERLINE><STRIKEOUT>0</STRIKEOUT><CHARSET>0</CHARSET><FACENAME>Arial</FACENAME></FONT>`;
const resources =
  font +
  '<STYLE id="1"><STYLE>0</STYLE><THICKNESS>1</THICKNESS><COLOR>0</COLOR></STYLE>';
function nets(drawing) {
  const generator = new api.NetlistGenerator();
  api.makeNetForDrawing(drawing, generator);
  return Object.values(generator.nets)
    .map((n) =>
      [
        ...new Set(
          n
            .filter((p) => p.reference && p.pin)
            .map((p) => p.reference + ':' + p.pin),
        ),
      ].sort(),
    )
    .filter((n) => n.length > 1)
    .sort((a, b) => a.join().localeCompare(b.join()));
}
class Example {
  constructor(id, title, size = [297, 210]) {
    this.id = id;
    this.title = title;
    this.drawing = api.blank();
    this.sheet = this.drawing.sheets[0];
    this.sheet.name = title;
    this.sheet.details.title = title;
    this.sheet.details.page_size = size.map((n) => n * 5);
    this.sheet.details.show_details = false;
    this.sheet.details.show_guides = false;
    this.serial = 1;
    this.parts = {};
    this.defs = new Map();
    this.sources = [];
    this.annotations = [];
    this.note(15, 10, size[0] - 15, 21, title, 24);
  }
  async part(ref, library, id, x, y, caption) {
    const source = libraries.get(library);
    const entry =
      typeof id === 'number' ? null : source.entries.find((e) => e.id === id);
    assert.ok(entry || typeof id === 'number', `Missing ${library}/${id}`);
    const row = source.rows.find((r) =>
      entry ? r[2] === entry.name : r[0] === id,
    );
    assert.ok(row, `Missing SQLite symbol ${id}`);
    const xml = new TextDecoder().decode(row[3]);
    if (entry) assert.equal(sha(xml), entry.xmlSha256);
    const key = library + '/' + row[0];
    const parsed = await recordDrawing(api, {
      xml,
      device: { id: key, name: row[2] },
      width: 0,
      height: 0,
      autoReference: true,
    });
    const symbol = parsed.sheets[0].items.find((i) => i.NodeName === 'symbol');
    if (!this.defs.has(key)) {
      symbol._symbol.id = this.defs.size + 1;
      symbol._symbol.ref.value = row[4];
      symbol._symbol.description = row[5];
      this.defs.set(key, symbol._symbol);
    }
    symbol._symbol = this.defs.get(key);
    symbol._id = this.serial++;
    const anchor = symbol._symbol.outlines[0].ref_point;
    symbol.point = [x * 5 + anchor[0], y * 5 + anchor[1]];
    symbol._active_points = null;
    symbol.text.find((t) => t.description === 'Ref').value = ref;
    this.sheet.items.push(symbol);
    this.parts[ref] = symbol;
    this.sources.push({
      reference: ref,
      library,
      libraryPath: source.lib.path,
      librarySha256: source.hash,
      componentId: entry?.id,
      nameId: row[0],
      symbolId: row[1],
      name: row[2],
      xmlSha256: sha(xml),
    });
    if (caption) {
      const text = `${ref}: ${caption}`;
      this.note(
        x - 2,
        y - 12,
        Math.min(
          this.sheet.details.page_size[0] / 5 - 12,
          x - 2 + text.length * 1.6,
        ),
        y - 7,
        text,
        12,
      );
    }
    return symbol;
  }
  pin(ref, number) {
    const p = new api.updateSymbol(this.parts[ref])
      .active_points()
      .find((p) => p[2].number === String(number));
    assert.ok(p, `Missing ${ref}:${number}`);
    return [p[0] / 5, p[1] / 5];
  }
  wire(...points) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      assert.ok(a[0] === b[0] || a[1] === b[1], 'Orthogonal wiring required');
      this.sheet.items.push({
        NodeName: 'wire',
        _id: this.serial++,
        d_points: [a.map((n) => n * 5), b.map((n) => n * 5)],
      });
    }
  }
  note(x, y, x2, y2, text, size = 12) {
    this.annotations.push(
      `<NOTE_TEXT a="${x},${y}" b="${x2},${y2}" font="1" color="453626" style="1" fill="0" direction="3" border_style="2" data-size="${size}">${escapeXML(
        text,
      )}</NOTE_TEXT>`,
    );
  }
  label(point, text, direction = 3) {
    this.annotations.push(
      `<LABEL pos="${point}" direction="${direction}" font="1" style="0">${escapeXML(
        text,
      )}</LABEL>`,
    );
  }
  power(point, text) {
    this.annotations.push(
      `<POWER pos="${point}" direction="${text === '0' ? 1 : 0}" which="${
        text === '0' ? 4 : 0
      }">${escapeXML(text)}</POWER>`,
    );
  }
  junction(point) {
    this.annotations.push(`<JUNCTION pos="${point}"/>`);
  }
  tail(ref, pin, points, name, direction = 3) {
    this.wire(this.pin(ref, pin), ...points);
    if (name === '0' || name === '3V3' || name === 'VMOTOR')
      this.power(points.at(-1), name);
    else this.label(points.at(-1), name, direction);
  }
  async save(expected) {
    // Parse annotations with the real reader, giving their resolved style/font
    // properties to the writer so resources are remapped across all symbols.
    for (const annotation of this.annotations) {
      const size = Number(annotation.match(/data-size="(\d+)"/)?.[1] || 12);
      const xml = `<TinyCADSheets><TinyCAD>${resources.replace(
        '<HEIGHT>12</HEIGHT>',
        `<HEIGHT>${size}</HEIGHT>`,
      )}${annotation.replace(
        / data-size="\d+"/,
        '',
      )}</TinyCAD></TinyCADSheets>`;
      const d = await api.decodeDrawing(new TextEncoder().encode(xml));
      for (const item of d.sheets[0].items) {
        item._id = this.serial++;
        this.sheet.items.push(item);
      }
    }
    const wanted = expected
      .map((n) => n.sort())
      .sort((a, b) => a.join().localeCompare(b.join()));
    assert.deepEqual(
      nets(this.drawing),
      wanted,
      `${this.id}: draft connects exact intended pins`,
    );
    let xml = new TextDecoder().decode(
      await api.encodeDrawing(this.drawing, 'xml'),
    );
    // The native codec emits reserved resource zero as an empty FONT. The public
    // schema requires complete resources even for the unused reserved entry.
    xml = xml.replace(/<FONT id="0"\s*\/>/, font.replace('id="1"', 'id="0"'));
    xml = xml
      .replace(
        /<(WIDTH|ITALIC|UNDERLINE|STRIKEOUT|CHARSET|STYLE)\s*\/>/g,
        '<$1>0</$1>',
      )
      .replace(/<DSNIDENTITY\b[^>]*\/>/g, '')
      .replace(/<TinyCAD id="[^"]*">/g, '<TinyCAD>');
    const restored = await api.decodeDrawing(new TextEncoder().encode(xml));
    assert.deepEqual(
      nets(restored),
      wanted,
      'Native save/load preserves topology',
    );
    await fs.writeFile(`${out}/${this.id}-draft.dsn`, xml);
    return {
      id: this.id,
      title: this.title,
      page: this.sheet.details.page_size.map((n) => n / 5),
      sources: this.sources,
      expectedNets: wanted,
      draftSha256: sha(xml),
    };
  }
}
const examples = [];
{
  const e = new Example(
    'embedded-climate-station',
    'ESP32 climate and display station',
  );
  await e.part(
    'U1',
    'embedded-smart-home',
    'esp32-devkitc-v4',
    35,
    50,
    'ESP32 DevKitC V4',
  );
  await e.part(
    'ENV1',
    'embedded-smart-home',
    'adafruit-bme280',
    145,
    50,
    'BME280 breakout',
  );
  await e.part('DISP1', 'embedded-smart-home', 'display-oled12864', 175, 135);
  e.note(173, 125, 213, 132, 'DISP1: OLED front / rear');
  e.tail('U1', 'J1-1', [[25, 56]], '3V3');
  e.tail('U1', 'J1-14', [[25, 82]], '0');
  e.tail('U1', 'J3-3', [[85, 60]], 'SCL');
  e.tail('U1', 'J3-6', [[85, 66]], 'SDA');
  e.tail(
    'ENV1',
    'JP2-1',
    [
      [149, 80],
      [132, 80],
    ],
    '3V3',
  );
  e.wire(e.pin('ENV1', 'JP2-3'), [153, 86], [159, 86], e.pin('ENV1', 'JP2-5'));
  e.wire([153, 86], [140, 86]);
  e.junction([153, 86]);
  e.power([140, 86], '0');
  e.tail('ENV1', 'JP2-4', [[155, 112]], 'SCL', 1);
  e.tail('ENV1', 'JP2-6', [[161, 112]], 'SDA', 1);
  e.tail(
    'DISP1',
    'I2C-4',
    [
      [223, 100],
      [210, 100],
    ],
    'SDA',
    2,
  );
  e.tail(
    'DISP1',
    'I2C-3',
    [
      [225, 90],
      [210, 90],
    ],
    'SCL',
    2,
  );
  e.tail(
    'DISP1',
    'I2C-2',
    [
      [227, 114],
      [245, 114],
    ],
    '0',
  );
  e.tail(
    'DISP1',
    'I2C-1',
    [
      [229, 106],
      [260, 106],
    ],
    '3V3',
  );
  e.note(
    20,
    128,
    145,
    166,
    'Matching SDA / SCL labels form the I2C bus.\nGPIO21 = SDA; GPIO22 = SCL.\nENV1 SDO is grounded: address 0x76.\nUSB powers U1; both modules use its 3V3 rail.',
  );
  e.note(
    20,
    183,
    280,
    201,
    'PCB wiring example. Spare headers, ENV1 3Vo and CS are open intentionally.\nConfigure the OLED address and firmware for the named boards. See Explanation for the full pin table.',
  );
  examples.push(
    await e.save([
      ['U1:J1-1', 'ENV1:JP2-1', 'DISP1:I2C-1'],
      ['U1:J1-14', 'ENV1:JP2-3', 'ENV1:JP2-5', 'DISP1:I2C-2'],
      ['U1:J3-3', 'ENV1:JP2-4', 'DISP1:I2C-3'],
      ['U1:J3-6', 'ENV1:JP2-6', 'DISP1:I2C-4'],
    ]),
  );
}
{
  const e = new Example(
    'solar-battery-home',
    'Home solar and battery plan',
    [420, 297],
  );
  const p = (ref, id, x, y, caption) => e.part(ref, 'solar', id, x, y, caption);
  await p('PV1', 2, 20, 50, 'Rooftop solar array');
  await p('PVISO1', 34, 125, 50, 'PV DC isolation');
  await p('INV1', 13, 230, 90, 'Hybrid inverter');
  await p('BAT1', 8, 20, 145, 'Wall battery');
  await p('BISO1', 35, 125, 145, 'Battery isolation');
  await p('ACISO1', 33, 335, 90, 'AC isolation');
  await p('GRID1', 22, 20, 215, 'Electricity grid');
  await p('METER1', 23, 125, 215, 'Meter');
  await p('CU1', 28, 230, 215, 'Home fuse box');
  await p('HOME1', 48, 335, 215, 'Household loads');
  e.wire(e.pin('PV1', 'PV_DC'), e.pin('PVISO1', 'PV_IN'));
  e.wire(
    e.pin('PVISO1', 'PV_OUT'),
    [210, 62],
    [210, 102],
    e.pin('INV1', 'PV_DC'),
  );
  e.wire(e.pin('BAT1', 'BATT_DC'), e.pin('BISO1', 'BATT_IN'));
  e.wire(
    e.pin('BISO1', 'BATT_OUT'),
    [216, 157],
    [216, 118],
    e.pin('INV1', 'BATT_DC'),
  );
  e.wire(e.pin('INV1', 'HOME_AC'), e.pin('ACISO1', 'AC_IN'));
  e.wire(
    e.pin('ACISO1', 'AC_OUT'),
    [410, 102],
    [410, 190],
    [210, 190],
    [210, 243],
    e.pin('CU1', 'SOLAR_AC'),
  );
  e.wire(e.pin('GRID1', 'GRID_AC'), e.pin('METER1', 'GRID_AC'));
  e.wire(e.pin('METER1', 'HOME_AC'), e.pin('CU1', 'AC_IN'));
  e.wire(e.pin('CU1', 'HOME'), e.pin('HOME1', 'HOME_AC'));
  e.note(
    20,
    22,
    400,
    37,
    'Energy flows: PV and battery connect to the hybrid inverter; its AC connection joins the home distribution board.\nThe grid/meter branch supplies the same distribution board. Each endpoint represents a whole cable.',
  );
  e.note(
    20,
    265,
    400,
    286,
    'Conceptual planning example, not an installation or protection design. Spare backup, EV and battery data ports are open.\nBattery BMS compatibility, earthing, protection, cable ratings and export controls depend on the actual system. See Explanation.',
  );
  examples.push(
    await e.save([
      ['PV1:PV_DC', 'PVISO1:PV_IN'],
      ['PVISO1:PV_OUT', 'INV1:PV_DC'],
      ['BAT1:BATT_DC', 'BISO1:BATT_IN'],
      ['BISO1:BATT_OUT', 'INV1:BATT_DC'],
      ['INV1:HOME_AC', 'ACISO1:AC_IN'],
      ['ACISO1:AC_OUT', 'CU1:SOLAR_AC'],
      ['GRID1:GRID_AC', 'METER1:GRID_AC'],
      ['METER1:HOME_AC', 'CU1:AC_IN'],
      ['CU1:HOME', 'HOME1:HOME_AC'],
    ]),
  );
}
{
  const e = new Example('podcast-studio', 'Two-person podcast studio');
  await e.part('MIC1', 'audio-music', 'mic-dynamic', 20, 38, 'Host microphone');
  await e.part(
    'MIC2',
    'audio-music',
    'mic-dynamic',
    20,
    94,
    'Guest microphone',
  );
  await e.part(
    'MIX1',
    'audio-music',
    'mixer-podcast-4',
    110,
    50,
    'Podcast mixer',
  );
  await e.part('HP1', 'audio-music', 'headphones', 230, 56, 'Host headphones');
  await e.part('HP2', 'audio-music', 'headphones', 230, 104);
  e.note(230, 145, 282, 150, 'HP2: Guest headphones');
  await e.part(
    'PC1',
    'audio-music',
    'computer-laptop',
    25,
    150,
    'Recording laptop',
  );
  e.wire(e.pin('MIC1', '1'), [72, 68], [72, 56], e.pin('MIX1', '1'));
  e.wire(
    e.pin('MIC2', '1'),
    [80, 124],
    [80, 48],
    [122, 48],
    e.pin('MIX1', '2'),
  );
  e.wire(
    e.pin('MIX1', '5'),
    [94, 66],
    [94, 126],
    [224, 126],
    [224, 86],
    e.pin('HP1', '1'),
  );
  e.wire(
    e.pin('MIX1', '6'),
    [100, 66],
    [100, 140],
    [220, 140],
    [220, 134],
    e.pin('HP2', '1'),
  );
  e.wire(
    e.pin('MIX1', '11'),
    [88, 74],
    [88, 198],
    [15, 198],
    [15, 186],
    e.pin('PC1', '1'),
  );
  e.note(
    120,
    156,
    278,
    194,
    'MIC1 / MIC2: balanced XLR microphone cables.\nHP1 / HP2: separate stereo headphone feeds.\nUSB: MIX1 to PC1, carrying recording/playback audio.\nUse the mixer headphone monitoring to avoid delay.\nEquipment power and software setup are described in Explanation.',
  );
  examples.push(
    await e.save([
      ['MIC1:1', 'MIX1:1'],
      ['MIC2:1', 'MIX1:2'],
      ['MIX1:5', 'HP1:1'],
      ['MIX1:6', 'HP2:1'],
      ['MIX1:11', 'PC1:1'],
    ]),
  );
}
{
  const e = new Example('lab-measurement-bench', 'DC load and waveform bench');
  await e.part('PSU1', 'test-measurement', 'psu-1', 20, 38, 'DC supply');
  await e.part(
    'DMM1',
    'test-measurement',
    'dmm-bench',
    115,
    38,
    'Voltmeter: HI / LO',
  );
  await e.part(
    'LOAD1',
    'test-measurement',
    'load-1',
    210,
    38,
    'Electronic DC load',
  );
  await e.part(
    'GEN1',
    'test-measurement',
    'generator-1',
    35,
    133,
    'Waveform generator',
  );
  await e.part(
    'SCOPE1',
    'test-measurement',
    'scope-2',
    190,
    129,
    'Oscilloscope',
  );
  e.wire(e.pin('PSU1', '1'), [24, 96], [214, 96], e.pin('LOAD1', '1'));
  e.wire(e.pin('DMM1', '1'), [119, 96]);
  e.junction([119, 96]);
  e.wire(e.pin('PSU1', '2'), [30, 106], [220, 106], e.pin('LOAD1', '2'));
  e.wire(e.pin('DMM1', '2'), [125, 106]);
  e.junction([125, 106]);
  e.wire(e.pin('GEN1', '1'), [39, 184], [194, 184], e.pin('SCOPE1', '1'));
  e.note(
    20,
    112,
    175,
    119,
    'DMM: voltage mode, HI / LO in parallel; current socket unused.\nCrossings join only where a dot is shown.',
  );
  e.note(
    20,
    191,
    280,
    204,
    'Set suitable supply current/voltage limits and load ratings. GEN1 OUT1 to SCOPE1 CH1 is one complete BNC coax cable.\nNo automatic chassis-earth bond or SPICE instrument model is implied. See Explanation for settings and extensions.',
  );
  examples.push(
    await e.save([
      ['PSU1:1', 'LOAD1:1', 'DMM1:1'],
      ['PSU1:2', 'LOAD1:2', 'DMM1:2'],
      ['GEN1:1', 'SCOPE1:1'],
    ]),
  );
}
{
  const e = new Example(
    'motor-control-bench',
    'DC motor and limit-control bench',
  );
  await e.part(
    'U1',
    'embedded-smart-home',
    'esp32-devkitc-v4',
    45,
    45,
    'USB-powered ESP32',
  );
  await e.part(
    'DRV1',
    'motors-motion',
    'driver-brushed',
    130,
    55,
    'PWM / direction driver',
  );
  await e.part(
    'M1',
    'motors-motion',
    'motor-planetary',
    220,
    55,
    'Geared DC motor',
  );
  await e.part('PSU1', 'test-measurement', 'psu-1', 120, 145, 'Motor supply');
  await e.part(
    'LIMIT1',
    'motors-motion',
    'limit-roller',
    35,
    135,
    'Normally-closed limit',
  );
  e.tail('U1', 'J1-14', [[35, 77]], '0');
  e.tail('U1', 'J1-9', [[28, 67]], 'ENABLE', 2);
  e.tail('U1', 'J1-11', [[16, 71]], 'LIMIT_NC', 2);
  e.tail(
    'U1',
    'J3-9',
    [
      [86, 67],
      [86, 75],
      [90, 75],
    ],
    'PWM',
  );
  e.tail(
    'U1',
    'J3-8',
    [
      [82, 65],
      [82, 57],
      [90, 57],
    ],
    'DIR',
  );
  e.tail(
    'DRV1',
    '1',
    [
      [104, 81],
      [104, 70],
    ],
    'VMOTOR',
  );
  e.tail(
    'DRV1',
    '2',
    [
      [140, 85],
      [120, 85],
      [120, 110],
    ],
    '0',
  );
  e.wire(e.pin('DRV1', '3'), [146, 104], [224, 104], e.pin('M1', '1'));
  e.wire(e.pin('DRV1', '4'), [152, 98], [230, 98], e.pin('M1', '2'));
  e.tail('DRV1', '5', [[158, 118]], 'PWM', 1);
  e.tail('DRV1', '6', [[164, 118]], 'DIR', 1);
  e.tail(
    'DRV1',
    '7',
    [
      [134, 122],
      [100, 122],
    ],
    'ENABLE',
    2,
  );
  e.tail('DRV1', '8', [[140, 118]], '0');
  e.tail(
    'PSU1',
    '1',
    [
      [108, 173],
      [108, 160],
    ],
    'VMOTOR',
  );
  e.tail(
    'PSU1',
    '2',
    [
      [130, 179],
      [116, 179],
      [116, 184],
    ],
    '0',
  );
  e.tail('LIMIT1', '1', [[39, 180]], '0');
  e.tail('LIMIT1', '2', [[47, 180]], 'LIMIT_NC', 1);
  e.note(
    202,
    128,
    280,
    182,
    'Matching labels join control nets.\nGPIO18: PWM\nGPIO19: direction\nGPIO25: enable\nGPIO27: NC limit, input pull-up\nCommon 0 is the signal return.',
  );
  e.note(
    20,
    200,
    280,
    208,
    'Use a 3.3V-compatible driver and matching motor/supply ratings. Firmware starts disabled and stops on an open NC limit.\nThis is a wiring layout, with no firmware, motion simulation or certified emergency-stop function. See Explanation.',
  );
  examples.push(
    await e.save([
      ['PSU1:1', 'DRV1:1'],
      ['PSU1:2', 'DRV1:2', 'DRV1:8', 'U1:J1-14', 'LIMIT1:1'],
      ['DRV1:3', 'M1:1'],
      ['DRV1:4', 'M1:2'],
      ['DRV1:5', 'U1:J3-9'],
      ['DRV1:6', 'U1:J3-8'],
      ['DRV1:7', 'U1:J1-9'],
      ['LIMIT1:2', 'U1:J1-11'],
    ]),
  );
}
await fs.writeFile(
  `${out}/sources.json`,
  JSON.stringify({ version: 1, examples }, null, 2) + '\n',
);
console.log(
  `Built ${examples.length} connected library examples for MCP review in ${out}`,
);
