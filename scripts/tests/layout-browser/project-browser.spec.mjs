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
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents }),
    store: { get: (_, fallback) => fallback },
    documents: directory,
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
    await sidebar
      .getByRole('button', {
        name: 'Transistor amplifier.tcproject',
        exact: true,
      })
      .click();
    await sidebar
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    await expect(
      sidebar.getByRole('button', { name: 'Open schematic', exact: true }),
    ).toBeVisible();

    const api = await layoutRuntime();
    const filename = path.join(
      directory,
      'Amp',
      'Transistor amplifier.tcproject',
    );
    const first = await api.decodeProjectArchive(await readFile(filename));
    await expect
      .poll(() =>
        page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
      )
      .toBe(first.entries[0].id);
    await page.evaluate(() =>
      window.layoutTest.renameCurrentSheet('Amplifier circuit'),
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await api.decodeProjectArchive(await readFile(filename))
          ).parentRevisionId,
      )
      .toBe(first.revisionId);
    const saved = await api.decodeProjectArchive(await readFile(filename));
    await assertProjectSheet(saved, 'Amplifier circuit');

    await page.evaluate(() => window.projectTestMenu('file-save-as'));
    const dialog = page.getByRole('dialog', { name: 'Save project as' });
    await dialog
      .getByRole('textbox', { name: 'Name' })
      .fill('Amplifier revision');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(
      sidebar.getByRole('button', {
        name: 'Amplifier revision.tcproject',
        exact: true,
      }),
    ).toBeVisible();
    const copy = await api.decodeProjectArchive(
      await readFile(
        path.join(directory, 'Amp', 'Amplifier revision.tcproject'),
      ),
    );
    expect(copy.projectId).toBe(saved.projectId);
    expect(copy.parentRevisionId).toBe(saved.revisionId);

    await sidebar
      .getByRole('button', {
        name: 'Actions for Transistor amplifier.tcproject',
      })
      .click();
    await page
      .getByRole('menuitem', { name: 'Set as comparison base' })
      .click();
    await sidebar
      .getByRole('button', { name: 'Actions for Amplifier revision.tcproject' })
      .click();
    await page
      .getByRole('menuitem', {
        name: 'Compare with Transistor amplifier.tcproject',
      })
      .click();
    const comparison = page.getByRole('dialog', {
      name: 'Compare project revisions',
    });
    await expect(
      comparison.getByText('Project files are identical.'),
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
        name: 'Amplifier revision.tcproject',
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
    expect(errors).toEqual([]);

    async function assertProjectSheet(project, name) {
      const drawing = await api.decodeDrawing(
        project.entries.find(({ kind }) => kind === 'schematic').data,
      );
      expect(drawing.sheets[0].name).toBe(name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
