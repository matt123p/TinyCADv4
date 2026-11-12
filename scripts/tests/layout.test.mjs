import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFile } from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();

async function amplifierFixture(name = 'amplifier.dsn') {
  const xml = new api.XMLBuilder();
  xml.fromText(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
  return new api.ioXML().from_dsn(xml).sheets[0];
}

function assertTransistorExits(sheet) {
  const transistors = sheet.items.filter(i => i.NodeName === 'symbol' &&
    i.text.some(t => t.description === 'Ref' && ['Q1', 'Q2'].includes(t.value)));
  assert.equal(transistors.length, 2, 'fixture includes both transistors from the reported circuit');
  for (const symbol of transistors) {
    const bounds = api.bodyRect(symbol);
    const centre = [(bounds.x1 + bounds.x2) / 2, (bounds.y1 + bounds.y2) / 2];
    for (const pin of api.pins(symbol)) {
      const incident = sheet.items.filter(i => i.NodeName === 'wire' &&
        i.d_points.some(p => p[0] === pin.p[0] && p[1] === pin.p[1]));
      assert.ok(incident.length, 'transistor pin must remain wired');
      for (const wire of incident) {
        const other = wire.d_points.find(p => p[0] !== pin.p[0] || p[1] !== pin.p[1]);
        assert.ok((other[0] - pin.p[0]) * (pin.p[0] - centre[0]) +
          (other[1] - pin.p[1]) * (pin.p[1] - centre[1]) > 0,
        'wire must leave transistor artwork instead of doubling back into it');
      }
    }
  }
}

test('a label at an explicit junction can fit an incident wire without moving the branch', () => {
  const input = sheet(
    wire(1, [100, 100], [200, 100]),
    wire(2, [100, 100], [100, 200]),
    { NodeName: 'junction', _id: 3, point: [100, 100] },
    label(4, [100, 100], 'BASE'),
  );
  const r = solve(input, { phases: ['net-labels'], lockedIds: [1, 2, 3] });
  assert.ok(r.before.metrics.labelOverhangs > 0);
  assert.equal(r.after.metrics.labelOverhangs, 0);
  assert.ok(r.changes.every(c => c.id === 4));
});

test('a label on an unjoined crossing retains its exact electrical anchor', () => {
  const input = sheet(
    wire(1, [0, 100], [200, 100]),
    wire(2, [100, 0], [100, 200]),
    label(3, [100, 100], 'BASE'),
  );
  const r = solve(input, { phases: ['net-labels'] });
  assert.deepEqual(r.sheet.items.find(i => i._id === 3).point, [100, 100]);
  assert.equal(r.changes.length, 0);
});

for (const disturbance of ['low', 'medium', 'high']) {
  test(`the actual amplifier does not acquire transistor pin loops at ${disturbance} strength`, async () => {
    const input = await amplifierFixture();
    assertTransistorExits(input);
    const r = solve(input, { disturbance });
    assertTransistorExits(r.sheet);
  });

  test(`the actual amplifier's existing pin loops are removed at ${disturbance} strength`, async () => {
    const input = await amplifierFixture('amplifier-with-pin-loops.dsn');
    assert.throws(() => assertTransistorExits(input), /doubling back/);
    const r = solve(input, { disturbance });
    assertTransistorExits(r.sheet);
    assert.ok(r.after.metrics.bends < r.before.metrics.bends);
    assert.ok(r.after.metrics.wireLength < r.before.metrics.wireLength);
  });
}

test('hidden transistor connection points have no rendered stem or inward lead constraint', async () => {
  const sheet = await amplifierFixture();
  const original = sheet.items.find(i => i.NodeName === 'symbol' && i.text.some(t => t.value === 'Q2'));
  for (let rotation = 0; rotation < 8; rotation++) {
    for (const [scale_x, scale_y] of [[1, 1], [-1, 1], [2, 0.5]]) {
      const symbol = api.refresh({ ...original, rotation, scale_x, scale_y });
      const body = api.bodyRect(symbol);
      for (const pin of api.pins(symbol)) {
        assert.equal(pin.length, 0, 'the hidden pin length in the file is not visible artwork');
        const dx = pin.p[0] - (body.x1 + body.x2) / 2;
        const dy = pin.p[1] - (body.y1 + body.y2) / 2;
        assert.ok(dx * pin.direction[0] + dy * pin.direction[1] >= 0);
      }
      const artwork = api.symbolArtwork(symbol);
      assert.deepEqual(artwork.obstacles, [artwork.body], 'undrawn pin stems and pin names reserve no space');
    }
  }
  assert.ok(original._symbol.outlines[0].active_points.every(p => p.pin.which === 5 && p.pin.length === 30),
    'the native symbol metadata must stay intact');
});
const font = {
  font_name: 'Arial',
  font_size: 9,
  font_bold: false,
  font_italic: false,
  font_colour: '#ff0000',
};
const wire = (id, ...ps) => ({
  NodeName: 'wire',
  _id: id,
  d_points: ps,
  _magnetic: null,
});
const label = (id, p, text = 'OUT') =>
  api.refresh({
    ...font,
    NodeName: 'label',
    _id: id,
    point: p,
    text,
    rotation: 0,
    which: 0,
    textData: null,
  });
const sheet = (...items) => ({
  ...api.blank().sheets[0],
  items,
  details: { ...api.blank().sheets[0].details, grid: 5 },
});
function symbol(
  id,
  x,
  y,
  {
    width = 40,
    height = 20,
    ports = [
      [-40, -10, 0],
      [0, -10, 2],
    ],
    showText = true,
    rotation = 0,
  } = {},
) {
  const active_points = ports.map(([px, py, r], i) => ({
    pos: [px, py],
    part: 0,
    power: false,
    pin: {
      ...font,
      NodeName: 'pin',
      _id: 10000 + id * 10 + i,
      point: [px, py],
      rotation: r,
      name: '',
      number: String(i + 1),
      length: 5,
      which: 0,
      elec: 4,
      part: 0,
      show_name: false,
      show_number: false,
    },
  }));
  return api.refresh({
    ...font,
    NodeName: 'symbol',
    _id: id,
    point: [x, y],
    rotation,
    scale_x: 1,
    scale_y: 1,
    part: 0,
    show_power: false,
    allow_resize: false,
    hints: [],
    _active_points: null,
    textData: [],
    text: [
      {
        description: 'Ref',
        value: 'R' + id,
        show: showText,
        display: 0,
        position: [-30, -15],
      },
      {
        description: 'Value',
        value: '1k',
        show: showText,
        display: 0,
        position: [-30, -5],
      },
      {
        description: '$$SPICE',
        value: 'private simulation data',
        show: false,
        display: 0,
        position: [0, 0],
      },
    ],
    _symbol: {
      id,
      uid: 'test-' + id,
      parts: 1,
      heterogeneous: false,
      name: { value: 'Test', type: 0 },
      ref: { value: 'R', type: 0 },
      outlines: [
        { items: [], size: [width, height], ref_point: [0, 0], active_points },
      ],
    },
  });
}
function solve(s, o = {}) {
  const original = JSON.stringify(s),
    result = api.optimiseLayout(s, { disturbance: 'high', ...o });
  assert.ok(
    JSON.stringify(s) === original,
    'must not mutate caller-owned sheet or symbol caches',
  );
  assert.ok(
    api.sameConnectivity(s, result.sheet, result.wireOrigins),
    'physical and electrical partitions',
  );
  assert.ok(
    result.sheet.items
      .filter((i) => i.NodeName === 'wire')
      .every((w) => w.d_points.length === 2),
    'native segment representation',
  );
  for (const key of [
    'bodyCollisions',
    'wireBodyCollisions',
    'crossings',
    'overlaps',
    'diagonalSegments',
    'pinExitViolations',
    'textCollisions',
    'labelOverhangs',
  ])
    assert.ok(result.after.metrics[key] <= result.before.metrics[key], key);
  const textCodes = new Set(['text-wire', 'text-body', 'text-overlap']);
  const pairKey = (d, origins = {}) =>
    d.code +
    ':' +
    d.itemIds
      .map((id) => origins[id] ?? id)
      .sort((a, b) => a - b)
      .join(',');
  const originalPairs = new Set(
    result.before.diagnostics
      .filter((d) => textCodes.has(d.code))
      .map((d) => pairKey(d)),
  );
  for (const d of result.after.diagnostics.filter((d) => textCodes.has(d.code)))
    assert.ok(
      originalPairs.has(pairKey(d, result.wireOrigins)),
      'must not trade an old text collision for a new pair',
    );
  return result;
}

test('symbol labels avoid all four pin sides and preserve hidden fields', () => {
  const s = symbol(1, 100, 100, {
    width: 40,
    height: 40,
    ports: [
      [-40, -20, 0],
      [0, -20, 2],
      [-20, -40, 1],
      [-20, 0, 3],
    ],
  });
  const input = sheet(
    s,
    wire(2, [60, 80], [20, 80]),
    wire(3, [100, 80], [140, 80]),
    wire(4, [80, 60], [80, 20]),
    wire(5, [80, 100], [80, 140]),
  );
  const r = solve(input, { selectedIds: [1] });
  assert.equal(r.after.metrics.textCollisions, 0);
  assert.deepEqual(r.sheet.items[0].text[2], s.text[2]);
  assert.ok(r.after.metrics.labelDistance < 50);
});

test('pin exits project outward before bending, including rotated and mirrored symbols', () => {
  for (const rotation of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const s = symbol(1, 100, 100, { rotation, showText: false }),
      p = api.pins(s)[1];
    const turn = [p.p[0] + p.direction[1] * 70, p.p[1] + p.direction[0] * 70];
    const end = [turn[0] + p.direction[0] * 80, turn[1] + p.direction[1] * 80];
    const r = solve(sheet(s, wire(2, p.p, turn, end)), { selectedIds: [2] });
    assert.equal(r.after.metrics.pinExitViolations, 0, 'rotation ' + rotation);
    assert.deepEqual(r.sheet.items[0].point, s.point);
  }
});

test('plain labels fit entirely on their wire and extend short free stubs', () => {
  const input = sheet(
    wire(1, [100, 100], [105, 100]),
    label(2, [105, 100], 'LONG_SIGNAL_NAME'),
  );
  const r = solve(input);
  assert.equal(r.after.metrics.labelOverhangs, 0);
  assert.ok(r.after.metrics.wireLength > r.before.metrics.wireLength);
});

test('centres an inline component and compacts oversized wiring without scaling', () => {
  const s = symbol(1, 120, 100, { showText: false });
  const input = sheet(
    s,
    wire(2, [0, 90], [80, 90]),
    wire(3, [120, 90], [400, 90]),
  );
  const r = solve(input);
  assert.ok(r.after.metrics.wireLength < r.before.metrics.wireLength * 0.6);
  assert.ok(r.after.metrics.inlineImbalance <= 10);
  assert.equal(r.sheet.items.find((i) => i._id === 1).scale_x, 1);
  assert.equal(r.sheet.items.find((i) => i._id === 1).scale_y, 1);
});

test('adds dots only to already connected branches; unjoined crossings stay separate', () => {
  const branch = solve(
    sheet(
      wire(1, [0, 50], [50, 50]),
      wire(2, [50, 50], [100, 50]),
      wire(3, [50, 50], [50, 100]),
    ),
  );
  assert.equal(
    branch.sheet.items.filter((i) => i.NodeName === 'junction').length,
    1,
  );
  const crossing = solve(
    sheet(wire(1, [0, 50], [100, 50]), wire(2, [50, 0], [50, 100])),
  );
  assert.equal(
    crossing.sheet.items.filter((i) => i.NodeName === 'junction').length,
    0,
  );
  const ambiguous = solve(
    sheet(wire(1, [0, 50], [100, 50]), wire(2, [50, 50], [50, 100]), {
      NodeName: 'junction',
      _id: 3,
      point: [55, 55],
    }),
  );
  assert.ok(
    ambiguous.after.diagnostics.some((d) => d.code === 'junction-position'),
  );
});

test('physical connectivity catches breaks concealed by equal net labels', () => {
  const original = sheet(
    wire(1, [0, 0], [50, 0]),
    wire(2, [50, 0], [100, 0]),
    label(3, [0, 0], 'D0'),
    label(4, [100, 0], 'D0'),
  );
  const broken = {
    ...original,
    items: original.items.map((i) =>
      i._id === 2 ? wire(2, [60, 0], [100, 0]) : i,
    ),
  };
  assert.equal(
    api.connectivitySignature(original),
    api.connectivitySignature(broken),
  );
  assert.notEqual(
    api.connectivitySignature(original, true),
    api.connectivitySignature(broken, true),
  );
  assert.equal(api.sameConnectivity(original, broken), false);
});

test('repairs a nearby misplaced junction only when its branch is already connected', () => {
  const input = sheet(
    wire(1, [0, 50], [50, 50]),
    wire(2, [50, 50], [100, 50]),
    wire(3, [50, 50], [50, 100]),
    { NodeName: 'junction', _id: 4, point: [54, 54] },
  );
  const r = solve(input, { phases: ['junctions'] });
  assert.equal(r.after.metrics.junctionIssues, 0);
  assert.deepEqual(r.sheet.items.find((i) => i._id === 4).point, [50, 50]);
  assert.equal(
    r.sheet.items.filter((i) => i.NodeName === 'junction').length,
    1,
  );
});

test('selection, explicit locks, zero budgets and cancellation leave protected items untouched', () => {
  const input = sheet(
    symbol(1, 100, 100),
    symbol(2, 400, 100),
    wire(3, [100, 90], [360, 90]),
  );
  for (const options of [
    { selectedIds: [] },
    { lockedIds: [1, 2, 3] },
    { maxEvaluations: 0 },
    { cancelled: () => true },
  ]) {
    const r = solve(input, options);
    assert.equal(r.changes.length, 0);
  }
  const r = solve(input, { selectedIds: [1] });
  assert.strictEqual(r.sheet.items[1], input.items[1]);
  assert.strictEqual(r.sheet.items[2], input.items[2]);
});

test('disturbance modes enforce a run-wide large component movement budget', () => {
  const input = sheet(
    symbol(1, 100, 100),
    symbol(2, 400, 100),
    symbol(3, 700, 100),
    symbol(4, 900, 100),
  );
  for (const [disturbance, count] of [
    ['low', 0],
    ['medium', 2],
    ['high', 3],
  ]) {
    const options = { disturbance, largeSymbolIds: [1, 2, 3] },
      o = api.settings(input, options);
    assert.equal(
      input.items.slice(0, 3).filter((i) => api.movable(i, o)).length,
      count,
    );
    assert.ok(api.movable(input.items[3], o));
    const r = solve(input, options);
    const moved = r.changes.filter(
      (c) =>
        c.before?.NodeName === 'symbol' &&
        [1, 2, 3].includes(c.id) &&
        JSON.stringify(c.before.point) !== JSON.stringify(c.after.point),
    );
    assert.ok(moved.length <= count);
  }
});

test('eight related native wire chains use a shared ordered corridor', () => {
  const left = symbol(1, 100, 300, {
    width: 40,
    height: 260,
    ports: Array.from({ length: 8 }, (_, i) => [0, -220 + i * 20, 2]),
    showText: false,
  });
  const right = symbol(2, 1540, 600, {
    width: 40,
    height: 260,
    ports: Array.from({ length: 8 }, (_, i) => [-40, -220 + i * 20, 0]),
    showText: false,
  });
  // Descending tracks avoid crossings, but are unnecessarily far apart.
  const ws = [];
  for (let i = 0; i < 8; i++) {
    const y = 80 + i * 20,
      endY = 380 + i * 20,
      x = 1200 - i * 120,
      id = 10 + i * 3;
    ws.push(
      wire(id, [100, y], [x, y]),
      wire(id + 1, [x, y], [x, endY]),
      wire(id + 2, [x, endY], [1500, endY]),
    );
  }
  const input = sheet(left, right, ...ws);
  assert.equal(api.wireBundles(input)[0].length, 8);
  const r = solve(input, { lockedIds: [1, 2] });
  assert.ok(r.after.metrics.bundleDisorder < r.before.metrics.bundleDisorder);
  assert.equal(r.after.metrics.crossings, 0);
});

test('seeded annealing is reproducible and never returns its worse exploratory state', () => {
  const input = sheet(symbol(1, 100, 100), symbol(2, 170, 100));
  const a = solve(input, { annealingSteps: 100, seed: 42 }),
    b = solve(input, { annealingSteps: 100, seed: 42 });
  assert.deepEqual(a.changes, b.changes);
});

test('named-net neighbours attract together while preserving local stub geometry', () => {
  const input = sheet(
    symbol(1, 100, 100, { showText: false }),
    wire(3, [100, 90], [130, 90]),
    label(4, [110, 90], 'DATA'),
    symbol(2, 700, 100, { showText: false }),
    wire(5, [660, 90], [630, 90]),
    label(6, [635, 90], 'DATA'),
  );
  const r = solve(input, { phases: ['placement'] });
  assert.ok(
    r.after.metrics.logicalProximity < r.before.metrics.logicalProximity,
  );
});

test('text-only tool cannot move a component or wire', () => {
  const input = sheet(symbol(1, 100, 100), wire(2, [100, 90], [300, 90]));
  const r = api.autoPlaceSymbolText(input);
  assert.deepEqual(r.sheet.items[0].point, input.items[0].point);
  assert.strictEqual(r.sheet.items[1], input.items[1]);
  assert.equal(r.after.metrics.textCollisions, 0);
});

test('power keep-outs include the full rotated ground artwork', () => {
  for (const rotation of [0, 1, 2, 3]) {
    const power = api.refresh({
      ...font,
      NodeName: 'power',
      _id: 1,
      point: [100, 100],
      which: 4,
      rotation,
      text: '0',
      textData: null,
      _magnetic: null,
      _no_show: false,
    });
    const bounds = api.bodyRect(power);
    assert.equal(
      rotation % 2 ? bounds.x2 - bounds.x1 : bounds.y2 - bounds.y1,
      28,
    );
    const crossing =
      rotation % 2
        ? wire(
            2,
            [rotation === 1 ? 80 : 120, 80],
            [rotation === 1 ? 80 : 120, 120],
          )
        : wire(
            2,
            [80, rotation === 0 ? 120 : 80],
            [120, rotation === 0 ? 120 : 80],
          );
    assert.ok(
      api.analyseLayout(sheet(power, crossing)).metrics.wireBodyCollisions > 0,
    );
  }
});

test('simulation drawings preserve connectivity and simulation metadata after layout and save/reopen', async () => {
  for (const id of ['voltage-divider', 'rc-charging', 'rc-low-pass']) {
    const drawing = await api.decodeDrawing(
      await fs.readFile('examples/simulation/' + id + '.dzn'),
    );
    const r = solve(drawing.sheets[0]);
    const updated = {
      ...drawing,
      sheets: [r.sheet, ...drawing.sheets.slice(1)],
    };
    const reopened = await api.decodeDrawing(
      await api.encodeDrawing(updated, 'zip-v1'),
    );
    const aligned = {
      ...reopened.sheets[0],
      items: reopened.sheets[0].items.map((i, j) => ({
        ...i,
        _id: r.sheet.items[j]._id,
      })),
    };
    assert.equal(aligned.items.length, r.sheet.items.length);
    assert.ok(api.sameConnectivity(r.sheet, aligned), id + ' save/reopen');
    assert.deepEqual(
      reopened.sheets.slice(1).map((s) => s.simulation),
      drawing.sheets.slice(1).map((s) => s.simulation),
    );
  }
});

test('regular grouping cannot move a locked or excluded component or its stubs', () => {
  const input = sheet(
    symbol(1, 100, 100, { showText: false }),
    wire(4, [100, 90], [125, 90]),
    label(5, [110, 90], 'A'),
    symbol(2, 250, 150, { showText: false }),
    wire(6, [250, 140], [280, 140]),
    label(7, [260, 140], 'B'),
    symbol(3, 450, 400, { showText: false }),
  );
  for (const options of [
    { lockedIds: [3] },
    { selectedIds: [1, 2, 4, 5, 6, 7] },
  ]) {
    const r = solve(input, { ...options, phases: ['placement'] });
    assert.strictEqual(
      r.sheet.items.find((i) => i._id === 3),
      input.items.find((i) => i._id === 3),
    );
  }
});

test('visible body bounds and compact text placement follow rotation, mirroring and scale', () => {
  for (let rotation = 0; rotation < 8; rotation++) {
    let s = symbol(1, 200, 200, { rotation });
    s = api.refresh({
      ...s,
      scale_x: 2,
      scale_y: 3,
      _symbol: {
        ...s._symbol,
        outlines: [
          {
            ...s._symbol.outlines[0],
            items: [
              {
                NodeName: 'line',
                _id: 900,
                d_points: [
                  [-30, -15],
                  [-10, -15],
                  [-10, -5],
                  [-30, -5],
                  [-30, -15],
                ],
              },
            ],
          },
        ],
      },
    });
    const b = api.symbolArtwork(s).body;
    const paths = [
      ...api.renderCircuit(sheet(s)).matchAll(/<path\b[^>]*\bd="([^"]+)"/g),
    ];
    const coordinates = paths
      .at(-1)[1]
      .match(/-?\d+(?:\.\d+)?/g)
      .map(Number);
    const xs = coordinates.filter((_, i) => i % 2 === 0),
      ys = coordinates.filter((_, i) => i % 2 === 1);
    assert.deepEqual(
      b,
      {
        x1: Math.min(...xs),
        x2: Math.max(...xs),
        y1: Math.min(...ys),
        y2: Math.max(...ys),
      },
      'body bounds match actual SVG artwork, including mirrored nonuniform scaling',
    );
    const r = solve(sheet(s), { phases: ['symbol-text'] });
    assert.equal(r.after.metrics.textCollisions, 0);
    const fields = api.texts(r.sheet.items[0]);
    const near = Math.min(
      ...fields.map((t) =>
        Math.hypot(
          Math.max(0, b.x1 - t.x2, t.x1 - b.x2),
          Math.max(0, b.y1 - t.y2, t.y1 - b.y2),
        ),
      ),
    );
    assert.ok(
      near <= 5,
      'text stays near artwork rather than the pin envelope',
    );
    if (fields.every((t) => t.x2 <= b.x1))
      assert.equal(
        fields[0].x2,
        fields[1].x2,
        'left-side fields align towards body',
      );
  }
});

test('junction artwork follows its wire under every symbol rotation, mirror and scale', () => {
  for (let rotation = 0; rotation < 8; rotation++) {
    const base = symbol(1, 200, 200, { rotation, showText: false });
    const s = api.refresh({
      ...base,
      scale_x: 2,
      scale_y: 3,
      _symbol: {
        ...base._symbol,
        outlines: [
          {
            ...base._symbol.outlines[0],
            items: [
              wire(900, [-30, -10], [-10, -10]),
              { NodeName: 'junction', _id: 901, point: [-10, -10] },
            ],
          },
        ],
      },
    });
    const svg = api.renderCircuit(sheet(s));
    const end = /<path d="M[^L]+L\s*([-\d.]+) ([-\d.]+)/.exec(svg);
    const dot = /<circle cx="([-\d.]+)" cy="([-\d.]+)" r="5"/.exec(svg);
    assert.ok(end && dot, 'rendered wire and dot for rotation ' + rotation);
    assert.deepEqual(dot.slice(1).map(Number), end.slice(1).map(Number));
  }
});

test('annotation crowding distinguishes a narrow gap from actual text overlap', () => {
  const power = api.refresh({
    ...font,
    NodeName: 'power',
    _id: 1,
    point: [100, 100],
    which: 4,
    rotation: 0,
    text: '0',
    textData: null,
    _magnetic: null,
    _no_show: false,
  });
  const p = api.texts(power)[0];
  const nearby = label(2, [p.x2 + 3, p.y2 + 3], 'CTRL');
  const a = api.analyseLayout(sheet(power, nearby));
  assert.equal(a.metrics.textCollisions, 0);
  assert.ok(a.metrics.annotationCrowding > 0);
  const far = label(2, [p.x2 + 30, p.y2 + 3], 'CTRL');
  assert.equal(
    api.analyseLayout(sheet(power, far)).metrics.annotationCrowding,
    0,
  );
});

test('plain labels prefer the middle or an inset end without grid-rounding overhang', () => {
  for (const vertical of [false, true])
    for (const reverse of [false, true]) {
      const a = vertical ? [100, 20] : [20, 100],
        b = vertical ? [100, 160] : [160, 100];
      const l = api.refresh({
        ...label(2, vertical ? [100, 30] : [30, 100], 'OUT'),
        rotation: vertical ? 1 : 0,
      });
      const r = solve(sheet(wire(1, ...(reverse ? [b, a] : [a, b])), l), {
        phases: ['net-labels'],
      });
      const t = api.texts(r.sheet.items.find((i) => i._id === 2))[0];
      assert.ok(
        Math.abs((vertical ? t.y1 + t.y2 : t.x1 + t.x2) / 2 - 90) < 1e-6,
      );
      assert.equal(r.after.metrics.labelOverhangs, 0);
    }
  const input = sheet(
    wire(1, [20, 100], [160, 100]),
    label(2, [25, 100]),
    symbol(3, 110, 95, { showText: false }),
  );
  const r = solve(input, { phases: ['net-labels'] });
  assert.equal(r.after.metrics.textCollisions, 0);
  const t = api.texts(r.sheet.items.find((i) => i._id === 2))[0];
  assert.ok(
    Math.abs(t.x1 - 22.5) < 1e-6 || Math.abs(t.x2 - 157.5) < 1e-6,
    'use a clear end when the middle is obstructed',
  );
});

test('a blocked wire detours around fixed artwork and carries its label without changing nets', () => {
  const component = symbol(1, 110, 110, { showText: false });
  const input = sheet(
    component,
    wire(2, [20, 95], [160, 95]),
    label(3, [25, 95]),
  );
  const r = solve(input, { phases: ['routing', 'net-labels'], lockedIds: [1] });
  assert.equal(r.before.metrics.wireBodyCollisions, 1);
  assert.equal(r.after.metrics.wireBodyCollisions, 0);
  assert.ok(
    r.after.metrics.wireLength > r.before.metrics.wireLength,
    'clearance outranks shortest wire',
  );
  assert.ok(
    r.sheet.items.filter((i) => i.NodeName === 'wire').length >= 3,
    'up, across, back down',
  );
  assert.strictEqual(
    r.sheet.items.find((i) => i._id === 1),
    component,
  );
  assert.equal(r.after.metrics.labelOverhangs, 0);
  const locked = solve(input, { phases: ['routing'], lockedIds: [1, 2, 3] });
  assert.equal(locked.changes.length, 0);
});

test('a movable component can escape a fixed crossing wire sideways', () => {
  const component = symbol(1, 110, 110, { showText: false });
  const input = sheet(component, wire(2, [20, 95], [160, 95]));
  const r = solve(input, { phases: ['routing', 'placement'], lockedIds: [2] });
  assert.equal(r.after.metrics.wireBodyCollisions, 0);
  assert.notDeepEqual(
    r.sheet.items.find((i) => i._id === 1).point,
    component.point,
  );
  assert.strictEqual(
    r.sheet.items.find((i) => i._id === 2),
    input.items[1],
  );
});

test('a ground symbol moves aside with its lead when another net crosses its artwork', () => {
  const ground = api.refresh({
    ...font,
    NodeName: 'power',
    _id: 1,
    point: [100, 90],
    which: 4,
    rotation: 0,
    text: '0',
    textData: null,
    _magnetic: null,
    _no_show: false,
  });
  const input = sheet(
    ground,
    wire(2, [100, 50], [100, 90]),
    wire(3, [90, 110], [120, 110]),
    label(4, [92.5, 110], 'A'),
  );
  const r = solve(input, {
    phases: ['routing', 'placement', 'net-labels'],
    disturbance: 'low',
    lockedIds: [3, 4],
  });
  assert.equal(r.after.metrics.wireBodyCollisions, 0);
  assert.notEqual(
    r.sheet.items.find((i) => i._id === 1).point[0],
    ground.point[0],
  );
  assert.ok(
    r.sheet.items.filter((i) => i.NodeName === 'wire').length > 2,
    'ground lead receives a clearance bend',
  );
  assert.strictEqual(
    r.sheet.items.find((i) => i._id === 3),
    input.items[2],
  );
});

test('labels follow their supporting wire and retain an already parallel reading direction', () => {
  for (let rotation = 0; rotation < 4; rotation++)
    for (const vertical of [false, true]) {
      const l = api.refresh({
        ...label(2, vertical ? [100, 60] : [60, 100], 'SIGNAL'),
        rotation,
      });
      const r = solve(
        sheet(
          wire(
            1,
            ...(vertical
              ? [
                  [100, 20],
                  [100, 180],
                ]
              : [
                  [20, 100],
                  [180, 100],
                ]),
          ),
          l,
        ),
        { phases: ['net-labels'] },
      );
      assert.equal(r.after.metrics.labelOverhangs, 0);
      assert.equal(
        r.sheet.items.find((i) => i._id === 2).rotation,
        rotation % 2 === Number(vertical) ? rotation : Number(vertical),
      );
    }
});

test('rotated labels on short stubs keep both text and electrical anchor on the wire', () => {
  for (const rotation of [0, 1, 2, 3]) {
    const l = api.refresh({ ...label(2, [100, 25], 'VCC'), rotation });
    const input = sheet(wire(1, [100, 25], [100, 50]), l);
    const r = solve(input, { phases: ['net-labels'] });
    const placed = r.sheet.items.find((i) => i._id === 2);
    const w = r.sheet.items.find((i) => i._id === 1);
    assert.equal(placed.rotation % 2, 1);
    assert.equal(r.after.metrics.labelOverhangs, 0);
    assert.equal(placed.point[0], 100);
    assert.ok(
      placed.point[1] >= Math.min(...w.d_points.map((p) => p[1])) &&
        placed.point[1] <= Math.max(...w.d_points.map((p) => p[1])),
    );
    for (const options of [{ lockedIds: [2] }, { selectedIds: [1] }]) {
      const locked = solve(input, { phases: ['net-labels'], ...options });
      assert.strictEqual(
        locked.sheet.items.find((i) => i._id === 2),
        l,
      );
    }
  }
});

test('a short labelled ground lead extends straight and respects fixed terminals', () => {
  const s = symbol(1, 110, 110, { showText: false, ports: [[-10, 0, 3]] });
  const p = api.pins(s)[0].p;
  const ground = api.refresh({
    ...font,
    NodeName: 'power',
    _id: 3,
    point: [p[0], p[1] + 20],
    which: 4,
    rotation: 0,
    text: '0',
    textData: null,
    _magnetic: null,
    _no_show: false,
  });
  const input = sheet(
    s,
    wire(2, p, ground.point),
    ground,
    label(4, [p[0], p[1] + 12], 'VSS'),
  );
  const r = solve(input, {
    phases: ['net-labels', 'placement'],
    lockedIds: [1],
  });
  assert.equal(r.after.metrics.labelOverhangs, 0);
  assert.equal(r.after.metrics.bends, 0);
  assert.equal(r.sheet.items.find((i) => i._id === 4).rotation, 1);
  const moved = r.sheet.items.find((i) => i._id === 3);
  assert.equal(moved.point[0], p[0]);
  assert.ok(moved.point[1] > ground.point[1]);
  for (const options of [{ lockedIds: [1, 3] }, { phases: ['net-labels'] }]) {
    const fixed = solve(input, {
      phases: ['net-labels', 'placement'],
      ...options,
    });
    assert.strictEqual(
      fixed.sheet.items.find((i) => i._id === 3),
      ground,
    );
  }
});

test('a labelled free tail straightens across native wire records while retaining their identities', () => {
  const s = symbol(1, 110, 110, { showText: false });
  const input = sheet(
    s,
    wire(2, [110, 100], [140, 100]),
    wire(3, [140, 100], [140, 150]),
    label(4, [140, 140]),
  );
  const r = solve(input, { phases: ['routing', 'net-labels'], lockedIds: [1] });
  assert.equal(r.after.metrics.bends, 0);
  assert.equal(r.after.metrics.labelOverhangs, 0);
  for (const id of [2, 3]) assert.ok(r.sheet.items.some((i) => i._id === id));
  assert.ok(
    r.sheet.items
      .filter((i) => i.NodeName === 'wire')
      .every((w) => w.d_points.every((p) => p[1] === 100)),
  );
  const locked = solve(input, {
    phases: ['routing', 'net-labels'],
    lockedIds: [1, 4],
  });
  assert.strictEqual(
    locked.sheet.items.find((i) => i._id === 4),
    input.items[3],
  );
  assert.ok(
    locked.after.metrics.bends > 0,
    'a fixed off-axis label remains an anchor',
  );
});

test('related pin labels form a common column and fan out only when their text needs clearance', () => {
  for (const pitch of [10, 25]) {
    const s = symbol(1, 180, 180, {
      height: 60,
      showText: false,
      ports: [
        [-40, -40, 0],
        [-40, -40 + pitch, 0],
      ],
    });
    const ps = api.pins(s);
    const input = sheet(
      s,
      ...ps.map((p, i) => wire(2 + i, p.p, [80, p.p[1]])),
      label(4, [90, ps[0].p[1]], 'A'),
      label(5, [85, ps[1].p[1]], 'CLOCK'),
    );
    const r = solve(input, { phases: ['net-labels'], lockedIds: [1] });
    const ls = r.sheet.items.filter((i) => i.NodeName === 'label');
    assert.equal(api.texts(ls[0])[0].x1, api.texts(ls[1])[0].x1);
    assert.equal(r.after.metrics.labelAlignment, 0);
    assert.equal(r.after.metrics.textCollisions, 0);
    assert.equal(r.after.metrics.labelOverhangs, 0);
    if (pitch === 25)
      assert.equal(
        r.after.metrics.bends,
        0,
        'no doglegs for already adequate pitch',
      );
    else
      assert.ok(
        r.before.metrics.textCollisions > 0 && r.after.metrics.bends > 0,
        'tight pin pitch needs real clearance',
      );
  }
});

test('aligned label fan-out reserves intervening unlabelled ground rows on either face', () => {
  for (const right of [false, true]) {
    const s = symbol(1, 180, 180, {
      height: 60,
      showText: false,
      ports: [0, 10, 20, 30].map((y) => [
        right ? 0 : -40,
        y - 40,
        right ? 2 : 0,
      ]),
    });
    const ps = api.pins(s);
    const endX = right ? 260 : 60;
    const ground = api.refresh({
      ...font,
      NodeName: 'power',
      _id: 9,
      point: [endX, ps[1].p[1]],
      which: 4,
      rotation: 0,
      text: '0',
      textData: null,
      _magnetic: null,
      _no_show: false,
    });
    const input = sheet(
      s,
      ...ps.map((p, i) => wire(2 + i, p.p, [endX, p.p[1]])),
      ...[0, 2, 3].map((index, i) =>
        label(6 + i, [right ? 210 : 90, ps[index].p[1]], i ? 'VCC' : 'CLK'),
      ),
      ground,
    );
    const r = solve(input, { phases: ['net-labels'], lockedIds: [1, 3, 9] });
    assert.ok(r.before.metrics.textCollisions > 0);
    assert.equal(r.after.metrics.textCollisions, 0);
    assert.equal(r.after.metrics.labelAlignment, 0);
    assert.equal(r.after.metrics.labelOverhangs, 0);
    assert.equal(r.after.metrics.crossings, 0);
    assert.equal(r.after.metrics.pinExitViolations, 0);
    for (const id of [1, 3, 9])
      assert.strictEqual(
        r.sheet.items.find((i) => i._id === id),
        input.items.find((i) => i._id === id),
      );
    const group = r.sheet.items.filter((i) => i.NodeName === 'label');
    assert.ok(group[0].point[1] < ps[1].p[1]);
    assert.ok(group[1].point[1] > ps[1].p[1]);
    assert.ok(group[2].point[1] > group[1].point[1]);
  }
});
function backtrackFixture(transform = p => p) {
  // The outer route is constrained by obstacles; only its local down/right/up
  // excursion is redundant. TinyCAD stores each leg as an individual item.
  const points = [[100, 100], [130, 100], [130, 150], [160, 150],
    [160, 120], [180, 120], [180, 160], [200, 160]].map(transform);
  const boxes = [
    [[145, 85], [155, 115]],
    [[80, 135], [120, 145]],
    [[145, 125], [155, 135]],
  ].map(([a, b], index) => ({ NodeName: 'rectangle', _id: 100 + index,
    point: transform(a), point_b: transform(b), line_width: 1 }));
  return sheet(...points.slice(1).map((p, i) => wire(10 + i, points[i], p)), ...boxes);
}

test('removes a local down-then-up excursion across native segments when whole-route shortcuts are blocked', () => {
  const input = backtrackFixture();
  const r = solve(input, { phases: ['routing'] });
  assert.equal(r.before.metrics.bends, 6);
  assert.equal(r.after.metrics.bends, 4);
  assert.equal(r.after.metrics.wireLength, r.before.metrics.wireLength - 60);
  for (const item of input.items)
    assert.ok(r.sheet.items.some(i => i._id === item._id), 'retain every native wire identity');
});

for (const [name, transform] of [
  ['horizontal', ([x, y]) => [y, x]],
  ['mirrored', ([x, y]) => [400 - x, y]],
  ['rotated', ([x, y]) => [400 - y, x]],
]) {
  test(`local reversal removal works on ${name} routes`, () => {
    const r = solve(backtrackFixture(transform), { phases: ['routing'] });
    assert.equal(r.after.metrics.bends, 4);
    assert.equal(r.after.metrics.wireLength, r.before.metrics.wireLength - 60);
  });
}

test('local reversal removal is independent of stored segment order and direction', () => {
  const input = backtrackFixture();
  input.items = input.items.reverse().map((item, index) => item.NodeName === 'wire' && index % 2
    ? { ...item, d_points: [...item.d_points].reverse() } : item);
  const r = solve(input, { phases: ['routing'] });
  assert.equal(r.after.metrics.bends, 4);
  assert.equal(r.after.metrics.wireLength, r.before.metrics.wireLength - 60);
});

test('local reversal removal also handles a proposed polyline before native segment serialization', () => {
  const input = backtrackFixture();
  const members = input.items.filter(i => i.NodeName === 'wire');
  input.items = [wire(10, members[0].d_points[0], ...members.map(w => w.d_points[1])),
    ...input.items.filter(i => i.NodeName !== 'wire')];
  const r = solve(input, { phases: ['routing'] });
  assert.equal(r.after.metrics.bends, 4);
  assert.equal(r.after.metrics.wireLength, r.before.metrics.wireLength - 60);
  assert.ok(Object.keys(r.wireOrigins).length, 'new native segments map to their original polyline');
});

test('keeps a local reversal when every shorter corner would collide with fixed artwork', () => {
  const input = backtrackFixture();
  input.items.push(...[
    [[140, 118], [150, 122]],
    [[168, 148], [172, 152]],
    [[168, 158], [172, 162]],
  ].map(([point, point_b], index) => ({ NodeName: 'rectangle', _id: 110 + index, point, point_b, line_width: 1 })));
  const r = solve(input, { phases: ['routing'] });
  assert.equal(r.before.metrics.wireBodyCollisions, 0);
  assert.equal(r.after.metrics.wireBodyCollisions, 0);
  assert.equal(r.after.metrics.bends, 6);
  assert.equal(r.changes.length, 0);
});

test('keeps a local reversal when shortcuts would overlap or cross other wires', () => {
  const input = backtrackFixture();
  input.items.push(wire(110, [140, 120], [150, 120]), wire(111, [170, 145], [170, 165]));
  const r = solve(input, { phases: ['routing'] });
  assert.equal(r.before.metrics.crossings, 0);
  assert.equal(r.after.metrics.crossings, 0);
  assert.equal(r.after.metrics.overlaps, 0);
  assert.equal(r.after.metrics.bends, 6);
  assert.equal(r.changes.length, 0);
});

test('a fixed branch along a reversal remains connected while a neighbouring detour can simplify', () => {
  const input = backtrackFixture();
  const branch = wire(110, [145, 150], [145, 200]);
  input.items.push(branch);
  const r = solve(input, { phases: ['routing'], lockedIds: [110] });
  assert.strictEqual(r.sheet.items.find(i => i._id === 110), branch);
  assert.ok(r.after.metrics.bends < r.before.metrics.bends);
  assert.ok(api.sameConnectivity(input, r.sheet, r.wireOrigins));
});

test('local reversal removal respects locks, selections, cancellation and evaluation budgets', () => {
  const input = backtrackFixture();
  for (const options of [
    { lockedIds: [13] },
    { selectedIds: [10, 11, 12, 14, 15, 16] },
    { maxEvaluations: 0 },
    { maxPasses: 0 },
    { cancelled: () => true },
  ]) {
    const r = solve(input, { phases: ['routing'], ...options });
    assert.equal(r.changes.length, 0, JSON.stringify(options));
  }
});

test('local reversal removal preserves the straight outward leads at both component pins', () => {
  const input = backtrackFixture();
  input.items.push(
    symbol(1, 100, 100, { showText: false, ports: [[0, 0, 2]] }),
    symbol(2, 240, 160, { showText: false, ports: [[-40, 0, 0]] }),
  );
  const r = solve(input, { phases: ['routing'], lockedIds: [1, 2] });
  assert.equal(r.before.metrics.pinExitViolations, 0);
  assert.equal(r.after.metrics.pinExitViolations, 0);
  assert.equal(r.after.metrics.bends, 4);
  assert.equal(r.after.metrics.wireLength, r.before.metrics.wireLength - 60);
});

test('a necessary reversal remains when a shortcut would turn back into a component pin', () => {
  const source = symbol(1, 100, 120, { showText: false, ports: [[0, -20, 1]] });
  assert.deepEqual(api.pins(source)[0].p, [100, 100]);
  const input = sheet(source,
    wire(10, [100, 100], [100, 80]),
    wire(11, [100, 80], [140, 80]),
    wire(12, [140, 80], [140, 130]),
    { NodeName: 'noconnect', _id: 20, point: [140, 130] },
  );
  const r = solve(input, { phases: ['routing'], lockedIds: [1, 20] });
  assert.equal(r.before.metrics.pinExitViolations, 0);
  assert.equal(r.after.metrics.pinExitViolations, 0);
  assert.equal(r.after.metrics.bends, 2, 'the pin must lead upward before turning downward');
  const incident = r.sheet.items.filter(i => i.NodeName === 'wire' &&
    i.d_points.some(p => p[0] === 100 && p[1] === 100));
  assert.equal(incident.length, 1);
  assert.ok(incident[0].d_points.every(p => p[0] === 100 && p[1] <= 100));
});

test('a movable label follows a local shortcut and a locked label keeps its supporting wire', () => {
  const input = backtrackFixture();
  const annotation = label(110, [140, 150], 'X');
  input.items.push(annotation);
  for (const lockedIds of [[], [110]]) {
    const r = solve(input, { phases: ['routing'], lockedIds });
    assert.equal(r.after.metrics.bends, 4);
    assert.equal(r.after.metrics.labelOverhangs, 0);
    assert.equal(r.after.metrics.textCollisions, 0);
    if (lockedIds.length)
      assert.strictEqual(r.sheet.items.find(i => i._id === 110), annotation);
  }
});

for (const disturbance of ['low', 'medium', 'high']) {
  test(`the full ${disturbance} auto-layout run removes local reversals within one pass`, () => {
    const r = solve(backtrackFixture(), { disturbance, maxPasses: 1 });
    assert.ok(r.after.metrics.bends <= 4);
    assert.ok(r.after.metrics.wireLength <= r.before.metrics.wireLength - 60);
  });
}
