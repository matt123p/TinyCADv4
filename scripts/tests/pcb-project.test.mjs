import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const legacy = await readFile(
  new URL('../../bundled-examples/drawings/AMP.dsn', import.meta.url),
);
const drawing = await api.decodeDrawing(legacy);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function makeProject(encoding = 'xml') {
  const circuit = {
    schemaVersion: 1,
    snapshotId: crypto.randomUUID(),
    documentId: drawing.documentId,
    revision: 1,
    components: [],
    nets: [],
    noConnects: [],
  };
  const board = {
    ...api.createBoard('Linked board', 2, [
      { x: 0, y: 0 },
      { x: 2_000_000, y: 0 },
      { x: 2_000_000, y: 2_000_000 },
      { x: 0, y: 2_000_000 },
    ]),
    sourceCircuit: {
      documentId: circuit.documentId,
      revision: circuit.revision,
      connectivityDigest: await api.circuitConnectivityDigest(circuit),
    },
  };
  const entry = (kind, id, data, compressed) => ({
    kind,
    id,
    path: api.projectEntryPath(kind, id, compressed),
    data,
  });
  return {
    projectId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    title: 'Portable board',
    requiredFeatures: [],
    entries: [
      entry('board', board.boardId, encoder.encode(api.serializeBoard(board))),
      entry(
        'circuit',
        circuit.snapshotId,
        encoder.encode(JSON.stringify(circuit)),
      ),
      entry(
        'schematic',
        drawing.documentId,
        await api.encodeDrawing(drawing, encoding),
        encoding === 'zip-v1',
      ),
    ],
  };
}

test('round trips the same linked project through a deterministic archive and loose files', async () => {
  for (const encoding of ['xml', 'zip-v1']) {
    const project = await makeProject(encoding);
    const loose = await api.encodeProjectFiles(project);
    const archive = await api.encodeProjectArchive(project);
    assert.deepEqual(
      await api.encodeProjectArchive({
        ...project,
        entries: [...project.entries].reverse(),
      }),
      archive,
    );
    assert.deepEqual(
      await api.decodeProjectArchive(archive),
      await api.decodeProjectFiles(loose),
    );
    assert.deepEqual(await api.decodeProjectFiles(loose), project);
  }
});

test('rejects a damaged file, a different source circuit, and an unknown required feature', async () => {
  const project = await makeProject();
  const [board, circuit, schematic] = project.entries;
  await assert.rejects(
    api.encodeProjectFiles({ ...project, entries: [board, schematic] }),
    /inconsistent source circuit/,
  );

  const files = await api.encodeProjectFiles(project);
  const damaged = files.get(circuit.path).slice();
  damaged[0] ^= 1;
  const corruptedFiles = new Map(files).set(circuit.path, damaged);
  await assert.rejects(
    api.decodeProjectFiles(corruptedFiles),
    /damaged project entry/,
  );

  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')));
  manifest.requiredFeatures = ['unsupported-feature'];
  const incompatibleFiles = new Map(files).set(
    'manifest.json',
    encoder.encode(JSON.stringify(manifest)),
  );
  await assert.rejects(
    api.decodeProjectFiles(incompatibleFiles),
    /Unsupported required project features/,
  );
});
