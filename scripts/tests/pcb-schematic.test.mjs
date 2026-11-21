import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const legacy = await readFile(
  new URL('../../bundled-examples/drawings/AMP.dsn', import.meta.url),
);
const symbols = (sheet) =>
  sheet.items.filter((item) => item.NodeName === 'symbol');
const pins = (symbol) =>
  symbol._symbol.outlines.flatMap((outline) =>
    outline.items.filter((item) => item.NodeName === 'pin'),
  );
const uid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

test('carries schematic purchasing attributes through the ECO into native PCB BOMs', async () => {
  const reference = new URL('../../examples/pcb/led-classroom/Reference/', import.meta.url);
  const board = await api.decodeBoard(await readFile(new URL('LED.dpn', reference)));
  const drawing = await api.decodeDrawing(await readFile(new URL('LED.dzn', reference)));
  const resistor = drawing.sheets.flatMap(symbols).find((symbol) =>
    symbol.text.some(({ description, value }) => description === 'Ref' && value === 'R1'));
  assert.ok(resistor);
  const fields = { Manufacturer: 'Example Parts', MPN: '=RES-330', Supplier: 'Parts & Co.',
    'Supplier SKU': 'A-330', 'Rated Voltage': '75 V', 'Power Rating': '0.25 W', Tolerance: '1%' };
  const addField = (description, value) =>
    resistor.text.push({ ...resistor.text[0], description, value, type: 2 });
  for (const [name, value] of Object.entries(fields)) addField(name, value);
  async function compile(drawing) {
    const graph = await api.buildHierarchicalNetlist({ drawing, path: 'LED.dzn' });
    return (await api.buildHierarchicalCircuitSnapshot(graph, {
      documentId: drawing.documentId, revision: board.appliedCircuit.revision + 1,
      previous: board.appliedCircuit.nets,
    })).snapshot;
  }
  const snapshot = await compile(await api.decodeDrawing(await api.encodeDrawing(drawing, 'zip-v1')));
  const procurement = { manufacturer: 'Example Parts', mpn: '=RES-330', supplier: 'Parts & Co.',
    supplierPartNumber: 'A-330', voltageRating: '75 V', powerRating: '0.25 W', tolerance: '1%' };
  assert.deepEqual(snapshot.components.find(({ reference }) => reference === 'R1').procurement, procurement);
  const eco = await api.previewCircuitEco(board, board.appliedCircuit, snapshot);
  assert.deepEqual(eco.changes.find(({ reference }) => reference === 'R1').fields, ['Purchasing details']);
  const saved = await api.decodeBoard(await api.encodeBoard(api.applyCircuitEco(board, eco)));
  assert.deepEqual(saved.components.find(({ reference }) => reference === 'R1').procurement, procurement);
  assert.deepEqual(saved.appliedCircuit.components.find(({ reference }) => reference === 'R1').procurement, procurement);
  assert.deepEqual(saved.footprints, board.footprints);
  assert.deepEqual(saved.tracks, board.tracks);
  assert.equal(saved.sourceCircuit.connectivityDigest, board.sourceCircuit.connectivityDigest);
  const spreadsheet = api.boardAssembly(saved)['bom.csv'];
  assert.match(spreadsheet, /Manufacturer,MPN,Supplier,Supplier part number,Voltage rating,Power rating,Tolerance/);
  assert.ok(spreadsheet.includes('"Example Parts","\'=RES-330","Parts & Co.","A-330","75 V","0.25 W","1%"'));
  assert.ok(api.boardAssembly(saved, undefined, 'raw')['bom.csv'].includes('"=RES-330"'));

  const [part] = saved.components.filter(({ reference }) => reference === 'R1');
  const equal = { ...part, id: crypto.randomUUID(), reference: 'R2' };
  const different = { ...part, id: crypto.randomUUID(), reference: 'R3', procurement: { ...procurement, voltageRating: '50 V' } };
  const bom = api.boardAssembly({ ...saved, footprints: [], components: [part, equal, different] })['bom.csv'];
  assert.match(bom, /"R1, R2","2"/);
  assert.match(bom, /"R3","1"/);

  addField('Manufacturer Part Number', 'Other Part');
  await assert.rejects(compile(drawing), /R1: conflicting MPN attributes/);
});

test('legacy XML receives stable unit and pin identities through DSN and compressed DZN', async () => {
  const drawing = await api.decodeDrawing(legacy);
  const [sheet] = drawing.sheets;
  const [symbol] = symbols(sheet);
  const [pin] = pins(symbol);
  const reference = symbol.text.find((field) => field.description === 'Ref');
  const runtimeId = symbol._id;
  assert.match(symbol.unitId, uid);
  assert.match(pin.pinId, uid);

  reference.value = 'Q100';
  pin.name = 'renamed gate';
  pin.number = '01';
  sheet.name = 'Renamed sheet';
  sheet.items.reverse();

  for (const encoding of ['xml', 'zip-v1']) {
    const encoded = await api.encodeDrawing(drawing, encoding);
    const restored = await api.decodeDrawing(encoded);
    assert.equal(restored.documentId, drawing.documentId);
    assert.equal(restored.sheets[0].id, sheet.id);
    const restoredUnit = symbols(restored.sheets[0]).find(
      (item) => item.unitId === symbol.unitId,
    );
    assert.notEqual(restoredUnit._id, runtimeId);
    assert.equal(
      restoredUnit.text.find((field) => field.description === 'Ref').value,
      'Q100',
    );
    const restoredPin = pins(restoredUnit).find(
      (item) => item.pinId === pin.pinId,
    );
    assert.equal(restoredPin.name, 'renamed gate');
    assert.equal(restoredPin.number, '01');
  }
});

test('native clipboard paste creates a new unit identity and retains the shared pin definitions', async () => {
  const drawing = await api.decodeDrawing(legacy);
  const [sheet] = drawing.sheets;
  const [original] = symbols(sheet);
  const editor = new api.updateView();
  const view = { _selected_array: [original._id] };
  const clipboard = editor.copy_tinycad_doc(view, sheet);
  const copy = editor.paste_tinycad_doc(view, sheet, clipboard, [2000, 2000]);
  const pasted = symbols(copy.sheet).find(
    (symbol) => symbol._id === copy.view._selected_array[0],
  );
  assert.match(pasted.unitId, uid);
  assert.notEqual(pasted.unitId, original.unitId);
  assert.deepEqual(
    pins(pasted).map((pin) => pin.pinId),
    pins(original).map((pin) => pin.pinId),
  );
});

test('new library placements use distinct UUIDs and carry a shared pin definition and package hint', async () => {
  const drawing = api.blank();
  const editor = new api.updateView();
  const view = { _selected_array: [] };
  const newPin = editor.command_add_pin(
    { ...view, selected_sheet: 0 },
    drawing.sheets[0],
  ).view.add;
  const library = {
    id: 'fixture-library-symbol',
    Name: 'Part',
    Reference: 'U?',
    ppp: 1,
    ShowName: 0,
    ShowRef: 0,
    Attributes: [{ AttName: 'Package', AttValue: 'SOT-23-5', ShowAtt: 2 }],
  };
  const first = editor.handleSelectLibrarySymbol(
    view,
    drawing.sheets[0],
    library,
    [[newPin]],
    [100, 100],
  );
  const second = editor.handleSelectLibrarySymbol(
    view,
    first.sheet,
    library,
    [[newPin]],
    [200, 200],
  );
  const [one, two] = symbols(second.sheet);
  assert.match(newPin.pinId, uid);
  assert.match(one.unitId, uid);
  assert.notEqual(one.unitId, two.unitId);
  assert.equal(pins(one)[0].pinId, newPin.pinId);
  assert.equal(pins(two)[0].pinId, newPin.pinId);
  assert.equal(
    two.text.find((field) => field.description === 'Package').value,
    'SOT-23-5',
  );
  const saved = await api.encodeDrawing(
    { ...drawing, sheets: [second.sheet] },
    'xml',
  );
  const reopened = await api.decodeDrawing(saved);
  assert.deepEqual(
    symbols(reopened.sheets[0]).map((symbol) => symbol.unitId),
    [one.unitId, two.unitId],
  );
});

const pinXml = (number, name, which = 0, part = 0, position = '0,0') =>
  `<PIN pos="${position}" which="${which}" elec="4" direction="0" part="${part}" number="${number}" show="0" length="0" number_pos="0" centre_name="0">${name}</PIN>`;
const definition = (pins, parts = 1) =>
  `<SYMBOLDEF id="1"><NAME type="0">Part</NAME><GUID>test</GUID><REF type="0">U?</REF><DESCRIPTION>Test</DESCRIPTION><PPP>${parts}</PPP><REF_POINT pos="0,0" power="0" part="1"/><TinyCAD>${pins}</TinyCAD></SYMBOLDEF>`;
const instance = (reference, position, part = 0) =>
  `<SYMBOL pos="${position}" id="1" show_power="0" can_scale="0" scale_x="1" scale_y="1" part="${part}" rotate="0"><FIELD pos="0,0" value="${reference}" description="Ref" type="0" show="1"/><FIELD pos="0,0" value="SOT-23" description="Package" type="0" show="0"/></SYMBOL>`;

function parse(xml) {
  const builder = new api.XMLBuilder();
  builder.fromText(xml);
  return new api.ioXML().from_dsn(builder);
}

test('checks named power rails and native electrical pin types', async () => {
  const checker = new api.updateDrawing();
  const marker = (name, position) =>
    `<POWER pos="${position}" direction="0" which="0">${name}</POWER>`;
  const rail = (types, names = ['VCC', 'VCC']) => {
    const parts = types.map((type, index) => {
      const id = String(index + 1);
      const term = pinXml('1', 'Terminal').replace('elec="4"', `elec="${type}"`);
      return definition(term).replace('id="1"', `id="${id}"`).replace('<GUID>test', `<GUID>test-${id}`);
    });
    const units = types.map((_, index) =>
      instance(`U${index + 1}`, `${20 + 10 * index},20`).replace('id="1"', `id="${index + 1}"`));
    return parse(
      '<TinyCADSheets><TinyCAD><NAME>Rail</NAME>' + parts.join('') + units.join('') +
      marker(names[0], '20,20') + marker(names[1], '60,20') +
      [20, 30, 40, 50].map((x) => `<WIRE a="${x},20" b="${x + 10},20"/>`).join('') +
      '</TinyCAD></TinyCADSheets>',
    );
  };

  const compile = [
    async (drawing) => new api.NetlistWorkerState().init(drawing),
    async (drawing) => api.buildHierarchicalNetlist({ drawing, path: 'Rail.dsn' }),
  ];
  for (const netlist of compile) {
    const valid = rail([10, 9, 9, 7, 8]);
    const compiled = await netlist(valid);
    const railCounts = compiled.eprops[compiled.labels.VCC];
    assert.equal(railCounts.powers, 2);
    assert.equal(railCounts.power_outputs, 1);
    assert.equal(railCounts.power_inputs, 2);
    assert.equal(railCounts.free, 1);
    assert.equal(railCounts.unspecified, 1);
    assert.deepEqual(checker.designRulesCheck(valid, valid.drc, compiled), []);

    for (const [types, message] of [
      [[10, 10], 'Multiple power outputs on same net'],
      [[9, 9], 'Multiple power inputs with no driver'],
      [[10, 1], 'Power connected to an output'],
    ]) {
      const drawing = rail(types);
      assert.deepEqual(checker.designRulesCheck(drawing, drawing.drc, await netlist(drawing))
        .map(({ text }) => text), [message]);
    }
    const openEmitter = await netlist(rail([11]));
    assert.equal(openEmitter.eprops[openEmitter.labels.VCC].open_emitters, 1);

    const shorted = rail([], ['VCC', 'VDD']);
    const findings = checker.designRulesCheck(shorted, {
      ...shorted.drc, MultipleNetNames: false,
    }, await netlist(shorted));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].text, 'Power connected to power');
    assert.equal(findings[0].symbol, 'VDD');
    assert.deepEqual(findings[0].a, [300, 100]);
  }
});

test('the MCU and sensor schematic passes ERC and still matches its saved PCB', async () => {
  const reference = new URL('../../examples/pcb/mcu-sensor/', import.meta.url);
  const drawing = await api.decodeDrawing(await readFile(new URL('Sensor.dsn', reference)));
  const board = await api.decodeBoard(await readFile(new URL('Sensor.dpn', reference)));
  const graph = await api.buildHierarchicalNetlist({ drawing, path: 'Sensor.dsn' });
  assert.deepEqual(new api.updateDrawing().designRulesCheck(drawing, drawing.drc, graph), []);
  const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
    documentId: drawing.documentId, revision: board.sourceCircuit.revision,
    previous: board.appliedCircuit.nets,
  });
  assert.equal(await api.circuitConnectivityDigest(snapshot), board.sourceCircuit.connectivityDigest);
});

test('audits hidden power by intent and keeps an explicit no-connect attached to its terminal', () => {
  const drawing = parse(
    `<TinyCAD>${definition(
      pinXml('A1', 'SIG') + pinXml('EP', 'GND', 4, 0, '0,2'),
    )}${instance('U1', '20,20')}</TinyCAD>`,
  );
  const [sheet] = drawing.sheets;
  const [symbol] = symbols(sheet);
  const active = new api.updateSymbol(symbol).active_points()[0];
  sheet.items.push({
    NodeName: 'noconnect',
    _id: 32767,
    point: active.slice(0, 2),
  });
  assert.deepEqual(api.auditPcbSchematic(drawing), []);
  const worker = new api.NetlistWorkerState().init(drawing);
  const nets = Object.values(worker.nets);
  const hiddenPower = nets.flat().find((node) => node.pin === 'EP');
  assert.equal(hiddenPower.label, 'GND');
  assert.equal(hiddenPower.a, null);
  const noConnectNet = nets.find((net) =>
    net.some((node) => node.parent?.NodeName === 'noconnect'),
  );
  assert.deepEqual(
    noConnectNet.filter((node) => node.symbol).map((node) => node.pin),
    ['A1'],
  );
  assert.equal(
    symbol.text.find((field) => field.description === 'Package').value,
    'SOT-23',
  );
});

test('lists bus, hierarchy and multipart capability gaps by source item or sheet', () => {
  const drawing = parse(
    `<TinyCADSheets><TinyCAD><NAME>Main</NAME>${definition(
      pinXml('01', 'A') + pinXml('02', 'B', 0, 1, '0,2'),
      2,
    )}${instance('U1', '20,20')}${instance(
      'U1',
      '30,30',
      1,
    )}</TinyCAD><HierarchicalSymbol><NAME>Child</NAME>${pinXml(
      '1',
      'PORT',
    )}</HierarchicalSymbol></TinyCADSheets>`,
  );
  const interfaceSheet = drawing.sheets.find(
    (sheet) => sheet.hierarchicalSymbol,
  );
  drawing.sheets
    .find((sheet) => !sheet.hierarchicalSymbol)
    .items.push({
      NodeName: 'buswire',
      _id: 32767,
      d_points: [
        [100, 100],
        [200, 100],
      ],
    });
  const issues = api.auditPcbSchematic(drawing);
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['hierarchy', 'multipart', 'reference', 'multipart', 'bus'],
  );
  assert.equal(issues.find((issue) => issue.code === 'bus').itemId, 32767);
  assert.equal(
    issues.find((issue) => issue.code === 'hierarchy').sheetId,
    interfaceSheet.id,
  );
  const netlist = new api.NetlistWorkerState().init(drawing);
  assert.deepEqual(
    netlist.symbols.map(([, entry]) => entry.part),
    [0, 1],
  );
  assert.deepEqual(
    Object.values(netlist.nets)
      .flat()
      .filter((node) => node.symbol)
      .map((node) => node.pin)
      .sort(),
    ['01', '02'],
  );
});

test('keeps coincident coordinates on separate sheets apart unless a net label joins them', () => {
  const part = definition(pinXml('01', 'Signal'));
  const drawing = parse(
    `<TinyCADSheets><TinyCAD><NAME>First</NAME>${part}${instance(
      'U1',
      '20,20',
    )}</TinyCAD>` +
      `<TinyCAD><NAME>Second</NAME>${part}${instance(
        'U2',
        '20,20',
      )}</TinyCAD></TinyCADSheets>`,
  );
  const groups = () =>
    Object.values(new api.NetlistWorkerState().init(drawing).nets)
      .map((net) =>
        net
          .filter((node) => node.symbol)
          .map((node) => node.reference)
          .sort(),
      )
      .filter((net) => net.length);
  assert.deepEqual(groups().flat().sort(), ['U1', 'U2']);
  assert.equal(groups().length, 2);
  for (const [index, sheet] of drawing.sheets.entries()) {
    const [x, y] = new api.updateSymbol(symbols(sheet)[0]).active_points()[0];
    sheet.items.push({
      NodeName: 'label',
      _id: 32000 + index,
      point: [x, y],
      text: 'SAME_NET',
      hints: [],
    });
  }
  assert.deepEqual(groups(), [['U1', 'U2']]);
  assert.deepEqual(api.auditPcbSchematic(drawing), []);
  drawing.sheets[1].name = 'First';
  assert.deepEqual(
    api.auditPcbSchematic(drawing).map(({ code }) => code),
    ['sheet-name'],
  );
});

test('retains net identity across renames and reports prior net IDs affected by splits and merges', () => {
  const terminal = () => ({
    unitId: crypto.randomUUID(),
    pinId: crypto.randomUUID(),
  });
  const [a, b, c] = [terminal(), terminal(), terminal()];
  const first = {
    id: crypto.randomUUID(),
    names: ['Before'],
    terminals: [a, b],
  };
  const second = { id: crypto.randomUUID(), names: ['Other'], terminals: [c] };
  const renamed = { names: ['After'], terminals: [b, a] };
  assert.deepEqual(api.reviewCircuitNets([first], [renamed]), {
    nets: [{ retainedId: first.id, affectedPreviousIds: [], draft: renamed }],
    removedIds: [],
  });
  const split = api.reviewCircuitNets(
    [first],
    [
      { names: ['Before'], terminals: [a] },
      { names: ['Split'], terminals: [b] },
    ],
  );
  assert.deepEqual(
    split.nets.map((net) => net.retainedId),
    [undefined, undefined],
  );
  assert.deepEqual(
    split.nets.map((net) => net.affectedPreviousIds),
    [[first.id], [first.id]],
  );
  assert.deepEqual(split.removedIds, [first.id]);
  const merged = api.reviewCircuitNets(
    [first, second],
    [{ names: ['Before'], terminals: [a, b, c] }],
  );
  assert.equal(merged.nets[0].retainedId, undefined);
  assert.deepEqual(
    merged.nets[0].affectedPreviousIds,
    [first.id, second.id].sort(),
  );
});

async function compileCircuit(drawing, previous) {
  const graph = await api.buildHierarchicalNetlist(
    { drawing, path: 'Circuit.dsn' },
    async () => assert.fail('This fixture has no child schematics'),
  );
  return api.buildHierarchicalCircuitSnapshot(graph, {
    documentId: drawing.documentId,
    revision: previous ? 2 : 1,
    previous: previous?.nets,
  });
}

function field(symbol, description, value) {
  symbol.text.push({
    ...symbol.text.find((entry) => entry.description === 'Ref'),
    description,
    value,
    show: false,
  });
}

test('compiles labelled bus members, reviewed multipart power pins, roles and no-connect intent through native saves', async () => {
  const multi = definition(
    pinXml('01', 'DATA0') +
      pinXml('EP', 'GND', 4, 0, '0,2') +
      pinXml('02', 'DATA1', 0, 1) +
      pinXml('EP', 'GND', 4, 1, '0,2') +
      pinXml('8', 'VDD', 4, 1, '0,4') +
      pinXml('NC', 'Unused', 0, 1, '0,7'),
    2,
  );
  const single = definition(pinXml('A01', 'Terminal')).replace(
    'id="1"',
    'id="2"',
  );
  const another = (ref, position) =>
    instance(ref, position).replace('id="1"', 'id="2"');
  const drawing = parse(
    '<TinyCADSheets><TinyCAD><NAME>First</NAME>' +
      multi +
      single +
      instance('U1', '20,20') +
      another('R1', '20,60') +
      another('X1', '20,100') +
      '</TinyCAD><TinyCAD><NAME>Second</NAME>' +
      multi +
      single +
      instance('U1', '20,20', 1) +
      another('R2', '20,60') +
      another('X2', '20,100') +
      another('NT1', '20,130') +
      '</TinyCAD></TinyCADSheets>',
  );
  const [first, second] = drawing.sheets;
  const [a, r1, probe] = symbols(first);
  const [b, r2, offboard, tie] = symbols(second);
  const placed = (symbol, pin) =>
    new api.updateSymbol(symbol)
      .active_points()
      .find(([, , definition]) => definition.number === pin)
      .slice(0, 2);
  const bind = crypto.randomUUID();
  for (const unit of [a, b]) {
    field(unit, 'PCB Component', bind);
    field(unit, 'PCB Shared Pins', '["EP"]');
  }
  field(r1, 'PCB Role', 'dnp');
  field(
    probe,
    '$$SPICE_CONTROL',
    '{"kind":"probe","mode":"voltage","invert":false}',
  );
  field(offboard, 'PCB Role', 'off-board');
  field(tie, 'PCB Role', 'net-tie');

  let id = 20000;
  const label = (sheet, text, point) => {
    const item = {
      NodeName: 'label',
      _id: id++,
      point,
      text,
      hints: [],
      rotation: 0,
      which: 0,
    };
    sheet.items.push(item);
    return item;
  };
  const busMember = (sheet, symbol, pin, name, x) => {
    const start = placed(symbol, pin);
    const end = [x, start[1]];
    sheet.items.push(
      { NodeName: 'wire', _id: id++, d_points: [start, end] },
      { NodeName: 'busslash', _id: id++, point: end, rotation: 0 },
    );
    label(sheet, name, end);
  };
  busMember(first, a, '01', 'DATA(0)', 400);
  busMember(first, r1, 'A01', 'DATA(1)', 400);
  busMember(second, b, '02', 'DATA(1)', 400);
  busMember(second, r2, 'A01', 'DATA(0)', 400);
  for (const sheet of drawing.sheets) {
    sheet.items.push(
      {
        NodeName: 'buswire',
        _id: id++,
        d_points: [
          [400, 0],
          [400, 400],
        ],
      },
      {
        NodeName: 'buslabel',
        _id: id++,
        point: [400, 100],
        text: 'DATA(1:0)',
        rotation: 0,
      },
    );
  }
  label(first, 'DATA(0)', placed(probe, 'A01'));
  label(second, 'DATA(1)', placed(offboard, 'A01'));
  const marker = { NodeName: 'noconnect', _id: id++, point: placed(b, 'NC') };
  second.items.push(marker);
  const { snapshot } = await compileCircuit(drawing);
  const component = (ref) =>
    snapshot.components.find(({ reference }) => reference === ref);
  const u1 = component('U1');
  assert.deepEqual(
    u1.units.map(({ id }) => id),
    [a.unitId, b.unitId],
  );
  assert.equal(u1.signals.length, 5);
  const board = {
    ...api.createBoard('Multipart', 2, [
      { x: 0, y: 0 },
      { x: 10_000_000, y: 0 },
      { x: 0, y: 10_000_000 },
    ]),
    components: [{ id: u1.id, reference: 'U12', role: 'electrical' }],
    sourceCircuit: {
      documentId: snapshot.documentId,
      revision: snapshot.revision,
      connectivityDigest: await api.circuitConnectivityDigest(snapshot),
    },
  };
  const renumbered = api.applyBackAnnotation(
    drawing,
    board,
    snapshot,
    snapshot,
  );
  const reopened = await api.decodeDrawing(
    await api.encodeDrawing(renumbered.drawing, 'zip-v1'),
  );
  const renamedUnits = reopened.sheets
    .flatMap(symbols)
    .filter(({ unitId }) => unitId === a.unitId || unitId === b.unitId);
  assert.deepEqual(
    renamedUnits.map(({ part }) => part),
    [0, 1],
  );
  assert.deepEqual(
    renamedUnits.map(
      ({ text }) => text.find(({ description }) => description === 'Ref').value,
    ),
    ['U12', 'U12'],
  );
  const compiledRename = (await compileCircuit(reopened, snapshot)).snapshot;
  assert.equal(
    await api.circuitConnectivityDigest(compiledRename),
    board.sourceCircuit.connectivityDigest,
  );

  assert.equal(
    u1.signals.find(({ number }) => number === 'EP').terminals.length,
    2,
  );
  for (const [name, physicalUnits] of [
    ['DATA(0)', [a.unitId, r2.unitId]],
    ['DATA(1)', [b.unitId, r1.unitId]],
    ['GND', [a.unitId, b.unitId]],
    ['VDD', [b.unitId]],
  ]) {
    assert.deepEqual(
      snapshot.nets
        .find(({ names }) => names.includes(name))
        .terminals.map(({ unitId }) => unitId)
        .sort(),
      physicalUnits.sort(),
    );
  }
  assert.equal(component('R1').role, 'dnp');
  assert.equal(component('X1').role, 'virtual');
  assert.equal(component('X2').role, 'off-board');
  assert.equal(component('NT1').role, 'net-tie');
  assert.deepEqual(
    snapshot.noConnects,
    u1.signals.find(({ number }) => number === 'NC').terminals,
  );
  for (const terminal of u1.signals.flatMap(({ terminals }) => terminals)) {
    assert.equal(snapshot.sources[terminal.unitId].unitId, terminal.unitId);
    assert.equal(
      snapshot.sources[terminal.unitId].documentId,
      drawing.documentId,
    );
  }

  const shared = u1.signals.find(({ number }) => number === 'EP');
  const projected = api.boardPadSources(
    {
      footprints: [{ id: 'placement', deviceId: 'device', componentId: u1.id }],
      deviceDefinitions: [
        {
          id: 'device',
          footprintId: 'definition',
          assignments: [{ kind: 'signal', padId: 'pad', signalId: shared.id }],
        },
      ],
      footprintDefinitions: [
        { id: 'definition', pads: [{ id: 'pad', label: 'EP' }] },
      ],
    },
    JSON.parse(JSON.stringify(snapshot)),
  );
  assert.deepEqual(
    projected.map(({ source }) => [
      source.sheetId,
      source.unitId,
      source.pinId,
    ]),
    shared.terminals.map(({ unitId, pinId }) => [
      snapshot.sources[unitId].sheetId,
      unitId,
      pinId,
    ]),
  );
  const invalid = structuredClone(snapshot);
  invalid.nets[0].terminals.push(component('X1').signals[0].terminals[0]);
  await assert.rejects(
    api.circuitConnectivityDigest(invalid),
    /nonphysical terminal/,
  );
  const withoutProbe = structuredClone(snapshot);
  withoutProbe.components = withoutProbe.components.filter(
    ({ reference }) => reference !== 'X1',
  );
  delete withoutProbe.sources[probe.unitId];
  assert.equal(
    await api.circuitConnectivityDigest(withoutProbe),
    await api.circuitConnectivityDigest(snapshot),
  );

  for (const encoding of ['xml', 'zip-v1']) {
    const reopened = await api.decodeDrawing(
      await api.encodeDrawing(drawing, encoding),
    );
    reopened.sheets.reverse();
    for (const sheet of reopened.sheets) {
      sheet.items.reverse();
      symbols(sheet)
        .find(({ part, _symbol }) => _symbol.parts === 2)
        .text.find(({ description }) => description === 'Ref').value = 'U9';
    }
    const { snapshot: revision, review } = await compileCircuit(
      reopened,
      snapshot,
    );
    assert.equal(
      revision.components.find(({ reference }) => reference === 'U9').id,
      u1.id,
    );
    assert.deepEqual(review.removedIds, []);
    assert.equal(
      await api.circuitConnectivityDigest(revision),
      await api.circuitConnectivityDigest(snapshot),
    );
  }

  // An annotation must not silently disconnect a net.
  const invalidLabel = label(second, 'ALREADY_CONNECTED', marker.point);
  await assert.rejects(
    compileCircuit(drawing),
    ({ source, message }) =>
      source.itemId === marker._id &&
      source.sheetId === second.id &&
      /no-connect/.test(message),
  );
  second.items.splice(second.items.indexOf(invalidLabel), 1);

  b.show_power = true;
  b._active_points = null;
  await assert.rejects(
    compileCircuit(drawing),
    /Shared pin EP has inconsistent/,
  );
  b.show_power = false;
  b._active_points = null;
  b.text = b.text.filter(({ description }) => description !== 'PCB Component');
  await assert.rejects(
    compileCircuit(drawing),
    ({ source, message }) =>
      source.unitId === b.unitId && /reviewed package UUID/.test(message),
  );
});

test('keeps multipart packages separate and back-annotates both units of the selected instance', async () => {
  const symbol = definition('', 2).replace(
    '<TinyCAD></TinyCAD>',
    '<TinyCADSheets><TinyCAD>' +
      pinXml('1', 'IN') +
      '</TinyCAD><TinyCAD>' +
      pinXml('A1', 'OUT') +
      pinXml('PWR', 'VCC', 4, 0, '0,2') +
      '</TinyCAD></TinyCADSheets>',
  );
  const child = parse(
    '<TinyCADSheets><HierarchicalSymbol><NAME>Module</NAME>' +
      pinXml('1', 'IN') +
      '</HierarchicalSymbol><TinyCAD><NAME>Circuit</NAME>' +
      symbol +
      instance('U1', '20,20') +
      instance('U1', '40,20', 1) +
      '</TinyCAD></TinyCADSheets>',
  );
  const [sheet] = child.sheets.filter((item) => !item.hierarchicalSymbol);
  const [a, b] = symbols(sheet);
  assert.equal(a._symbol.heterogeneous, true);
  const binding = crypto.randomUUID();
  for (const unit of [a, b]) field(unit, 'PCB Component', binding);
  sheet.items.push({
    NodeName: 'label',
    _id: 22000,
    text: 'IN',
    hints: [],
    point: new api.updateSymbol(a).active_points()[0].slice(0, 2),
  });
  const makeChild = (ref, x) =>
    `<HIERARCHICAL_SYMBOL file="Child.dsn" pos="${x},20" rotate="0">` +
    `<FIELD type="0" description="Ref" value="${ref}" show="1" pos="0,0"/>` +
    '</HIERARCHICAL_SYMBOL>';
  const root = parse(
    '<TinyCAD>' + makeChild('H1', 80) + makeChild('H2', 120) + '</TinyCAD>',
  );
  const [h1, h2] = symbols(root.sheets[0]);
  const graph = await api.buildHierarchicalNetlist(
    { path: 'Root.dsn', drawing: root },
    async () => ({ path: 'Child.dsn', drawing: child }),
  );
  const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
    documentId: root.documentId,
    revision: 1,
  });
  assert.deepEqual(
    snapshot.components.map(({ reference }) => reference),
    ['H1_U1', 'H2_U1'],
  );
  assert.equal(new Set(snapshot.components.map(({ id }) => id)).size, 2);
  for (const [i, component] of snapshot.components.entries()) {
    const path = [i === 0 ? h1.unitId : h2.unitId];
    assert.deepEqual(component.signals.map(({ number }) => number).sort(), [
      '1',
      'A1',
      'PWR',
    ]);
    assert.deepEqual(
      component.units.map(({ id }) => snapshot.sources[id].instancePath),
      [path, path],
    );
    assert.deepEqual(
      component.units.map(({ id }) => snapshot.sources[id].unitId),
      [a.unitId, b.unitId],
    );
    const power = snapshot.nets.find(({ names }) =>
      names.includes(`H${i + 1}_VCC`),
    );
    assert.deepEqual(
      power.terminals,
      component.signals.find(({ number }) => number === 'PWR').terminals,
    );
  }
  const [selected, sibling] = snapshot.components;
  const connectivityDigest = await api.circuitConnectivityDigest(snapshot);
  const board = {
    ...api.createBoard('Multipart annotation', 2, [
      { x: 0, y: 0 },
      { x: 10_000_000, y: 0 },
      { x: 0, y: 10_000_000 },
    ]),
    sourceCircuit: {
      documentId: root.documentId,
      revision: snapshot.revision,
      connectivityDigest,
    },
    components: [selected, sibling].map(({ id, reference }) => ({
      id,
      reference,
      role: 'electrical',
    })),
  };
  const edited = api.editBoardReferences(
    board,
    new Map([[selected.id, 'U42']]),
  );
  const preview = api.previewBackAnnotation(root, edited, snapshot, snapshot);
  assert.equal(preview.canApply, true);
  assert.deepEqual(
    preview.changes[0].sources.map(({ unitId }) => unitId),
    [a.unitId, b.unitId],
  );
  const updated = api.applyBackAnnotation(root, edited, snapshot, snapshot);
  const reopened = await api.decodeDrawing(
    await api.encodeDrawing(updated.drawing, 'xml'),
  );
  const references = await api.referencesForInstance(reopened, child, [
    h1.unitId,
  ]);
  assert.equal(references[a.unitId], 'U42');
  assert.equal(references[b.unitId], 'U42');
  assert.deepEqual(
    await api.referencesForInstance(reopened, child, [h2.unitId]),
    {},
  );
  const regenerated = await api.buildHierarchicalNetlist(
    { path: 'Root.dsn', drawing: reopened },
    async () => ({ path: 'Child.dsn', drawing: child }),
  );
  const { snapshot: recompiled } = await api.buildHierarchicalCircuitSnapshot(
    regenerated,
    {
      documentId: root.documentId,
      revision: updated.board.appliedCircuit.revision,
      previous: snapshot.nets,
    },
  );
  assert.deepEqual(
    recompiled.components.map(({ id, reference }) => [id, reference]).sort(),
    [
      [selected.id, 'U42'],
      [sibling.id, sibling.reference],
    ].sort(),
  );
  assert.equal(
    await api.circuitConnectivityDigest(recompiled),
    connectivityDigest,
  );
});
