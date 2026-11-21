import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutRuntime } from '../lib/layout-runtime.mjs';

const api = await layoutRuntime();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

test('round trips native XML settings with relocatable paths and rejects invalid links', async () => {
  const boardId = crypto.randomUUID();
  const schematicId = crypto.randomUUID();
  const settings = {
    projectId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    title: 'Prototype & revision',
    author: 'Alex & Jo "Lab"',
    requiredFeatures: [],
    primarySchematic: schematicId,
    primaryBoard: boardId,
    associations: [{ schematic: schematicId, board: boardId }],
    entries: [
      { kind: 'schematic', id: schematicId, path: 'Circuit & power/Main.dsn' },
      { kind: 'board', id: boardId, path: 'Layouts/Board.dpn' },
    ],
  };
  assert.throws(() => api.encodeProjectSettings({ ...settings, author: 'Invalid\nAuthor' }),
    /Invalid project author/);
  const bytes = api.encodeProjectSettings(settings);
  assert.match(decoder.decode(bytes), /^<\?xml/);
  assert.deepEqual(api.decodeProjectSettings(bytes), settings);
  for (const path of [
    '../Main.dsn',
    '/Main.dsn',
    'src/../Main.dsn',
    'src\\Main.dsn',
  ]) {
    assert.throws(
      () =>
        api.encodeProjectSettings({
          ...settings,
          entries: [{ ...settings.entries[0], path }, settings.entries[1]],
        }),
      /Invalid or duplicate project link/,
    );
  }
  assert.throws(
    () =>
      api.encodeProjectSettings({
        ...settings,
        primaryBoard: crypto.randomUUID(),
      }),
    /Missing primary project document/,
  );
  const xml = decoder
    .decode(bytes)
    .replace(
      '</TinyCADProject>',
      '<REQUIRED feature="future-feature"/></TinyCADProject>',
    );
  assert.throws(
    () => api.decodeProjectSettings(encoder.encode(xml)),
    /Unsupported required project feature/,
  );
});

test('validates board sources, sides and precision in saved output recipes', () => {
  const board = crypto.randomUUID();
  const recipe = {
    kind: 'pcb',
    id: crypto.randomUUID(),
    board,
    directory: 'outputs/pcb',
    format: 'copper',
    layer: 'bottom',
    filename: 'copper-bottom.gbr',
  };
  const settings = {
    projectId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    title: 'Board outputs',
    requiredFeatures: [],
    entries: [{ kind: 'board', id: board, path: 'Layouts/Board.dpn' }],
    outputRecipes: [recipe],
  };
  const copper = api.encodeProjectSettings(settings);
  assert.deepEqual(api.decodeProjectSettings(copper), settings);
  const placement = {
    ...recipe,
    format: 'placement',
    filename: 'position.csv',
    layer: undefined,
    decimals: 0,
  };
  const roundTrip = api.decodeProjectSettings(
    api.encodeProjectSettings({ ...settings, outputRecipes: [placement] }),
  ).outputRecipes[0];
  assert.equal(roundTrip.decimals, 0);
  assert.equal('layer' in roundTrip, false);
  for (const invalid of [
    { ...recipe, board: crypto.randomUUID() },
    { ...recipe, layer: undefined },
    { ...recipe, filename: 'copper-bottom.csv' },
    { ...recipe, decimals: 3 },
    { ...placement, decimals: 7 },
    { ...placement, decimals: 2.5 },
    { ...placement, layer: 'top' },
  ]) {
    assert.throws(
      () => api.encodeProjectSettings({ ...settings, outputRecipes: [invalid] }),
      /Invalid or duplicate project output recipe/,
    );
  }
  assert.throws(
    () => api.decodeProjectSettings(
      encoder.encode(decoder.decode(copper).replace('layer="bottom"', 'layer="inner"')),
    ),
    /Unsupported PCB output recipe settings/,
  );
});

test('compares saved files at their project-relative paths', () => {
  const projectId = crypto.randomUUID();
  const before = {
    projectId,
    entries: new Map([
      ['outputs/report.txt', { path: 'outputs/report.txt', digest: 'before' }],
      ['Circuit.dsn', { path: 'Circuit.dsn', digest: 'same' }],
    ]),
  };
  const after = {
    projectId,
    entries: new Map([
      ['outputs/report.txt', { path: 'outputs/report.txt', digest: 'after' }],
      ['Circuit.dsn', { path: 'Circuit.dsn', digest: 'same' }],
      ['Layouts/Board.dpn', { path: 'Layouts/Board.dpn', digest: 'board' }],
    ]),
  };
  assert.deepEqual(api.compareProjectRevisions(before, after), [
    { kind: 'added', after: 'Layouts/Board.dpn' },
    {
      kind: 'changed',
      before: 'outputs/report.txt',
      after: 'outputs/report.txt',
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
                mimeType: 'application/xml',
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
