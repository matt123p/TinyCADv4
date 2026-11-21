import { readFile } from 'node:fs/promises';
import { librarySqlite } from '../../lib/library-from-sql.mjs';
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
  test.setTimeout(90000);
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
  let settings = api.encodeProjectSettings({
    projectId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    title: 'Shared circuit',
    requiredFeatures: [],
    primarySchematic: drawing.documentId,
    primaryBoard: board.boardId,
    associations: [{ schematic: drawing.documentId, board: board.boardId }],
    entries: [
      { kind: 'schematic', id: drawing.documentId, path: 'src/Circuit.dzn' },
      { kind: 'board', id: board.boardId, path: 'Board.dpn' },
      { kind: 'schematic', id: child.documentId, path: 'src/Child.dsn' },
    ],
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('tinycad.startupMode')) localStorage.setItem('tinycad.startupMode', 'project');
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
  const uploads = [];
  const importedFolders = [];
  let version = 1;
  let settingsVersion = 1;
  await page.route('https://**/*', (route) => route.abort());
  await page.route('https://www.googleapis.com/drive/v3/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('spaces') === 'appDataFolder')
      return route.fulfill({ json: { files: [] } });
    if (url.pathname.endsWith('/files') && route.request().method() === 'POST') {
      const metadata = route.request().postDataJSON();
      const item = { id: 'folder-' + importedFolders.length, name: metadata.name, mimeType: metadata.mimeType };
      importedFolders.push({ parent: metadata.parents[0], item });
      return route.fulfill({ json: item });
    }
    if (url.pathname.endsWith('/files')) {
      listed.push(url.searchParams.get('q'));
      const files = {
        root: [
          { id: 'designs', name: 'My projects', mimeType: 'application/vnd.google-apps.folder' },
        ],
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
      return route.fulfill({ json: { files: [
        ...(files[folder] ?? []),
        ...[...importedFolders, ...uploads].filter(({ parent }) => parent === folder).map(({ item }) => item),
      ] } });
    }
    if (url.searchParams.get('alt') === 'media') {
      const file = url.pathname.split('/').at(-1);
      const imported = uploads.find(({ item }) => item.id === file);
      if (imported) return route.fulfill({ body: imported.payload, contentType: imported.item.mimeType });
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
        version: url.pathname.endsWith('/drawing') ? String(version) :
          url.pathname.endsWith('/project') ? String(settingsVersion) : '1',
      },
    });
  });
  await page.route('https://www.googleapis.com/drive/v2/files/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const metadata = {
      project: { id: 'project', title: 'Shared.tcproject', parents: [{ id: 'shared' }] },
      shared: { id: 'shared', title: 'Shared' },
    };
    return route.fulfill({ json: metadata[id] ?? { id }, status: metadata[id] ? 200 : 404 });
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
  await page.route('https://www.googleapis.com/upload/drive/v3/files?**', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    const boundary = request.headers()['content-type'].split('boundary=')[1];
    const body = request.postDataBuffer();
    const parts = body.toString('utf8').split('--' + boundary);
    const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1]);
    const [, payload] = parts[2].split('\r\n\r\n');
    const item = { id: 'uploaded-' + uploads.length, name: metadata.name, mimeType: metadata.mimeType };
    uploads.push({ item, parent: metadata.parents[0], payload: payload.slice(0, -2) });
    return route.fulfill({ json: { ...item, version: '1' } });
  });
  let textOnDrive;
  await page.route('https://www.googleapis.com/upload/drive/v3/files/uploaded-1?**', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('PATCH');
    const boundary = request.headers()['content-type'].split('boundary=')[1];
    const parts = request.postDataBuffer().toString('utf8').split('--' + boundary);
    const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1]);
    expect(metadata).toEqual({ name: 'Readme.md', mimeType: 'text/markdown' });
    textOnDrive = parts[2].split('\r\n\r\n')[1].slice(0, -2);
    return route.fulfill({ json: { id: 'uploaded-1', name: 'Readme.md', version: '2' } });
  });
  await page.route('https://www.googleapis.com/upload/drive/v3/files/project?**', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('PATCH');
    const boundary = request.headers()['content-type'].split('boundary=')[1];
    const parts = request.postDataBuffer().toString('utf8').split('--' + boundary);
    const metadata = JSON.parse(parts[1].split('\r\n\r\n')[1]);
    expect(metadata).toEqual({ name: 'Shared.tcproject', mimeType: 'application/xml' });
    settings = new TextEncoder().encode(parts[2].split('\r\n\r\n')[1].slice(0, -2));
    settingsVersion++;
    return route.fulfill({ json: { id: 'project', name: 'Shared.tcproject', version: String(settingsVersion) } });
  });
  const sidebar = page.getByRole('region', { name: 'Projects', exact: true });
  async function open() {
    await expect(sidebar).toBeVisible();
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
  const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
  await sidebar.getByRole('button', { name: 'Board.dpn', exact: true }).click();
  await expect(layout.getByRole('img', { name: 'Board layout' })).toBeVisible();
  await layout.getByRole('button', { name: 'Run design checks…' }).click();
  const checks = page.getByRole('dialog', { name: 'PCB design checks' });
  await expect(checks.getByRole('list', { name: 'PCB findings' })).toContainText(
    'The associated schematic has not been applied to this board.',
  );
  await checks.getByRole('button', { name: 'Close', exact: true }).click();
  await layout.getByRole('button', { name: 'Close', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await sidebar
    .getByRole('button', { name: 'Actions for Board.dpn', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Download PCB', exact: true })
    .click();
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
  await sidebar.getByRole('button', { name: 'Project folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Footprint editor…' }).click();
  const editor = page.getByRole('dialog', { name: 'Footprint editor' });
  await editor
    .getByRole('button', { name: 'Browse starter footprint drafts' })
    .click();
  await editor.getByLabel('Starter footprint draft').selectOption('dip-8');
  await editor.getByRole('button', { name: 'Open starter draft' }).click();
  await expect(
    editor.getByText('dip-8.step · Embedded', { exact: false }),
  ).toBeVisible();
  const footprintDownload = page.waitForEvent('download');
  await editor
    .getByRole('button', { name: 'Export footprint', exact: true })
    .click();
  const native = await api.decodeFootprintLibrary(
    await readFile(await (await footprintDownload).path()),
  );
  const SQL = await librarySqlite();
  const db = new SQL.Database(
    await readFile(
      new URL('../../../bundled-footprints/starter-v1.tplib', import.meta.url),
    ),
  );
  try {
    const entry = api
      .readStarterFootprints(db)
      .find(({ id }) => id === 'dip-8');
    expect(native).toEqual(await api.readStarterFootprint(db, entry));
  } finally {
    db.close();
  }
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.layoutTest.renameCurrentSheet('Saved while closing'));
  const activity = page.getByRole('group', { name: 'Project activity bar' });
  await activity.getByRole('button', { name: 'Close Project', exact: true }).click();
  const close = page.getByRole('dialog', { name: 'Close Project', exact: true });
  await close.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(sidebar).toBeVisible();
  await activity.getByRole('button', { name: 'Close Project', exact: true }).click();
  await close.getByRole('button', { name: 'Save and close', exact: true }).click();
  await expect.poll(() => version).toBe(4);
  await expect(close).toHaveCount(0);
  await expect(sidebar).toHaveCount(0);
  await expect(activity).toHaveCount(0);
  expect((await api.decodeDrawing(data)).sheets[0].name).toBe('Saved while closing');

  const openFolder = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open Project Folder…' }).click();
  };
  await openFolder();
  const picker = page.getByRole('dialog', { name: 'Open Project Folder…' });
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(activity).toHaveCount(0);
  await openFolder();
  await picker.getByRole('button', { name: 'My projects', exact: true }).click();
  await picker.getByRole('button', { name: 'Shared', exact: true }).click();
  await picker.getByRole('button', { name: 'Select folder', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Shared.tcproject', exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.setItem('tinycad.startupMode', 'single'));
  const linked = new URL(app.baseURL);
  linked.searchParams.set('state', JSON.stringify({ action: 'open', ids: ['project'] }));
  await page.goto(linked.href);
  await expect(sidebar.getByRole('button', { name: 'Board.dpn', exact: true })).toBeVisible();
  await expect(activity).toBeVisible();

  const transfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF-fixture'], 'Vendor data.pdf', { type: 'application/pdf' }));
    transfer.items.add(new File([], 'Reference'));
    const getEntry = DataTransferItem.prototype.webkitGetAsEntry;
    DataTransferItem.prototype.webkitGetAsEntry = function () {
      if (this.getAsFile()?.name !== 'Reference') return getEntry.call(this);
      return {
        name: 'Reference', isDirectory: true,
      createReader() {
        let read = false;
        return { readEntries(done) {
          if (read) return done([]);
          read = true;
          done([{
            name: 'Readme.md', isFile: true,
            file: (done) => done(new File(['# Data'], 'Readme.md', { type: 'text/markdown' })),
          }]);
        } };
      },
      };
    };
    return transfer;
  });
  await sidebar.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(sidebar).toHaveClass(/project-drop-target/);
  await sidebar.dispatchEvent('drop', { dataTransfer: transfer });
  const importing = page.getByRole('dialog', { name: 'Add files…' });
  await expect(importing.getByRole('status')).toHaveText('2 files imported. 0 items skipped.');
  await importing.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Vendor data.pdf', exact: true })).toBeVisible();
  expect(uploads).toEqual([{
    parent: 'shared',
    item: { id: 'uploaded-0', name: 'Vendor data.pdf', mimeType: 'application/pdf' },
    payload: '%PDF-fixture',
  }, {
    parent: 'folder-0',
    item: { id: 'uploaded-1', name: 'Readme.md', mimeType: 'text/markdown' },
    payload: '# Data',
  }]);
  expect(importedFolders).toEqual([{
    parent: 'shared',
    item: { id: 'folder-0', name: 'Reference', mimeType: 'application/vnd.google-apps.folder' },
  }]);
  await sidebar.getByRole('button', { name: 'Reference', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: 'Readme.md', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Readme.md', exact: true }).click();
  const editorTab = page.getByRole('textbox', { name: 'Edit Readme.md' });
  await expect(editorTab).toHaveValue('# Data');
  await editorTab.fill('# New Drive data\n');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect.poll(() => textOnDrive).toBe('# New Drive data\n');
  await expect(page.getByRole('tab', { name: 'Readme.md', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Parent folder', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Project Settings…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Author', exact: true }).fill('Drive editor');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect.poll(() => settingsVersion).toBe(2);
  const savedSettings = api.decodeProjectSettings(settings);
  expect(savedSettings.author).toBe('Drive editor');
  expect(savedSettings.associations).toEqual([{ schematic: drawing.documentId, board: board.boardId }]);

});
