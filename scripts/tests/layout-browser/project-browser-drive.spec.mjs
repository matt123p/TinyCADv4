import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { layoutRuntime } from '../../lib/layout-runtime.mjs';
import { serveLayoutApp } from './serve-app.mjs';

let app;
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await serveLayoutApp('layout-browser', 'google', 'production', {
    GOOGLE_CLIENT_ID_PROD: 'project-browser-test',
  });
});
test.afterAll(async () => {
  await app?.close();
});

test('Google mode opens native schematic and PCB files in the remembered Drive project', async ({
  page,
}) => {
  const api = await layoutRuntime();
  const drawing = api.blank();
  let data = await api.encodeDrawing(drawing, 'zip-v1');
  const board = api.createBoard('Shared layout', 1, [
    { x: 0, y: 0 },
    { x: 3_000_000, y: 0 },
    { x: 3_000_000, y: 2_000_000 },
    { x: 0, y: 2_000_000 },
  ]);
  const boardData = await api.encodeBoard(board);
  const child =
    await api.decodeDrawing(`<TinyCADSheets><HierarchicalSymbol><NAME>Interface</NAME>
    <PIN pos="20,30" direction="3" which="0" elec="0" number="1" length="20" number_pos="0" centre_name="0" part="0" show="1">DATA</PIN>
    </HierarchicalSymbol><TinyCAD><NAME>Child circuit</NAME></TinyCAD></TinyCADSheets>`);
  const childData = await api.encodeDrawing(child, 'xml');
  const settings = api.encodeProjectSettings({
    projectId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    title: 'Shared circuit',
    requiredFeatures: [],
    primarySchematic: drawing.documentId,
    primaryBoard: board.boardId,
    entries: [
      { kind: 'schematic', id: drawing.documentId, path: 'src/Circuit.dzn' },
      { kind: 'board', id: board.boardId, path: 'Board.dpn' },
      { kind: 'schematic', id: child.documentId, path: 'src/Child.dsn' },
    ],
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'tinycad.driveProjectFolder.test-account',
      JSON.stringify({ id: 'designs', name: 'My projects' }),
    );
    const user = {
      getBasicProfile: () => ({
        getId: () => 'test-account',
        getName: () => 'Test',
        getImageUrl: () => '',
        getEmail: () => 'test@example.test',
      }),
      getAuthResponse: () => ({ access_token: 'test-token' }),
    };
    window.gapi = {
      load: (_, callback) => callback(),
      auth2: {
        init: async () => {},
        getAuthInstance: () => ({
          signIn: async () => user,
          currentUser: { get: () => user },
        }),
      },
    };
  });
  const listed = [];
  let version = 1;
  await page.route('https://**/*', (route) => route.abort());
  await page.route('https://www.googleapis.com/drive/v3/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('spaces') === 'appDataFolder')
      return route.fulfill({ json: { files: [] } });
    if (url.pathname.endsWith('/files')) {
      listed.push(url.searchParams.get('q'));
      const files = {
        designs: [
          {
            id: 'shared',
            name: 'Shared',
            mimeType: 'application/vnd.google-apps.folder',
          },
        ],
        shared: [
          {
            id: 'project',
            name: 'Shared.tcproject',
            mimeType: 'application/xml',
          },
          { id: 'board', name: 'Board.dpn', mimeType: 'application/xml' },
          {
            id: 'source',
            name: 'src',
            mimeType: 'application/vnd.google-apps.folder',
          },
        ],
        source: [
          { id: 'child', name: 'Child.dsn', mimeType: 'application/xml' },
          {
            id: 'drawing',
            name: 'Circuit.dzn',
            mimeType: 'application/octet-stream',
          },
        ],
      };
      const folder = url.searchParams.get('q').split("'")[1];
      return route.fulfill({ json: { files: files[folder] ?? [] } });
    }
    if (url.searchParams.get('alt') === 'media') {
      const file = url.pathname.split('/').at(-1);
      return route.fulfill({
        body: Buffer.from(
          {
            drawing: data,
            board: boardData,
            project: settings,
            child: childData,
          }[file],
        ),
        contentType:
          file === 'drawing' ? 'application/octet-stream' : 'application/xml',
      });
    }
    return route.fulfill({
      json: {
        version: url.pathname.endsWith('/drawing') ? String(version) : '1',
      },
    });
  });
  await page.route(
    'https://www.googleapis.com/upload/drive/v3/files/drawing?**',
    async (route) => {
      const request = route.request();
      expect(request.method()).toBe('PATCH');
      const boundary = request.headers()['content-type'].split('boundary=')[1];
      const body = request.postDataBuffer();
      const content = Buffer.from(
        'Content-Type: application/octet-stream\r\n\r\n',
      );
      const start = body.indexOf(content) + content.length;
      const end = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
      data = body.subarray(start, end);
      version++;
      return route.fulfill({
        json: { id: 'drawing', name: 'Circuit.dzn', version: String(version) },
      });
    },
  );
  const sidebar = page.getByRole('region', { name: 'Projects', exact: true });
  async function open() {
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(
      sidebar.getByText('My projects', { exact: true }),
    ).toBeVisible();
    await sidebar.getByRole('button', { name: 'Shared', exact: true }).click();
    await sidebar
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
  }
  await page.goto(app.baseURL);
  await open();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(drawing.documentId);
  expect(listed).toEqual(
    expect.arrayContaining([
      "'designs' in parents and trashed = false",
      "'shared' in parents and trashed = false",
      "'source' in parents and trashed = false",
    ]),
  );
  const downloading = page.waitForEvent('download');
  await sidebar.getByRole('button', { name: 'Board.dpn', exact: true }).click();
  const copiedBoard = await downloading;
  expect(copiedBoard.suggestedFilename()).toBe('Board.dpn');
  expect(
    await api.decodeBoard(await readFile(await copiedBoard.path())),
  ).toEqual(board);
  await page.evaluate(() =>
    window.layoutTest.renameCurrentSheet('Saved to Drive'),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => version).toBe(2);
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  const saved = await api.decodeDrawing(data);
  expect(saved.representation).toBe('zip-v1');
  expect(saved.sheets[0].name).toBe('Saved to Drive');
  await page.evaluate(() =>
    window.layoutTest.renameCurrentSheet('Local Drive recovery'),
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'Recovery copy saved at' }),
  ).toBeVisible();
  await page.reload();
  await open();
  const recovery = page.getByRole('dialog', { name: 'Recover project edits' });
  await recovery
    .getByRole('button', { name: 'Discard copy and open saved' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(drawing.documentId);
  expect(
    await page.evaluate(
      () => window.layoutTest.snapshot().drawing.sheets[0].name,
    ),
  ).toBe('Saved to Drive');
  await page.reload();
  await open();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(drawing.documentId);
  await expect(recovery).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'src', exact: true }).click();
  await sidebar
    .getByRole('button', { name: 'Actions for Child.dsn', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Place as child symbol' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().adding?.hierarchy?.path),
    )
    .toBe('src/Child.dsn');
  await page.evaluate(() =>
    window.layoutTest.pointer('lbuttondown', [350, 350]),
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => version).toBe(3);
  const parent = await api.decodeDrawing(data);
  expect(parent.sheets[0].items[0].hierarchy).toEqual({
    path: 'src/Child.dsn',
    documentId: child.documentId,
    cached: true,
  });
  const hierarchy = page.getByRole('region', { name: 'Schematic hierarchy' });
  await hierarchy.getByRole('button', { name: 'Open child schematic' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(child.documentId);
  await hierarchy.getByRole('button', { name: 'Back to parent' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(drawing.documentId);
});
