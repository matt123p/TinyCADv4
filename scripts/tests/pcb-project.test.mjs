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

test('compares stable entry identities across project revisions', async () => {
  const original = await makeProject();
  const [board, circuit, schematic] = original.entries;
  const recipeId = crypto.randomUUID();
  const recipePath = api.projectEntryPath('recipe', recipeId);
  const replacement = {
    ...original,
    revisionId: crypto.randomUUID(),
    parentRevisionId: original.revisionId,
    entries: [
      {
        ...schematic,
        path: api.projectEntryPath('schematic', schematic.id, true),
        data: await api.encodeDrawing(drawing, 'zip-v1'),
      },
      circuit,
      {
        kind: 'recipe',
        id: recipeId,
        path: recipePath,
        data: encoder.encode(
          JSON.stringify({ id: recipeId, schemaVersion: 1 }),
        ),
      },
    ],
  };
  const before = await api.revisionInventory(original);
  const after = await api.revisionInventory(replacement);
  assert.deepEqual(api.compareProjectRevisions(before, after), [
    { kind: 'removed', before: board.path },
    { kind: 'added', after: recipePath },
    {
      kind: 'changed',
      before: schematic.path,
      after: replacement.entries[0].path,
    },
  ]);
  assert.throws(
    () =>
      api.compareProjectRevisions(before, {
        ...after,
        projectId: crypto.randomUUID(),
      }),
    /same project/,
  );
});

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

test('lists paged Drive project files and folders and skips ordinary drawings', async () => {
  const calls = [];
  const files = await api.driveProjectFiles(
    { operation: 'list', folder: 'root' },
    async (resource) => {
      const query = new URL(resource, 'https://example.test').searchParams;
      calls.push(query.get('pageToken'));
      assert.equal(query.get('q'), "'root' in parents and trashed = false");
      return query.has('pageToken')
        ? Response.json({
            files: [
              {
                id: 'boards',
                name: 'Boards',
                mimeType: 'application/vnd.google-apps.folder',
              },
            ],
          })
        : Response.json({
            nextPageToken: 'next',
            files: [
              {
                id: 'circuit',
                name: 'Circuit.dsn',
                mimeType: 'application/octet-stream',
              },
              {
                id: 'project',
                name: 'Amp.tcproject',
                mimeType: 'application/zip',
              },
            ],
          });
    },
  );
  assert.deepEqual(calls, [null, 'next']);
  assert.deepEqual(files, [
    { id: 'project', name: 'Amp.tcproject', folder: false },
    { id: 'boards', name: 'Boards', folder: true },
  ]);
});

test('checks Drive revision tokens around reads and before overwriting a project', async () => {
  const document = new Uint8Array([1, 2, 3]);
  const requests = [];
  const drive = async (resource, options) => {
    requests.push(resource);
    if (resource.endsWith('?alt=media')) return new Response(document);
    if (resource.endsWith('?fields=version'))
      return Response.json({ version: '4' });
    assert.equal(options.method, 'PATCH');
    assert.match(options.headers['Content-Type'], /^multipart\/related;/);
    assert.match(await options.body.text(), /Amp\.tcproject/);
    return Response.json({ id: 'amp', name: 'Amp.tcproject', version: '5' });
  };
  assert.deepEqual(
    await api.driveProjectFiles({ operation: 'read', id: 'amp' }, drive),
    { data: document, version: '4' },
  );
  assert.equal(requests.length, 3);
  const write = {
    operation: 'write',
    id: 'amp',
    folder: 'root',
    name: 'Amp.tcproject',
    data: document,
    version: '3',
  };
  await assert.rejects(api.driveProjectFiles(write, drive), /changed on Drive/);
  assert.equal(requests.length, 4);
  assert.equal(
    (await api.driveProjectFiles({ ...write, version: '4' }, drive)).version,
    '5',
  );
});
