import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const fixturePath = (path) =>
  new URL('./fixtures/pcb-hierarchy/' + path, import.meta.url);
const symbols = (sheet) =>
  sheet.items.filter((item) => item.NodeName === 'symbol');

async function fixture() {
  const paths = ['src/Circuit.dsn', 'Blocks/Child.dsn', 'Blocks/Leaf.dsn'];
  const [root, child, leaf] = await Promise.all(
    paths.map(async (path) =>
      api.decodeDrawing(await readFile(fixturePath(path))),
    ),
  );
  const [, , h1, h2] = symbols(root.sheets[0]);
  const files = new Map(
    paths.map((path, index) => [path, [root, child, leaf][index]]),
  );
  return { files, root, child, leaf, h1, h2 };
}

function compile(files) {
  return api.buildHierarchicalNetlist(
    { path: 'src/Circuit.dsn', drawing: files.get('src/Circuit.dsn') },
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
  const v3 = await readFile(fixturePath('v3-netlist.xml'), 'utf8');
  // The v3 XML export puts the leaf reference first and appends the instance path
  // from inner to outer. Compare references and pin numbers in the same order.
  const v3Members = [...v3.matchAll(/<net\b[^>]*>([\s\S]*?)<\/net>/g)]
    .map(([, net]) =>
      [...net.matchAll(/<pin part="([^"]+)" name="[^"]*" number="([^"]+)"/g)]
        .map(
          ([, reference, pin]) =>
            reference.split('_').reverse().join('_') + '.' + pin,
        )
        .sort()
        .join(' '),
    )
    .sort();
  const actualMembers = Object.values(graph.nets)
    .map((nodes) =>
      nodes
        .filter((node) => node.symbol)
        .map((node) => node.reference + '.' + node.pin)
        .sort()
        .join(' '),
    )
    .filter(Boolean)
    .sort();
  assert.deepEqual(actualMembers, v3Members);
  assert.equal(graph.symbols.length, [...v3.matchAll(/<part ref=/g)].length);
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
  const clonedRoot = cloned.get('src/Circuit.dsn');
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
  h1.hierarchy.path = 'Circuit.dsn';
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

test('keeps colliding exported label names on separate nets', async () => {
  const { files, root } = await fixture();
  const [r1, r2] = symbols(root.sheets[0]);
  const hotspot = (symbol) =>
    new api.updateSymbol(symbol).active_points()[0].slice(0, 2);
  root.sheets[0].items.push(
    { NodeName: 'label', _id: 10001, text: 'H1_LOCAL', point: hotspot(r1) },
    { NodeName: 'label', _id: 10002, text: '__proto__', point: hotspot(r2) },
  );
  const graph = await compile(files);
  assert.deepEqual(memberships(graph), expected);
  assert.notEqual(graph.labels.H1_LOCAL, graph.labels.H1_LOCAL_2);
  assert.ok(
    graph.nets[graph.labels.H1_LOCAL_2].some(
      ({ reference }) => reference === 'H1_R2',
    ),
  );
  assert.ok(
    graph.nets[graph.labels.__proto__].some(
      ({ reference }) => reference === 'R2',
    ),
  );
});

test('reports the source of a bus before creating an incomplete PCB snapshot', async () => {
  const { files, root, child, h1 } = await fixture();
  const sheet = child.sheets[1];
  sheet.items.push({
    NodeName: 'buswire',
    _id: 10001,
    d_points: [
      [0, 0],
      [20, 0],
    ],
  });
  const graph = await compile(files);
  await assert.rejects(
    api.buildHierarchicalCircuitSnapshot(graph, {
      documentId: root.documentId,
      revision: 1,
    }),
    (error) =>
      error instanceof api.HierarchyConnectivityError &&
      /Review bus connectivity/.test(error.message) &&
      error.source.sheetId === sheet.id &&
      error.source.instancePath[0] === h1.unitId,
  );
});
