import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const pin = (name, which = 0) =>
  `<PIN pos="0,0" direction="3" which="${which}" elec="4" number="01" length="20" number_pos="0" centre_name="0" part="0" show="1">${name}</PIN>`;
const placed = (ref, number, x, y) =>
  `<SYMBOL id="${number}" pos="${x},${y}" part="0" rotate="0" show_power="0"><FIELD type="0" description="Ref" value="${ref}" show="1" pos="0,0"/><FIELD type="0" description="Name" value="Resistor" show="1" pos="0,0"/></SYMBOL>`;
const definition = (id, name = 'TERMINAL', which = 0) =>
  `<SYMBOLDEF id="${id}"><NAME type="0">Resistor</NAME><REF type="0">R?</REF><PPP>1</PPP><REF_POINT pos="0,0"/><TinyCAD>${pin(
    name,
    which,
  )}</TinyCAD></SYMBOLDEF>`;
const block = (ref, path, x, y) =>
  `<HIERACHICAL_SYMBOL file="${path}" pos="${x},${y}" rotate="0"><FIELD type="0" description="Ref" value="${ref}" show="1" pos="0,0"/></HIERACHICAL_SYMBOL>`;
const wrap = (...sheets) => `<TinyCADSheets>${sheets.join('')}</TinyCADSheets>`;
const sheet = (name, body) => `<TinyCAD><NAME>${name}</NAME>${body}</TinyCAD>`;
const iface = (name = 'IN') =>
  `<HierachicalSymbol><NAME>Interface</NAME>${pin(name)}</HierachicalSymbol>`;
const symbols = (sheet) =>
  sheet.items.filter((item) => item.NodeName === 'symbol');
const anchor = (symbol) =>
  new api.updateSymbol({ ...symbol, _active_points: null })
    .active_points()[0]
    .slice(0, 2);
let itemId = 9000;
const label = (sheet, name, point) =>
  sheet.items.push({ NodeName: 'label', _id: itemId++, text: name, point });
const wire = (sheet, a, b) =>
  sheet.items.push({ NodeName: 'wire', _id: itemId++, d_points: [a, b] });

async function fixture() {
  const [root, child, leaf] = await Promise.all([
    api.decodeDrawing(
      wrap(
        sheet(
          'Main',
          definition(1) +
            placed('R1', 1, 10, 20) +
            placed('R2', 1, 10, 60) +
            block('H1', '..\\Blocks\\Child.dsn', 50, 20) +
            block('H2', '..\\Blocks\\Child.dsn', 50, 60),
        ),
      ),
    ),
    api.decodeDrawing(
      wrap(
        iface(),
        sheet(
          'Input',
          definition(1) +
            definition(2, 'VCC', 4) +
            placed('R1', 1, 10, 20) +
            placed('R2', 1, 10, 40) +
            placed('R4', 1, 10, 60) +
            placed('R5', 2, 10, 70),
        ),
        sheet(
          'Output',
          definition(1) +
            placed('R3', 1, 10, 40) +
            block('H1', 'Leaf.dsn', 50, 20),
        ),
      ),
    ),
    api.decodeDrawing(
      wrap(iface(), sheet('Leaf', definition(1) + placed('R1', 1, 10, 20))),
    ),
  ]);
  const [main] = root.sheets;
  const [, input, output] = child.sheets;
  const [, leafCircuit] = leaf.sheets;
  const [r1, r2, h1, h2] = symbols(main);
  const [inputR1, localR2, powerR4] = symbols(input);
  const [localR3, nested] = symbols(output);
  const [leafR1] = symbols(leafCircuit);
  const prepare = async (sheet, child, symbol) => {
    const def = api.hierarchyDefinition(
      sheet,
      await api.childInterface(child, symbol.hierarchy.path),
    );
    return anchor(api.refreshPlacement(symbol, symbol.hierarchy, def));
  };
  wire(main, anchor(r1), await prepare(main, child, h1));
  wire(main, anchor(r2), await prepare(main, child, h2));
  label(input, 'IN', anchor(inputR1));
  label(output, 'IN', await prepare(output, leaf, nested));
  label(leafCircuit, 'IN', anchor(leafR1));
  label(input, 'LOCAL', anchor(localR2));
  label(output, 'LOCAL', anchor(localR3));
  label(input, 'VCC', anchor(powerR4));
  const files = new Map([
    ['src/Main.dsn', root],
    ['Blocks/Child.dsn', child],
    ['Blocks/Leaf.dsn', leaf],
  ]);
  return { files, root, child, leaf, h1, h2 };
}

function compile(files) {
  return api.buildHierarchicalNetlist(
    { path: 'src/Main.dsn', drawing: files.get('src/Main.dsn') },
    async (parent, link) => {
      const path = api.childPath(link, parent.path);
      const drawing = files.get(path);
      if (!drawing) throw new Error(`Missing child ${path}.`);
      return { path, drawing };
    },
  );
}

function memberships(graph) {
  return Object.values(graph.nets)
    .map((nodes) =>
      nodes
        .filter((node) => node.symbol)
        .map((node) => node.reference)
        .sort()
        .join(' '),
    )
    .filter(Boolean)
    .sort();
}

const expected = [
  'H1_H1_R1 H1_R1 R1',
  'H2_H1_R1 H2_R1 R2',
  'H1_R2 H1_R3',
  'H2_R2 H2_R3',
  'H1_R4 H1_R5',
  'H2_R4 H2_R5',
].sort();

test('binds v3 named ports across nested, repeated and multi-sheet designs with instance-local labels and hidden power', async () => {
  const { files, root, child, leaf, h1, h2 } = await fixture();
  const graph = await compile(files);
  assert.deepEqual(memberships(graph), expected);
  assert.equal(graph.symbols.length, 14);
  assert.notEqual(graph.labels.H1_LOCAL, graph.labels.H2_LOCAL);
  assert.notEqual(graph.labels.H1_VCC, graph.labels.H2_VCC);
  const sourceFor = (reference) => {
    const symbol = graph.symbols.find(
      ([, item]) =>
        item.text.find((field) => field.description === 'Ref').value ===
        reference,
    )[1];
    return graph.sources[symbol.unitId];
  };
  assert.deepEqual(sourceFor('H1_R1').instancePath, [h1.unitId]);
  assert.deepEqual(sourceFor('H2_R1').instancePath, [h2.unitId]);
  assert.equal(sourceFor('H2_R1').documentId, child.documentId);
  assert.equal(sourceFor('H2_H1_R1').documentId, leaf.documentId);
  assert.equal(sourceFor('H2_H1_R1').instancePath.length, 2);
  const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
    documentId: root.documentId,
    revision: 1,
  });
  assert.equal(snapshot.components.length, graph.symbols.length);
  assert.equal(snapshot.nets.length, expected.length);
  const cloned = new Map(
    await Promise.all(
      [...files].map(async ([path, drawing]) => [
        path,
        await api.decodeDrawing(await api.encodeDrawing(drawing, 'xml')),
      ]),
    ),
  );
  const savedGraph = await compile(cloned);
  assert.deepEqual(memberships(savedGraph), expected);
  const clonedRoot = cloned.get('src/Main.dsn');
  symbols(clonedRoot.sheets[0])
    .find((item) => item.unitId === h2.unitId)
    .text.find((field) => field.description === 'Ref').value = 'H7';
  const renamed = await compile(cloned);
  const { snapshot: revision, review } =
    await api.buildHierarchicalCircuitSnapshot(renamed, {
      documentId: root.documentId,
      revision: 2,
      previous: snapshot.nets,
    });
  assert.deepEqual(
    Object.keys(revision.sources).sort(),
    Object.keys(snapshot.sources).sort(),
  );
  assert.equal(review.removedIds.length, 0);
  assert.equal(
    await api.circuitConnectivityDigest(snapshot),
    await api.circuitConnectivityDigest(revision),
  );
});

test('reports the exact placement on a missing child, cycle or ambiguous port', async () => {
  const { files, root, h1, child } = await fixture();
  const match = (pattern) => (error) =>
    error instanceof api.HierarchyConnectivityError &&
    pattern.test(error.message) &&
    error.source.documentId === root.documentId &&
    error.source.itemId === h1._id &&
    error.source.sheetId === root.sheets[0].id;
  const original = h1.hierarchy.path;
  h1.hierarchy.path = 'Missing.dsn';
  await assert.rejects(compile(files), match(/Missing child/));
  h1.hierarchy.path = 'Main.dsn';
  await assert.rejects(compile(files), match(/cycle/));
  h1.hierarchy.path = original;
  const interfaceSheet = child.sheets[0];
  interfaceSheet.items.push({
    ...interfaceSheet.items[0],
    pinId: crypto.randomUUID(),
  });
  await assert.rejects(compile(files), match(/distinct, nonempty port names/));
  interfaceSheet.items.pop();
  const output = child.sheets[1];
  output.items = output.items.filter((item) => item.text !== 'IN');
  child.sheets[2].items = child.sheets[2].items.filter(
    (item) => item.text !== 'IN',
  );
  await assert.rejects(compile(files), match(/missing binding for port IN/));
});
