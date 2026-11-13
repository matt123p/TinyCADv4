import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bundle = fs.readFileSync(
  new URL('../../drawing-server.bundle.js', import.meta.url),
  'utf8',
);
const font =
  '<FONT id="1"><HEIGHT>10</HEIGHT><WIDTH>0</WIDTH><WEIGHT>400</WEIGHT><ITALIC>0</ITALIC><UNDERLINE>0</UNDERLINE><STRIKEOUT>0</STRIKEOUT><CHARSET>0</CHARSET><FACENAME>Arial</FACENAME></FONT>';
const pin =
  '<PIN pos="0,0" which="0" elec="4" direction="0" part="0" number="1" show="3" length="20" number_pos="0" centre_name="0">P</PIN>';
const symboldef = `<SYMBOLDEF id="1"><NAME type="0">Part</NAME><GUID>test</GUID><REF type="0">U?</REF><DESCRIPTION>Test</DESCRIPTION><PPP>1</PPP><REF_POINT pos="0,0" power="0" part="1"/><TinyCAD>${pin}</TinyCAD></SYMBOLDEF>`;
function symbol(ref, pos = '20,20', part = 0) {
  return `<SYMBOL pos="${pos}" id="1" show_power="0" can_scale="0" scale_x="1" scale_y="1" part="${part}" rotate="0"><FIELD pos="0,0" value="${ref}" description="Ref" type="0" show="1"/></SYMBOL>`;
}
const circuit = `<TinyCAD><NAME>Main</NAME>${font}<WIRE a="20,20" b="60,20"/><LABEL pos="20.2,20" direction="0" font="1" color="000000" style="0">SIGNAL</LABEL><WIRE a="20,60" b="60,60"/><LABEL pos="20.2,60" direction="0" font="1" color="000000" style="0">OTHER</LABEL></TinyCAD>`;
function api() {
  const context = vm.createContext({ console });
  vm.runInContext(bundle, context, { timeout: 10000 });
  return context.TinyCADDrawingServerBundle;
}

test('standalone bundle runs without browser/Node globals and assigns repeatable IDs', () => {
  const runtime = api();
  const first = runtime.validateTinyCadDrawing(circuit);
  assert.equal(first.structurallyValid, true);
  assert.equal(first.sheets[0].itemCount, 4);
  assert.deepEqual(
    JSON.stringify(first),
    JSON.stringify(runtime.validateTinyCadDrawing(circuit)),
  );
});

test('renders page details and content views with real drawing primitives', () => {
  const runtime = api();
  const page = runtime.renderTinyCadDrawingSvg(circuit);
  assert.match(page, /viewBox="0 0 1485 1050"/);
  assert.match(page, /SIGNAL/);
  assert.match(page, /<line/);
  const content = runtime.renderTinyCadDrawingSvg(circuit, 1, 'content');
  assert.notEqual(content, page);
  assert.throws(
    () => runtime.renderTinyCadDrawingSvg(circuit, 2),
    /sheet must/,
  );
});

test('runs editor electrical DRC including duplicate references', () => {
  const result = api().validateTinyCadDrawing(
    `<TinyCAD>${symboldef}${symbol('U1')}${symbol('U1', '60,60')}</TinyCAD>`,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Duplicated references/.test(e.message)));
  assert.ok(result.errors.every((e) => e.sheet && e.itemId && e.message));
});

test('auto-tidy improves labels, preserves connectivity, and returns native XML', () => {
  const runtime = api(),
    result = runtime.tidyTinyCadDrawing(circuit, 1, {
      phases: ['net-labels'],
      maxEvaluations: 100,
    });
  assert.equal(result.connectivityPreserved, true);
  assert.equal(result.serializationConnectivityPreserved, true);
  assert.ok(result.changes.length, 'fixture must exercise real layout changes');
  assert.match(result.definition, /<TinyCADSheets>/);
  assert.equal(
    runtime.validateTinyCadDrawing(result.definition).structurallyValid,
    true,
  );
  assert.equal(result.validation.sheets[0].itemCount, 4);
});

test('empty selection and locked IDs retain circuit geometry', () => {
  const runtime = api();
  assert.equal(
    runtime.tidyTinyCadDrawing(circuit, 1, { selectedIds: [] }).changes.length,
    0,
  );
  const ids = runtime
    .validateTinyCadDrawing(circuit)
    .sheets[0].items.map((i) => i.id);
  assert.equal(
    runtime.tidyTinyCadDrawing(circuit, 1, { lockedIds: ids }).changes.length,
    0,
  );
  assert.throws(
    () => runtime.tidyTinyCadDrawing(circuit, 1, { selectedIds: [999999] }),
    /Unknown item ID/,
  );
});

test('roundtrips placed components and actual legacy amplifier fixture', () => {
  const runtime = api();
  const placed = `<TinyCAD>${symboldef}${symbol('U1')}</TinyCAD>`;
  const result = runtime.tidyTinyCadDrawing(placed, 1, { selectedIds: [] });
  assert.equal(result.serializationConnectivityPreserved, true);
  assert.match(runtime.renderTinyCadDrawingSvg(result.definition), /U1/);
  const legacy = fs.readFileSync(
    new URL('./fixtures/amplifier.dsn', import.meta.url),
    'utf8',
  );
  const amplifier = runtime.tidyTinyCadDrawing(legacy, 1, { selectedIds: [] });
  assert.equal(amplifier.serializationConnectivityPreserved, true);
  assert.ok(
    amplifier.validation.sheets[0].items.some((i) => i.type === 'symbol'),
  );
});

test('multipart symbol outlines survive loading and saving', () => {
  const runtime = api();
  const multi = symboldef
    .replace('<PPP>1</PPP>', '<PPP>2</PPP>')
    .replace(
      `<TinyCAD>${pin}</TinyCAD>`,
      `<TinyCADSheets><TinyCAD>${pin}</TinyCAD><TinyCAD>${pin.replace(
        'number="1"',
        'number="2"',
      )}</TinyCAD></TinyCADSheets>`,
    );
  const xml = `<TinyCAD>${multi}${symbol('U1', '20,20', 0)}${symbol(
    'U1',
    '60,20',
    1,
  )}</TinyCAD>`;
  const result = runtime.tidyTinyCadDrawing(xml, 1, { selectedIds: [] });
  assert.equal(result.serializationConnectivityPreserved, true);
  assert.match(result.definition, /number="2"/);
  assert.match(runtime.renderTinyCadDrawingSvg(result.definition), /U1/);
});

test('selected sheet operations keep other sheets and enforce limits', () => {
  const runtime = api();
  const xml = `<TinyCADSheets>${circuit}<TinyCAD><NAME>Other sheet</NAME><WIRE a="100,100" b="200,100"/></TinyCAD></TinyCADSheets>`;
  const result = runtime.tidyTinyCadDrawing(xml, 1, { phases: ['net-labels'] });
  assert.equal(result.validation.sheets.length, 2);
  assert.match(result.definition, /<NAME>Other sheet<\/NAME>/);
  assert.match(result.definition, /a="100,100" b="200,100"/);
  assert.throws(
    () => runtime.tidyTinyCadDrawing(xml, 1, { maxEvaluations: 501 }),
    /limited/,
  );
  assert.throws(
    () => runtime.validateTinyCadDrawing('<!DOCTYPE TinyCAD><TinyCAD/>'),
    /DTD/,
  );
});

test('wire net-type appearance and metadata survive rendering and saving', () => {
  const runtime = api();
  const xml =
    '<TinyCADSheets><TinyCAD><NAME>Main</NAME><WIRE a="20,20" b="60,20" net_type="Signal"/></TinyCAD><NETLIST_TYPES><TYPE name="Signal" wireColor="#123456" wireThickness="3"/></NETLIST_TYPES></TinyCADSheets>';
  assert.match(runtime.renderTinyCadDrawingSvg(xml), /#123456/);
  const output = runtime.tidyTinyCadDrawing(xml, 1, { selectedIds: [] });
  assert.match(output.definition, /net_type="Signal"/);
  assert.match(output.definition, /wireColor="#123456"/);
});
