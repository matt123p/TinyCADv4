import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { librarySqlite } from '../lib/library-from-sql.mjs';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const output = process.argv[2];
if (!output)
  throw new Error('Pass a directory for the two classroom project folders.');
const api = await layoutRuntime();
const encode = (text) => new TextEncoder().encode(text);
const id = (n) => '5ed00000-0000-4000-8000-' + String(n).padStart(12, '0');
const point = (x, y) => ({ x: Math.round(x * 1e6), y: Math.round(y * 1e6) });
const parts = [
  {
    ref: 'J1',
    value: '5 V input',
    shape: 'connector',
    procurement: { Manufacturer: 'JST', MPN: 'B2B-XH-A(LF)(SN)' },
    footprint: 'jst-xh-2-vertical',
    pins: ['+5 V', '0 V'],
    at: [50, 66],
  },
  {
    ref: 'R1',
    value: '330 Ω',
    shape: 'resistor',
    procurement: {
      Manufacturer: 'YAGEO', MPN: 'MFR-12FTF52-330R',
      'Power rating': '1/6 W', Tolerance: '±1%',
    },
    footprint: 'axial-762',
    pins: ['1', '2'],
    at: [115, 66],
  },
  {
    ref: 'D1',
    value: 'Red LED',
    shape: 'led',
    procurement: { Manufacturer: 'Kingbright', MPN: 'WP7113ID' },
    footprint: 'led-radial-5',
    pins: ['Cathode', 'Anode'],
    at: [186, 66],
  },
];
const netNames = ['5V', 'LED_A', 'GND'];
const wires = [
  [
    ['J1', '1'],
    ['R1', '1'],
  ],
  [
    ['R1', '2'],
    ['D1', '2'],
  ],
  [
    ['J1', '2'],
    ['D1', '1'],
  ],
];

function symbolXml(part, index) {
  const connector = part.shape === 'connector';
  const diode = part.shape === 'led';
  const pin = (index, x, y, direction) =>
    `<PIN pos="${x},${y}" direction="${direction}" number="${
      index + 1
    }" length="12" number_pos="0" centre_name="0" which="0" elec="4" part="0" show="1" pin_uuid="${id(
      10 + index + Number(part.ref[0].charCodeAt(0)) * 10,
    )}">${part.pins[index]}</PIN>`;
  const pinXml = connector
    ? pin(0, 14, 0, 3) + pin(1, 14, 16, 3)
    : diode
    ? pin(0, 14, 0, 3) + pin(1, -14, 0, 2)
    : pin(0, -14, 0, 2) + pin(1, 14, 0, 3);
  const line = (a, b) => `<POLYGON polygon="0" pos="0,0" style="1" fill="0">
    <POINT pos="${a}" arc="0"/><POINT pos="${b}" arc="0"/></POLYGON>`;
  const outline = (points) =>
    points
      .slice(1)
      .map((b, i) => line(points[i], b))
      .join('');
  const graphics = connector
    ? outline(['-10,-6', '4,-6', '4,22', '-10,22', '-10,-6'])
    : diode
    ? outline(['-4,-6', '4,0', '-4,6', '-4,-6']) +
      line('4,-6', '4,6') +
      line('-2,-8', '2,-12') +
      line('2,-8', '6,-12') +
      line('2,-12', '-1,-12') +
      line('6,-12', '3,-12')
    : outline(['-7,-4', '7,-4', '7,4', '-7,4', '-7,-4']);
  const definition = `<SYMBOLDEF id="${index}"><NAME type="0">${
    part.value
  }</NAME>
    <GUID>${id(100 + index)}</GUID><REF type="0">${
    part.ref[0]
  }?</REF><PPP>1</PPP>
    <REF_POINT pos="0,0" power="0" part="0"/><TinyCAD>${pinXml}${graphics}</TinyCAD></SYMBOLDEF>`;
  const field = (name, value, y, show) =>
    `<FIELD pos="-8,${y}" value="${value}" description="${name}" type="1" show="${show}"/>`;
  const spiceTemplate = connector
    ? 'V$(ref) %(1) %(2) DC 5'
    : diode
    ? '$(ref) %(2) %(1) TeachingLED'
    : '$(ref) %(1) %(2) $(Value)';
  const spice = field('$$SPICE', spiceTemplate, 0, 0);
  const model = diode
    ? field('$$SPICE_PROLOG', '.model TeachingLED D(IS=1e-18 N=2)', 0, 0)
    : '';
  const value = part.ref === 'R1' ? field('Value', '330', 11, 1) : '';
  const procurement = Object.entries(part.procurement)
    .map(([name, text]) => field(name, text, 0, 0))
    .join('');
  const instance = `<SYMBOL id="${index}" pos="${
    part.at
  }" part="0" rotate="0" show_power="0" can_scale="0" scale_x="1" scale_y="1">
    ${field('Ref', part.ref, -20, 1)}${field(
    'Name',
    part.ref === 'R1' ? 'Resistor' : part.value,
    connector ? 27 : 11,
    part.ref === 'R1' ? 0 : 1,
  )}
    ${field('Package', part.footprint, 0, 0)}${spice}${model}${value}${procurement}</SYMBOL>`;
  return { definition, instance };
}

const symbolXmlParts = parts.map((part, index) => symbolXml(part, index + 1));
const drawing = await api.decodeDrawing(
  encode(`<TinyCADSheets><TinyCAD><NAME>LED classroom circuit</NAME>
  <DETAILS><TITLE>Classroom LED indicator</TITLE></DETAILS>
  <STYLE id="1"><STYLE>0</STYLE><COLOR>000000</COLOR><THICKNESS>1</THICKNESS></STYLE>
  ${symbolXmlParts.map(({ definition }) => definition).join('')}
  ${symbolXmlParts.map(({ instance }) => instance).join('')}
  </TinyCAD></TinyCADSheets>`),
);
drawing.documentId = id(1);
const [sheet] = drawing.sheets;
sheet.id = id(2);
const endpoints = new Map();
for (const [index, item] of sheet.items.entries()) {
  item.unitId = id(3 + index);
  for (const [x, y, pin] of new api.updateSymbol(item).active_points())
    endpoints.set(parts[index].ref + ':' + pin.number, [x, y]);
}
const wire = (points) =>
  points.slice(1).forEach((b, i) => {
    const a = points[i];
    if (a[0] === b[0] && a[1] === b[1]) return;
    assert.ok(
      a[0] === b[0] || a[1] === b[1],
      'Schematic wires must be orthogonal.',
    );
    sheet.items.push({
      NodeName: 'wire',
      _id: 100 + sheet.items.length,
      d_points: [a, b],
    });
  });
for (const [index, [left, right]] of wires.entries()) {
  const a = endpoints.get(left.join(':'));
  const b = endpoints.get(right.join(':'));
  if (index === 2) {
    const lower = Math.max(a[1], b[1]) + 125;
    wire([
      a,
      [a[0] + 75, a[1]],
      [a[0] + 75, lower],
      [a[0] + 175, lower],
      [b[0] + 75, lower],
      [b[0] + 75, b[1]],
      b,
    ]);
  } else {
    const middle = (a[0] + b[0]) / 2;
    wire([a, [middle, a[1]], [middle, b[1]], b]);
  }
}

const labelXml = wires
  .map(([left, right], index) => {
    const a = endpoints.get(left.join(':'));
    const b = endpoints.get(right.join(':'));
    const x = index === 2 ? (b[0] + 75 + a[0] + 75) / 2 : (a[0] + b[0]) / 2;
    const y = index === 2 ? Math.max(a[1], b[1]) + 125 : a[1];
    return `<LABEL pos="${x / 5},${y / 5}" direction="3" font="1" style="0">${
      netNames[index]
    }</LABEL>`;
  })
  .join('');
const returnY =
  Math.max(endpoints.get('J1:2')[1], endpoints.get('D1:1')[1]) + 125;
const ground = `<POWER pos="${(endpoints.get('J1:2')[0] + 175) / 5},${
  returnY / 5
}" direction="1" which="4">0</POWER>`;
const labelsDrawing = await api.decodeDrawing(
  encode(
    `<TinyCADSheets><TinyCAD><FONT id="1"><HEIGHT>10</HEIGHT><FACENAME>Arial</FACENAME><WIDTH>0</WIDTH><WEIGHT>400</WEIGHT><ITALIC>0</ITALIC><UNDERLINE>0</UNDERLINE><STRIKEOUT>0</STRIKEOUT><CHARSET>0</CHARSET></FONT>${labelXml}${ground}</TinyCAD></TinyCADSheets>`,
  ),
);
for (const label of labelsDrawing.sheets[0].items)
  sheet.items.push({ ...label, _id: 100 + sheet.items.length });

const simulation = api.createSimulationSheet(sheet, 'LED operating point');
simulation.id = id(7);
simulation.simulation.analysis.kind = 'op';
const currentSignal = api.deviceSignal(sheet.id, 'R1', 'current');
simulation.simulation.signals = ['led_a', currentSignal, 'vj1#branch'];
simulation.simulation.measurements = [
  {
    id: 'forward-voltage',
    name: 'LED forward voltage',
    kind: 'value',
    source: 'led_a',
  },
  {
    id: 'led-current',
    name: 'LED current through R1',
    kind: 'value',
    source: currentSignal,
  },
];
simulation.simulation.instructions =
  'Run Operating Point. The ideal 5 V supply is represented by the connector J1. Expect the teaching LED to read about 1.9 V and 9.4 mA with R1 at 330 ohms. Select the measurements to locate the contributing circuit elements. Change the Value field of R1 to 470 and run again to compare current. The diode model is illustrative.';

drawing.sheets.push(simulation);
const schematic = await api.encodeDrawing(drawing);
const restored = await api.decodeDrawing(schematic);
const setup = restored.sheets.find(
  ({ kind }) => kind === 'simulation',
).simulation;
const simulationNet = new api.NetlistWorkerState().init({
  ...restored,
  sheets: restored.sheets.filter(({ kind }) => kind !== 'simulation'),
});
assert.deepEqual(api.checkSpiceComponents(simulationNet, setup), []);
const simulationDeck = api.buildDeck(simulationNet, setup);
assert.match(simulationDeck, /^VJ1\s+5V\s+0\s+DC\s+5$/im);
assert.match(simulationDeck, /^R1\s+5V\s+LED_A\s+330$/im);
assert.match(simulationDeck, /^D1\s+LED_A\s+0\s+TeachingLED$/im);

if (process.argv.includes('--verify-native')) {
  const runtime = new URL('../../build/engines/native/', import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', runtime), 'utf8'),
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'tinycad-led-spice-'));
  try {
    const deckFile = path.join(directory, 'led.cir');
    await writeFile(deckFile, simulationDeck);
    const engineFile = (file) => fileURLToPath(new URL(file, runtime));
    const run = spawnSync(
      engineFile(manifest.helper),
      [
        engineFile(manifest.library),
        deckFile,
        ...manifest.modules.map(engineFile),
      ],
      { cwd: directory, encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    const events = run.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).state, 'complete');
    const { names } = events.find(({ type }) => type === 'vectors');
    const rows = events
      .filter(({ type }) => type === 'data')
      .flatMap(({ rows }) => rows);
    const results = api.resolvedSignals(
      restored,
      simulationNet,
      {
        scale: '',
        log: '',
        vectors: names.map((name, index) => ({
          name,
          unit: api.vectorUnit(name),
          real: rows.map((row) => row[index]),
        })),
      },
      setup.signals,
    );
    const voltage = results.vectors.find(({ name }) => name === 'led_a')
      .real[0];
    const current = results.vectors.find(({ name }) => name === currentSignal)
      .real[0];
    const supply = results.vectors.find(({ name }) => name === 'vj1#branch')
      .real[0];
    assert.ok(voltage > 1.85 && voltage < 1.95, String(voltage));
    assert.ok(current > 0.009 && current < 0.01, String(current));
    assert.ok(Math.abs(current + supply) < 1e-9);
    assert.ok(Math.abs(voltage + current * 330 - 5) < 1e-9);
    console.log(
      `Native operating point: ${voltage.toFixed(3)} V, ${(
        current * 1000
      ).toFixed(2)} mA.`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const graph = await api.buildHierarchicalNetlist({
  path: 'LED.dzn',
  drawing: restored,
});
const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
  documentId: restored.documentId,
  revision: 1,
});
for (const { ref, procurement } of parts) {
  const component = snapshot.components.find(({ reference }) => reference === ref);
  assert.equal(component?.procurement?.manufacturer, procurement.Manufacturer, ref);
  assert.equal(component?.procurement?.mpn, procurement.MPN, ref);
}
const labels = new Map(
  snapshot.components.flatMap((component) =>
    component.signals.flatMap((signal) =>
      signal.terminals.map(({ pinId }) => [
        pinId,
        component.reference + ':' + signal.number,
      ]),
    ),
  ),
);
assert.deepEqual(
  snapshot.nets.flatMap(({ names }) => names).toSorted(),
  [...netNames, '0'].toSorted(),
);
const orderedNets = (groups) =>
  groups.map((group) => group.toSorted().join(' ')).toSorted();
assert.deepEqual(
  orderedNets(
    snapshot.nets.map(({ terminals }) =>
      terminals.map(({ pinId }) => labels.get(pinId)),
    ),
  ),
  orderedNets(wires.map((pair) => pair.map((pin) => pin.join(':')))),
);

const SQL = await librarySqlite();
const db = new SQL.Database(
  await readFile(
    new URL('../../bundled-footprints/starter-v1.tplib', import.meta.url),
  ),
);
const catalogue = await api.readStarterDevices(db);
const drafts = api.readStarterFootprints(db);
const selections = new Map();
for (const component of snapshot.components) {
  const part = parts.find(({ ref }) => ref === component.reference);
  const entry = drafts.find(({ id }) => id === part.footprint);
  const draft = await api.readStarterFootprint(db, entry);
  const { definitionDigest, ...definition } = draft.definition;
  const artwork = await api.footprintDefinition({
    ...definition,
    id: id(40 + parts.indexOf(part)),
    ...(part.ref !== 'R1' ? {
      assembly: {
        marker: {
          kind: part.ref === 'D1' ? 'cathode' : 'pin-1',
          padId: definition.pads.find(({ label }) => label === '1').id,
        },
        ...(part.ref === 'D1' ? { notes: 'Fit the LED cathode to the pad marked K.' } : {}),
      },
    } : {}),
    graphics: definition.graphics.map((graphic) => {
      if (graphic.layer !== 'F.SilkS' || graphic.kind !== 'circle')
        return graphic;
      // Both imported legend dots sit to the left of pad 1.
      return {
        ...graphic,
        strokeNm: Math.max(150_000, graphic.strokeNm),
        center: { ...graphic.center, x: graphic.center.x - 100_000 },
        end: { ...graphic.end, x: graphic.end.x - 100_000 },
      };
    }),
  });
  let version;
  if (part.ref === 'J1') {
    const pinned = catalogue.find(
      ({ definition }) => definition.footprint.id === draft.definition.id,
    );
    version = await api.readLibraryDevice(
      await api.writeLibraryDevice({
        ...pinned.definition,
        id: id(43),
        footprint: artwork,
        review: {
          ...pinned.definition.review,
          evidence:
            pinned.definition.review.evidence +
            ' Classroom variant increases legend stroke to 0.15 mm and moves the pin-1 dot 0.1 mm away from the pad.',
        },
      }),
    );
  } else {
    version = await api.readLibraryDevice(
      await api.publishFootprintDevice(
        {
          ...draft,
          definition: artwork,
        },
        {
          packageName: part.footprint,
          widthNm: entry.bodyNm[0],
          heightNm: entry.bodyNm[1],
          license: 'CC0-1.0',
          reviewer: 'TinyCAD LED classroom exercise',
          evidence:
            'Lesson-local pin mapping. Confirm the actual axial resistor fit and LED cathode on pad 1 before assembly.',
          mappings: new Map(
            draft.definition.pads.map((pad) => [
              pad.id,
              {
                kind: 'signal',
                terminal: part.pins[Number(pad.label) - 1],
              },
            ]),
          ),
        },
      ),
    );
  }
  const bindings = version.definition.assignments.map(({ padId, signalId }) => {
    const pad = version.definition.footprint.pads.find(
      ({ id }) => id === padId,
    );
    const signal = component.signals.find(({ number }) => number === pad.label);
    return { terminalId: signalId, signalId: signal.id };
  });
  selections.set(component.id, { revision: version, bindings });
}
db.close();

const empty = {
  ...api.createBoard('LED classroom board', 2, [
    point(0, 0),
    point(40, 0),
    point(40, 22),
    point(0, 22),
  ]),
  boardId: id(30),
  requiredFeatures: ['straight-outline', 'fabrication-settings'],
  fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
};
const review = await api.previewCircuitEco(empty, undefined, snapshot, {
  selectedDevices: selections,
});
const exercise = api.applyCircuitEco(empty, review);
const layout = new Map([
  ['J1', { positionNm: point(7, 9), rotationMicrodegree: 90e6 }],
  ['R1', { positionNm: point(18, 7.75), rotationMicrodegree: 0 }],
  ['D1', { positionNm: point(30, 7.75), rotationMicrodegree: 180e6 }],
]);
let completed = exercise;
const padPoints = new Map();
for (const component of completed.components) {
  const position = { ...layout.get(component.reference), side: 'top' };
  completed = await api.placeUnplacedComponent(
    completed,
    component.id,
    position,
  );
  const device = completed.deviceDefinitions.find(
    ({ id }) => id === component.deviceId,
  );
  const footprint = completed.footprintDefinitions.find(
    ({ id }) => id === device.footprintId,
  );
  for (const { label, positionNm } of footprint.pads)
    padPoints.set(
      component.reference + ':' + label,
      api.placeFootprintPoint(positionNm, position),
    );
}
const wasm = await readFile(
  path.join(
    path.dirname(
      createRequire(import.meta.url).resolve('clipper2-wasm/package.json'),
    ),
    'dist/es/clipper2z.wasm',
  ),
);
const kernel = await api.loadPolygonKernel(Uint8Array.from(wasm).buffer);
for (const [index, [left, right]] of wires.entries()) {
  const key = left.join(':');
  const net = snapshot.nets.find(({ terminals }) =>
    terminals.some(({ pinId }) => labels.get(pinId) === key),
  );
  const a = padPoints.get(key);
  const b = padPoints.get(right.join(':'));
  const points = index === 2 ? [a, point(7, 16), point(31.27, 16), b] : [a, b];
  completed = api.commitManualRoute(
    completed,
    {
      netId: net.id,
      widthNm: 500_000,
      path: points.map((position) => ({ position, layer: 'top' })),
      viaDiameterNm: 650_000,
      viaDrillNm: 300_000,
    },
    kernel,
  );
}

completed = {
  ...completed,
  tracks: completed.tracks.map((track, index) => ({
    ...track,
    id: id(200 + index),
  })),
};
const reference = await api.decodeBoard(await api.encodeBoard(completed));
const circuit = {
  state: 'resolved',
  snapshot,
  applied: reference.appliedCircuit,
};
const first = await api.prepareCamPreview(reference, kernel, circuit);
const second = await api.prepareCamPreview(reference, kernel, circuit);
assert.equal(first.report.schematic.state, 'current');
assert.equal(first.drills.length, 6);
assert.deepEqual(first.report.issues, []);
for (const [file, data] of Object.entries(first.files)) {
  if (file !== 'checks.json') assert.equal(second.files[file], data, file);
}
for (const [name, board] of [
  ['Exercise', exercise],
  ['Reference', reference],
]) {
  const folder = path.join(output, name);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'LED.dzn'), schematic);
  await writeFile(path.join(folder, 'LED.dpn'), await api.encodeBoard(board));
  await writeFile(
    path.join(folder, 'LED.tcproject'),
    api.encodeProjectSettings({
      projectId: id(name === 'Exercise' ? 31 : 32),
      revisionId: id(33),
      title: 'LED classroom ' + name.toLowerCase(),
      primarySchematic: restored.documentId,
      entries: [
        { kind: 'schematic', id: restored.documentId, path: 'LED.dzn' },
        { kind: 'board', id: board.boardId, path: 'LED.dpn' },
      ],
      associations: [{ schematic: restored.documentId, board: board.boardId }],
      requiredFeatures: [],
    }),
  );
}
console.log(
  'Verified three intended nets, six drills and repeatable copper and assembly outputs.',
);
