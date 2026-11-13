import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { layoutRuntime } from './layout-runtime.mjs';
import { escapeXML } from './layout-artwork.mjs';
const { DOMParser, XMLSerializer } = createRequire(import.meta.url)(
  'common-xml-features',
);

export async function recordDrawing(api, record) {
  const doc = new DOMParser().parseFromString(record.xml, 'text/xml');
  const nodes = Array.from(doc.documentElement.childNodes).filter(
    (n) => n.nodeType === 1,
  );
  const resource = (n) => ['FONT', 'STYLE', 'FILL'].includes(n.nodeName),
    serial = (n) => new XMLSerializer().serializeToString(n);
  return api.decodeDrawing(
    new TextEncoder().encode(
      `<TinyCADSheets><TinyCAD><NAME>Layout</NAME>${nodes
        .filter(resource)
        .map(serial)
        .join('')}<SYMBOLDEF id="1"><NAME type="1">${escapeXML(
        record.device.name,
      )}</NAME><GUID>${
        record.device.id
      }</GUID><REF type="1">A?</REF><DESCRIPTION>Native layout review</DESCRIPTION><PPP>1</PPP>${
        record.autoReference
          ? ''
          : `<REF_POINT pos="${record.width},${record.height}" power="0" part="1"/>`
      }<TinyCAD>${nodes
        .filter((n) => !resource(n))
        .map(serial)
        .join('')}</TinyCAD></SYMBOLDEF><SYMBOL id="1" pos="${record.width},${
        record.height
      }" part="0" rotate="0" show_power="0" can_scale="0" scale_x="1" scale_y="1"><FIELD pos="0,0" value="A1" description="Ref" type="1" show="0"/></SYMBOL></TinyCAD></TinyCADSheets>`,
    ),
  );
}

export async function layoutProofPage(records, ids) {
  const api = await layoutRuntime(),
    drawing = api.blank(),
    sheet = drawing.sheets[0];
  const page = { width: 1485, height: 1050, margin: 50, gap: 30 }; // A4 landscape, 5 units/mm.
  sheet.details.page_size = [page.width, page.height];
  const rows = [];
  const placements = [];
  const ordered = [];
  for (const id of ids) {
    const r = records.find((r) => r.device.id === id);
    assert.ok(r, 'Missing proof symbol ' + id);
    const parsed = await recordDrawing(api, r),
      symbol = parsed.sheets[0].items[0];
    const b = api.circuitBounds(parsed.sheets[0]),
      width = b.x2 - b.x1,
      height = b.y2 - b.y1;
    ordered.push({ id, symbol, b, width, height });
  }
  ordered.sort((a, b) => b.height - a.height);
  for (const [i, { id, symbol, b, width, height }] of ordered.entries()) {
    // Fill gaps in earlier rows before opening another row. No symbol scaling.
    let row = rows.find((r) => r.nextX + width <= page.width - page.margin);
    if (!row) {
      const last = rows.at(-1);
      row = {
        nextX: page.margin,
        y: last ? last.y + last.height + page.gap : 80,
        height,
      };
      rows.push(row);
    }
    const x = row.nextX,
      y = row.y;
    assert.ok(
      y + height <= page.height - page.margin,
      `${id} must fit A4 at native placement size`,
    );
    symbol._id = i + 1;
    symbol._symbol.id = String(i + 1);
    symbol.text.find((t) => t.description === 'Ref').value = 'A' + (i + 1);
    symbol.point = [symbol.point[0] + x - b.x1, symbol.point[1] + y - b.y1];
    symbol._active_points = null;
    sheet.items.push(symbol);
    placements.push({ id, x, y, width, height });
    row.nextX += Math.ceil(width / 10) * 10 + page.gap;
  }
  const bounds = api.circuitBounds(sheet);
  assert.ok(
    bounds.x1 >= page.margin - 1 &&
      bounds.x2 <= page.width - page.margin + 1 &&
      bounds.y2 <= page.height - page.margin + 1,
  );
  // Use the real codec so the proof is also an editable native drawing.
  const dsn = await api.encodeDrawing(drawing),
    restored = await api.decodeDrawing(dsn);
  assert.equal(restored.sheets[0].items.length, ids.length);
  assert.deepEqual(restored.sheets[0].details.page_size, [
    page.width,
    page.height,
  ]);
  assert.deepEqual(api.circuitBounds(restored.sheets[0]), bounds);
  let svg = api.renderCircuit(restored.sheets[0], {
    x1: 0,
    y1: 0,
    x2: page.width - 40,
    y2: page.height - 40,
  });
  svg = svg.replace(
    /<\/svg>$/,
    `<rect x="0" y="0" width="1445" height="1010" fill="none" stroke="#acbac4"/><text x="30" y="30" font-family="Arial" font-size="14" fill="#263645">A4 landscape — ${ids.length} components at native placement size</text></svg>`,
  );
  return { page, placements, dsn, svg };
}

export const embeddedProofIds = [
  'esp32-devkitc-v4',
  'raspberry-pi-4',
  'arduino-uno',
  'arduino-nano',
  'lolin-d1-mini',
  'nodemcu-esp8266',
  'adafruit-bme280',
  'adafruit-sht31',
  'grove-pir',
  'hc-sr04',
  'grove-buzzer',
  'grove-ldr',
  'adafruit-bh1750',
  'gravity-relay',
  'gravity-soil',
  'grove-water',
  'grove-button',
  'display-oled12864',
];
export const audioProofIds = [
  'mixer-analog-8',
  'mic-dynamic',
  'mic-condenser',
  'speaker-pa-active',
  'speaker-monitor-active',
  'interface-2',
  'computer-laptop',
  'headphones',
  'di-passive',
  'instrument-electric',
  'keyboard-49',
  'amp-power-stereo',
  'iem-transmitter',
  'wireless-receiver-2',
  'connector-xlr-f',
  'connector-trs-balanced',
  'connector-midi-din',
  'adapter-stereo-breakout',
];

export const testMeasurementProofIds = [
  'scope-4',
  'psu-2',
  'dmm-bench',
  'daq-8',
  'dmm-handheld',
  'probe-tc-immersion',
  'probe-rtd-4',
  'probe-passive',
  'heater-cartridge',
  'heater-mat',
  'peltier',
  'relay-spdt',
  'relay-ssr',
  'hotplate-stirrer',
  'beaker',
  'bnc-tee',
  'bnc-terminator',
  'terminal-block-8',
];

export const motorsMotionProofIds = [
  'motor-microgear',
  'motor-encoder',
  'motor-bldc-outrunner',
  'stepper-nema17',
  'servo-micro',
  'servo-standard',
  'servo-smart-ttl',
  'driver-a4988',
  'driver-tb6612',
  'encoder-ab',
  'encoder-magnetic-i2c',
  'limit-roller',
  'limit-inductive-npn',
  'solenoid-frame',
  'actuator-linear',
  'mechanical-wheel',
];
