import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerProjectFiles } from '../../../electron/projectFiles.js';
import { installElectronBridge } from '../chat-browser/electron-bridge.mjs';
import { layoutRuntime } from '../../lib/layout-runtime.mjs';
import { serveLayoutApp } from './serve-app.mjs';

let app;
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await serveLayoutApp('layout-browser', 'electron');
});
test.afterAll(async () => {
  await app?.close();
});

test('projects share the editor sidebar and save schematic changes and a revision copy', async ({
  browser,
  page,
}, info) => {
  test.setTimeout(60000);
  const parent = info.project.outputDir;
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'project-browser-'));
  const frame = {};
  const webContents = { mainFrame: frame };
  let handler;
  let chosenFolder;
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents }),
    store: { get: (_, fallback) => fallback, set: () => {} },
    documents: directory,
    dialog: { showOpenDialog: async () => ({ filePaths: [chosenFolder] }) },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const context = page.context();
  await installElectronBridge(context);
  await context.exposeBinding('projectTestFiles', async (_, request) => {
    if (request.data) request.data = Uint8Array.from(request.data);
    const result = await handler(
      { sender: webContents, senderFrame: frame },
      request,
    );
    return result?.data ? { ...result, data: Array.from(result.data) } : result;
  });
  await context.addInitScript(() => {
    window.electronAPI.projectFiles = async (request) => {
      const result = await window.projectTestFiles(
        request.data ? { ...request, data: Array.from(request.data) } : request,
      );
      return result?.data
        ? { ...result, data: Uint8Array.from(result.data) }
        : result;
    };
    window.electronAPI.onMenuCommand = (handler) => {
      window.projectTestMenu = handler;
      return () => {};
    };
  });
  try {
    await writeFile(path.join(directory, 'Ignore.dsn'), 'outside the project');
    await page.goto(app.baseURL);
    const projects = page.getByRole('button', {
      name: 'Projects',
      exact: true,
    });
    const libraries = page
      .getByRole('button', { name: 'Libraries', exact: true })
      .first();
    await projects.click();
    let sidebar = page.getByRole('region', { name: 'Projects', exact: true });
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.side-panel')).toBeVisible();
    await libraries.click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expect(sidebar.getByText('Ignore.dsn')).toHaveCount(0);

    async function create(kind, name) {
      await sidebar
        .getByRole('button', { name: 'Project folder actions' })
        .click();
      await page.getByRole('menuitem', { name: kind }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    }
    await create('New folder…', 'Amp');
    await sidebar.getByRole('button', { name: 'Amp', exact: true }).click();
    await create('New project…', 'Transistor amplifier');
    const sourceRoot = path.join(directory, 'Amp', 'Transistor amplifier');
    const sourceSettings = path.join(
      sourceRoot,
      'Transistor amplifier.tcproject',
    );
    const sourceDrawing = path.join(sourceRoot, 'Circuit.dsn');
    const api = await layoutRuntime();
    await expect
      .poll(async () =>
        Boolean(await readFile(sourceSettings).catch(() => null)),
      )
      .toBe(true);
    const created = api.decodeProjectSettings(await readFile(sourceSettings));
    const circuit = {
      schemaVersion: 1,
      snapshotId: crypto.randomUUID(),
      documentId: created.primarySchematic,
      revision: 1,
      components: [],
      nets: [],
      noConnects: [],
    };
    const board = {
      ...api.createBoard('Amplifier layout', 2, [
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
    const boardId = board.boardId;
    const boardData = await api.encodeBoard(board);
    await mkdir(path.join(sourceRoot, 'layouts'));
    const boardPath = 'layouts/Main.dpn';
    await writeFile(path.join(sourceRoot, boardPath), boardData);
    await writeFile(
      path.join(sourceRoot, 'Circuit.snapshot.json'),
      JSON.stringify(circuit),
    );
    const first = {
      ...created,
      primaryBoard: boardId,
      associations: [{ schematic: created.primarySchematic, board: boardId }],
      entries: [
        ...created.entries,
        { kind: 'board', id: boardId, path: boardPath },
        {
          kind: 'circuit',
          id: circuit.snapshotId,
          path: 'Circuit.snapshot.json',
        },
      ],
    };
    await writeFile(sourceSettings, api.encodeProjectSettings(first));
    const settingsBytes = await readFile(sourceSettings);
    await mkdir(path.join(sourceRoot, 'outputs'));
    await writeFile(path.join(sourceRoot, 'outputs', 'notes.txt'), 'keep me');
    await sidebar
      .getByRole('button', { name: 'Transistor amplifier', exact: true })
      .click();
    await sidebar
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
      )
      .toBe(first.primarySchematic);
    await page.evaluate(() =>
      window.layoutTest.renameCurrentSheet('Amplifier circuit'),
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    await expect
      .poll(
        async () =>
          (
            await api.decodeDrawing(await readFile(sourceDrawing))
          ).sheets[0].name,
      )
      .toBe('Amplifier circuit');
    expect(await readFile(sourceSettings)).toEqual(settingsBytes);

    await page.evaluate(() => window.projectTestMenu('file-save-as'));
    const dialog = page.getByRole('dialog', { name: 'Save project as' });
    await dialog
      .getByRole('textbox', { name: 'Name' })
      .fill('Amplifier revision');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    const copyRoot = path.join(directory, 'Amp', 'Amplifier revision');
    const copySettings = path.join(copyRoot, 'Amplifier revision.tcproject');
    await expect
      .poll(async () => {
        const bytes = await readFile(copySettings).catch(() => null);
        return bytes && api.decodeProjectSettings(bytes).parentRevisionId;
      })
      .toBe(first.revisionId);
    const copy = api.decodeProjectSettings(await readFile(copySettings));
    expect(copy.projectId).toBe(first.projectId);
    expect(copy.associations).toEqual(first.associations);
    expect(await readFile(path.join(copyRoot, boardPath))).toEqual(
      Buffer.from(boardData),
    );
    await sidebar.getByRole('button', { name: 'layouts', exact: true }).click();
    const download = page.waitForEvent('download');
    await sidebar
      .getByRole('button', { name: 'Main.dpn', exact: true })
      .click();
    expect((await download).suggestedFilename()).toBe('Main.dpn');
    const circuitPath = path.join(sourceRoot, 'Circuit.snapshot.json');
    await writeFile(circuitPath, JSON.stringify({ ...circuit, revision: 2 }));
    await sidebar
      .getByRole('button', { name: 'Main.dpn', exact: true })
      .click();
    await expect(sidebar.getByRole('alert')).toContainText(
      'Missing or inconsistent project circuit snapshot',
    );
    await writeFile(circuitPath, JSON.stringify(circuit));
    await sidebar.getByRole('button', { name: 'Parent folder' }).click();

    expect(
      await readFile(path.join(copyRoot, 'outputs', 'notes.txt'), 'utf8'),
    ).toBe('keep me');

    await sidebar
      .getByRole('button', {
        name: 'Actions for Transistor amplifier.tcproject',
      })
      .click();
    await page
      .getByRole('menuitem', { name: 'Set as comparison base' })
      .click();
    await sidebar.getByRole('button', { name: 'Parent folder' }).click();
    await sidebar
      .getByRole('button', { name: 'Amplifier revision', exact: true })
      .click();
    const copyMarker = sidebar.getByRole('button', {
      name: 'Actions for Amplifier revision.tcproject',
    });
    await expect(
      sidebar.getByRole('button', { name: 'Open schematic' }),
    ).toBeVisible();
    await copyMarker.click();
    const compare = page.getByRole('menuitem', {
      name: 'Compare with Transistor amplifier.tcproject',
    });
    await compare.click();
    const comparison = page.getByRole('dialog', {
      name: 'Compare project revisions',
    });
    await expect(
      comparison.getByText('Project files are identical.'),
    ).toBeVisible();
    await comparison
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await writeFile(path.join(copyRoot, 'outputs', 'notes.txt'), 'changed');
    await copyMarker.click();
    await compare.click();
    await expect(
      comparison.getByText('Changed outputs/notes.txt'),
    ).toBeVisible();
    await comparison
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    await page.evaluate(() =>
      window.layoutTest.renameCurrentSheet('Last acknowledged edit'),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Recovery copy saved at' }),
    ).toBeVisible();
    const cdp = await browser.newBrowserCDPSession();
    const marker = crypto.randomUUID();
    const events = [];
    cdp.on('Tracing.dataCollected', ({ value }) => {
      events.push(...value);
    });
    await cdp.send('Tracing.start', { categories: 'blink.user_timing' });
    await page.evaluate((name) => performance.mark(name), marker);
    const traceComplete = once(cdp, 'Tracing.tracingComplete');
    await cdp.send('Tracing.end');
    await traceComplete;
    const pid = events.find(({ name }) => name === marker)?.pid;
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    expect(processInfo).toContainEqual(
      expect.objectContaining({ type: 'renderer', id: pid }),
    );
    await cdp.detach();
    const crashed = page.waitForEvent('crash', { timeout: 10000 });
    await page.evaluate(() =>
      window.layoutTest.renameCurrentSheet('Later edit'),
    );
    process.kill(pid, 'SIGKILL');
    await crashed;
    await page.close();
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    sidebar = page.getByRole('region', { name: 'Projects', exact: true });
    await sidebar.getByRole('button', { name: 'Amp', exact: true }).click();
    await sidebar
      .getByRole('button', {
        name: 'Amplifier revision',
        exact: true,
      })
      .click();
    await sidebar.getByRole('button', { name: 'Open schematic' }).click();
    const recovery = page.getByRole('dialog', {
      name: 'Recover project edits',
    });
    await expect(
      recovery.getByText('Edits made after this copy may have been lost.'),
    ).toBeVisible();
    await recovery.getByRole('button', { name: 'Recover edits' }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.layoutTest.snapshot().drawing.sheets[0].name,
        ),
      )
      .toBe('Last acknowledged edit');
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Save', exact: true }),
    ).toBeDisabled();
    await sidebar.getByRole('button', { name: 'Open schematic' }).click();
    await expect(recovery).toHaveCount(0);

    await page.getByRole('button', { name: 'Simulation', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Simulate', exact: true }).click();
    await expect(page.locator('.simulation-sheet')).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.side-panel')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    chosenFolder = copyRoot;
    await sidebar
      .getByRole('button', { name: 'Project folder actions' })
      .click();
    await page
      .getByRole('menuitem', { name: 'Choose project folder…' })
      .click();
    await expect(
      sidebar.getByRole('button', { name: 'Open schematic' }),
    ).toBeVisible();
    await sidebar.getByRole('button', { name: 'Open schematic' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
      )
      .toBe(first.primarySchematic);
    chosenFolder = path.dirname(copyRoot);
    await page.evaluate(() => window.projectTestMenu('file-save-as'));
    const siblingSave = page.getByRole('dialog', { name: 'Save project as' });
    await siblingSave
      .getByRole('textbox', { name: 'Name' })
      .fill('Sibling revision');
    await siblingSave.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(
      sidebar.getByRole('button', { name: 'Sibling revision', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
