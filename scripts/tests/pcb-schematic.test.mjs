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
  const interfaceSheet = drawing.sheets.find((sheet) => sheet.hierarchicalSymbol);
  drawing.sheets.find((sheet) => !sheet.hierarchicalSymbol).items.push({
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
