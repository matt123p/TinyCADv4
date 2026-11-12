import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
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

test('regenerated teaching examples retain layout quality, connectivity and simulation metadata', async () => {
  const manifest = JSON.parse(
    await fs.readFile('bundled-examples/teaching/manifest.json', 'utf8'),
  );
  for (const id of ['G01', 'G14', 'A38', 'A36']) {
    const entry = manifest.scenarios.find((s) => s.id === id),
      drawing = await api.decodeDrawing(
        await fs.readFile('bundled-examples/' + entry.path),
      );
    const input = drawing.sheets[0],
      r = solve(input, { nativeWireJunctions: true });
    if (id === 'G01') {
      assert.equal(r.after.metrics.pinExitViolations, 0);
      assert.equal(r.after.metrics.textCollisions, 0);
      assert.equal(r.after.metrics.labelOverhangs, 0);
      assert.ok(r.after.metrics.wireLength <= r.before.metrics.wireLength);
    }
    const byRef = (ref) =>
      r.sheet.items.find(
        (i) =>
          i.NodeName === 'symbol' &&
          i.text.some((t) => t.description === 'Ref' && t.value === ref),
      );
    const centre = (ref) => {
      const symbol = byRef(ref);
      const b = api.bodyRect(symbol);
      return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
    };
    for (const ref of ['R1', 'R2']) {
      const s = byRef(ref);
      if (!s) continue;
      const b = api.symbolArtwork(s).body;
      assert.ok(
        Math.min(
          ...api
            .texts(s)
            .map((t) =>
              Math.hypot(
                Math.max(0, b.x1 - t.x2, t.x1 - b.x2),
                Math.max(0, b.y1 - t.y2, t.y1 - b.y2),
              ),
            ),
        ) <= 5,
        ref + ' text group is close to the resistor body',
      );
    }
    if (id === 'G14') {
      const pin = api.pins(byRef('LDR1')).find((p) => p.direction[1] > 0);
      const path = api
        .wirePaths(r.sheet)
        .find((p) =>
          p.points.some((q) => q[0] === pin.p[0] && q[1] === pin.p[1]),
        );
      assert.ok(
        path.points.some((p) => p[0] !== pin.p[0]),
        'LDR return reaches the ground side of the restored loop',
      );
    }
    if (id === 'A36' || id === 'A38') {
      const chip = byRef('U1');
      const body = api.symbolArtwork(chip).body;
      const reference = api.texts(chip)[0];
      assert.ok(
        Math.hypot(
          Math.max(0, body.x1 - reference.x2, reference.x1 - body.x2),
          Math.max(0, body.y1 - reference.y2, reference.y1 - body.y2),
        ) <= 5,
        id + ' reference sits next to visible chip body',
      );
    }
    if (id === 'A38') {
      for (const ref of ['C1', 'C2']) {
        const capacitor = byRef(ref),
          body = api.symbolArtwork(capacitor).body;
        const fields = api.texts(capacitor);
        for (const t of fields)
          assert.ok(
            Math.max(0, body.x1 - t.x2, t.x1 - body.x2) <= 5,
            ref + ' reference and value are both close to the plates',
          );
        const edge = fields[0].x2 <= body.x1 ? 'x2' : 'x1';
        assert.equal(
          fields[0][edge],
          fields[1][edge],
          'reference and value share their body-facing edge',
        );
      }
      assert.equal(
        centre('R1')[0],
        centre('R2')[0],
        'parallel resistor stack shares a centreline',
      );
      assert.ok(
        centre('R1')[1] < centre('R2')[1],
        'reference order is retained',
      );
      assert.equal(
        centre('C1')[1],
        centre('C2')[1],
        'capacitors share a horizontal baseline',
      );
      assert.ok(centre('C1')[0] < centre('C2')[0]);
      const controls = r.sheet.items
        .filter((i) => i.NodeName === 'label' && i.text === 'CTRL')
        .flatMap(api.texts);
      const grounds = r.sheet.items
        .filter((i) => i.NodeName === 'power' && i.text === '0')
        .flatMap(api.texts);
      for (const a of controls)
        for (const b of grounds) {
          const gap = Math.hypot(
            Math.max(0, a.x1 - b.x2, b.x1 - a.x2),
            Math.max(0, a.y1 - b.y2, b.y1 - a.y2),
          );
          assert.ok(
            gap >= 15 - 1e-6,
            'CTRL must have a readable separation from ground 0',
          );
        }
      assert.equal(r.after.metrics.componentDisorder, 0);
      assert.equal(
        r.after.metrics.bends,
        0,
        'isolated A38 stubs stay straight',
      );
      assert.equal(r.after.metrics.labelAlignment, 0);
    }
    if (id === 'A36') {
      const inputPorts = ['U1', 'U2', 'U3'].map((ref) => byRef(ref)._id);
      for (const group of api
        .labelGroups(r.sheet)
        .filter(
          (g) => inputPorts.includes(g[0].pin.id) && g[0].pin.direction[0] < 0,
        ))
        for (const { label: l } of group)
          assert.ok(
            !r.after.diagnostics.some(
              (d) =>
                d.itemIds.includes(l._id) &&
                ['text-wire', 'text-body', 'text-overlap'].includes(d.code),
            ),
            'input label columns leave space for intervening ground connections',
          );
      assert.equal(
        r.after.metrics.labelOverhangs,
        0,
        'every plain label follows and fits its supporting wire',
      );
      const v1 = byRef('V1');
      for (const pin of api.pins(v1)) {
        const path = api
          .wirePaths(r.sheet)
          .find((p) =>
            p.points.some((q) => q[0] === pin.p[0] && q[1] === pin.p[1]),
          );
        assert.ok(
          path.points.every((q) => q[0] === pin.p[0]),
          'V1 supply and ground leads stay straight after grouping',
        );
      }
      const u3 = api
        .pins({ ...byRef('U3'), show_power: true, _active_points: null })
        .find((p) => p.direction[1] === -1).p;
      const supply = api
        .wirePaths(r.sheet)
        .find((p) => p.points.some((q) => q[0] === u3[0] &&
          q[1] >= u3[1] && q[1] <= api.symbolArtwork(byRef('U3')).body.y1));
      assert.ok(
        supply && supply.points.every((q) => q[0] === supply.points[0][0]),
        'U3 supply does not retain an arbitrary dogleg',
      );
      assert.equal(
        r.after.metrics.labelAlignment,
        0,
        'pin labels share their face column',
      );
      assert.equal(
        r.after.metrics.wireBodyCollisions,
        0,
        'ground artwork no longer intersects VCC wires',
      );
      const aLabels = r.sheet.items.filter(
        (i) => i.NodeName === 'label' && i.text === 'A',
      );
      for (const l of aLabels)
        assert.ok(
          !r.after.diagnostics.some(
            (d) =>
              d.itemIds.includes(l._id) &&
              [
                'text-overlap',
                'text-wire',
                'text-body',
                'annotation-crowding',
              ].includes(d.code),
          ),
          'A labels are clear of CLK and neighbouring wires',
        );
      const clockLabels = r.sheet.items.filter(
        (i) => i.NodeName === 'label' && i.text === 'CLK',
      );
      for (const l of clockLabels)
        assert.ok(
          !r.after.diagnostics.some(
            (d) =>
              d.itemIds.includes(l._id) &&
              ['text-overlap', 'text-wire', 'text-body'].includes(d.code),
          ),
          'clock labels avoid adjacent wires',
        );
      const cs = ['V1', 'V2', 'V3'].map(centre);
      assert.ok(
        cs.every((c) => c[1] === cs[0][1]),
        'source bodies share a baseline',
      );
      assert.ok(cs[1][0] > cs[0][0]);
      assert.equal(
        cs[1][0] - cs[0][0],
        cs[2][0] - cs[1][0],
        'source row has equal pitch',
      );
      assert.equal(r.after.metrics.componentDisorder, 0);
    }
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
  for(let rotation=0;rotation<8;rotation++) {
    const base=symbol(1,200,200,{rotation,showText:false});
    const s=api.refresh({...base,scale_x:2,scale_y:3,_symbol:{...base._symbol,
      outlines:[{...base._symbol.outlines[0],items:[
        wire(900,[-30,-10],[-10,-10]),
        {NodeName:'junction',_id:901,point:[-10,-10]},
      ]}]}});
    const svg=api.renderCircuit(sheet(s));
    const end=/<path d="M[^L]+L\s*([-\d.]+) ([-\d.]+)/.exec(svg);
    const dot=/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="5"/.exec(svg);
    assert.ok(end&&dot,'rendered wire and dot for rotation '+rotation);
    assert.deepEqual(dot.slice(1).map(Number),end.slice(1).map(Number));
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
