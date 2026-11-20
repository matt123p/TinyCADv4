import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const utf8 = new TextDecoder();

function legacyParent(tag = 'HIERACHICAL_SYMBOL') {
  return `<TinyCADSheets><TinyCAD><NAME>Main</NAME>
    <${tag} file="..\\Blocks\\Input.dsn" pos="50,60" rotate="3" can_scale="1" scale_x="2" scale_y="1">
      <FIELD type="0" description="Name" value="" show="1" pos="0,10"/>
      <FIELD type="0" description="Ref" value="H17" show="1" pos="0,12"/>
    </${tag}>
    </TinyCAD></TinyCADSheets>`;
}

function legacyChild(tag = 'HierachicalSymbol', name = 'IN') {
  return `<TinyCADSheets><${tag}><NAME>Interface</NAME>
    <PIN pos="20,25" direction="3" which="0" elec="0" number="01" length="20"
      number_pos="0" centre_name="0" part="0" show="1">${name}</PIN>
    </${tag}><TinyCAD><NAME>Input circuit</NAME></TinyCAD>
    <TinyCAD><NAME>Filter circuit</NAME></TinyCAD></TinyCADSheets>`;
}

test('reads and writes native and both legacy hierarchy spellings without losing unresolved placements', async () => {
  for (const tag of ['HIERACHICAL_SYMBOL', 'HIERARCHICAL_SYMBOL']) {
    const parent = await api.decodeDrawing(legacyParent(tag));
    const item = parent.sheets[0].items[0];
    assert.equal(item.hierarchy.path, '..\\Blocks\\Input.dsn');
    assert.equal(item.hierarchy.cached, false);
    assert.equal(
      item.text.find((field) => field.description === 'Ref').value,
      'H17',
    );
    assert.deepEqual(item.point, [250, 300]);
    assert.equal(item.scale_x, 2);
    const saved = await api.encodeDrawing(parent, 'xml');
    assert.match(utf8.decode(saved), /<HIERARCHICAL_SYMBOL /);
    assert.doesNotMatch(utf8.decode(saved), /<HIERACHICAL_SYMBOL /);
    const copy = await api.decodeDrawing(saved);
    assert.equal(copy.sheets[0].items[0].unitId, item.unitId);
    assert.equal(copy.sheets[0].items[0].rotation, item.rotation);
    assert.deepEqual(copy.sheets[0].items[0].hierarchy, item.hierarchy);
  }
  for (const tag of ['HierachicalSymbol', 'HierarchicalSymbol']) {
    const child = await api.decodeDrawing(legacyChild(tag));
    assert.equal(child.sheets[0].hierarchicalSymbol, true);
    assert.equal(child.sheets.length, 3);
    const bytes = await api.encodeDrawing(child, 'zip-v1');
    const port = (await api.decodeDrawing(bytes)).sheets[0].items[0];
    assert.equal(port.pinId, child.sheets[0].items[0].pinId);
    assert.equal(port.name, 'IN');
    assert.equal(port.number, '01');
  }
});

test('resolves v3 relative paths without accepting root escapes, and validates interface ports', async () => {
  const parent = await api.decodeDrawing(legacyParent());
  const oldLink = parent.sheets[0].items[0].hierarchy;
  assert.equal(api.childPath(oldLink, 'src/Main.dsn'), 'Blocks/Input.dsn');
  assert.throws(() => api.childPath(oldLink, 'Main.dsn'), /leaves the project/);
  assert.throws(
    () =>
      api.childPath({ ...oldLink, path: 'C:\\blocks\\Input.dsn' }, 'Main.dsn'),
    /Choose a schematic/,
  );
  assert.throws(
    () =>
      api.childPath(
        { ...oldLink, path: '../Other.dsn', documentId: crypto.randomUUID() },
        'src/Main.dsn',
      ),
    /leaves the project/,
  );
  const child = await api.decodeDrawing(legacyChild());
  const sheet = child.sheets[0];
  sheet.items.push({ ...sheet.items[0], pinId: crypto.randomUUID() });
  await assert.rejects(
    api.childInterface(child, 'Input'),
    /distinct, nonempty port names/,
  );
});

test('embeds native port identities and reports changed connected hotspots while preserving the instance', async () => {
  const parent = await api.decodeDrawing(legacyParent());
  const child = await api.decodeDrawing(legacyChild());
  const root = parent.sheets[0];
  const old = root.items[0];
  const art = await api.childInterface(child, 'Input.dsn');
  const definition = api.hierarchyDefinition(root, art);
  const link = {
    path: 'Blocks/Input.dsn',
    documentId: child.documentId,
    cached: true,
  };
  const placed = api.refreshPlacement(old, link, definition);
  root.items[0] = placed;
  const [x, y] = new api.updateSymbol(placed).active_points()[0];
  assert(Number.isFinite(x) && Number.isFinite(y));
  root.items.push({
    _id: 5000,
    NodeName: 'wire',
    d_points: [
      [x, y],
      [x + 20, y],
    ],
    _magnetic: null,
  });
  const reloaded = await api.decodeDrawing(
    await api.encodeDrawing(parent, 'xml'),
  );
  const instance = reloaded.sheets[0].items.find((item) => item.hierarchy);
  assert.deepEqual(instance.hierarchy, link);
  assert.equal(instance.unitId, old.unitId);
  assert.equal(
    instance._symbol.outlines[0].active_points[0].pin.pinId,
    child.sheets[0].items[0].pinId,
  );
  const pin = child.sheets[0].items[0];
  child.sheets[0].items[0] = { ...pin, name: 'INPUT' };
  const revisedArt = await api.childInterface(child, 'Input.dsn');
  const revised = api.refreshPlacement(
    placed,
    link,
    api.hierarchyDefinition(root, revisedArt),
  );
  assert.deepEqual(api.affectedPorts(root, placed, revised), ['IN']);
  assert.equal(revised.unitId, old.unitId);
});
