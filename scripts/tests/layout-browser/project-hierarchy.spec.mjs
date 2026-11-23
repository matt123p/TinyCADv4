import { clickPcbCommand, drawPcbOutline, pcbNetRow, selectCopperRow, selectPcbNet } from './pcb-controls.mjs';
import { test, expect } from '@playwright/test';
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerProjectFiles } from '../../../electron/projectFiles.js';
import { installElectronBridge } from '../chat-browser/electron-bridge.mjs';
import { layoutRuntime } from '../../lib/layout-runtime.mjs';
import { librarySqlite } from '../../lib/library-from-sql.mjs';
import { serveLayoutApp } from './serve-app.mjs';

let app;
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await serveLayoutApp('layout-browser', 'electron');
});
test.afterAll(async () => {
  await app?.close();
});

test('restores project tabs and the active file, including an explicitly empty tab strip', async ({ page }, info) => {
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'project-tab-session-'));
  try {
    const otherRoot = path.join(root, 'Other project');
    await mkdir(otherRoot);
    let selectedFolder = root;
    const api = await layoutRuntime();
    const drawing = api.blank();
    const board = api.createBoard('Board', 2, [
      { x: 0, y: 0 }, { x: 20e6, y: 0 }, { x: 20e6, y: 20e6 }, { x: 0, y: 20e6 },
    ]);
    await writeFile(path.join(root, 'Circuit.dsn'), await api.encodeDrawing(drawing, 'xml'));
    await writeFile(path.join(root, 'Board.dpn'), await api.encodeBoard(board));
    await writeFile(path.join(root, 'Notes.md'), '# Build notes');
    await writeFile(path.join(root, 'Draft.dsn'), '<TinyCADSheets><TinyCAD><NAME>Draft</NAME></TinyCAD></TinyCADSheets>');
    await writeFile(path.join(root, 'Project.tcproject'), api.encodeProjectSettings({
      projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(), title: 'Session',
      requiredFeatures: [], entries: [
        { kind: 'schematic', id: drawing.documentId, path: 'Circuit.dsn' },
        { kind: 'board', id: board.boardId, path: 'Board.dpn' },
      ],
    }));
    await installProjectBridge(page, root, undefined, undefined, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [selectedFolder] }),
    });
    await page.goto(app.baseURL);
    const activity = page.getByRole('group', { name: 'Project activity bar' });
    const tree = page.getByRole('region', { name: 'Projects', exact: true });
    if (!(await tree.isVisible())) await activity.getByRole('button', { name: 'Projects', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: 'Project files' });
    const labels = ['Notes.md', 'Circuit.dsn', 'Board.dpn', 'Draft.dsn'];
    const expectTabOrder = async () => {
      const openTabs = tabs.getByRole('tab');
      await expect(openTabs).toHaveCount(labels.length);
      for (const [index, label] of labels.entries()) await expect(openTabs.nth(index)).toHaveAccessibleName(label);
    };
    for (const name of labels) {
      if (name === 'Notes.md') {
        await tree.getByRole('button', { name, exact: true }).press('Shift+F10');
        await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
      } else await tree.getByRole('button', { name, exact: true }).click();
      await expect(tabs.getByRole('tab', { name, exact: true })).toBeVisible();
    }
    await expectTabOrder();
    await tabs.getByRole('tab', { name: 'Notes.md', exact: true }).click();
    const close = async () => {
      await page.evaluate(() => window.hierarchyTestMenu('file-close-project'));
      await expect(activity).toHaveCount(0);
    };
    const reopen = () => page.evaluate(() => window.hierarchyTestMenu('file-open-project-folder'));
    await close();
    await reopen();
    await expectTabOrder();
    await expect(tabs.getByRole('tab', { name: 'Notes.md', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await expectTabOrder();
    await expect(tabs.getByRole('tab', { name: 'Notes.md', exact: true })).toHaveAttribute('aria-selected', 'true');

    selectedFolder = otherRoot;
    await reopen();
    await expect(tree.getByRole('button', { name: 'Project folder actions' })).toHaveAttribute('title', 'Other project');
    await expect(tabs).toHaveCount(0);
    selectedFolder = root;
    await reopen();
    await expectTabOrder();

    for (const name of [...labels].reverse()) {
      await tabs.getByRole('button', { name: 'Close ' + name, exact: true }).click();
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveCount(0);
    }
    await expect(tabs).toHaveCount(0);
    await close();
    await reopen();
    await expect(tree).toBeVisible();
    await expect(tabs).toHaveCount(0);
    await page.reload();
    await expect(tree).toBeVisible();
    await expect(tabs).toHaveCount(0);
    await close();
  } finally {
    await page.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('opens project files into tabs and hosts PCB tools in the shared sidebar', async ({ page }, info) => {
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'project-shell-'));
  try {
    const nested = path.join(root, 'Notes');
    await mkdir(nested);
    for (const [name, sheet] of [['First.dsn', 'First sheet'], ['Second.dsn', 'Second sheet']]) {
      await writeFile(path.join(root, name), `<TinyCADSheets><TinyCAD><NAME>${sheet}</NAME></TinyCAD></TinyCADSheets>`);
    }
    await writeFile(path.join(nested, 'View.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>');
    await cp(path.resolve('examples/pcb/led-classroom/Reference/LED.dpn'), path.join(root, 'Board.dpn'));
    await installProjectBridge(page, root, undefined, undefined, {
      showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
    });
    await page.goto(app.baseURL);
    const tree = page.getByRole('region', { name: 'Projects', exact: true });
    const row = (name) => tree.getByRole('button', { name, exact: true });
    const activity = page.getByRole('group', { name: 'Project activity bar' });
    if (!(await tree.isVisible())) await activity.getByRole('button', { name: 'Projects', exact: true }).click();
    const hideSidebar = page.getByRole('button', { name: 'Hide side panel', exact: true });
    const hidePosition = await hideSidebar.boundingBox();
    const hideIcon = await hideSidebar.locator('svg').innerHTML();
    await hideSidebar.click();
    await expect(tree).toBeHidden();
    const showSidebar = page.getByRole('button', { name: 'Show side panel', exact: true });
    await expect(showSidebar).toBeFocused();
    await showSidebar.click();
    await expect(tree).toBeVisible();
    await activity.getByRole('button', { name: 'Source Control', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Source Control', exact: true })).toBeVisible();
    await expect.poll(() => hideSidebar.boundingBox()).toEqual(hidePosition);
    expect(await hideSidebar.locator('svg').innerHTML()).toBe(hideIcon);
    await activity.getByRole('button', { name: 'Libraries', exact: true }).click();
    await expect(page.getByPlaceholder('Search libraries...')).toBeVisible();
    await expect.poll(() => hideSidebar.boundingBox()).toEqual(hidePosition);
    expect(await hideSidebar.locator('svg').innerHTML()).toBe(hideIcon);
    await activity.getByRole('button', { name: 'Projects', exact: true }).click();
    const tabs = page.getByRole('tablist', { name: 'Project files' });
    const initialSchematic = tabs.getByRole('tab', { name: 'tCad1.dsn', exact: true });
    await expect(initialSchematic).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Close tCad1.dsn', exact: true })).toBeVisible();
    await initialSchematic.press('Delete');
    await expect(initialSchematic).toHaveCount(0);
    await expect(row('First.dsn')).toBeVisible();
    await expect(row('Parent folder')).toHaveCount(0);
    await expect(row('Actions for First.dsn')).toHaveCount(0);
    await expect(activity.getByRole('button', { name: 'Close Project', exact: true })).toHaveCount(0);
    await expect(row('Close Project')).toBeVisible();
    await expect(row('View.svg')).toHaveCount(0);
    await row('Notes').click();
    await expect(row('View.svg')).toBeVisible();
    await expect(row('First.dsn')).toBeVisible();
    await expect(row('First.dsn')).toHaveCSS('text-align', 'start');
    const label = await row('First.dsn').locator('.project-tree-filename').boundingBox();
    expect(label.x - (await row('First.dsn').boundingBox()).x).toBeLessThan(50);
    const downloads = [];
    page.on('download', (file) => downloads.push(file.suggestedFilename()));
    await row('First.dsn').press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'First.dsn', exact: true })).toBeVisible();
    await page.evaluate(() => window.layoutTest.renameCurrentSheet('Unsaved first sheet'));
    await row('Second.dsn').click();
    await expect(tabs.getByRole('tab', { name: 'Second.dsn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await tabs.getByRole('button', { name: 'Close First.dsn', exact: true }).click();
    const closeFirst = page.getByRole('dialog', { name: 'Close First.dsn', exact: true });
    await closeFirst.getByRole('button', { name: 'Cancel' }).click();
    await expect(tabs.getByRole('tab', { name: 'Second.dsn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await row('View.svg').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'View.svg', exact: true })).toHaveAttribute('aria-selected', 'true');
    await row('Board.dpn').click();
    await expect(tabs.getByRole('tab', { name: 'Board.dpn', exact: true })).toHaveAttribute('aria-selected', 'true');
    const toolbar = page.getByRole('toolbar', { name: 'PCB commands' });
    const saveAll = toolbar.getByRole('button', { name: 'Save All', exact: true });
    await expect(saveAll).toHaveText('');
    await expect(toolbar.getByRole('button', { name: 'Save', exact: true }).locator('xpath=following-sibling::*[1]')).toHaveAttribute('aria-label', 'Save All');
    await expect(tabs.getByRole('button', { name: 'Close Board.dpn', exact: true })).toBeVisible();
    await expect(tree).toBeVisible();
    await expect(page.getByRole('region', { name: 'Footprints', exact: true })).toBeHidden();
    await activity.getByRole('button', { name: 'Libraries', exact: true }).click();
    const footprints = page.getByRole('region', { name: 'Footprints', exact: true });
    await expect(footprints.getByRole('tab', { name: 'Unplaced', exact: true })).toBeVisible();
    await expect.poll(() => hideSidebar.boundingBox()).toEqual(hidePosition);
    expect(await hideSidebar.locator('svg').innerHTML()).toBe(hideIcon);
    await expect(footprints.locator('xpath=ancestor::div[contains(@class,"side-panel-container")]')).toHaveCount(1);
    await expect(tree).toBeHidden();
    await activity.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(tree).toBeVisible();
    await expect(footprints).toBeHidden();
    await tabs.getByRole('tab', { name: 'First.dsn *', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.layoutTest.snapshot().drawing.sheets[0].name)).toBe('Unsaved first sheet');
    await expect(tree.locator('li[data-selected]')).toHaveText('First.dsn');
    await tabs.getByRole('button', { name: 'Close View.svg', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'View.svg', exact: true })).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Close Board.dpn', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Board.dpn', exact: true })).toHaveCount(0);
    expect(downloads).toEqual([]);
    await page.screenshot({ path: info.outputPath('project-sidebar.png') });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function installProjectBridge(page, documents, beforeRequest, takeProjectOpen, dialog, shell) {
  const senderFrame = {};
  const sender = { mainFrame: senderFrame };
  let handler;
  const preferences = new Map();
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents: sender }),
    store: {
      get: (key, fallback) => preferences.get(key) ?? fallback,
      set: (key, value) => preferences.set(key, value),
    },
    documents,
    takeProjectOpen,
    dialog,
    shell,
  });
  const browser = page.context();
  await installElectronBridge(browser);
  await browser.exposeBinding('hierarchyTestFiles', async (_, request) => {
    await beforeRequest?.(request);
    if (request.data) request.data = Uint8Array.from(request.data);
    const result = await handler({ sender, senderFrame }, request);
    return result?.data ? { ...result, data: Array.from(result.data) } : result;
  });
  await browser.addInitScript((startInProject) => {
    if (startInProject && !localStorage.getItem('tinycad.startupMode'))
      localStorage.setItem('tinycad.startupMode', 'project');
    window.electronAPI.projectFiles = async (request) => {
      const result = await window.hierarchyTestFiles(
        request.data ? { ...request, data: Array.from(request.data) } : request,
      );
      return result?.data
        ? { ...result, data: Uint8Array.from(result.data) }
        : result;
    };
    window.electronAPI.onMenuCommand = (callback) => {
      window.hierarchyTestMenu = callback;
      return () => {};
    };
  }, !takeProjectOpen);
}

test('authors, wires, navigates, updates and copies repeated and nested child schematics', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(
    path.join(info.project.outputDir, 'hierarchy-'),
  );
  await installProjectBridge(page, directory);
  const api = await layoutRuntime();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const sidebar = page.getByRole('region', { name: 'Projects', exact: true });
    const panel = page.getByRole('region', { name: 'Schematic hierarchy' });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const drawing = () =>
      page.evaluate(() => window.layoutTest.snapshot().drawing);
    const active = () =>
      page.evaluate(() => {
        const snapshot = window.layoutTest.snapshot();
        return snapshot.drawing.sheets[snapshot.sheet];
      });
    const pointer = (event, point) =>
      page.evaluate(
        ([event, point]) => window.layoutTest.pointer(event, point),
        [event, point],
      );
    const select = (item) =>
      page.evaluate((id) => window.layoutTest.selectItem(id), item._id);
    const placements = async () =>
      (await active()).items.filter((item) => item.hierarchy);
    const prompt = async (menu, name) => {
      await sidebar
        .getByRole('button', { name: 'Project folder actions' })
        .click({ button: 'right' });
      await page.getByRole('menuitem', { name: menu }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    };
    const open = async (name, id) => {
      await sidebar.getByRole('button', { name, exact: true }).click();
      await expect.poll(async () => (await drawing()).documentId).toBe(id);
    };
    const fillInterface = async (name) => {
      await panel
        .getByRole('button', { name: 'Add hierarchical symbol' })
        .click();
      await expect
        .poll(async () => (await active()).hierarchicalSymbol)
        .toBe(true);
      await page.getByRole('button', { name: 'Pin', exact: true }).click();
      await pointer('lbuttondown', [225, 225]);
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
      await expect
        .poll(
          async () =>
            (await active()).items.find((item) => item.NodeName === 'pin')
              ?.name,
        )
        .toBe(name);
      await page
        .locator('.sheetbar')
        .getByText('Sheet 1', { exact: true })
        .click();
    };
    const place = async (name, at) => {
      await sidebar
        .getByRole('button', { name: name, exact: true })
        .click({ button: 'right' });
      await page
        .getByRole('menuitem', { name: 'Place as child symbol' })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.layoutTest.snapshot().adding?.hierarchy?.path,
          ),
        )
        .toBe(name);
      await pointer('lbuttondown', at);
    };

    await prompt('New project…', 'Hierarchy');
    await sidebar
      .getByRole('button', { name: 'Hierarchy', exact: true })
      .click();
    await expect(
      sidebar.getByRole('button', { name: 'Circuit.dsn', exact: true }),
    ).toBeVisible();
    await prompt('New schematic…', 'Child.dzn');
    await expect(
      sidebar.getByRole('button', { name: 'Child.dzn', exact: true }),
    ).toBeVisible();
    await prompt('New schematic…', 'Grandchild');
    await expect(
      sidebar.getByRole('button', { name: 'Grandchild.dsn', exact: true }),
    ).toBeVisible();
    const root = path.join(directory, 'Hierarchy');
    const marker = path.join(root, 'Hierarchy.tcproject');
    const settings = api.decodeProjectSettings(await readFile(marker));
    const child = settings.entries.find((item) => item.path === 'Child.dzn');
    const grandchild = settings.entries.find(
      (item) => item.path === 'Grandchild.dsn',
    );

    await open(grandchild.path, grandchild.id);
    await fillInterface('SIGNAL');
    await save.click();
    await expect(save).toBeDisabled();
    await open(child.path, child.id);
    await fillInterface('IN');
    await place(grandchild.path, [500, 500]);
    await expect.poll(async () => (await placements()).length).toBe(1);
    await save.click();
    await expect(save).toBeDisabled();

    await open('Circuit.dsn', settings.primarySchematic);
    await place(child.path, [400, 400]);
    await place(child.path, [675, 475]);
    await expect.poll(async () => (await placements()).length).toBe(2);
    const [first, second] = await placements();
    expect(second.unitId).not.toBe(first.unitId);
    expect(second.hierarchy).toEqual(first.hierarchy);
    await page
      .getByRole('button', { name: 'Rotate Clockwise', exact: true })
      .click();
    expect((await placements())[1].rotation).not.toBe(second.rotation);

    const [x, y] = new api.updateSymbol(
      (await placements())[1],
    ).active_points()[0];
    const [targetX, targetY] = new api.updateSymbol(
      (await placements())[0],
    ).active_points()[0];
    await page.evaluate(() =>
      window.layoutTest.command('add_wire_point_to_point'),
    );
    await pointer('lbuttondown', [x, y]);
    await pointer('mousemove', [targetX, targetY]);
    await pointer('lbuttondown', [targetX, targetY]);
    await expect
      .poll(async () =>
        (await active()).items.some((item) => item.NodeName === 'wire'),
      )
      .toBe(true);
    await select((await placements())[1]);
    await save.click();
    await expect(save).toBeDisabled();

    await panel.getByRole('button', { name: 'Open child schematic' }).click();
    await expect.poll(async () => (await drawing()).documentId).toBe(child.id);
    await expect(panel).toContainText('H2 · Child.dzn');
    await panel.getByRole('button', { name: 'Where used' }).click();
    await expect(
      panel.getByRole('button', { name: /Circuit.dsn.*H1/ }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: /Circuit.dsn.*H2/ }),
    ).toBeVisible();
    await select((await placements())[0]);
    await panel.getByRole('button', { name: 'Open child schematic' }).click();
    await expect
      .poll(async () => (await drawing()).documentId)
      .toBe(grandchild.id);
    await expect(panel).toContainText('H2 / H1 · Grandchild.dsn');
    await panel.getByRole('button', { name: 'Back to parent' }).click();
    await expect.poll(async () => (await drawing()).documentId).toBe(child.id);
    await panel.getByRole('button', { name: 'Back to parent' }).click();
    await expect
      .poll(async () => (await drawing()).documentId)
      .toBe(settings.primarySchematic);
    await expect
      .poll(async () => {
        const item = (await placements())[1];
        const ids = await page.evaluate(
          () => window.layoutTest.snapshot().selectedIds,
        );
        return ids.includes(item._id);
      })
      .toBe(true);

    const childFile = path.join(root, child.path);
    const changed = await api.decodeDrawing(await readFile(childFile));
    changed.sheets[0].items.find((item) => item.NodeName === 'pin').name =
      'RENAMED';
    await writeFile(childFile, await api.encodeDrawing(changed, 'zip-v1'));
    await panel.getByRole('button', { name: 'Reload child symbol' }).click();
    await expect(panel.getByRole('alert')).toContainText('IN');
    await panel.getByRole('button', { name: 'Apply update' }).click();
    await expect
      .poll(
        async () =>
          (
            await placements()
          )[1]._symbol.outlines[0].active_points[0].pin.name,
      )
      .toBe('RENAMED');
    expect((await placements())[1].unitId).toBe(second.unitId);
    await save.click();
    await expect(save).toBeDisabled();

    await page.evaluate(() => window.hierarchyTestMenu('file-save-as'));
    const dialog = page.getByRole('dialog', { name: 'Save project as' });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Hierarchy copy');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    const copy = path.join(directory, 'Hierarchy copy');
    await expect
      .poll(
        async () =>
          !!(await readFile(path.join(copy, 'Hierarchy copy.tcproject')).catch(
            () => undefined,
          )),
      )
      .toBe(true);
    const copied = await api.decodeDrawing(
      await readFile(path.join(copy, 'Circuit.dsn')),
    );
    expect(
      copied.sheets[0].items
        .filter((item) => item.hierarchy)
        .map((item) => item.unitId),
    ).toEqual([first.unitId, second.unitId]);
    await select((await placements())[1]);
    await panel.getByRole('button', { name: 'Open child schematic' }).click();
    await expect.poll(async () => (await drawing()).documentId).toBe(child.id);
    await panel.getByRole('button', { name: 'Back to parent' }).click();
    await expect
      .poll(async () => (await drawing()).documentId)
      .toBe(settings.primarySchematic);
    await rm(path.join(copy, child.path));
    await select((await placements())[0]);
    await expect(panel.getByRole('status')).toContainText(
      'Missing or ambiguous',
    );
    await expect(
      panel.getByRole('button', { name: 'Relink child' }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('opens legacy project paths and repairs an absolute child locator through an explicit import', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(
    path.join(info.project.outputDir, 'hierarchy-legacy-'),
  );
  await installProjectBridge(page, directory);
  const api = await layoutRuntime();
  const parentId = crypto.randomUUID();
  const parentSheetId = crypto.randomUUID();
  const pathOf = (name) => path.join(directory, name);
  const legacyChild = `<TinyCADSheets><HierachicalSymbol><NAME>Interface</NAME>
    <PIN pos="20,25" direction="3" which="0" elec="0" number="01" length="20" number_pos="0" centre_name="0" part="0" show="1">IN</PIN>
    </HierachicalSymbol><TinyCAD><NAME>Inside</NAME></TinyCAD></TinyCADSheets>`;
  try {
    await mkdir(pathOf('src'));
    await mkdir(pathOf('Blocks'));
    await writeFile(pathOf('Blocks/Input.dsn'), legacyChild);
    await writeFile(
      pathOf('src/Main.dsn'),
      `<TinyCADSheets><DSNIDENTITY id="${parentId}"/><TinyCAD id="${parentSheetId}"><NAME>Main</NAME>
      <HIERACHICAL_SYMBOL pos="60,70" rotate="0" file="..\\Blocks\\Input.dsn"><FIELD type="0" description="Ref" value="H1" show="1" pos="0,12"/></HIERACHICAL_SYMBOL>
      <HIERARCHICAL_SYMBOL pos="100,100" rotate="0" file="C:\\external\\External.dsn"><FIELD type="0" description="Ref" value="H2" show="1" pos="0,12"/></HIERARCHICAL_SYMBOL>
      </TinyCAD></TinyCADSheets>`,
    );
    const marker = pathOf('Legacy.tcproject');
    await writeFile(
      marker,
      api.encodeProjectSettings({
        projectId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        title: 'Legacy',
        requiredFeatures: [],
        primarySchematic: parentId,
        entries: [{ id: parentId, kind: 'schematic', path: 'src/Main.dsn' }],
      }),
    );
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const sidebar = page.getByRole('region', { name: 'Projects', exact: true });
    const panel = page.getByRole('region', { name: 'Schematic hierarchy' });
    await sidebar
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    const drawing = () =>
      page.evaluate(() => window.layoutTest.snapshot().drawing);
    const select = (index) =>
      page.evaluate(
        (index) =>
          window.layoutTest.selectItem(
            window.layoutTest
              .snapshot()
              .drawing.sheets[0].items.filter((i) => i.hierarchy)[index]._id,
          ),
        index,
      );
    await expect.poll(async () => (await drawing()).documentId).toBe(parentId);
    expect((await drawing()).sheets[0].items[0].hierarchy.cached).toBe(true);
    const originalInstance = (await drawing()).sheets[0].items[0];
    expect((await drawing()).sheets[0].items[1].hierarchy.cached).toBe(false);
    await select(0);
    await panel
      .getByRole('button', { name: 'Add child to project and open' })
      .click();
    const registeredInput = async () =>
      api
        .decodeProjectSettings(await readFile(marker))
        .entries.find((item) => item.path === 'Blocks/Input.dsn');
    await expect.poll(async () => !!(await registeredInput())).toBe(true);
    const input = await registeredInput();
    await expect.poll(async () => (await drawing()).documentId).toBe(input.id);
    await expect(
      page.locator('.sheetbar').getByText('Inside', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Back to parent' }).click();
    await expect.poll(async () => (await drawing()).documentId).toBe(parentId);
    expect((await drawing()).sheets[0].items[0].hierarchy).toEqual({
      path: input.path,
      documentId: input.id,
      cached: true,
    });
    expect((await drawing()).sheets[0].items[0]).toMatchObject({
      unitId: originalInstance.unitId, _symbol: originalInstance._symbol,
    });

    await select(1);
    await expect(panel.getByRole('status')).toContainText(
      'inside this project',
    );
    await page.locator('input[type=file][accept=".dsn,.dzn"]').setInputFiles({
      name: 'External.dsn',
      mimeType: 'application/xml',
      buffer: Buffer.from(legacyChild),
    });
    const dialog = page.getByRole('dialog', { name: 'Import schematic…' });
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(
      sidebar.getByRole('button', { name: 'External.dsn', exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Relink child' }).click();
    const external = api
      .decodeProjectSettings(await readFile(marker))
      .entries.find((item) => item.path === 'External.dsn');
    await panel
      .getByRole('combobox', { name: 'Choose a project schematic' })
      .selectOption(external.id);
    await panel.getByRole('button', { name: 'Use schematic' }).click();
    await expect
      .poll(async () => (await drawing()).sheets[0].items[1].hierarchy.path)
      .toBe('External.dsn');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect
      .poll(async () => {
        const bytes = await readFile(pathOf('src/Main.dsn'), 'utf8');
        return (
          bytes.includes('file="External.dsn"') &&
          !bytes.includes('HIERACHICAL_SYMBOL')
        );
      })
      .toBe(true);
    const saved = await api.decodeDrawing(await readFile(pathOf('src/Main.dsn')));
    expect(saved.sheets[0].items[0].hierarchy).toMatchObject({ path: input.path, documentId: input.id });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses expanded project connectivity for exports, cross-probing, and reviewed PCB transfers', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(
    path.join(info.project.outputDir, 'hierarchy-board-'),
  );
  let interruptedBoard;
  let interrupted = false;
  await installProjectBridge(page, directory, (request) => {
    if (!interruptedBoard || request.id !== interruptedBoard) return;
    if (request.operation === 'write') interrupted = true;
    if (interrupted) throw new Error('Simulated storage interruption');
  });
  const original = path.join(directory, 'Hierarchy');
  const api = await layoutRuntime();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const files = new Map();
    const entries = [];
    for (const documentPath of [
      'src/Circuit.dsn',
      'Blocks/Child.dsn',
      'Blocks/Leaf.dsn',
    ]) {
      const data = await readFile(
        new URL('../fixtures/pcb-hierarchy/' + documentPath, import.meta.url),
      );
      const drawing = await api.decodeDrawing(data);
      files.set(documentPath, drawing);
      entries.push({
        id: drawing.documentId,
        kind: 'schematic',
        path: documentPath,
      });
    }
    const rootPath = entries[0].path;
    const root = files.get(rootPath);
    const graph = await api.buildHierarchicalNetlist(
      { path: rootPath, drawing: root },
      async (parent, link) => {
        const path = api.childPath(link, parent.path);
        return { path, drawing: files.get(path) };
      },
    );
    const { snapshot } = await api.buildHierarchicalCircuitSnapshot(graph, {
      documentId: root.documentId,
      revision: 1,
    });
    const part = snapshot.components.find(
      ({ reference }) => reference === 'H2_H1_R1',
    );
    const { unitId, pinId } = part.signals[0].terminals[0];
    const source = snapshot.sources[unitId];
    const partNet = snapshot.nets.find(({ terminals }) =>
      terminals.some(
        (terminal) => terminal.unitId === unitId && terminal.pinId === pinId,
      ),
    );
    const id = () => crypto.randomUUID();
    const positionNm = { x: 1_000_000, y: 1_000_000 };
    const digest = 'sha256:' + 'a'.repeat(64);
    const componentId = id();
    const footprintId = id();
    const deviceId = id();
    const padId = id();
    const board = {
      ...api.createBoard('Control board', 1, [
        { x: 0, y: 0 },
        { x: 10_000_000, y: 0 },
        { x: 10_000_000, y: 10_000_000 },
        { x: 0, y: 10_000_000 },
      ]),
      requiredFeatures: ['straight-outline', 'embedded-devices'],
      sourceCircuit: {
        documentId: root.documentId,
        revision: snapshot.revision,
        connectivityDigest: await api.circuitConnectivityDigest(snapshot),
      },
      components: [
        {
          id: componentId,
          logicalId: part.id,
          signals: [{ signalId: part.signals[0].id, netId: partNet.id }],
        },
      ],
      nets: [{ id: partNet.id, name: partNet.names[0] }],
      footprintDefinitions: [
        {
          id: footprintId,
          name: 'Fixture terminal',
          revision: 'r1',
          definitionDigest: digest,
          pads: [{ id: padId, label: 'A01', positionNm }],
        },
      ],
      deviceDefinitions: [
        {
          id: deviceId,
          footprintId,
          revision: 'r1',
          definitionDigest: digest,
          packageName: 'Fixture terminal',
          packageSource: 'Browser fixture',
          signalIds: [part.signals[0].id],
          assignments: [
            { padId, kind: 'signal', signalId: part.signals[0].id },
          ],
        },
      ],
      footprints: [
        {
          id: id(),
          componentId,
          deviceId,
          positionNm,
          rotationMicrodegree: 0,
          side: 'top',
          locked: false,
        },
      ],
    };
    root.sheets[0].items
      .find(({ unitId }) => unitId === source.instancePath[0])
      .text.find(({ description }) => description === 'Ref').value = 'H7';
    const leaf = files
      .get(source.documentPath)
      .sheets.find(({ id }) => id === source.sheetId);
    const template = leaf.items.find(({ unitId }) => unitId === source.unitId);
    leaf.items.push({
      ...template,
      _id: Math.max(...leaf.items.map(({ _id }) => _id)) + 1,
      unitId: id(),
      point: [1_000, 1_000],
      _active_points: null,
      text: template.text.map((field) =>
        field.description === 'Ref' ? { ...field, value: 'R9' } : field,
      ),
    });
    for (const [name, drawing] of files) {
      const target = path.join(original, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await api.encodeDrawing(drawing, 'xml'));
    }
    await writeFile(
      path.join(original, 'Board.dpn'),
      await api.encodeBoard(board),
    );
    await writeFile(
      path.join(original, 'Circuit.json'),
      JSON.stringify(snapshot),
    );
    await writeFile(
      path.join(original, 'Hierarchy.tcproject'),
      api.encodeProjectSettings({
        projectId: id(),
        revisionId: id(),
        title: 'Hierarchy',
        requiredFeatures: [],
        primarySchematic: root.documentId,
        primaryBoard: board.boardId,
        entries: [
          ...entries,
          { kind: 'board', id: board.boardId, path: 'Board.dpn' },
          { kind: 'circuit', id: snapshot.snapshotId, path: 'Circuit.json' },
        ],
        associations: [{ schematic: root.documentId, board: board.boardId }],
      }),
    );

    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', {
      name: 'Projects',
      exact: true,
    });
    const snapshotUI = () => page.evaluate(() => window.layoutTest.snapshot());
    await projects
      .getByRole('button', { name: 'Hierarchy', exact: true })
      .click();
    await projects
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(root.documentId);

    await page.evaluate(() => window.hierarchyTestMenu('file-save-as'));
    const saveAs = page.getByRole('dialog', { name: 'Save project as' });
    await saveAs.getByRole('textbox', { name: 'Name' }).fill('Verified copy');
    await saveAs.getByRole('button', { name: 'OK', exact: true }).click();
    const copy = path.join(directory, 'Verified copy');
    await expect
      .poll(
        async () =>
          !!(await readFile(path.join(copy, 'Verified copy.tcproject')).catch(
            () => undefined,
          )),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await snapshotUI()).projectRoot?.includes('Verified copy'),
      )
      .toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await projects
      .getByRole('button', { name: 'Verified copy', exact: true })
      .click();
    await projects
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(root.documentId);

    await page.getByRole('button', { name: 'Symbols', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Netlist', exact: true }).click();
    await expect(
      page.getByRole('row').filter({ hasText: 'H7_H1_R1.01' }),
    ).toHaveCount(1);
    await page.evaluate(() => window.hierarchyTestMenu('tools-bom'));
    await expect(page.locator('.bomTable')).toContainText('H7_H1_R1');
    await expect(page.locator('.bomTable')).toContainText('H1_H1_R1');
    await expect(page.locator('.bomTable tbody tr')).toHaveCount(1);
    await expect(page.locator('.bomTable tbody tr td').nth(1)).toHaveText('16');
    await page.evaluate(() => window.hierarchyTestMenu('tools-netlist'));
    const dialog = page.getByRole('dialog', { name: 'Generate Netlist' });
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'PADS-PCB', exact: true }).click();
    const download = page.waitForEvent('download', { timeout: 10000 });
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    const exported = await readFile(await (await download).path(), 'utf8');
    expect(exported).toContain('H7_H1_R1.01');
    expect(exported).toContain('H1_H1_R1.01');

    await projects
      .getByRole('button', { name: 'Board.dpn' })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Cross-probe schematic…' })
      .click();
    const probe = page.getByRole('dialog', { name: 'Board.dpn' });
    await probe.getByRole('button', { name: 'Review connectivity' }).click();
    await expect(probe.getByRole('status')).toHaveText(
      'Nets retained: 6. Nets proposed: 2. Previous nets to review: 0.',
    );
    await probe
      .getByRole('button', { name: 'H2_H1_R1 · A01 · TERMINAL' })
      .click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(source.documentId);
    const active = await snapshotUI();
    expect(active.drawing.sheets[active.sheet].id).toBe(source.sheetId);
    const selected = active.drawing.sheets[active.sheet].items.find(
      ({ unitId }) => unitId === source.unitId,
    );
    expect(active.selectedIds).toEqual([selected._id]);
    expect(active.hoverPins).toEqual([`${selected._id}:@${pinId}`]);
    await expect(
      page.getByRole('region', { name: 'Schematic hierarchy' }),
    ).toContainText('H7 / H1 · Blocks/Leaf.dsn');
    await projects
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(root.documentId);
    await projects
      .getByRole('button', { name: 'Board.dpn' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Review PCB devices…' }).click();
    const devices = page.getByRole('dialog', { name: 'Review PCB devices' });
    await devices
      .getByLabel('Component', { exact: true })
      .selectOption(part.id);
    const terminalId = id();
    const footprint = {
      id: footprintId,
      name: 'Reviewed fixture',
      revision: 'r2',
      pads: [
        {
          id: padId,
          label: '01',
          positionNm,
          stack: {
            copper: {
              top: {
                kind: 'capsule',
                start: { x: 0, y: 0 },
                end: { x: 0, y: 0 },
                widthNm: 600_000,
              },
            },
          },
        },
      ],
    };
    const library = await api.writeLibraryDevice({
      format: 'tinycad-device',
      version: 1,
      id: id(),
      name: 'Reviewed fixture',
      revision: 'r2',
      packageNames: ['Fixture terminal'],
      mount: 'surface-mount',
      bodyNm: { width: 1_000_000, height: 1_000_000 },
      source: 'Browser fixture',
      license: 'CC0-1.0',
      review: { by: 'Test', evidence: 'Schematic fixture' },
      footprint: {
        ...footprint,
        definitionDigest: await api.deviceDigest(footprint),
      },
      terminals: [{ id: terminalId, name: 'Terminal' }],
      assignments: [{ padId, kind: 'signal', signalId: terminalId }],
    });
    await devices.getByLabel('Add device library file').setInputFiles({
      name: 'reviewed.tcdevice.json',
      mimeType: 'application/json',
      buffer: Buffer.from(library),
    });
    const deviceChoice = devices.getByLabel('Device revision');
    await deviceChoice.selectOption({
      label: 'Reviewed fixture · r2 · 1 pads',
    });
    const preview = devices.getByRole('button', {
      name: 'Preview device changes',
    });
    await expect(preview).toBeDisabled();
    await devices
      .getByLabel('Signal for pad 01 (1)')
      .selectOption(part.signals[0].id);
    await expect(
      devices.getByRole('img', { name: 'Highlighted schematic pin' }),
    ).toBeVisible();
    const padPreview = devices.getByRole('img', {
      name: 'Footprint pad preview',
    });
    await expect(padPreview.locator('[data-highlighted="true"]')).toContainText(
      '01',
    );
    await preview.click();
    await expect(
      devices.getByRole('region', { name: 'Proposed device changes' }),
    ).toContainText('Label');
    const boardPath = path.join(copy, 'Board.dpn');
    expect((await api.decodeBoard(await readFile(boardPath))).revision).toBe(
      board.revision,
    );
    await devices
      .getByRole('button', { name: 'Apply reviewed device' })
      .click();
    await expect(devices).toBeHidden();
    const reviewedBoard = await api.decodeBoard(await readFile(boardPath));
    expect(reviewedBoard.revision).toBe(board.revision + 1);
    expect(reviewedBoard.footprints[0]).toEqual({
      ...board.footprints[0],
      deviceId: reviewedBoard.deviceDefinitions[0].id,
    });
    expect(reviewedBoard.deviceDefinitions[0].library.bindings).toEqual([
      { terminalId, signalId: part.signals[0].id },
    ]);
    expect(await readFile(path.join(copy, 'reviewed.tcdevice.json'))).toEqual(
      Buffer.from(library),
    );

    const versionBeforeErc = (await snapshotUI()).drawingVersion;
    await page.evaluate(() => window.hierarchyTestMenu('tools-drc'));
    const erc = page.getByRole('dialog', { name: 'Design Rules Check' });
    await erc.getByRole('checkbox', { name: 'Unconnected nets' }).check();
    await erc.getByRole('button', { name: 'OK', exact: true }).click();
    const issue = page.getByRole('row').filter({
      has: page.getByText('H7_H1_R9', { exact: true }),
    });
    await expect(issue).toContainText('Unconnected nets');
    expect((await snapshotUI()).drawingVersion).toBe(versionBeforeErc);
    await issue.click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(source.documentId);
    await expect(
      page.getByRole('region', { name: 'Schematic hierarchy' }),
    ).toContainText('H7 / H1 · Blocks/Leaf.dsn');
    await projects
      .getByRole('button', { name: 'Board.dpn' })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Update PCB from Schematic…' })
      .click();
    const eco = page.getByRole('dialog', { name: 'Update PCB from Schematic' });
    await expect(eco).toContainText('src/Circuit.dsn → Board.dpn');
    await expect(
      eco.getByRole('button', { name: 'Apply circuit update' }),
    ).toBeDisabled();
    await eco
      .getByRole('button', { name: 'Review device for H7_H1_R9', exact: true })
      .click();
    const draftDevice = page.getByRole('dialog', {
      name: 'Review PCB devices',
    });
    await draftDevice.getByLabel('Device revision').selectOption({
      label: 'Reviewed fixture · r2 · 1 pads',
    });
    await draftDevice
      .getByLabel('Signal for pad 01 (1)')
      .selectOption({ index: 1 });
    await draftDevice
      .getByRole('button', { name: 'Preview device changes' })
      .click();
    await draftDevice
      .getByRole('button', { name: 'Stage reviewed device' })
      .click();
    await expect(
      eco.getByRole('list', { name: 'Reviewed device changes' }),
    ).toContainText('H7_H1_R9');
    await eco.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await api.decodeBoard(await readFile(boardPath))).revision).toBe(
      reviewedBoard.revision,
    );
    await projects.getByRole('button', { name: 'Blocks', exact: true }).click();
    await projects
      .getByRole('button', { name: 'Leaf.dsn' })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Create PCB from Schematic…' })
      .click();
    const pathPrompt = page.getByRole('dialog', {
      name: 'Create PCB from Schematic…',
    });
    await expect(pathPrompt.getByRole('textbox')).toHaveValue(
      'Blocks/Leaf.dpn',
    );
    await pathPrompt.getByRole('button', { name: 'OK', exact: true }).click();
    const firstTransfer = page.getByRole('dialog', {
      name: 'Create PCB from Schematic',
      exact: true,
    });
    await expect(
      firstTransfer.getByRole('button', { name: 'Create linked PCB' }),
    ).toBeDisabled();
    for (const reference of ['R1', 'R9']) {
      await firstTransfer
        .getByRole('button', {
          name: 'Review device for ' + reference,
          exact: true,
        })
        .click();
      const picker = page.getByRole('dialog', { name: 'Review PCB devices' });
      await picker
        .getByLabel('Device revision')
        .selectOption({ label: 'Reviewed fixture · r2 · 1 pads' });
      await picker
        .getByLabel('Signal for pad 01 (1)')
        .selectOption({ index: 1 });
      await picker
        .getByRole('button', { name: 'Preview device changes' })
        .click();
      await picker
        .getByRole('button', { name: 'Stage reviewed device' })
        .click();
    }
    await firstTransfer
      .getByRole('button', { name: 'Create linked PCB' })
      .click();
    await expect(firstTransfer).toBeHidden();
    const pcbLayout = page.getByRole('region', {
      name: 'PCB layout',
      exact: true,
    });
    await expect(
      pcbLayout.getByRole('img', { name: 'Board layout' }),
    ).toBeVisible();
    await expect(
      pcbLayout.getByRole('list', { name: 'Unplaced components' }),
    ).toContainText('R1');
    await expect(
      pcbLayout.getByRole('list', { name: 'Unplaced components' }),
    ).toContainText('R9');
    await pcbLayout.getByRole('button', { name: /R9/ }).click();
    await pcbLayout.getByLabel('X (mm)', { exact: true }).fill('20');
    await pcbLayout.getByLabel('Y (mm)', { exact: true }).fill('30');
    await pcbLayout.getByRole('button', { name: 'Place at coordinates' }).click();
    await expect(
      pcbLayout.getByRole('grid', { name: 'Placed components', exact: true }),
    ).toContainText('R9');
    await pcbLayout.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Leaf.dpn', exact: true })).toBeVisible();
    await page.getByRole('tablist', { name: 'Project files' }).getByRole('button', { name: /Close (?:Blocks\/)?Leaf\.dpn/ }).click();

    const leafRow = projects.locator('li').filter({
      has: page.getByRole('button', { name: 'Leaf.dpn', exact: true }),
    });
    await expect(leafRow).toContainText('In sync');

    const created = await api.decodeBoard(
      await readFile(path.join(copy, 'Blocks/Leaf.dpn')),
    );
    expect(created.components.map(({ reference }) => reference).sort()).toEqual(
      ['R1', 'R9'],
    );
    expect(created.footprints).toHaveLength(1);
    expect(created.footprints[0].componentId).toBe(
      created.components.find(({ reference }) => reference === 'R9').id,
    );
    expect(created.footprints[0].positionNm).toEqual({
      x: 20_000_000,
      y: 30_000_000,
    });
    expect(created.appliedCircuit.documentId).toBe(source.documentId);
    const marker = api.decodeProjectSettings(
      await readFile(path.join(copy, 'Verified copy.tcproject')),
    );
    expect(marker.associations).toContainEqual({
      schematic: source.documentId,
      board: created.boardId,
    });
    expect(marker.entries).toContainEqual({
      kind: 'board',
      id: created.boardId,
      path: 'Blocks/Leaf.dpn',
    });
    await projects.getByRole('button', { name: 'Leaf.dsn', exact: true }).click();
    await expect.poll(async () => (await snapshotUI()).drawing.documentId).toBe(source.documentId);
    await page.getByText('Leaf', { exact: true }).click();
    await expect.poll(async () => {
      const { drawing, sheet } = await snapshotUI();
      return drawing.sheets[sheet].id;
    }).toBe(source.sheetId);
    await page.evaluate(() => {
      const { drawing, sheet } = window.layoutTest.snapshot();
      const points = drawing.sheets[sheet].items
        .filter((item) => item.NodeName === 'symbol')
        .map(({ point }) => point);
      const edge = (axis, fn, margin) => fn(...points.map((point) => point[axis])) + margin;
      const start = [edge(0, Math.min, -100), edge(1, Math.min, -100)];
      const end = [edge(0, Math.max, 100), edge(1, Math.max, 100)];
      window.layoutTest.pointer('lbuttondown', start);
      window.layoutTest.pointer('mousedrag', end);
      window.layoutTest.pointer('dragend', end);
    });
    await expect.poll(async () => (await snapshotUI()).selectedIds.length).toBeGreaterThanOrEqual(2);
    const placeSelection = projects.getByRole('button', { name: 'Place selected schematic components…' });
    await expect(placeSelection).toBeVisible();
    await placeSelection.click();
    const boardPicker = page.getByRole('dialog', { name: 'Place selected schematic components' });
    await expect(boardPicker.getByRole('list', { name: 'Linked boards' }).getByRole('listitem')).toHaveCount(1);
    await boardPicker.getByRole('button', { name: 'Blocks/Leaf.dpn · 1 package' }).click();
    const tray = page.getByRole('region', { name: 'Unplaced components' });
    await expect(tray.getByRole('status')).toHaveText('1 remaining · Place R1');
    await expect(tray.getByRole('img', { name: 'Footprint pad preview' })).toBeVisible();
    await expect(pcbLayout.getByRole('button', { name: 'Place at coordinates' })).toBeDisabled();
    await tray.getByRole('button', { name: 'Stop sequential placement' }).click();
    await page.getByRole('group', { name: 'Project activity bar' }).getByRole('button', { name: 'Projects', exact: true }).click();
    const checkDialog = page.getByRole('region', { name: 'PCB design checks' });
    async function openLeafChecks() {
      await clickPcbCommand(pcbLayout, 'Run design checks…');
      await expect(checkDialog.getByText(/Schematic parity · checked/)).toBeVisible();
    }
    await openLeafChecks();
    await expect(checkDialog.getByRole('table', { name: 'PCB findings' }))
      .not.toContainText('The project schematic changed');
    await checkDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await pcbLayout
      .getByRole('button', { name: 'Update PCB from Schematic…' })
      .click();
    await expect(eco.getByRole('status')).toHaveText('The board is current.');
    await eco.getByRole('button', { name: 'Close', exact: true }).click();
    await projects
      .getByRole('button', { name: 'Leaf.dsn' })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', {
        name: 'Update PCB from Schematic…',
        exact: true,
      })
      .click();
    await expect(eco.getByRole('status')).toHaveText('The board is current.');
    await eco.getByRole('button', { name: 'Close', exact: true }).click();

    await projects.getByRole('button', { name: 'Blocks', exact: true }).click();
    await projects
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(root.documentId);
    await projects.getByRole('button', { name: 'Blocks', exact: true }).click();
    const leafPath = path.join(copy, 'Blocks/Leaf.dsn');
    const pcbPath = path.join(copy, 'Blocks/Leaf.dpn');
    const renamedUnit = created.appliedCircuit.components.find(
      ({ reference }) => reference === 'R9',
    ).units[0].id;
    async function renameLeafPart(reference) {
      const before = await readFile(leafPath);
      const current = await api.decodeDrawing(before);
      const unit = current.sheets
        .flatMap(({ items }) => items)
        .find(({ unitId }) => unitId === renamedUnit);
      unit.text.find(({ description }) => description === 'Ref').value =
        reference;
      const content = await api.encodeDrawing(current, 'xml');
      expect(Buffer.from(content).equals(before)).toBe(false);
      await writeFile(leafPath, content);
    }
    async function previewLeafUpdate() {
      await projects
        .getByRole('button', { name: 'Leaf.dpn' })
        .click({ button: 'right' });
      await page
        .getByRole('menuitem', { name: 'Update PCB from Schematic…' })
        .click();
    }
    await renameLeafPart('R10');
    await page.evaluate(() =>
      window.dispatchEvent(new Event('tinycad:project-files-changed')),
    );
    await expect(leafRow).toContainText('Schematic changes pending');
    await projects.getByRole('button', { name: 'Leaf.dpn', exact: true }).click();
    await openLeafChecks();
    const findings = checkDialog.getByRole('table', { name: 'PCB findings' });
    await expect(findings).toContainText('The project schematic changed since the last PCB update.');
    await expect(findings).toContainText('Board and schematic references differ for R10.');
    const drcDownload = page.waitForEvent('download');
    await checkDialog.getByRole('button', { name: 'Save report…' }).click();
    const pendingReport = JSON.parse(await readFile(await (await drcDownload).path(), 'utf8'));
    expect(pendingReport.schematic).toMatchObject({
      state: 'pending', documentId: source.documentId, digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect((await api.decodeBoard(await readFile(pcbPath))).revision).toBe(created.revision);
    await checkDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await previewLeafUpdate();
    await expect(
      eco.getByRole('list', { name: 'Component changes' }),
    ).toContainText('Update R10');
    await renameLeafPart('R11');
    await eco.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(eco.getByRole('alert')).toContainText(
      'The schematic changed after the preview.',
    );
    expect((await api.decodeBoard(await readFile(pcbPath))).revision).toBe(
      created.revision,
    );
    await eco.getByRole('button', { name: 'Cancel', exact: true }).click();
    await previewLeafUpdate();
    await expect(
      eco.getByRole('list', { name: 'Component changes' }),
    ).toContainText('Update R11');
    await eco.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(eco).toBeHidden();
    const updated = await api.decodeBoard(await readFile(pcbPath));
    expect(updated.revision).toBe(created.revision + 1);
    expect(updated.components.map(({ reference }) => reference).sort()).toEqual(
      ['R1', 'R11'],
    );
    expect(updated.sourceCircuit.connectivityDigest).toBe(
      created.sourceCircuit.connectivityDigest,
    );
    expect((await api.decodeBoard(await readFile(boardPath))).revision).toBe(
      reviewedBoard.revision,
    );
    const traceId = id();
    const oldNet = updated.appliedCircuit.nets.find(({ names }) =>
      names.includes('IN'),
    );
    const track = {
      id: traceId,
      netId: oldNet.id,
      widthNm: 250_000,
      layerId: 'top',
      start: { x: 1_000_000, y: 1_000_000 },
      end: { x: 2_000_000, y: 1_000_000 },
    };
    await writeFile(
      pcbPath,
      await api.encodeBoard({
        ...updated,
        tracks: [track],
        requiredFeatures: [...updated.requiredFeatures, 'routed-copper'],
      }),
    );
    await projects
      .getByRole('button', { name: 'Leaf.dpn', exact: true })
      .click();
    const canvas = pcbLayout.getByRole('img', { name: 'Board layout' });
    await expect(canvas.locator(`[data-track="${traceId}"]`)).toHaveCount(1);
    await openLeafChecks();
    await expect(findings).not.toContainText('The project schematic changed');
    await checkDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await selectPcbNet(pcbLayout, oldNet.id);
    await expect(
      pcbLayout.getByRole('list', { name: 'Schematic net terminals' }),
    ).toContainText('R1');
    await expect(
      pcbLayout
        .getByRole('img', { name: 'Board layout' })
        .locator('[data-net-highlighted="true"]'),
    ).toHaveCount(1);
    await page.getByRole('tablist', { name: 'Project files' }).getByRole('button', { name: /Close (?:Blocks\/)?Leaf\.dpn/ }).click();
    const leafBeforeRemoval = await readFile(leafPath);
    const revisedLeaf = await api.decodeDrawing(leafBeforeRemoval);
    for (const sheet of revisedLeaf.sheets) {
      sheet.items = sheet.items.filter(
        ({ text }) =>
          !Array.isArray(text) ||
          !text.some(
            ({ description, value }) => description === 'Ref' && value === 'R1',
          ),
      );
    }
    await writeFile(leafPath, await api.encodeDrawing(revisedLeaf, 'xml'));
    const routedBefore = await readFile(pcbPath);
    await previewLeafUpdate();
    const affectedTrace = eco.getByRole('list', { name: 'Affected copper' })
      .locator(`[data-copper-id="${traceId}"]`);
    await expect(affectedTrace).toContainText('Net assignment needs review');
    await eco.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await readFile(pcbPath)).toEqual(routedBefore);
    await previewLeafUpdate();
    await expect(affectedTrace).toBeVisible();
    await renameLeafPart('R12');
    await eco.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(eco.getByRole('alert')).toContainText(
      'The schematic changed after the preview.',
    );
    expect(await readFile(pcbPath)).toEqual(routedBefore);
    await eco.getByRole('button', { name: 'Cancel', exact: true }).click();
    await previewLeafUpdate();
    await expect(
      eco.getByRole('list', { name: 'Component changes' }),
    ).toContainText('Update R12');
    await expect(affectedTrace).toBeVisible();
    await eco.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(eco).toBeHidden();
    const routed = await api.decodeBoard(await readFile(pcbPath));
    const { netId: originalNetId, ...trackGeometry } = track;
    expect(routed.tracks).toEqual([{ ...trackGeometry, reviewRequired: true }]);
    await projects
      .getByRole('button', { name: 'Leaf.dpn' })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: 'Undo last circuit update…' })
      .click();
    const restore = page.getByRole('dialog', {
      name: 'Undo last circuit update…',
    });
    await restore
      .getByRole('button', { name: 'Restore board revision' })
      .click();
    await expect(restore).toBeHidden();
    const restored = await api.decodeBoard(await readFile(pcbPath));
    expect(restored.revision).toBe(routed.revision + 1);
    expect(restored.tracks).toEqual([track]);
    expect(restored.appliedCircuit).toEqual(updated.appliedCircuit);
    await projects.getByRole('button', { name: 'Blocks', exact: true }).click();
    await writeFile(leafPath, leafBeforeRemoval);
    const rootFile = path.join(copy, rootPath);
    const rootBeforeAnnotation = await readFile(rootFile);
    const childBeforeAnnotation = await readFile(leafPath);
    async function boardMenu(action) {
      await projects
        .getByRole('button', { name: 'Board.dpn' })
        .click({ button: 'right' });
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    }
    await boardMenu('Edit PCB references…');
    const boardRefEditor = page.getByRole('dialog', {
      name: 'Edit PCB references',
      exact: true,
    });
    const boardPart = reviewedBoard.components.find(
      ({ id }) => id === componentId,
    );
    await boardRefEditor
      .getByLabel('Reference for ' + (boardPart.reference ?? componentId), {
        exact: true,
      })
      .fill('C12');
    await boardRefEditor
      .getByRole('button', { name: 'Save PCB references' })
      .click();
    await expect(boardRefEditor).toBeHidden();
    const renamedOnBoard = await api.decodeBoard(await readFile(boardPath));
    expect(renamedOnBoard.components[0].reference).toBe('C12');

    await boardMenu('Update Schematic from PCB…');
    const reverse = page.getByRole('dialog', {
      name: 'Update Schematic from PCB',
      exact: true,
    });
    await expect(
      reverse.getByRole('button', { name: 'Apply reference changes' }),
    ).toBeDisabled();
    await reverse
      .getByRole('combobox', { name: 'Resolve H2_H1_R1', exact: false })
      .selectOption('pcb');
    interruptedBoard = boardPath;
    await reverse
      .getByRole('button', { name: 'Apply reference changes' })
      .click();
    await expect(reverse.getByRole('alert')).toContainText(
      'Simulated storage interruption',
    );
    expect(await readFile(rootFile)).not.toEqual(rootBeforeAnnotation);
    interruptedBoard = undefined;
    await page.reload();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await projects
      .getByRole('button', { name: 'Verified copy', exact: true })
      .click();
    await expect
      .poll(async () => (await readFile(rootFile)).equals(rootBeforeAnnotation))
      .toBe(true);
    expect((await api.decodeBoard(await readFile(boardPath))).revision).toBe(
      renamedOnBoard.revision,
    );
    await boardMenu('Update Schematic from PCB…');
    await reverse
      .getByRole('combobox', { name: 'Resolve H2_H1_R1' })
      .selectOption('pcb');
    await reverse
      .getByRole('button', { name: 'Apply reference changes' })
      .click();
    await expect(reverse).toBeHidden();
    const annotatedRoot = await api.decodeDrawing(await readFile(rootFile));
    expect(annotatedRoot.instanceReferences).toEqual([
      {
        instancePath: source.instancePath,
        componentId: part.id,
        reference: 'C12',
      },
    ]);
    expect(await readFile(leafPath)).toEqual(childBeforeAnnotation);
    const synchronized = await api.decodeBoard(await readFile(boardPath));
    expect(
      synchronized.appliedCircuit.components.find(({ id }) => id === part.id)
        .reference,
    ).toBe('C12');
    expect(synchronized.footprints).toEqual(reviewedBoard.footprints);
    expect(synchronized.sourceCircuit.connectivityDigest).toBe(
      reviewedBoard.sourceCircuit.connectivityDigest,
    );

    await boardMenu('Update Schematic from PCB…');
    await expect(reverse.getByRole('status')).toHaveText(
      'There are no PCB reference changes to apply.',
    );
    await reverse.getByRole('button', { name: 'Cancel' }).click();
    await boardMenu('Cross-probe schematic…');
    await page
      .getByRole('dialog', { name: 'Board.dpn' })
      .getByRole('button', { name: 'C12 · 01 · TERMINAL' })
      .click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(source.documentId);
    await expect(
      page.locator('svg').getByText('C12', { exact: true }),
    ).toBeVisible();
    await projects
      .getByRole('button', { name: 'Find in PCB…', exact: true })
      .click();
    const reverseProbe = page.getByRole('dialog', {
      name: 'Find in PCB',
      exact: true,
    });
    await expect(
      reverseProbe.getByRole('heading', { name: 'Board.dpn · C12' }),
    ).toBeVisible();
    await expect(
      reverseProbe.getByRole('heading', { name: 'Blocks/Leaf.dpn · R1' }),
    ).toBeVisible();
    const rootMatch = reverseProbe.getByRole('region', {
      name: 'Board.dpn',
      exact: true,
    });
    await expect(
      rootMatch.getByRole('button', { name: '01 · TERMINAL' }),
    ).toBeVisible();
    await rootMatch.getByRole('button', { name: 'Show net on board' }).click();
    await expect(
      pcbLayout.getByRole('img', { name: 'Board layout' }),
    ).toBeVisible();
    await expect(boardNet).toHaveValue(partNet.id);
    await expect(
      pcbLayout
        .getByRole('img', { name: 'Board layout' })
        .locator('[data-net-highlighted="true"]'),
    ).toHaveCount(1);
    await expect(
      pcbLayout.getByRole('list', { name: 'Schematic connections' }),
    ).toContainText('01 · TERMINAL');
    await pcbLayout
      .getByRole('list', { name: 'Schematic net terminals' })
      .getByRole('button', { name: /^C12 · TERMINAL/ })
      .click();
    await expect(pcbLayout).toBeHidden();
    await expect(
      page.getByRole('region', { name: 'Schematic hierarchy' }),
    ).toContainText('H7 / H1');
    await page.evaluate(() => window.hierarchyTestMenu('tools-bom'));
    await expect(page.locator('.bomTable')).toContainText('C12');
    await projects
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(root.documentId);
    await page.evaluate(() => window.hierarchyTestMenu('tools-bom'));
    await expect(page.locator('.bomTable')).toContainText('C12');
    const bomReferences = page.locator('.bomTable tbody tr td').first();
    await expect(bomReferences).toHaveText(/(?:^|,)H1_H1_R1(?:,|$)/);
    await expect(bomReferences).not.toHaveText(/(?:^|,)H7_H1_R1(?:,|$)/);

    await boardMenu('Undo last back annotation…');
    const undoAnnotation = page.getByRole('dialog', {
      name: 'Undo last back annotation…',
    });
    await undoAnnotation
      .getByRole('button', { name: 'Restore references' })
      .click();
    await expect(undoAnnotation).toBeHidden();
    expect(await readFile(rootFile)).toEqual(rootBeforeAnnotation);
    const restoredReference = await api.decodeBoard(await readFile(boardPath));
    expect(restoredReference.revision).toBe(synchronized.revision + 1);
    expect(restoredReference.components).toEqual(renamedOnBoard.components);
    expect(restoredReference.footprints).toEqual(renamedOnBoard.footprints);

    const sibling = snapshot.components.find(
      ({ reference }) => reference === 'H1_H1_R1',
    );
    const siblingId = id();
    const exchangeBoard = {
      ...restoredReference,
      components: [
        ...restoredReference.components,
        { id: siblingId, logicalId: sibling.id, reference: sibling.reference },
      ],
    };
    await writeFile(boardPath, await api.encodeBoard(exchangeBoard));
    await boardMenu('Edit PCB references…');
    await boardRefEditor
      .getByLabel('Reference for C12', { exact: true })
      .fill(sibling.reference);
    await boardRefEditor
      .getByLabel('Reference for ' + sibling.reference, { exact: true })
      .fill(part.reference);
    await boardRefEditor
      .getByRole('button', { name: 'Save PCB references' })
      .click();
    await expect(boardRefEditor).toBeHidden();
    const stagedExchange = await readFile(boardPath);

    async function previewExchange() {
      await boardMenu('Update Schematic from PCB…');
      await reverse
        .getByRole('combobox', {
          name: 'Resolve ' + part.reference,
          exact: true,
        })
        .selectOption('pcb');
      await expect(
        reverse.getByRole('button', { name: 'Apply reference changes' }),
      ).toBeEnabled();
    }
    await previewExchange();
    const externallyEdited = Buffer.concat([
      rootBeforeAnnotation,
      Buffer.from('\n'),
    ]);
    await writeFile(rootFile, externallyEdited);
    await reverse
      .getByRole('button', { name: 'Apply reference changes' })
      .click();
    await expect(reverse.getByRole('alert')).toContainText(
      'changed in storage',
    );
    expect(await readFile(boardPath)).toEqual(stagedExchange);
    expect(await readFile(rootFile)).toEqual(externallyEdited);
    await reverse.getByRole('button', { name: 'Cancel', exact: true }).click();
    await writeFile(rootFile, rootBeforeAnnotation);

    await previewExchange();
    await reverse
      .getByRole('button', { name: 'Apply reference changes' })
      .click();
    await expect(reverse).toBeHidden();
    const exchanged = await api.decodeBoard(await readFile(boardPath));
    const exchangedRoot = await api.decodeDrawing(await readFile(rootFile));
    expect(
      new Map(
        exchangedRoot.instanceReferences.map(({ componentId, reference }) => [
          componentId,
          reference,
        ]),
      ),
    ).toEqual(
      new Map([
        [part.id, sibling.reference],
        [sibling.id, part.reference],
      ]),
    );
    expect(
      exchanged.appliedCircuit.components.find(({ id }) => id === part.id)
        .reference,
    ).toBe(sibling.reference);
    expect(
      exchanged.appliedCircuit.components.find(({ id }) => id === sibling.id)
        .reference,
    ).toBe(part.reference);
    expect(exchanged.footprints).toEqual(restoredReference.footprints);

    await boardMenu('Undo last back annotation…');
    await undoAnnotation
      .getByRole('button', { name: 'Restore references' })
      .click();
    await expect(undoAnnotation).toBeHidden();
    expect(await readFile(rootFile)).toEqual(rootBeforeAnnotation);
    const undone = await api.decodeBoard(await readFile(boardPath));
    const beforeExchange = await api.decodeBoard(stagedExchange);
    expect(undone).toEqual({
      ...beforeExchange,
      revision: exchanged.revision + 1,
    });
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('places bundled SMT and through-hole packages and reopens their embedded STEP models offline', async ({ page }, info) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'bundled-packages-'));
  const original = path.join(directory, 'Original');
  const copied = path.join(directory, 'Copied');
  const marker = 'Assembly.tcproject';
  const sku = { D1: 'KPD-3224SYCK', J1: 'B2B-XH-A' };
  try {
    const api = await layoutRuntime();
    const led = new URL('../../../examples/pcb/led-classroom/Reference/LED.dzn', import.meta.url);
    const drawing = await api.decodeDrawing(await readFile(led));
    const [sheet] = drawing.sheets;
    const parts = sheet.items.flatMap((item) => {
      if (item.NodeName !== 'symbol') return [];
      const reference = item.text.find(({ description }) => description === 'Ref')?.value;
      if (!Object.hasOwn(sku, reference)) return [];
      return [{
        ...item,
        text: item.text.map((field) => field.description === 'Package'
          ? { ...field, value: sku[reference] } : field),
      }];
    });
    expect(parts).toHaveLength(2);
    let markerId = Math.max(...sheet.items.map((item) => item._id));
    const noConnects = parts.flatMap((part) => new api.updateSymbol(part).active_points()
      .map(([x, y]) => ({ _id: ++markerId, NodeName: 'noconnect', point: [x, y] })));
    drawing.sheets = [{ ...sheet, items: [...parts, ...noConnects] }];
    await mkdir(original, { recursive: true });
    await writeFile(path.join(original, 'Circuit.dsn'), await api.encodeDrawing(drawing, 'xml'));
    await writeFile(path.join(original, marker), api.encodeProjectSettings({
      title: 'Assembly', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], primarySchematic: drawing.documentId,
      entries: [{ kind: 'schematic', id: drawing.documentId, path: 'Circuit.dsn' }],
    }));
    let pending = path.join(original, marker);
    await installProjectBridge(page, directory, undefined, () => {
      const launch = pending;
      pending = undefined;
      return launch;
    });
    let allowCatalogue = true;
    const catalogueLoads = [];
    page.on('response', (response) => {
      if (response.ok() && /\.tplib(?:$|\?)/.test(response.url()))
        catalogueLoads.push(response.url());
    });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && (allowCatalogue || !/\.t[cp]lib(?:$|\?)/.test(url))
        ? route.continue() : route.abort();
    });
    await page.goto(app.baseURL + '?project=1');
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'Circuit.dsn', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Create PCB from Schematic…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Create PCB from Schematic…', exact: true })
      .getByRole('button', { name: 'OK', exact: true }).click();
    const transfer = page.getByRole('dialog', { name: 'Create PCB from Schematic', exact: true });
    const picker = page.getByRole('dialog', { name: 'Review PCB devices', exact: true });
    for (const reference of ['D1', 'J1']) {
      await transfer.getByRole('button', { name: 'Review device for ' + reference, exact: true }).click();
      await expect(picker.getByText('Package hint ' + sku[reference] + ' · 1 matching revision')).toBeVisible();
      await picker.getByLabel('Search devices').fill(sku[reference]);
      await picker.getByLabel('Device revision').selectOption({ index: 1 });
      for (const number of ['1', '2']) {
        const signal = picker.getByRole('combobox', { name: new RegExp('^Signal for pad ' + number + ' ') });
        const match = await signal.locator('option').filter({ hasText: new RegExp('^' + number + ' ·') }).textContent();
        await signal.selectOption({ label: match });
      }
      await picker.getByRole('button', { name: 'Preview device changes' }).click();
      await picker.getByRole('button', { name: 'Stage reviewed device' }).click();
    }
    expect(catalogueLoads).toHaveLength(1);
    await transfer.getByRole('button', { name: 'Create linked PCB' }).click();
    const editor = page.getByRole('region', { name: 'PCB layout' });
    const placed = editor.getByRole('grid', { name: 'Placed components', exact: true });
    for (const [reference, x, rotation, side] of [['D1', '18', '90', 'bottom'], ['J1', '32', '0', 'top']]) {
      await editor.getByRole('list', { name: 'Unplaced components', exact: true })
        .getByRole('button', { name: new RegExp('^' + reference + ' ·') }).click();
      const place = editor.getByRole('group', { name: 'Place ' + reference, exact: true });
      await place.getByLabel('X (mm)', { exact: true }).fill(x);
      await place.getByLabel('Rotation (°)', { exact: true }).fill(rotation);
      await place.getByLabel('Layer', { exact: true }).selectOption(side);
      await place.getByRole('button', { name: 'Place at coordinates' }).click();
      await expect(placed).toContainText(reference);
    }

    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    const boardFile = path.join(original, 'Circuit.dpn');
    await expect.poll(async () => (await api.decodeBoard(await readFile(boardFile))).footprints?.length).toBe(2);
    const board = await api.decodeBoard(await readFile(boardFile));
    expect(board.footprints).toHaveLength(2);
    const SQL = await librarySqlite();
    const packaged = new SQL.Database(await readFile(new URL('../../../bundled-footprints/starter-v1.tplib', import.meta.url)));
    const devices = await api.readStarterDevices(packaged);
    packaged.close();
    for (const [reference, order] of Object.entries(sku)) {
      const component = board.components.find((item) => item.reference === reference);
      const placement = board.footprints.find(({ componentId }) => componentId === component.id);
      const device = board.deviceDefinitions.find(({ id }) => id === component.deviceId);
      const source = devices.find(({ definition }) => definition.packageNames.includes(order));
      expect(device.library.digest).toBe(source.digest);
      const actual = board.footprintDefinitions.find(({ id }) => id === device.footprintId);
      expect(actual.pads).toEqual(source.definition.footprint.pads);
      expect(actual.models).toEqual(source.definition.footprint.models);
      expect(actual.pads.every(({ stack }) => !!stack.drill?.plated)).toBe(reference === 'J1');
      for (const asset of source.definition.models)
        expect(board.modelAssets.find(({ id }) => id === asset.id)).toEqual(asset);
      expect(placement).toMatchObject(reference === 'D1'
        ? { side: 'bottom', rotationMicrodegree: 90e6 } : { side: 'top', rotationMicrodegree: 0 });
    }
    await cp(original, copied, { recursive: true });
    allowCatalogue = false;
    pending = path.join(copied, marker);
    await page.reload();
    await projects.getByRole('button', { name: 'Circuit.dpn', exact: true }).click();
    await expect(placed).toContainText('D1');
    await expect(placed).toContainText('J1');
    await clickPcbCommand(editor, 'Inspect in 3D…');
    const viewer = page.getByRole('dialog', { name: '3D board inspection' });
    await expect(viewer.getByText('Generated STEP envelope', { exact: false })).toHaveCount(2);
    expect(catalogueLoads).toHaveLength(1);
    expect(await readFile(path.join(copied, 'Circuit.dpn'))).toEqual(await readFile(boardFile));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('imports a KiCad symbol and footprint with a portable STEP model', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(
    path.join(info.project.outputDir, 'footprint-editor-'),
  );
  await installProjectBridge(page, directory);
  const api = await layoutRuntime();
  const sourceData = await readFile(
    new URL('../fixtures/pcb-hierarchy/Blocks/Leaf.dsn', import.meta.url),
  );
  const source = await api.decodeDrawing(sourceData);
  source.sheets = [{ ...source.sheets.find(({ name }) => name === 'Leaf'), items: [] }];
  await writeFile(
    path.join(directory, 'Circuit.dsn'),
    await api.encodeDrawing(source, 'xml'),
  );
  await writeFile(
    path.join(directory, 'Connector.tcproject'),
    api.encodeProjectSettings({
      projectId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      title: 'Connector',
      primarySchematic: source.documentId,
      entries: [
        { kind: 'schematic', id: source.documentId, path: 'Circuit.dsn' },
      ],
      requiredFeatures: [],
    }),
  );
  try {
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', {
      name: 'Projects',
      exact: true,
    });
    await projects.getByRole('button', { name: 'Circuit.dsn', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.layoutTest.snapshot().drawing.documentId))
      .toBe(source.documentId);
    await page.evaluate((content) => {
      window.electronAPI.openKicadImport = async () => ({
        fileName: 'Test.kicad_sym', content,
      });
      window.hierarchyTestMenu('import-kicad-symbols');
    }, `(kicad_symbol_lib (version 20241209)
      (symbol "Test" (in_bom yes) (on_board yes)
        (property "Reference" "R" (at 0 1 0) (effects (font (size 1 1))))
        (property "Value" "Test" (at 0 -1 0) (effects (font (size 1 1))))
        (property "Footprint" "Package_Test:Test" (at 0 0 0) (effects (font (size 1 1)) (hide yes)))
        (symbol "Test_1_1"
          (pin passive line (at 0 0 0) (length 2)
            (name "Signal" (effects (font (size 1 1))))
            (number "01" (effects (font (size 1 1))))))))`);
    const symbolImport = page.getByRole('dialog', { name: 'Import Symbol', exact: true });
    await expect(symbolImport.getByText('Test', { exact: true })).toBeVisible();
    await symbolImport.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(symbolImport).toBeHidden();
    await page.evaluate(() => window.layoutTest.pointer('lbuttondown', [250, 250]));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.hierarchyTestMenu('tools-annotate'));
    const annotate = page.getByRole('dialog', { name: 'Annotate Symbols' });
    await annotate.getByRole('radio', { name: 'Add references' }).check();
    await annotate.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const schematicPath = path.join(directory, 'Circuit.dsn');
    const readPlacedSymbol = async () => {
      const saved = await api.decodeDrawing(await readFile(schematicPath));
      return saved.sheets[0].items.find(({ NodeName }) => NodeName === 'symbol');
    };
    await expect.poll(readPlacedSymbol).toMatchObject({ NodeName: 'symbol' });
    const importedSymbol = await readPlacedSymbol();
    const importedFields = new Map(importedSymbol.text.map(({ description, value }) => [description, value]));
    expect(importedFields.get('Ref')).toBe('R1');
    expect(importedFields.get('Footprint')).toBe('Package_Test:Test');
    expect(importedFields.get('Package')).toBe('Test');
    const importedPin = importedSymbol._symbol.outlines[0].active_points[0].pin;
    expect(importedPin.number).toBe('01');

    await projects
      .getByRole('button', { name: 'Project folder actions' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Footprint editor…' }).click();
    const editor = page.getByRole('dialog', { name: 'Footprint editor' });
    await editor
      .getByRole('button', { name: 'Browse starter footprint drafts' })
      .click();
    await editor
      .getByLabel('Starter footprint draft')
      .selectOption('ti-lm358dr-d0008a');
    await editor.getByRole('button', { name: 'Open starter draft' }).click();
    await expect(editor.getByLabel('Datasheet URL')).toHaveValue(
      'https://www.ti.com/lit/ds/symlink/lm358.pdf',
    );
    await expect(
      editor.getByRole('button', { name: 'Open datasheet' }),
    ).toBeEnabled();
    await editor
      .getByLabel('Starter footprint draft')
      .selectOption('samesky-sj1-3525n');
    await editor.getByRole('button', { name: 'Open starter draft' }).click();
    await expect(editor.getByLabel('Datasheet URL')).toHaveValue(
      'https://www.sameskydevices.com/product/resource/sj1-352xn.pdf',
    );
    await editor.getByRole('button', { name: 'Map as device' }).click();
    await expect(
      editor.getByLabel('Assignment for pad MP1 (6)', { exact: true }),
    ).toHaveValue('mechanical');
    await expect(
      editor.getByLabel('Assignment for pad 10 (4)', { exact: true }),
    ).toHaveValue('signal');
    await editor.getByRole('button', { name: 'Hide device mapping' }).click();
    await editor.getByLabel('Starter footprint draft').selectOption('dip-8');
    await expect(
      editor.getByText('Hand-soldered through-hole', { exact: false }),
    ).toBeVisible();
    await editor.getByRole('button', { name: 'Open starter draft' }).click();
    await expect(
      editor.getByRole('img', { name: 'Footprint pad preview' }),
    ).toBeVisible();
    await expect(
      editor.getByText('dip-8.step · Embedded', { exact: false }),
    ).toBeVisible();
    const footprintView = editor.getByRole('img', { name: 'Footprint pad preview' });
    const padTarget = footprintView.locator('[data-pad-id][data-highlighted="false"]').first();
    const clickedPad = await padTarget.getAttribute('data-pad-id');
    await padTarget.click();
    await expect(editor.getByRole('combobox', { name: 'Pad', exact: true })).toHaveValue(clickedPad);
    const SQL = await librarySqlite();
    const db = new SQL.Database(await readFile(
      new URL('../../../bundled-footprints/starter-v1.tplib', import.meta.url),
    ));
    const draft = await api.readStarterFootprint(db, api.readStarterFootprints(db).find(({ id }) => id === 'dip-8'));
    db.close();
    const stepBytes = Buffer.from(await api.readBoardModelAsset(draft.assets[0]));
    const modelPath = '${KICAD9_3DMODEL_DIR}/Fixture.3dshapes/asymmetric.step';
    const missingPath = '${KICAD9_3DMODEL_DIR}/Fixture.3dshapes/missing.step';
    const modelFile = { name: 'asymmetric.step', mimeType: 'application/step', buffer: stepBytes };
    await editor.getByLabel('Open footprint').setInputFiles({
      name: 'Test.kicad_mod',
      mimeType: 'text/plain',
      buffer: Buffer.from(`(footprint "Test" (version 20241229) (layer "F.Cu")
        (fp_line (start -2 1) (end 2 1) (stroke (width 0.15) (type solid)) (layer "F.SilkS"))
        (fp_text user "L" (at 2 -2) (layer "F.SilkS")
          (effects (font (size 1 1) (thickness 0.15)) (justify left bottom)))
        (pad "01" smd rect (at 0 0) (size 1.2 1.6) (layers "F.Cu" "F.Mask" "F.Paste"))
        (model "${modelPath}" (offset (xyz 2 -1 0.25))
          (scale (xyz 1.2 0.8 1.5)) (rotate (xyz 0 0 -90)))
        (model "${missingPath}")
      )`),
    });
    await expect(
      editor.getByRole('img', { name: 'Footprint pad preview' }),
    ).toBeVisible();
    const importReport = editor.getByRole('list', { name: 'KiCad import report' });
    await expect(importReport).toContainText('Select a local STEP file for ' + missingPath);
    await editor.getByLabel(modelPath + ' · Select local STEP file', { exact: true }).setInputFiles(modelFile);
    await expect(editor.getByText(modelPath + ' · Embedded')).toBeVisible();
    await editor.getByLabel('Add STEP model', { exact: true }).setInputFiles({
      ...modelFile, name: 'Direct.step',
    });
    await expect(editor.getByText('Direct.step · Embedded')).toBeVisible();
    await page.evaluate(() => localStorage.setItem('tinycad.language', 'de'));
    await editor.getByLabel('Pad X (mm)', { exact: true }).fill('1,5');
    await editor.getByLabel('Pad Y (mm)', { exact: true }).focus();
    await editor
      .getByRole('button', { name: 'Check footprint dimensions' })
      .click();
    await expect(
      editor.getByRole('list', { name: 'Footprint findings' }),
    ).toContainText('Courtyard');
    const datasheetUrl =
      'https://example.com/part.pdf?format=full&lang=en#page=2';
    await editor.getByLabel('Datasheet URL').fill(datasheetUrl);
    await editor.getByText('Assembly drawing', { exact: true }).click();
    await expect(editor.getByLabel('Assembly marker')).toHaveValue('');
    await editor.getByLabel('Assembly marker').selectOption('pin-1');
    await expect(editor.getByLabel('Marked pad').locator('option:checked')).toHaveText('01 · 1');
    await editor.getByLabel('Assembly notes').fill('Orient marked end toward the board edge.');
    const footprintDownload = page.waitForEvent('download');
    await editor
      .getByRole('button', { name: 'Export footprint', exact: true })
      .click();
    const native = await api.decodeFootprintLibrary(
      await readFile(await (await footprintDownload).path()),
    );
    expect(native.definition.pads[0].positionNm.x).toBe(1_500_000);
    expect(native.definition.datasheetUrl).toBe(datasheetUrl);
    expect(native.definition.assembly).toEqual({
      marker: { kind: 'pin-1', padId: native.definition.pads[0].id },
      notes: 'Orient marked end toward the board edge.',
    });
    expect(native.definition.graphics[0].layer).toBe('F.SilkS');
    expect(native.definition.graphics[1]).toMatchObject({ kind: 'text', text: 'L' });
    expect(native.assets).toHaveLength(1);
    expect(Buffer.from(await api.readBoardModelAsset(native.assets[0]))).toEqual(stepBytes);
    const [resolved, missing, direct] = native.definition.models;
    expect(resolved).toMatchObject({
      source: modelPath,
      assetId: native.assets[0].id,
      offsetNm: [2e6, -1e6, 250_000],
      rotationMicrodegree: [0, 0, 90e6],
      scale: [1.2, 0.8, 1.5],
    });
    expect(missing).toMatchObject({ source: missingPath });
    expect(missing.assetId).toBeUndefined();
    expect(direct).toMatchObject({ source: 'Direct.step', assetId: resolved.assetId,
      offsetNm: [0, 0, 0], rotationMicrodegree: [0, 0, 0], scale: [1, 1, 1] });
    await editor.getByRole('button', { name: 'Remove Direct.step', exact: true }).click();
    await editor.getByRole('button', { name: 'Remove ' + missingPath, exact: true }).click();
    await editor.getByLabel('Model license', { exact: true }).fill('CC0-1.0');
    await editor
      .getByRole('button', { name: 'Edit artwork', exact: true })
      .click();
    await editor
      .getByLabel('Graphic shape', { exact: true })
      .selectOption('rect');
    await editor.getByLabel('Layer', { exact: true }).selectOption('F.CrtYd');
    await editor
      .getByLabel('Graphic points', { exact: false })
      .fill('-3,0 -2,0\n4,0; 2,0');
    await editor
      .getByRole('button', { name: 'Add graphic', exact: true })
      .click();
    await expect(
      editor.getByLabel('Graphic', { exact: true }).locator('option:checked'),
    ).toHaveText(/F.CrtYd/);

    const fittedView = await footprintView.getAttribute('data-view-box');
    await footprintView.hover();
    await page.mouse.wheel(0, -150);
    await expect(footprintView).not.toHaveAttribute('data-view-box', fittedView);
    const dimensionDownload = page.waitForEvent('download');
    await editor.getByRole('button', { name: 'Export 1:1 SVG' }).click();
    const drawing = await readFile(
      await (await dimensionDownload).path(),
      'utf8',
    );
    expect(drawing.match(/\bviewBox="([^"]+)"/)[1]).toBe(fittedView);
    expect(drawing).not.toContain('data-svg-drawing');
    await editor.getByRole('button', { name: 'Fit footprint', exact: true }).click();
    await expect(footprintView).toHaveAttribute('data-view-box', fittedView);
    const printedWidth = Number(
      drawing.match(/<svg[^>]*\bwidth="([\d.]+)mm"/)[1],
    );
    const printedHeight = Number(
      drawing.match(/<svg[^>]*\bheight="([\d.]+)mm"/)[1],
    );
    const [, , viewWidth, viewHeight] = drawing
      .match(/\bviewBox="([^"]+)"/)[1]
      .split(/\s+/)
      .map(Number);
    expect(printedWidth).toBe(viewWidth / 1_000_000);
    expect(printedHeight).toBe(viewHeight / 1_000_000);
    expect(drawing).toContain('M 0 0 L 10000000 0');
    expect(drawing).toContain('10 mm');
    expect(drawing).toContain('M 2000000,-3000000 L 2000000,-2000000 L 3000000,-2000000');

    await editor.getByLabel('New pad label', { exact: true }).fill('MH');
    await editor.getByLabel('Pad shape', { exact: true }).selectOption('hole');
    await editor.getByLabel('X (mm)', { exact: true }).fill('3');
    await editor.getByLabel('Drill width (mm)', { exact: true }).fill('0.8');
    await editor.getByRole('button', { name: 'Add pad', exact: true }).click();

    await editor.getByRole('button', { name: 'Map as device' }).click();
    for (const [label, value] of [
      ['Package name', 'Test'],
      ['Body width (mm)', '4'],
      ['Body height (mm)', '2'],
      ['Device license', 'CC0-1.0'],
      ['Reviewed by', 'Fixture reviewer'],
      ['Review evidence', 'Fixture drawing'],
    ]) {
      await editor.getByLabel(label, { exact: true }).fill(value);
    }
    await editor
      .getByLabel('Assignment for pad 01 (1)', { exact: true })
      .selectOption('signal');
    await editor
      .getByLabel('Terminal for pad 01 (1)', { exact: true })
      .fill('Signal');
    await editor
      .getByLabel('Assignment for pad MH (2)', { exact: true })
      .selectOption('mechanical');
    const deviceDownload = page.waitForEvent('download');
    await editor
      .getByRole('button', { name: 'Export reviewed device' })
      .click();
    const deviceData = await readFile(await (await deviceDownload).path());
    const { definition: device } = await api.readLibraryDevice(deviceData);
    expect(device.footprint.pads[0].label).toBe('01');
    expect(device.footprint.pads[0].stack.copper.top.kind).toBe('polygon');
    expect(device.terminals[0].name).toBe('Signal');
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    const libraryPath = path.join(directory, 'Test.tcdevice.json');
    await writeFile(libraryPath, deviceData);
    await projects
      .getByRole('button', { name: 'Circuit.dsn', exact: true })
      .click({ button: 'right' });
    await page
      .getByRole('menuitem', {
        name: 'Create PCB from Schematic…',
        exact: true,
      })
      .click();
    await page
      .getByRole('dialog', { name: 'Create PCB from Schematic…', exact: true })
      .getByRole('button', { name: 'OK', exact: true })
      .click();
    const transfer = page.getByRole('dialog', {
      name: 'Create PCB from Schematic',
      exact: true,
    });
    await transfer
      .getByRole('button', { name: 'Review device for R1', exact: true })
      .click();
    const picker = page.getByRole('dialog', {
      name: 'Review PCB devices',
      exact: true,
    });
    await expect(picker.getByText(/Package hint Test · 1 matching revision/)).toBeVisible();
    await picker
      .getByLabel('Device revision')
      .selectOption({ label: 'Test · 1 · 2 pads' });
    await picker.getByLabel('Signal for pad 01 (1)').selectOption({ index: 1 });
    await picker
      .getByRole('button', { name: 'Preview device changes' })
      .click();
    await picker.getByRole('button', { name: 'Stage reviewed device' }).click();
    await transfer.getByRole('button', { name: 'Create linked PCB' }).click();
    const layout = page.getByRole('region', {
      name: 'PCB layout',
      exact: true,
    });
    await layout
      .getByRole('list', { name: 'Unplaced components' })
      .getByRole('button', { name: /^R1/ })
      .click();
    await layout.getByRole('button', { name: 'Place at coordinates' }).click();
    await expect(
      layout.getByRole('grid', { name: 'Placed components', exact: true }),
    ).toContainText('R1');
    await layout.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Circuit.dpn', exact: true })).toBeVisible();
    await page.getByRole('tablist', { name: 'Project files' }).getByRole('button', { name: 'Close Circuit.dpn', exact: true }).click();
    await rm(libraryPath);
    const pcb = await api.decodeBoard(
      await readFile(path.join(directory, 'Circuit.dpn')),
    );
    expect(pcb.appliedCircuit.components).toHaveLength(1);
    const [compiled] = pcb.appliedCircuit.components;
    expect(compiled).toMatchObject({ reference: 'R1', packageHint: 'Test' });
    const signal = compiled.signals.find(({ number }) => number === '01');
    const [terminal] = signal.terminals;
    expect(terminal.pinId).toBe(importedPin.pinId);
    expect(pcb.appliedCircuit.sources[terminal.unitId].unitId).toBe(importedSymbol.unitId);
    expect(pcb.deviceDefinitions[0].assignments[0]).toMatchObject({ kind: 'signal', signalId: signal.id });
    expect(pcb.footprints).toHaveLength(1);
    expect(pcb.footprintDefinitions[0].pads).toEqual(device.footprint.pads);
    expect(pcb.footprintDefinitions[0].pads[1].stack.drill.plated).toBe(false);
    expect(pcb.deviceDefinitions[0].assignments[1].kind).toBe('mechanical');
    expect(pcb.footprintDefinitions[0].models).toEqual([resolved]);
    expect(pcb.modelAssets).toHaveLength(1);
    expect(Buffer.from(await api.readBoardModelAsset(pcb.modelAssets[0]))).toEqual(stepBytes);

    // Reopen an actual copied project folder with the original and source library erased.
    const copy = path.join(directory, 'Copied');
    await mkdir(copy);
    for (const name of ['Connector.tcproject', 'Circuit.dsn', 'Circuit.dpn'])
      await cp(path.join(directory, name), path.join(copy, name));
    for (const name of ['Connector.tcproject', 'Circuit.dsn', 'Circuit.dpn'])
      await rm(path.join(directory, name));
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(app.baseURL) && !/\.tplib($|\?)/.test(url)) return route.continue();
      return route.abort();
    });
    await page.evaluate(() => localStorage.removeItem('tinycad.language'));
    await page.reload();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await projects.getByRole('button', { name: 'Copied', exact: true }).click();
    await projects.getByRole('button', { name: 'Connector.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'Circuit.dpn', exact: true }).click();
    const inspect = async (face) => {
      await clickPcbCommand(layout, 'Inspect in 3D…');
      const viewer = page.getByRole('dialog', { name: '3D board inspection' });
      await expect(viewer.getByRole('img', { name: 'Interactive 3D PCB' })).toBeVisible();
      await viewer.getByRole('button', { name: face, exact: true }).click();
      const parts = viewer.getByRole('list', { name: '3D components' });
      await expect(parts.getByText('Imported STEP', { exact: false })).toBeVisible();
      await expect(parts.getByText('Missing STEP model', { exact: false })).toHaveCount(0);
      await viewer.getByRole('button', { name: 'Close', exact: true }).click();
    };
    await inspect('Top');
    await layout.getByRole('grid', { name: 'Placed components', exact: true })
      .getByRole('button', { name: 'R1', exact: true }).click();
    await layout.getByLabel('Layer', { exact: true }).selectOption('bottom');
    await layout.getByLabel('Rotation (°)', { exact: true }).fill('90');
    await layout.getByRole('button', { name: 'Apply position' }).click();
    await layout.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => {
      const updated = await api.decodeBoard(await readFile(path.join(copy, 'Circuit.dpn')));
      return updated.footprints[0];
    }).toMatchObject({ side: 'bottom', rotationMicrodegree: 90e6 });
    await inspect('Bottom');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function reviewEveryCamLayer(cam) {
  const release = cam.getByRole('button', { name: 'Release and download…' });
  await cam.getByText('Manufacturing review · 0 release blockers', { exact: true }).click();
  await expect(release).toBeDisabled();
  await cam.getByRole('checkbox', { name: 'Outline and both drill files reviewed' }).check();
  const layers = cam.getByLabel('CAM layer');
  const choices = await layers.locator('option').evaluateAll((options) =>
    options.map(({ value, text }) => ({ value, text })));
  for (const { value, text } of choices) {
    await layers.selectOption(value);
    await cam.getByRole('checkbox', { name: text + ' reviewed', exact: true }).check();
  }
  await expect(release).toBeEnabled();
}

async function completeLedExercise(page, info, offset) {
  test.setTimeout(90_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'led-classroom-'));
  const sample = new URL('../../../examples/pcb/led-classroom/', import.meta.url);
  for (const name of ['Exercise', 'Reference'])
    await cp(new URL(name, sample), path.join(directory, name), { recursive: true });
  await installProjectBridge(page, directory);
  const api = await layoutRuntime();
  const source = await api.decodeBoard(await readFile(path.join(directory, 'Reference', 'LED.dpn')));
  const shift = ({ x, y }) => ({ x: x + offset.x, y: y + offset.y });
  const reference = {
    ...source,
    footprints: source.footprints.map((item) => ({ ...item, positionNm: shift(item.positionNm) })),
    tracks: source.tracks.map((item) => ({ ...item, start: shift(item.start), end: shift(item.end) })),
  };
  try {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)) return route.continue();
      return route.abort();
    });
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    const openSample = async (name) => {
      await projects.getByRole('button', { name, exact: true }).click();
      await projects.getByRole('button', { name: 'LED.tcproject', exact: true }).click();
    };
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    const tabs = page.getByRole('tablist', { name: 'Project files', exact: true });
    await openSample('Exercise');
    await projects.getByRole('button', { name: 'LED.dzn', exact: true }).click();
    for (const name of ['LED_A', 'GND', 'V1'])
      await expect(page.locator('svg').getByText(name, { exact: true })).toBeVisible();
    await expect(page.locator('svg').getByText('5V', { exact: true }).first()).toBeVisible();
    const schematicRulers = page.getByRole('button', { name: 'Toggle Rulers', exact: true });
    if (await schematicRulers.getAttribute('aria-pressed') !== 'true') await schematicRulers.click();
    const schematic = page.locator('.circuit-drawing svg');
    const markers = page.locator('[data-ruler-pointer]');
    await schematic.hover({ position: { x: 200, y: 130 } });
    await expect(markers).toHaveCount(2);
    const offsets = () => markers.evaluateAll((rails) => rails.map((marker, i) => {
      const line = marker.getBoundingClientRect();
      const ruler = marker.parentElement.getBoundingClientRect();
      return i === 0 ? line.left - ruler.left : line.top - ruler.top;
    }));
    const firstOffsets = await offsets();
    await schematic.hover({ position: { x: 240, y: 160 } });
    await expect.poll(async () => (await offsets()).map((offset, i) =>
      Math.abs(offset - firstOffsets[i] - (i === 0 ? 40 : 30)) <= 1,
    )).toEqual([true, true]);

    const schematicWidth = await schematic.getAttribute('width');
    await schematic.dispatchEvent('wheel', { shiftKey: true, deltaX: 30, deltaY: 0 });
    await expect(schematic).toHaveAttribute('width', schematicWidth);
    const schematicBounds = await schematic.boundingBox();
    const schematicAnchor = { x: schematicBounds.x + 240, y: schematicBounds.y + 160 };
    await page.mouse.move(schematicAnchor.x, schematicAnchor.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -50);
    await page.keyboard.up('Control');
    await expect.poll(async () => Number(await schematic.getAttribute('width')) / Number(schematicWidth))
      .toBeCloseTo(Math.sqrt(1.25), 5);
    const zoomedSchematicBounds = await schematic.boundingBox();
    const scale = Number(await schematic.getAttribute('width')) / Number(schematicWidth);
    expect(Math.abs((schematicAnchor.x - zoomedSchematicBounds.x) / scale - 240)).toBeLessThan(2);
    expect(Math.abs((schematicAnchor.y - zoomedSchematicBounds.y) / scale - 160)).toBeLessThan(2);

    const selectedSheet = page.locator('.sheet-heading-on');
    const originalSheetName = await selectedSheet.innerText();
    const operatingPoint = page.locator('.sheet-heading').filter({ hasText: 'LED operating point' });
    await expect(operatingPoint).toBeVisible();
    await operatingPoint.click();
    await page.getByText(/Experiment notes/).click();
    await expect(page.getByRole('textbox', { name: 'Instructions / experiment notes' })).toHaveValue(/Expect the teaching LED to read about 1.9 V/);
    await expect(page.getByRole('toolbar').getByRole('button', { name: 'Run', exact: true })).toBeVisible();
    await page.locator('.sheet-heading').getByText(originalSheetName, { exact: true }).click();
    const actions = selectedSheet.getByRole('button', { name: 'Sheet actions' });
    await actions.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename Sheet', exact: true });
    await rename.getByRole('textbox', { name: 'Sheet Name' }).fill('LED tutorial draft');
    await rename.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(selectedSheet).toHaveText('LED tutorial draft');

    await projects.getByRole('button', { name: 'LED.dpn', exact: true }).click();
    const canvas = layout.getByRole('img', { name: 'Board layout' });
    await expect(canvas).toBeVisible();
    await expect(projects).toBeVisible();
    const fabrication = page.getByRole('dialog', { name: 'Fabrication settings', exact: true });
    const openFabrication = () => clickPcbCommand(layout, 'Fabrication settings…');
    await openFabrication();
    await fabrication.getByLabel('Board thickness (mm)').fill('1.2');
    await fabrication.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(fabrication).toBeHidden();
    const split = page.getByRole('button', { name: 'Side by side', exact: true });
    await split.click();
    await expect(split).toHaveAttribute('aria-pressed', 'true');
    const schematicPane = page.getByRole('group', { name: 'Schematic pane', exact: true });
    const pcbPane = page.getByRole('group', { name: 'PCB pane', exact: true });
    await expect(schematicPane.locator('svg').getByText('LED_A', { exact: true })).toBeVisible();
    await expect(pcbPane.getByRole('img', { name: 'Board layout' })).toBeVisible();
    const left = await schematicPane.boundingBox();
    const right = await pcbPane.boundingBox();
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
    await expect(tabs.getByRole('tab', { name: 'LED.dzn *', exact: true })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'LED.dpn *', exact: true })).toBeVisible();
    await actions.focus();
    await expect(tabs.getByRole('tab', { name: /^LED\.dzn/ })).toHaveAttribute('aria-selected', 'true');
    const history = (command) => page.evaluate((command) => window.hierarchyTestMenu('edit-' + command), command);
    const saveFocused = () => page.evaluate(() => window.hierarchyTestMenu('file-save'));
    const exercise = path.join(directory, 'Exercise');
    const savedSheetName = async () => (await api.decodeDrawing(
      await readFile(path.join(exercise, 'LED.dzn')),
    )).sheets.find(({ kind }) => kind !== 'simulation').name;
    const savedThickness = async () => (await api.decodeBoard(
      await readFile(path.join(exercise, 'LED.dpn')),
    )).fabrication?.thicknessNm;
    await expect(selectedSheet).toHaveText('LED tutorial draft');
    await history('undo');
    await expect(selectedSheet).toHaveText(originalSheetName);
    await history('redo');
    await expect(selectedSheet).toHaveText('LED tutorial draft');
    await saveFocused();
    await expect.poll(savedSheetName).toBe('LED tutorial draft');
    expect(await savedThickness()).not.toBe(1_200_000);
    await history('undo');
    await expect(selectedSheet).toHaveText(originalSheetName);
    await saveFocused();
    await expect.poll(savedSheetName).toBe(originalSheetName);

    await openFabrication();
    await expect(fabrication.getByLabel('Board thickness (mm)')).toHaveValue('1.2');
    await fabrication.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: /^LED\.dpn/ })).toHaveAttribute('aria-selected', 'true');
    await expect(schematicPane).toBeVisible();
    await saveFocused();
    await expect.poll(savedThickness).toBe(1_200_000);
    await history('undo');
    await openFabrication();
    await expect(fabrication.getByLabel('Board thickness (mm)')).toHaveValue('1.6');
    await fabrication.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(selectedSheet).toHaveText(originalSheetName);
    await split.click();
    await expect(schematicPane).toHaveCount(0);
    await expect(canvas).toBeVisible();

    const unplaced = layout.getByRole('list', { name: 'Unplaced components', exact: true });
    await expect(unplaced.getByRole('listitem')).toHaveCount(3);
    await unplaced.getByRole('button', { name: /^D1/ }).click();
    await expect(layout.getByRole('img', { name: 'Footprint pad preview' })).toBeVisible();
    await layout.getByRole('button', { name: 'First board guide', exact: true }).click();
    await expect(page.getByRole('region', { name: 'First board guide' })).toBeVisible();
    const placed = layout.getByRole('grid', { name: 'Placed components', exact: true });
    for (const footprint of reference.footprints) {
      const component = reference.components.find(({ id }) => id === footprint.componentId);
      await unplaced.getByRole('button', { name: new RegExp('^' + component.reference) }).click();
      await layout.getByLabel('X (mm)', { exact: true }).fill(String(footprint.positionNm.x / 1e6));
      await layout.getByLabel('Y (mm)', { exact: true }).fill(String(footprint.positionNm.y / 1e6));
      await layout.getByLabel('Rotation (°)', { exact: true }).fill(String(footprint.rotationMicrodegree / 1e6));
      await layout.getByRole('button', { name: 'Place at coordinates', exact: true }).click();
      await expect(layout.getByRole('group', { name: 'Position ' + component.reference, exact: true })).toBeVisible();
    }
    await clickPcbCommand(layout, 'View components');
    await expect(placed.locator('[data-rowid]')).toHaveCount(reference.footprints.length);
    await expect(canvas.locator('circle[data-board-pad]').first()).toBeVisible();
    await expect(canvas.locator('line[data-board-pad]').first()).toHaveAttribute('stroke-linecap', 'round');
    const clickBoardPoint = async ({ x, y }) => {
      const screen = await canvas.evaluate((svg, [x, y]) => {
        const point = new DOMPoint(x, -y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
        return [point.x, point.y];
      }, [x, y]);
      await page.mouse.click(...screen);
    };
    for (const netId of new Set(reference.tracks.map(({ netId }) => netId))) {
      const tracks = reference.tracks.filter((track) => track.netId === netId);
      await layout.getByRole('button', { name: 'Route track', exact: true }).click();
      await selectPcbNet(layout, netId);
      await clickBoardPoint(tracks[0].start);
      for (const { end } of tracks) await clickBoardPoint(end);
      await layout.getByRole('button', { name: 'Finish route', exact: true }).click();
      await expect(layout.getByRole('button', { name: 'Route track', exact: true })).toBeVisible();
    }
    await layout.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'LED.dpn', exact: true })).toBeVisible();
    const completedBytes = await readFile(path.join(directory, 'Exercise', 'LED.dpn'));
    const completed = await api.decodeBoard(completedBytes);
    await writeFile(info.outputPath('led-saved-before-release.dpn'), completedBytes);
    expect(completed.footprints.map(({ positionNm }) => positionNm)).toEqual(reference.footprints.map(({ positionNm }) => positionNm));
    expect(new Set(completed.tracks.map(({ netId }) => netId))).toEqual(new Set(reference.tracks.map(({ netId }) => netId)));
    await clickPcbCommand(layout, 'Run design checks…');
    const checks = page.getByRole('region', { name: 'PCB design checks' });
    await expect(checks.getByRole('status')).toContainText('found no issues');
    await checks.getByText('Check coverage', { exact: true }).click();
    await expect(checks.getByText(/Schematic parity · checked/)).toBeVisible();
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
    await clickPcbCommand(layout, 'CAM read-back preview…');
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    await expect(cam.getByRole('status')).toContainText('Gerber and drill read-back matched revision');
    await expect(cam.locator('[data-plating="plated"]')).toHaveCount(6);
    const downloadEvent = page.waitForEvent('download');
    await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
    const download = await downloadEvent;
    const archive = info.outputPath('led-cam-preview.zip');
    await download.saveAs(archive);
    const zip = new ZipReader(new Uint8ArrayReader(await readFile(archive)));
    try {
      const entries = await zip.getEntries();
      const text = (name) => entries.find(({ filename }) => filename === name).getData(new TextWriter());
      const manifest = JSON.parse(await text('manifest.json'));
      expect(manifest.revision).toBe(completed.revision);
      for (const [name, sha256] of Object.entries(manifest.files))
        expect(createHash('sha256').update(await text(name)).digest('hex')).toBe(sha256);
      expect(JSON.parse(await text('checks.json')).issues).toEqual([]);
      expect((await text('plated.xnc')).match(/^X[^\n]+Y[^\n]+$/gm)).toHaveLength(6);
    } finally {
      await zip.close();
    }
    const release = cam.getByRole('button', { name: 'Release and download…' });
    await reviewEveryCamLayer(cam);
    const schematicPath = path.join(directory, 'Exercise', 'LED.dzn');
    const savedSchematic = await readFile(schematicPath);
    await rm(schematicPath);
    await release.click();
    await expect(cam.getByRole('alert')).toContainText('changed after the CAM review');
    await writeFile(schematicPath, savedSchematic);
    const releaseEvent = page.waitForEvent('download');
    await release.click();
    const releaseArchive = info.outputPath('led-manufacturing-release.zip');
    await (await releaseEvent).saveAs(releaseArchive);
    const originalArchive = await readFile(releaseArchive);
    const frozen = new ZipReader(new Uint8ArrayReader(originalArchive));
    let releaseManifest;
    try {
      const entries = await frozen.getEntries();
      const text = (name) => entries.find(({ filename }) => filename === name).getData(new TextWriter());
      const manifest = JSON.parse(await text('manifest.json'));
      releaseManifest = manifest;
      expect(manifest.kind).toBe('tinycad-manufacturing-release');
      expect(manifest.status).toBe('RELEASED');
      expect(manifest.revision).toBe(completed.revision);
      expect(manifest.checks.readiness).toEqual([]);
      expect(manifest.schematic.state).toBe('current');
      expect(Buffer.from(await text('board.dpn'))).toEqual(completedBytes);
      const names = manifest.outputs.map(({ filename }) => filename);
      expect(entries.map(({ filename }) => filename).sort()).toEqual([...names, 'manifest.json'].sort());
      expect(manifest.cam.reviewedFiles).toEqual(names.filter((name) => /\.(gbr|xnc)$/.test(name)).sort());
      for (const { filename, sha256 } of manifest.outputs)
        expect(createHash('sha256').update(await text(filename)).digest('hex')).toBe(sha256);
    } finally {
      await frozen.close();
    }
    await cam.getByRole('button', { name: 'Close', exact: true }).click();
    await layout.getByRole('button', { name: 'Undo', exact: true }).click();
    await clickPcbCommand(layout, 'Manufacturing revisions…');
    const revisions = page.getByRole('dialog', { name: 'Manufacturing revisions' });
    const releaseInput = revisions.getByLabel('Manufacturing release ZIP');
    await releaseInput.setInputFiles(archive);
    await expect(revisions.getByRole('alert')).toContainText('manufacturing release manifest is invalid');
    const damagedArchive = Buffer.from(originalArchive);
    const gerberHeader = damagedArchive.indexOf('%FSLAX');
    expect(gerberHeader).toBeGreaterThan(0);
    damagedArchive[gerberHeader] ^= 1;
    await releaseInput.setInputFiles({ name: 'altered.zip', mimeType: 'application/zip', buffer: damagedArchive });
    await expect(revisions.getByRole('alert')).toHaveText(/signature|payload/i);
    await expect(revisions.getByRole('button', { name: 'Create revision' })).toBeDisabled();
    await releaseInput.setInputFiles(releaseArchive);
    await expect(revisions.getByText(/Release .* · revision/)).toBeVisible();
    await revisions.getByText(/Copper and board geometry · [1-9][0-9]* changes/).click();
    await expect(revisions.getByRole('list', { name: 'Copper and board geometry' })).toContainText('Removed · Track');
    await revisions.getByText(/Output files · [1-9][0-9]* changes/).click();
    await expect(revisions.getByRole('list', { name: 'Output files' })).toContainText('Changed · copper-top.gbr');
    await revisions.getByRole('button', { name: 'Create revision' }).click();
    await expect(revisions).toBeHidden();
    await layout.getByRole('button', { name: 'Save', exact: true }).click();
    const workingPath = path.join(directory, 'Exercise', 'LED.dpn');
    await expect.poll(async () => (await api.decodeBoard(await readFile(workingPath))).releaseParent?.id)
      .toBe(releaseManifest.reviewId);
    const working = await api.decodeBoard(await readFile(workingPath));
    expect(working.revision).toBeGreaterThan(completed.revision);
    expect(working.tracks).toEqual(completed.tracks);
    expect(working.releaseParent).toEqual({
      id: releaseManifest.reviewId, revision: completed.revision, boardSha256: releaseManifest.nativeBoardSha256,
    });
    await clickPcbCommand(layout, 'CAM read-back preview…');
    await reviewEveryCamLayer(cam);
    const nextReleaseEvent = page.waitForEvent('download');
    await release.click();
    const nextArchive = info.outputPath('led-manufacturing-next-revision.zip');
    await (await nextReleaseEvent).saveAs(nextArchive);
    const nextZip = new ZipReader(new Uint8ArrayReader(await readFile(nextArchive)));
    try {
      const entries = await nextZip.getEntries();
      const manifest = JSON.parse(await entries.find(({ filename }) => filename === 'manifest.json').getData(new TextWriter()));
      expect(manifest.parentRelease).toEqual(working.releaseParent);
      expect(manifest.revision).toBe(working.revision);
      expect(manifest.reviewId).not.toBe(releaseManifest.reviewId);
      for (const original of releaseManifest.outputs.filter(({ filename }) => /\.(gbr|xnc)$/.test(filename))) {
        expect(manifest.outputs.find(({ filename }) => filename === original.filename).sha256).toBe(original.sha256);
      }
    } finally {
      await nextZip.close();
    }
    expect(await readFile(releaseArchive)).toEqual(originalArchive);
    await cam.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('tablist', { name: 'Project files' }).getByRole('button', { name: 'Close LED.dpn', exact: true }).click();
    await projects.getByRole('button', { name: 'Exercise', exact: true }).click();

    await openSample('Reference');
    await projects.getByRole('button', { name: 'LED.dpn', exact: true }).click();
    await expect(layout.getByRole('grid', { name: 'Placed components', exact: true }).locator('[data-rowid]')).toHaveCount(3);
    await clickPcbCommand(layout, 'Run design checks…');
    await expect(checks.getByRole('status')).toContainText('found no issues');
    await checks.getByText('Check coverage', { exact: true }).click();
    await expect(checks.getByText(/Schematic parity · checked/)).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('completes the classroom LED exercise offline in the shared schematic and PCB shell', async ({ page }, info) => {
  await completeLedExercise(page, info, { x: 0, y: 0 });
});

test('releases the same LED circuit after translating its placement and routes', async ({ page }, info) => {
  await completeLedExercise(page, info, { x: 2e6, y: 1e6 });
});

test('reviews moved pads and changed drills without changing unrelated routes', async ({ page }, info) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'replace-footprint-'));
  try {
    await cp(new URL('../../../examples/pcb/led-classroom/Reference', import.meta.url), directory, {
      recursive: true,
    });
    const api = await layoutRuntime();
    const boardPath = path.join(directory, 'LED.dpn');
    const bytes = await readFile(boardPath);
    const original = await api.decodeBoard(bytes);
    const diode = original.components.find(({ reference }) => reference === 'D1');
    const oldDevice = original.deviceDefinitions.find(({ id }) => id === diode.deviceId);
    const { definitionDigest, ...footprint } = original.footprintDefinitions.find(({ id }) => id === oldDevice.footprintId);
    const pinOne = footprint.pads.find(({ label }) => label === '1');
    const revised = await api.footprintDefinition({
      ...footprint, name: 'Classroom LED revised openings', revision: '2',
      pads: footprint.pads.map((pad) => pad.id === pinOne.id ? {
        ...pad, positionNm: { ...pad.positionNm, y: 2e6 },
        stack: { ...pad.stack, drill: { ...pad.stack.drill, widthNm: 1_100_000 } },
      } : pad),
    });
    const mapped = await api.publishFootprintDevice({
      format: 'tinycad-footprint', version: 1, definition: revised,
      provenance: { kind: 'authored', source: 'Routed replacement test fixture' },
      assets: original.modelAssets.filter(({ id }) => revised.models.some(({ assetId }) => assetId === id)),
    }, {
      packageName: oldDevice.packageName, widthNm: 5e6, heightNm: 5e6,
      license: 'CC0-1.0', reviewer: 'TinyCAD test', evidence: 'Known pad and drill changes for route-impact qualification.',
      mappings: new Map(revised.pads.map(({ id, label }) =>
        [id, { kind: 'signal', terminal: label }])),
    });
    await writeFile(path.join(directory, 'replacement.tcdevice.json'), mapped);
    await installProjectBridge(page, directory);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)
        ? route.continue() : route.abort();
    });
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'LED.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'LED.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    await clickPcbCommand(layout, 'Update PCB from Schematic…');
    const update = page.getByRole('dialog', { name: 'Update PCB from Schematic' });
    await update.getByLabel('Component to replace').selectOption({ label: 'D1' });
    await update.getByRole('button', { name: 'Review replacement device' }).click();
    const device = page.getByRole('dialog', { name: 'Review PCB devices' });
    await device.getByLabel('Device revision').selectOption((await api.readLibraryDevice(mapped)).digest);
    const padOneSignal = device.getByLabel('Signal for pad 1 (1)', { exact: true });
    const padTwoSignal = device.getByLabel('Signal for pad 2 (2)', { exact: true });
    const signals = original.appliedCircuit.components.find(({ reference }) => reference === 'D1').signals;
    const cathode = signals.find(({ number }) => number === '1');
    const anode = signals.find(({ number }) => number === '2');
    const previewDevice = device.getByRole('button', { name: 'Preview device changes' });
    await padOneSignal.selectOption(anode.id);
    await padTwoSignal.selectOption(cathode.id);
    await previewDevice.click();
    const assignments = device.getByRole('list', { name: 'Pad changes' });
    await expect(assignments).toContainText(`Schematic assignment · 1 · ${cathode.name} → 2 · ${anode.name}`);
    await expect(assignments).toContainText(`Schematic assignment · 2 · ${anode.name} → 1 · ${cathode.name}`);
    await device.getByRole('button', { name: 'Back', exact: true }).click();
    await padOneSignal.selectOption(cathode.id);
    await padTwoSignal.selectOption(anode.id);
    await previewDevice.click();
    const expectPadDelta = async (dialog) => {
      const pads = dialog.getByRole('list', { name: 'Pad changes' });
      await expect(pads).toContainText('(-1.27, 0) mm → (-1.27, 2) mm');
      await expect(pads).toContainText('Ø0.9 mm plated hole → Ø1.1 mm plated hole');
    };
    await expectPadDelta(device);
    await device.getByRole('button', { name: 'Stage reviewed device' }).click();
    await expectPadDelta(update);
    const affected = update.getByRole('list', { name: 'Affected copper' });
    await expect(affected).toContainText('Top track');
    await expect(affected).toContainText(/Open net .* · 2 disconnected terminal groups/);
    const ground = diode.signals.find(({ signalId }) =>
      oldDevice.assignments.some(({ padId, signalId: id }) => padId === pinOne.id && id === signalId)).netId;
    const expectedRoutes = original.tracks.filter(({ netId }) => netId === ground).map(({ id }) => id);
    await expect(affected.locator('[data-copper-id]')).toHaveCount(expectedRoutes.length);
    expect(await affected.locator('[data-copper-id]').evaluateAll((rows) => rows.map((row) => row.dataset.copperId)))
      .toEqual(expectedRoutes);
    expect(await readFile(boardPath)).toEqual(bytes);
    await update.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(update).toBeHidden();
    const completed = await api.decodeBoard(await readFile(boardPath));
    const placed = completed.footprints.find(({ componentId }) => componentId === diode.id);
    expect(placed.positionNm).toEqual(original.footprints.find(({ componentId }) => componentId === diode.id).positionNm);
    expect(completed.tracks.filter(({ id }) => !expectedRoutes.includes(id)))
      .toEqual(original.tracks.filter(({ id }) => !expectedRoutes.includes(id)));
    expect(completed.tracks.filter(({ reviewRequired }) => reviewRequired).map(({ id }) => id))
      .toEqual(expectedRoutes);
    await clickPcbCommand(layout, 'Run design checks…');
    const checks = page.getByRole('region', { name: 'PCB design checks' });
    const open = checks.getByRole('table', { name: 'PCB findings' })
      .getByRole('row').filter({ hasText: 'Required terminals remain in separate copper islands.' });
    await expect(open.getByText('Error', { exact: true })).toBeVisible();
    await open.getByText('Finding details', { exact: true }).click();
    await open.getByRole('button', { name: /^Show schematic pin D1 ·/ }).click();
    await expect(checks).toBeHidden();
    await expect(layout).toBeHidden();
    await expect(page.locator('svg').getByText('D1', { exact: true })).toBeVisible();
    await projects.getByRole('button', { name: 'LED.dpn', exact: true }).click();
    await clickPcbCommand(layout, 'CAM read-back preview…');
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    await cam.getByText(/Manufacturing review · [1-9][0-9]* release blockers/).click();
    await expect(cam.getByRole('button', { name: 'Release and download…' })).toBeDisabled();
    const download = page.waitForEvent('download');
    await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
    await (await download).saveAs(info.outputPath('replacement-cam-preview.zip'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('checks and exports the adversarial geometry reference offline', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'adversarial-geometry-'));
  try {
    await cp(new URL('../../../examples/pcb/adversarial-geometry', import.meta.url), directory, { recursive: true });
    await installProjectBridge(page, directory);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)
        ? route.continue() : route.abort();
    });
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'Geometry.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'Geometry.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    const canvas = layout.getByRole('img', { name: 'Board layout' });
    await expect(canvas.locator('[data-track]')).toHaveCount(10);
    await expect(layout.getByText('Zones filled.', { exact: true })).toBeVisible();
    await expect(canvas.locator('[data-zone-fill]')).toHaveCount(1);
    await clickPcbCommand(layout, 'Run design checks…');
    const checks = page.getByRole('region', { name: 'PCB design checks' });
    const findings = checks.getByRole('table', { name: 'PCB findings' }).locator('tbody > tr');
    await expect(findings.filter({ hasText: 'A physical copper island joins distinct nets.' })).toHaveCount(2);
    await expect(findings.filter({ hasText: 'Copper on the same net meets only at isolated points.' }))
      .toHaveCount(1);
    const webMessage = 'Filled zone copper is below the required minimum width.';
    const web = findings.filter({ hasText: webMessage });
    await expect(web).toHaveCount(1);
    await expect(web).toContainText('Measured 0.001 mm. Required 0.18 mm.');
    const clearance = findings.filter({ hasText: 'Copper clearance is below the board minimum.' });
    await expect(clearance).toHaveCount(3);
    await expect(clearance.filter({ hasText: 'Measured 0.000001 mm.' })).toHaveCount(1);
    const physical = checks.getByText('Physical connectivity · checked', { exact: true });
    if (!(await physical.isVisible())) await checks.getByText('Check coverage', { exact: true }).click();
    await expect(physical).toBeVisible();
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
    await clickPcbCommand(layout, 'CAM read-back preview…');
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible();
    await cam.getByText(/Manufacturing review · .* release blockers/).click();
    await expect(cam.getByRole('list', { name: 'Release blockers' }).getByRole('listitem')
      .filter({ hasText: 'A physical copper island joins distinct nets.' })).toHaveCount(2);
    await expect(cam.getByRole('list', { name: 'Release blockers' }))
      .toContainText('Copper on the same net meets only at isolated points.');
    await expect(cam.getByRole('list', { name: 'Release blockers' })).toContainText(webMessage);
    await expect(cam.getByRole('button', { name: 'Release and download…' })).toBeDisabled();
    const event = page.waitForEvent('download');
    await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
    await (await event).saveAs(info.outputPath('adversarial-cam-preview.zip'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cross-probes the simulated RC node on the offline filter reference', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'op-amp-filter-'));
  try {
    await cp(new URL('../../../examples/pcb/op-amp-filter', import.meta.url), directory, { recursive: true });
    const api = await layoutRuntime();
    const board = await api.decodeBoard(await readFile(path.join(directory, 'Filter.dpn')));
    const probes = await api.boardPadSources(board, board.appliedCircuit);
    const pad = probes.find(({ reference, padLabel }) => reference === 'R1' && padLabel === '2');
    const rc = board.nets.find(({ name }) => name === 'RC');
    await installProjectBridge(page, directory);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)
        ? route.continue() : route.abort();
    });
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'Filter.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'Filter.dpn' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Cross-probe schematic…' }).click();
    await page.getByRole('dialog', { name: 'Filter.dpn' })
      .getByRole('button', { name: /^R1 · 2 ·/ }).click();
    const snapshot = () => page.evaluate(() => window.layoutTest.snapshot());
    await expect.poll(async () => (await snapshot()).drawing.documentId).toBe(pad.source.documentId);
    const active = await snapshot();
    const item = active.drawing.sheets[active.sheet].items.find(({ unitId }) =>
      unitId === pad.source.unitId);
    expect(active.hoverPins).toEqual([`${item._id}:@${pad.source.pinId}`]);
    await projects.getByRole('button', { name: 'Find in PCB…', exact: true }).click();
    const reverse = page.getByRole('dialog', { name: 'Find in PCB', exact: true });
    await reverse.getByRole('region', { name: 'Filter.dpn', exact: true })
      .getByRole('button', { name: 'Show net on board' }).click();
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    await expect(await pcbNetRow(layout, rc.id)).toHaveAttribute('aria-current', 'true');
    const related = layout.getByRole('list', { name: 'Schematic net terminals' });
    await expect(related.getByRole('listitem')).toHaveCount(3);
    for (const ref of ['C1', 'R1', 'U1']) await expect(related).toContainText(ref);
    await expect(layout.locator('[data-track][data-net-highlighted="true"]')).toHaveCount(2);
    const split = page.getByRole('button', { name: 'Side by side', exact: true });
    await split.click();
    const schematicPane = page.getByRole('group', { name: 'Schematic pane', exact: true });
    const pcbPane = page.getByRole('group', { name: 'PCB pane', exact: true });
    await expect(schematicPane).toBeVisible();
    const capacitor = probes.find(({ reference, padLabel }) => reference === 'C1' && padLabel === '1');
    const capacitorItem = active.drawing.sheets[active.sheet].items.find(({ unitId }) =>
      unitId === capacitor.source.unitId);
    await related.getByRole('button', { name: /^C1 ·/ }).click();
    await expect.poll(async () => (await snapshot()).hoverPins)
      .toEqual([`${capacitorItem._id}:@${capacitor.source.pinId}`]);
    await expect(schematicPane).toBeVisible();
    await expect(pcbPane.getByRole('img', { name: 'Board layout' })).toBeVisible();
    await expect(layout.locator('[data-track][data-net-highlighted="true"]')).toHaveCount(2);
    await projects.getByRole('button', { name: 'Find in PCB…', exact: true }).click();
    await reverse.getByRole('region', { name: 'Filter.dpn', exact: true })
      .getByRole('button', { name: 'Show net on board' }).click();
    await expect(layout.locator('[data-track][data-net-highlighted="true"]')).toHaveCount(2);
    await expect(schematicPane).toBeVisible();
    await split.click();
    await clickPcbCommand(layout, 'Run design checks…');
    const checks = page.getByRole('region', { name: 'PCB design checks' });
    await expect(checks.getByRole('status')).toContainText('found no issues');
    await checks.getByText('Check coverage', { exact: true }).click();
    await expect(checks.getByText(/Schematic parity · checked/)).toBeVisible();
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
    await clickPcbCommand(layout, 'CAM read-back preview…');
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible();
    const event = page.waitForEvent('download');
    await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
    await (await event).saveAs(info.outputPath('filter-cam-preview.zip'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('checks both regulator packages and exports bottom thermal changes offline', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'regulators-'));
  try {
    await cp(new URL('../../../examples/pcb/regulator', import.meta.url), directory, { recursive: true });
    await installProjectBridge(page, directory);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)
        ? route.continue() : route.abort();
    });
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'Regulators.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'Regulators.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    await expect(layout.getByRole('grid', { name: 'Placed components' })).toContainText('U1');
    await expect(layout.getByRole('grid', { name: 'Placed components' })).toContainText('U2');
    const checks = page.getByRole('region', { name: 'PCB design checks' });
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    async function downloadPreview(name, review) {
      await clickPcbCommand(layout, 'CAM read-back preview…');
      await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible();
      if (review) await review();
      const event = page.waitForEvent('download');
      await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
      await (await event).saveAs(info.outputPath(name));
      await cam.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await clickPcbCommand(layout, 'Run design checks…');
    await expect(checks.getByRole('status')).toContainText('found no issues');
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
    await downloadPreview('regulator-baseline.zip', async () => {
      await reviewEveryCamLayer(cam);
      const release = page.waitForEvent('download');
      await cam.getByRole('button', { name: 'Release and download…' }).click();
      await (await release).saveAs(info.outputPath('regulator-manufacturing-release.zip'));
    });

    await selectCopperRow(layout, /Copper zone ·/);
    const zone = layout.getByRole('form', { name: 'Copper zone properties' });
    await zone.getByLabel(/^Cutouts/).fill(
      '28.58, 8.03\n28.72, 8.03\n28.72, 8.29\n28.58, 8.29\n\n' +
      '27.7, 8.58\n28.3, 8.58\n28.3, 8.72\n27.7, 8.72',
    );
    await zone.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(layout.getByText('Zones filled.', { exact: true })).toBeVisible();
    await clickPcbCommand(layout, 'Run design checks…');
    const findings = checks.getByRole('table', { name: 'PCB findings' });
    await expect(findings.locator('tbody > tr')).toHaveCount(2);
    await expect(findings).toContainText('North · Thermal spoke does not bridge the land and pour.');
    await expect(findings).toContainText('East · Filled thermal spoke is below the required bridge width.');
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
    await downloadPreview('regulator-clipped.zip', async () => {
      await cam.getByText(/Manufacturing review · .* release blockers/).click();
      await expect(cam.getByRole('list', { name: 'Release blockers' })).toContainText('Thermal spoke');
      await expect(cam.getByRole('button', { name: 'Release and download…' })).toBeDisabled();
    });
    await layout.getByRole('button', { name: 'Undo', exact: true }).click();
    await clickPcbCommand(layout, 'Run design checks…');
    await expect(checks.getByRole('status')).toContainText('found no issues');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('checks the copied MCU and sensor schematic, board, and antenna keepout offline', async ({ page }, info) => {
  test.setTimeout(120_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'mcu-sensor-'));
  try {
    await cp(new URL('../../../examples/pcb/mcu-sensor', import.meta.url), directory, { recursive: true });
    await installProjectBridge(page, directory);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)
        ? route.continue() : route.abort();
    });
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'Sensor.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'Sensor.dsn', exact: true }).click();
    await page.evaluate(() => window.hierarchyTestMenu('tools-drc'));
    const erc = page.getByRole('dialog', { name: 'Design Rules Check' });
    await erc.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(page.getByText('DRC Results (0)', { exact: true })).toBeVisible();
    await projects.getByRole('button', { name: 'Sensor.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    const canvas = layout.getByRole('img', { name: 'Board layout' });
    await expect(canvas.locator('[data-component]')).toHaveCount(15);
    await expect(canvas.locator('[data-placement-area]')).toHaveCount(4);
    await expect(canvas.locator('[data-routing-region]')).toHaveCount(1);
    await expect(layout.getByText('Zones filled.', { exact: true })).toBeVisible({ timeout: 30_000 });
    const checks = page.getByRole('region', { name: 'PCB design checks' });
    const openChecks = () => clickPcbCommand(layout, 'Run design checks…');
    const closeChecks = () => checks.getByRole('button', { name: 'Close', exact: true }).click();
    await openChecks();
    await expect(checks.getByRole('status')).toContainText('found no issues', { timeout: 30_000 });
    await closeChecks();
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    await clickPcbCommand(layout, 'CAM read-back preview…');
    await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible({ timeout: 40_000 });
    const event = page.waitForEvent('download');
    await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
    await (await event).saveAs(info.outputPath('mcu-sensor-cam.zip'));
    await cam.getByRole('button', { name: 'Close', exact: true }).click();

    await layout.getByRole('button', { name: 'Edit Antenna edge keepout…' }).click();
    const region = page.getByRole('dialog', { name: 'Edit routing region' });
    await region.getByLabel('Outline (X, Y in mm)').fill('12,30\n42,30\n42,37\n12,37');
    await region.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(region).toBeHidden();
    await openChecks();
    await expect(checks.getByRole('table', { name: 'PCB findings' }))
      .toContainText('The routing region excludes this track.', { timeout: 30_000 });
    await closeChecks();
    await layout.getByRole('button', { name: 'Undo', exact: true }).click();
    await openChecks();
    await expect(checks.getByRole('status')).toContainText('found no issues', { timeout: 30_000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rebuilds zone copper for release after clearance and outline edits', async ({ page }, info) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'zone-rebuild-'));
  try {
    await cp(new URL('../../../examples/pcb/led-classroom/Reference', import.meta.url), directory, {
      recursive: true,
    });
    await installProjectBridge(page, directory);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)
        ? route.continue() : route.abort();
    });
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'LED.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'LED.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    const canvas = layout.getByRole('img', { name: 'Board layout' });
    const fill = canvas.locator('[data-zone-fill]');
    await clickPcbCommand(layout, 'Add copper zone');
    await drawPcbOutline(canvas, [[3, 3], [8, 3], [8, 8], [3, 8]]);
    const zone = layout.getByRole('form', { name: 'Copper zone properties' });
    await zone.getByLabel('Net', { exact: true }).selectOption({ label: '0' });
    await zone.getByLabel('Layer', { exact: true }).selectOption('bottom');
    await zone.getByLabel('Outline (X, Y in mm)', { exact: true }).fill('-1, -1\n42, -1\n42, 23\n-1, 23');
    await zone.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(layout.getByText('Zones filled.', { exact: true })).toBeVisible();
    await expect(fill).toHaveCount(1);

    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    const release = cam.getByRole('button', { name: 'Release and download…' });
    async function download(button, name) {
      const event = page.waitForEvent('download');
      await button.click();
      const artifact = info.outputPath(name);
      await (await event).saveAs(artifact);
      return artifact;
    }
    const openCam = () => clickPcbCommand(layout, 'CAM read-back preview…');
    await openCam();
    await reviewEveryCamLayer(cam);
    const prior = await download(cam.getByRole('button', { name: 'Download preview bundle…' }), 'zone-before.zip');
    await cam.getByRole('button', { name: 'Close', exact: true }).click();
    await layout.getByRole('button', { name: 'Cancel zone fill', exact: true }).click();
    await clickPcbCommand(layout, 'Fabrication settings…');
    const fabrication = page.getByRole('dialog', { name: 'Fabrication settings' });
    await fabrication.getByRole('textbox', { name: /^Copper clearance \(mm\)/ }).fill('0.65');
    await fabrication.getByRole('button', { name: 'Apply', exact: true }).click();
    await clickPcbCommand(layout, 'PCB Size & Shape…');
    const outline = page.getByRole('dialog', { name: 'PCB Size & Shape' });
    await outline.getByLabel('Width (mm)', { exact: true }).fill('38');
    await outline.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(layout.getByText('Zone fill is stale.', { exact: true })).toBeVisible();
    await expect(layout.getByText('Design checks are stale.', { exact: true })).toBeVisible();
    await expect(fill).toHaveCount(0);
    await layout.getByRole('button', { name: 'Save', exact: true }).click();
    const api = await layoutRuntime();
    const readBoard = () => readFile(path.join(directory, 'LED.dpn')).then(api.decodeBoard);
    await expect.poll(async () => (await readBoard()).rules?.clearanceNm).toBe(650_000);
    const edited = await readBoard();
    await openCam();
    await reviewEveryCamLayer(cam);
    const released = await download(release, 'zone-after-release.zip');
    await cam.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(layout.getByText('Design checks are stale.', { exact: true })).toHaveCount(0);
    await expect(layout.getByText('Zone fill is stale.', { exact: true })).toBeVisible();

    async function readZip(filename) {
      const zip = new ZipReader(new Uint8ArrayReader(await readFile(filename)));
      try {
        const entries = await zip.getEntries();
        return new Map(await Promise.all(entries.map(async (entry) =>
          [entry.filename, await entry.getData(new TextWriter())])));
      } finally {
        await zip.close();
      }
    }
    const before = await readZip(prior);
    const after = await readZip(released);
    const manifest = JSON.parse(after.get('manifest.json'));
    const report = JSON.parse(after.get('checks.json'));
    expect(manifest.status).toBe('RELEASED');
    expect(manifest.revision).toBe(edited.revision);
    expect(report.revision).toBe(edited.revision);
    expect(report.issues).toEqual([]);
    expect(manifest.rules.effective.clearanceNm).toBe(650_000);
    expect(after.get('copper-bottom.gbr')).not.toEqual(before.get('copper-bottom.gbr'));
    expect(after.get('profile.gbr')).not.toEqual(before.get('profile.gbr'));
    for (const name of ['plated.xnc', 'non-plated.xnc', 'copper-top.gbr'])
      expect(after.get(name)).toEqual(before.get(name));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps DNP pads in copper checks and excludes the part from fitted exports', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'dnp-reference-'));
  try {
    await cp(new URL('../../../examples/pcb/led-classroom/Reference', import.meta.url), directory, {
      recursive: true,
    });
    await installProjectBridge(page, directory);
    await page.route('**/*', (route) => {
      const url = route.request().url();
      return url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)
        ? route.continue() : route.abort();
    });
    const api = await layoutRuntime();
    const schematicPath = path.join(directory, 'LED.dzn');
    const boardPath = path.join(directory, 'LED.dpn');
    const original = await api.decodeBoard(await readFile(boardPath));
    const readSymbol = async () => (await api.decodeDrawing(await readFile(schematicPath))).sheets[0].items
      .find((item) => item.NodeName === 'symbol' && item.text.some(
        ({ description, value }) => description === 'Ref' && value === 'D1',
      ));
    const diode = await readSymbol();
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'LED.tcproject', exact: true }).click();
    await projects.getByRole('button', { name: 'LED.dzn', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.layoutTest.snapshot().drawing.documentId))
      .toBe(original.sourceCircuit.documentId);
    await page.evaluate((unitId) => {
      const live = window.layoutTest.snapshot().drawing.sheets[0].items.find((item) => item.unitId === unitId);
      window.layoutTest.selectItem(live._id);
    }, diode.unitId);
    const properties = page.getByRole('table', { name: 'Properties', exact: true });
    await expect(properties).toBeVisible();
    await properties.getByRole('button', { name: 'Add Attribute', exact: true }).click();
    const attribute = properties.getByRole('row').last();
    await attribute.getByRole('textbox').nth(0).fill('PCB Role');
    await attribute.getByRole('textbox').nth(1).fill('dnp');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await readSymbol()).text.find(({ description }) => description === 'PCB Role')?.value)
      .toBe('dnp');

    await projects.getByRole('button', { name: 'LED.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    await clickPcbCommand(layout, 'Update PCB from Schematic…');
    const update = page.getByRole('dialog', { name: 'Update PCB from Schematic' });
    await expect(update).toContainText('Physical role');
    await update.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect.poll(async () => (await api.decodeBoard(await readFile(boardPath))).components
      .find(({ reference }) => reference === 'D1')?.role).toBe('dnp');
    const dnp = await api.decodeBoard(await readFile(boardPath));
    expect(dnp.tracks).toEqual(original.tracks);
    expect(dnp.footprints).toEqual(original.footprints);
    expect(dnp.deviceDefinitions).toEqual(original.deviceDefinitions);
    await clickPcbCommand(layout, 'CAM read-back preview…');
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    const event = page.waitForEvent('download');
    await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
    const archive = info.outputPath('led-dnp-cam-preview.zip');
    await (await event).saveAs(archive);
    const zip = new ZipReader(new Uint8ArrayReader(await readFile(archive)));
    try {
      const entries = await zip.getEntries();
      const text = (name) => entries.find(({ filename }) => filename === name).getData(new TextWriter());
      expect(await text('bom-fitted.csv')).not.toContain('"D1"');
      expect(await text('placement.csv')).not.toContain('"D1"');
      expect(await text('bom.csv')).toMatch(/"D1","1"[^\r\n]+"DNP"/);
      expect(await text('assembly-top.svg')).toContain('D1 (DNP)');
      expect(JSON.parse(await text('checks.json')).issues).toEqual([]);
    } finally {
      await zip.close();
    }
    await cam.getByRole('button', { name: 'Close', exact: true }).click();
    const ledNet = dnp.nets.find(({ name }) => name === 'LED_A');
    const track = dnp.tracks.find(({ netId }) => netId === ledNet.id);
    const canvas = layout.getByRole('img', { name: 'Board layout' });
    const midpoint = await canvas.evaluate((svg, [a, b]) => {
      const point = new DOMPoint((a.x + b.x) / 2, -(a.y + b.y) / 2).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
      return [point.x, point.y];
    }, [track.start, track.end]);
    await page.mouse.click(...midpoint);
    await layout.getByRole('button', { name: 'Delete selected copper…' }).click();
    await layout.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
    await clickPcbCommand(layout, 'Run design checks…');
    await expect(page.getByRole('region', { name: 'PCB design checks' }).getByRole('table', { name: 'PCB findings' }))
      .toContainText('Required terminals remain in separate copper islands.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('opens and edits the single-sided timer and logic reference offline', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'timer-reference-'));
  const sample = new URL('../../../examples/pcb/timer-logic/', import.meta.url);
  const marker = path.join(directory, 'Timer.tcproject');
  let pending = marker;
  try {
    for (const name of ['Timer.dsn', 'Timer.dpn', 'Timer.tcproject'])
      await cp(new URL(name, sample), path.join(directory, name));
    await installProjectBridge(page, directory, undefined, () => {
      const file = pending;
      pending = undefined;
      return file;
    });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(app.baseURL) && !/\.(?:tplib|tclib)($|\?)/i.test(url)) return route.continue();
      return route.abort();
    });
    await page.goto(app.baseURL + '?project=1');
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'Timer.dsn', exact: true }).click();
    await page.locator('.sheet-heading').getByText('NAND and hidden power', { exact: true }).click();
    for (const reference of ['U2A', 'U2B', 'U2C', 'U2D'])
      await expect(page.locator('svg').getByText(reference, { exact: true })).toBeVisible();
    await projects.getByRole('button', { name: 'Timer.dpn', exact: true }).click();
    const board = page.getByRole('region', { name: 'PCB layout', exact: true });
    await expect(board.getByLabel('Copper layers')).toHaveValue('1');
    const packages = board.getByRole('grid', { name: 'Placed components', exact: true });
    await expect(packages.getByRole('listitem')).toHaveCount(6);
    await expect(packages.getByRole('button', { name: 'U2', exact: true })).toHaveCount(1);
    const canvas = board.getByRole('img', { name: 'Board layout' });
    await expect(canvas.locator('[data-wire-jumper]')).toHaveCount(1);
    await clickPcbCommand(board, 'Run design checks…');
    const checks = page.getByRole('region', { name: 'PCB design checks' });
    const findings = checks.getByRole('table', { name: 'PCB findings' }).locator('tbody > tr');
    await expect(findings).toHaveCount(1, { timeout: 30_000 });
    await expect(findings).toContainText('Separate bare copper islands require fitted wire jumpers');
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
    await clickPcbCommand(board, 'CAM read-back preview…');
    const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
    await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible({ timeout: 55_000 });
    const download = page.waitForEvent('download');
    await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
    await (await download).saveAs(info.outputPath('timer-cam-preview.zip'));
    await cam.getByRole('button', { name: 'Close', exact: true }).click();
    await selectCopperRow(board, 'Wire jumper · JP1');
    const jumper = board.getByRole('form', { name: 'Wire jumper properties' });
    await jumper.getByLabel('Fit jumper').uncheck();
    await jumper.getByRole('button', { name: 'Apply', exact: true }).click();
    await board.getByRole('button', { name: 'Save', exact: true }).click();
    const api = await layoutRuntime();
    await expect.poll(async () => {
      const decoded = await api.decodeBoard(await readFile(path.join(directory, 'Timer.dpn')));
      return decoded.jumpers.find(({ reference }) => reference === 'JP1')?.fitted;
    }).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('regenerates nested schematic recipes after copying the project folder', async ({ page }, info) => {
  test.setTimeout(90_000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'outputs-'));
  const original = path.join(directory, 'Original');
  const copy = path.join(directory, 'Copied');
  let interrupt = true;
  await installProjectBridge(page, directory, (request) => {
    if (interrupt && request.operation === 'write' && request.name === 'components.csv') {
      interrupt = false;
      throw new Error('Simulated interruption while saving output');
    }
  });
  const api = await layoutRuntime();
  try {
    const entries = [];
    for (const name of ['src/Circuit.dsn', 'Blocks/Child.dsn', 'Blocks/Leaf.dsn']) {
      const source = await api.decodeDrawing(await readFile(
        new URL('../fixtures/pcb-hierarchy/' + name, import.meta.url),
      ));
      const outfile = path.join(original, name);
      await mkdir(path.dirname(outfile), { recursive: true });
      await writeFile(outfile, await api.encodeDrawing(source, 'xml'));
      entries.push({ id: source.documentId, kind: 'schematic', path: name });
    }
    const board = api.createBoard('Board', 1, [
      { x: 0, y: 0 }, { x: 3e6, y: 0 }, { x: 3e6, y: 2e6 }, { x: 0, y: 2e6 },
    ]);
    entries.push({ id: board.boardId, kind: 'board', path: 'Board.dpn' });
    await writeFile(path.join(original, 'Board.dpn'), await api.encodeBoard(board));
    await writeFile(path.join(original, 'Original.tcproject'), api.encodeProjectSettings({
      title: 'Outputs fixture', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], entries, primarySchematic: entries[0].id, primaryBoard: board.boardId,
    }));
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Project outputs', exact: true });
    async function openOutputs(name) {
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
      await projects.getByRole('button', { name, exact: true }).click();
      await projects.getByRole('button', { name: 'Project outputs…', exact: true }).click();
    }
    const outputDir = 'generated/release';
    const names = ['components.csv', 'wiring.net'];
    const run = (name) => dialog.getByRole('listitem').filter({ hasText: outputDir + '/' + name })
      .getByRole('button', { name: 'Run', exact: true }).click();
    await page.goto(app.baseURL);
    await openOutputs('Original');
    for (const [kind, name] of [['BOM', names[0]], ['netlist', names[1]]]) {
      await dialog.getByRole('button', { name: 'Add ' + kind + ' recipe' }).click();
      await dialog.getByRole('textbox', { name: 'Output folder' }).fill(outputDir);
      await dialog.getByRole('textbox', { name: 'Filename' }).fill(name);
      await dialog.getByRole('button', { name: 'Save recipe' }).click();
      await expect(dialog.getByRole('listitem').filter({ hasText: name })).toBeVisible();
    }
    await run(names[0]);
    await expect(dialog.getByRole('alert')).toContainText('Simulated interruption');
    const pending = JSON.parse(await readFile(path.join(original, outputDir, names[0] + '.manifest.json'), 'utf8'));
    expect(pending.pending).toBe(true);
    for (const name of names) {
      await run(name);
      await expect(dialog.getByRole('status')).toContainText('Generated ' + outputDir + '/' + name);
    }
    const bom = await readFile(path.join(original, outputDir, names[0]), 'utf8');
    expect(bom).toContain('H1_H1_R1');
    expect(await readFile(path.join(original, outputDir, names[1]), 'utf8')).toContain('*PADS-PCB*');
    const settings = api.decodeProjectSettings(await readFile(path.join(original, 'Original.tcproject')));
    expect(settings.outputRecipes).toHaveLength(2);

    await cp(original, copy, { recursive: true });
    await page.reload();
    await openOutputs('Copied');
    for (const name of names) {
      await run(name);
      await expect(dialog.getByRole('status')).toContainText('Generated ' + outputDir + '/' + name);
      for (const file of [name, name + '.manifest.json']) {
        expect(await readFile(path.join(copy, outputDir, file))).toEqual(
          await readFile(path.join(original, outputDir, file)),
        );
      }
    }
    await writeFile(path.join(copy, outputDir, names[0]), 'Hand edited');
    await run(names[0]);
    await expect(dialog.getByRole('alert')).toContainText('has been edited');
    expect(await readFile(path.join(copy, outputDir, names[0]), 'utf8')).toBe('Hand edited');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('reopens the saved linked PCB after a renderer crash', async ({ page, context }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'board-save-only-'));
  await installProjectBridge(page, directory);
  const root = path.join(directory, 'Project');
  await mkdir(root);
  const api = await layoutRuntime();
  const original = api.createBoard('Source', 2, [
    { x: 0, y: 0 }, { x: 10e6, y: 0 }, { x: 10e6, y: 10e6 }, { x: 0, y: 10e6 },
  ]);
  const boardPath = path.join(root, 'Board.dpn');
  await writeFile(boardPath, await api.encodeBoard(original));
  await writeFile(path.join(root, 'Project.tcproject'), api.encodeProjectSettings({
    title: 'Save only fixture', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
    primaryBoard: original.boardId, requiredFeatures: [],
    entries: [{ kind: 'board', id: original.boardId, path: 'Board.dpn' }],
  }));
  const open = async (target) => {
    await target.goto(app.baseURL);
    await target.getByRole('button', { name: 'Projects', exact: true }).click();
    const projects = target.getByRole('region', { name: 'Projects', exact: true });
    await projects.getByRole('button', { name: 'Project', exact: true }).click();
    await projects.getByRole('button', { name: 'Board.dpn', exact: true }).click();
  };
  const board = (target) => target.getByRole('region', { name: 'PCB layout' });

  try {
    await open(page);
    await clickPcbCommand(board(page), 'View board tools');
    await board(page).getByLabel('Copper layers').selectOption('1');
    await expect(page).toHaveTitle('TinyCAD - Board.dpn*');
    const renderer = await context.newCDPSession(page);
    const crashed = page.waitForEvent('crash');
    // The renderer can terminate before replying to the crash command.
    void renderer.send('Page.crash').catch(() => {});
    await crashed;
    await page.close();
    const reopened = await context.newPage();
    await open(reopened);
    await clickPcbCommand(board(reopened), 'View board tools');
    await expect(board(reopened).getByLabel('Copper layers')).toHaveValue('2');
    await expect(reopened.getByRole('dialog', { name: 'Recover PCB edits' })).toHaveCount(0);
    expect((await api.decodeBoard(await readFile(boardPath))).revision).toBe(original.revision);
    await board(reopened).getByLabel('Copper layers').selectOption('1');
    await board(reopened).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(reopened).toHaveTitle('TinyCAD - Board.dpn');
    expect((await api.decodeBoard(await readFile(boardPath))).copperLayers).toHaveLength(1);
    await reopened.close();
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('regenerates saved PCB recipes offline after copying a project', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'pcb-outputs-'));
  const original = path.join(directory, 'Original');
  const copy = path.join(directory, 'Copied');
  const outputDir = 'generated/board';
  const recipes = [
    { format: 'board-bom', filename: 'components.csv' },
    { format: 'board-bom', filename: 'components-raw.csv', csvText: 'raw' },
    { format: 'fitted-bom', filename: 'fitted-components.csv' },
    { format: 'placement', filename: 'coordinates.csv', decimals: 2 },
    { format: 'copper', filename: 'solder-side.gbr', layer: 'bottom' },
    { format: 'assembly-drawing', filename: 'placement-top.svg', layer: 'top' },
  ];

  try {
    await cp(new URL('../../../examples/pcb/led-classroom/Reference', import.meta.url), original, {
      recursive: true,
    });
    const api = await layoutRuntime();
    const originalBoardPath = path.join(original, 'LED.dpn');
    const originalBoard = await api.decodeBoard(await readFile(originalBoardPath));
    await writeFile(originalBoardPath, await api.encodeBoard({
      ...originalBoard, components: originalBoard.components.map((part) =>
        part.reference === 'R1' ? { ...part, procurement: { mpn: '=RES-330', tolerance: '1%' } } : part),
    }));
    await installProjectBridge(page, directory);
    const requests = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(app.baseURL) && !/\.tplib($|\?)/.test(url))
        return route.continue();
      requests.push(url);
      return route.abort();
    });
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Project outputs', exact: true });
    async function openOutputs(name) {
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
      await projects.getByRole('button', { name, exact: true }).click();
      await projects.getByRole('button', { name: 'Project outputs…', exact: true }).click();
    }
    const recipeRow = (filename) =>
      dialog.getByRole('listitem').filter({ hasText: outputDir + '/' + filename });
    async function run(filename) {
      await recipeRow(filename).getByRole('button', { name: 'Run', exact: true }).click();
      await expect(dialog.getByRole('status')).toHaveText('Generated ' + outputDir + '/' + filename);
    }

    await page.goto(app.baseURL);
    await openOutputs('Original');
    for (const { format, filename, layer, decimals, csvText } of recipes) {
      await dialog.getByRole('button', { name: 'Add PCB output recipe' }).click();
      await expect(dialog.getByLabel('Source PCB').locator('option:checked')).toHaveText('LED.dpn');
      await dialog.getByLabel('PCB output format').selectOption(format);
      if (layer) await dialog.getByLabel('Layer').selectOption(layer);
      if (decimals !== undefined)
        await dialog.getByLabel('Decimal places').selectOption(String(decimals));
      if (csvText) await dialog.getByLabel('CSV text').selectOption(csvText);
      await dialog.getByRole('textbox', { name: 'Output folder' }).fill(outputDir);
      await dialog.getByRole('textbox', { name: 'Filename' }).fill(filename);
      await dialog.getByRole('button', { name: 'Save recipe' }).click();
      await expect(recipeRow(filename)).toBeVisible();
      await run(filename);
    }

    const output = (filename) => readFile(path.join(original, outputDir, filename), 'utf8');
    expect(await output('components.csv')).toContain('"R1","1","330","axial-762","Fitted"');
    expect(await output('components.csv')).toContain('"\'=RES-330"');
    expect(await output('components-raw.csv')).toContain('"=RES-330"');
    expect(await output('fitted-components.csv')).toBe(await output('components.csv'));
    expect(await output('coordinates.csv')).toContain('"R1","330","axial-762","Fitted","18.00","7.75","top","0.00"');
    expect(await output('solder-side.gbr')).toContain('%TF.FileFunction,Copper,L2,Bot*%');
    expect(await output('placement-top.svg')).toContain('<svg');

    await cp(original, copy, { recursive: true });
    await rm(path.join(copy, outputDir), { recursive: true });
    await page.reload();
    await openOutputs('Copied');
    await recipeRow('components-raw.csv').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dialog.getByLabel('CSV text')).toHaveValue('raw');
    await dialog.getByRole('button', { name: 'Cancel edit' }).click();
    await recipeRow('coordinates.csv').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dialog.getByLabel('Decimal places')).toHaveValue('2');
    await dialog.getByRole('button', { name: 'Cancel edit' }).click();
    await recipeRow('solder-side.gbr').getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dialog.getByLabel('Layer')).toHaveValue('bottom');
    await dialog.getByRole('button', { name: 'Cancel edit' }).click();
    const boardDigest = createHash('sha256')
      .update(await readFile(path.join(copy, 'LED.dpn')))
      .digest('hex');
    for (const { filename } of recipes) {
      await run(filename);
      for (const file of [filename, filename + '.manifest.json']) {
        expect(await readFile(path.join(copy, outputDir, file), 'utf8')).toEqual(await output(file));
      }
      const manifest = JSON.parse(await output(filename + '.manifest.json'));
      expect(manifest.sources).toEqual({ 'LED.dpn': boardDigest });
      expect(manifest.output.digest).toBe(
        createHash('sha256').update(await output(filename)).digest('hex'),
      );
    }
    expect(requests).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('opens a desktop project at its containing folder without replacing the drawing', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const area = await mkdtemp(path.join(info.project.outputDir, 'desktop-project-open-'));
  const documents = path.join(area, 'Documents');
  const first = path.join(area, 'First');
  const second = path.join(area, 'Second');
  const invalid = path.join(area, 'Invalid');
  const unmarked = path.join(area, 'Unmarked');
  const trash = path.join(area, 'Trash');
  const trashed = [];
  let chosenFolder;
  let queued = path.join(first, 'Startup.tcproject');
  try {
    await Promise.all([documents, first, second, invalid, unmarked, trash].map((folder) => mkdir(folder)));
    const api = await layoutRuntime();
    for (const [folder, marker, title] of [
      [first, 'Startup.tcproject', 'Startup settings'],
      [second, 'Next.tcproject', 'Next settings'],
    ]) {
      await writeFile(path.join(folder, marker), api.encodeProjectSettings({
        title,
        projectId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        requiredFeatures: [],
        entries: [],
      }));
      await writeFile(path.join(folder, title + '.txt'), 'notes');
    }
    const board = api.createBoard('Linked layout', 2, [
      { x: 0, y: 0 }, { x: 2e6, y: 0 }, { x: 2e6, y: 2e6 }, { x: 0, y: 2e6 },
    ]);
    const boardPath = path.join(second, 'Linked.dpn');
    await writeFile(boardPath, await api.encodeBoard(board));
    const nextMarker = path.join(second, 'Next.tcproject');
    const next = api.decodeProjectSettings(await readFile(nextMarker));
    await writeFile(nextMarker, api.encodeProjectSettings({
      ...next,
      entries: [{ kind: 'board', id: board.boardId, path: 'Linked.dpn' }],
    }));
    await writeFile(path.join(documents, 'Unrelated.tcproject'), 'unrelated');
    await writeFile(path.join(invalid, 'Broken.tcproject'), 'invalid XML');
    await writeFile(path.join(unmarked, 'Build notes.txt'), 'Existing file');
    await writeFile(path.join(unmarked, 'Move me.txt'), 'Portable notes');
    await mkdir(path.join(unmarked, 'Datasheets', 'Connectors'), { recursive: true });
    await writeFile(path.join(unmarked, 'Datasheets', 'Connectors', 'Pinout.txt'), 'Tip, ring and sleeve');
    await installProjectBridge(page, documents, undefined, () => {
      const value = queued;
      queued = undefined;
      return value;
    }, {
      showOpenDialog: async () => chosenFolder
        ? { canceled: false, filePaths: [chosenFolder] }
        : { canceled: true, filePaths: [] },
    }, {
      async trashItem(filename) {
        await rename(filename, path.join(trash, path.basename(filename)));
        trashed.push(filename);
      },
    });
    await page.goto(app.baseURL);
    await expect(page.getByRole('group', { name: 'Project activity bar' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Projects', exact: true })).toHaveCount(0);
    await page.goto(app.baseURL + '?project=1');
    const projects = page.getByRole('region', { name: 'Projects', exact: true });
    await expect(projects.getByRole('button', { name: 'Startup settings.txt', exact: true })).toBeVisible();
    await expect(projects.getByRole('button', { name: 'Parent folder' })).toHaveCount(0);
    await expect(projects.getByText('First', { exact: true })).toBeVisible();
    await expect(projects.getByText('Unrelated')).toHaveCount(0);

    await page.evaluate(() => window.layoutTest.renameCurrentSheet('Unsaved standalone edit'));
    queued = path.join(second, 'Next.tcproject');
    await page.evaluate(() => window.hierarchyTestMenu('file-open-project-launch'));
    await expect(projects.getByRole('button', { name: 'Next settings.txt', exact: true })).toBeVisible();
    await expect(projects.getByText('Second', { exact: true })).toBeVisible();
    await expect(projects.getByText('Startup settings.txt', { exact: true })).toHaveCount(0);

    queued = path.join(invalid, 'Broken.tcproject');
    await page.evaluate(() => window.hierarchyTestMenu('file-open-project-launch'));
    await expect(page.getByRole('dialog').getByText('Invalid TinyCAD project settings XML.')).toBeVisible();
    await expect(projects.getByText('Second', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.hierarchyTestMenu('file-open-project-folder'));
    await expect(projects.getByText('Second', { exact: true })).toBeVisible();
    chosenFolder = unmarked;
    await page.evaluate(() => window.hierarchyTestMenu('file-open-project-folder'));
    await expect(projects.getByText('Unmarked', { exact: true })).toBeVisible();
    const treeButton = (name) => projects.getByRole('button', { name, exact: true });
    async function chooseItemAction(item, action) {
      await treeButton(item).click({ button: 'right' });
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    }
    async function chooseFolderAction(action) {
      await treeButton('Project folder actions').click({ button: 'right' });
      await page.getByRole('menuitem', { name: action, exact: true }).click();
    }
    async function submitName(name) {
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
      await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    }

    await expect(treeButton('Build notes.txt')).toBeVisible();
    const sheetFolder = treeButton('Datasheets');
    await expect(sheetFolder).toHaveAttribute('aria-expanded', 'false');
    await sheetFolder.focus();
    await page.keyboard.press('Enter');
    await expect(sheetFolder).toHaveAttribute('aria-expanded', 'true');
    await expect(treeButton('Build notes.txt')).toBeVisible();
    const connectors = treeButton('Connectors');
    await connectors.click();
    const pinout = treeButton('Pinout.txt');
    await expect(pinout).toBeVisible();
    const outer = await sheetFolder.boundingBox();
    const nested = await pinout.boundingBox();
    expect(nested.x).toBeGreaterThan(outer.x);
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(pinout).toBeVisible();

    await chooseItemAction('Move me.txt', 'Cut for move');
    await chooseFolderAction('Paste moved item');
    await expect(treeButton('Move me.txt')).toBeVisible();
    const moved = path.join(unmarked, 'Datasheets', 'Connectors', 'Move me.txt');
    await expect.poll(() => readFile(moved, 'utf8').catch(() => null)).toBe('Portable notes');
    await expect(readFile(path.join(unmarked, 'Move me.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

    await chooseFolderAction('New folder…');
    await submitName('To rename');
    await expect(treeButton('To rename')).toBeVisible();
    await chooseItemAction('To rename', 'Rename');
    await submitName('Empty folder');
    await expect(treeButton('Empty folder')).toBeVisible();

    await chooseItemAction('Move me.txt', 'Move to trash');
    await page.getByRole('dialog', { name: 'Move to trash' }).getByRole('button', { name: 'Move to trash' }).click();
    await expect(treeButton('Move me.txt')).toHaveCount(0);
    await chooseItemAction('Empty folder', 'Move to trash');
    await page.getByRole('dialog', { name: 'Move to trash' }).getByRole('button', { name: 'Move to trash' }).click();
    await expect(treeButton('Empty folder')).toHaveCount(0);
    expect(trashed).toEqual([
      path.join(unmarked, 'Datasheets', 'Connectors', 'Move me.txt'),
      path.join(unmarked, 'Datasheets', 'Connectors', 'Empty folder'),
    ]);
    expect(await readFile(path.join(trash, 'Move me.txt'), 'utf8')).toBe('Portable notes');

    await sheetFolder.click();
    await expect(sheetFolder).toHaveAttribute('aria-expanded', 'false');
    await expect(connectors).toHaveCount(0);
    await expect(treeButton('Build notes.txt')).toBeVisible();
    await projects.getByRole('button', { name: 'Project folder actions' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New project…' }).click();
    const name = page.getByRole('dialog');
    await name.getByRole('textbox', { name: 'Name' }).fill('Build');
    await name.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(projects.getByRole('button', { name: 'Build.tcproject', exact: true })).toBeVisible();
    const settings = api.decodeProjectSettings(await readFile(path.join(unmarked, 'Build.tcproject')));
    expect(settings.entries).toEqual([]);
    expect(await readFile(path.join(unmarked, 'Build notes.txt'), 'utf8')).toBe('Existing file');
    await page.evaluate(() => window.hierarchyTestMenu('file-close-project'));
    await expect(projects).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Project activity bar' })).toHaveCount(0);
    expect(await page.evaluate(() => window.layoutTest.snapshot().drawing.sheets[0].name)).toBe('Unsaved standalone edit');

    await page.evaluate(() => window.hierarchyTestMenu('settings-settings'));
    const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settingsDialog.getByLabel('Open in…')).toHaveValue('single');
    await settingsDialog.getByLabel('Open in…').selectOption('project');
    await settingsDialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(projects).toHaveCount(0);
    await page.goto(app.baseURL);
    await expect(projects.getByRole('button', { name: 'Build.tcproject', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Project activity bar' })).toHaveCSS('flex-direction', 'column');

    queued = nextMarker;
    await page.evaluate(() => window.hierarchyTestMenu('file-open-project-launch'));
    await projects.getByRole('button', { name: 'Linked.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout' });
    await layout.getByLabel('Copper layers').selectOption('1');
    await page.evaluate(() => window.hierarchyTestMenu('file-close-project'));
    const close = page.getByRole('dialog', { name: 'Close Project', exact: true });
    await close.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(layout.getByLabel('Copper layers')).toHaveValue('1');
    await page.evaluate(() => window.hierarchyTestMenu('file-close-project'));
    await close.getByRole('button', { name: 'Save and close', exact: true }).click();
    await expect(close).toHaveCount(0);
    await expect(layout).toHaveCount(0);
    await expect(projects).toHaveCount(0);
    expect((await api.decodeBoard(await readFile(boardPath))).copperLayers).toHaveLength(1);
  } finally {
    await rm(area, { recursive: true, force: true });
  }
});

test('relocates linked board folders and recovers interrupted file operations', async ({ page }, info) => {
  test.setTimeout(90000);
  const root = await mkdtemp(path.join(info.project.outputDir, 'linked-move-'));
  const marker = path.join(root, 'Example.tcproject');
  const recycleBin = await mkdtemp(path.join(info.project.outputDir, 'linked-trash-'));
  const api = await layoutRuntime();
  let failCommit = false;
  let failRollback = false;
  let failTrash = false;
  let failTrashRollback = false;
  const trashed = [];
  await installProjectBridge(page, root, async (request) => {
    if (failCommit && request.operation === 'write' && request.id === marker) {
      failCommit = false;
      const settings = api.decodeProjectSettings(await readFile(marker));
      await writeFile(marker, api.encodeProjectSettings({ ...settings, author: 'Concurrent edit' }));
      throw new Error('Simulated settings write failure');
    }
    if (failRollback && request.operation === 'move' && request.folder === root) {
      failRollback = false;
      throw new Error('Simulated interruption during rollback');
    }
    if (failTrashRollback && !failTrash && request.operation === 'write' && request.id === marker) {
      failTrashRollback = false;
      throw new Error('Simulated interruption restoring trash settings');
    }
  }, undefined, undefined, {
    async trashItem(filename) {
      if (failTrash) {
        failTrash = false;
        throw new Error('Simulated trash provider failure');
      }
      await rename(filename, path.join(recycleBin, path.basename(filename)));
      trashed.push(filename);
    },
  });
  try {
    await Promise.all(['Modules', 'Archive', 'Occupied', 'Outside'].map((name) => mkdir(path.join(root, name))));
    const top = crypto.randomUUID();
    const child = crypto.randomUUID();
    const leaf = crypto.randomUUID();
    const placement = crypto.randomUUID();
    const xml = (id, name, items = '') =>
      `<TinyCADSheets><DSNIDENTITY id="${id}"/><TinyCAD id="${crypto.randomUUID()}"><NAME>${name}</NAME>${items}</TinyCAD></TinyCADSheets>`;
    const instance = (file, id, unit) =>
      `<HIERARCHICAL_SYMBOL pos="60,70" rotate="0" file="${file}" child_uuid="${id}" unit_uuid="${unit}"><FIELD type="0" description="Ref" value="H1" show="1" pos="0,12"/></HIERARCHICAL_SYMBOL>`;
    const system = await api.decodeDrawing(xml(top, 'System', instance('Modules/Child.dsn', child, placement)));
    await writeFile(path.join(root, 'System.dzn'), await api.encodeDrawing(system, 'zip-v1'));
    const legacy = '<HIERACHICAL_SYMBOL pos="60,70" rotate="0" file="../Outside/Leaf.dsn"/>';
    const childFile = path.join(root, 'Modules', 'Child.dsn');
    await writeFile(childFile, xml(child, 'Module', legacy));
    await writeFile(path.join(root, 'Outside', 'Leaf.dsn'), xml(leaf, 'Leaf'));

    const outline = [{ x: 0, y: 0 }, { x: 2e6, y: 0 }, { x: 2e6, y: 2e6 }, { x: 0, y: 2e6 }];
    const board = api.createBoard('Module PCB', 1, outline);
    const existing = api.createBoard('Occupied PCB', 1, outline);
    const boardBytes = Buffer.from(await api.encodeBoard(board));
    await writeFile(path.join(root, 'Modules', 'Main.dpn'), boardBytes);
    await writeFile(path.join(root, 'Occupied', 'Other.dpn'), await api.encodeBoard(existing));
    const association = { schematic: child, board: board.boardId };
    await writeFile(marker, api.encodeProjectSettings({
      projectId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      title: 'Linked moves',
      requiredFeatures: [],
      primarySchematic: top,
      primaryBoard: board.boardId,
      entries: [
        { kind: 'schematic', id: top, path: 'System.dzn' },
        { kind: 'schematic', id: child, path: 'Modules/Child.dsn' },
        { kind: 'board', id: board.boardId, path: 'Modules/Main.dpn' },
        { kind: 'board', id: existing.boardId, path: 'Occupied/Other.dpn' },
      ],
      associations: [association],
      outputRecipes: [
        {
          id: crypto.randomUUID(), kind: 'netlist', schematic: child, format: 'PADS-PCB',
          directory: 'Modules/outputs', filename: 'Module.net',
        },
        {
          id: crypto.randomUUID(), kind: 'bom', board: board.boardId,
          directory: 'Modules/outputs', filename: 'Module.csv',
        },
        {
          id: crypto.randomUUID(), kind: 'pcb', board: board.boardId, format: 'placement',
          directory: 'Modules/outputs', filename: 'Placement.csv',
        },
      ],
    }));

    const sidebar = page.getByRole('region', { name: 'Projects', exact: true });
    const item = (name) => sidebar.getByRole('button', { name, exact: true });
    const menu = (name) => page.getByRole('menuitem', { name, exact: true });
    async function showProject() {
      await page.goto(app.baseURL);
      await page.getByRole('button', { name: 'Projects', exact: true }).click();
      await expect(item('Open schematic')).toBeVisible();
    }
    async function action(name, command) {
      await item(name).click({ button: 'right' });
      await menu(command).click();
    }
    async function paste() {
      await item('Project folder actions').click({ button: 'right' });
      await menu('Paste moved item').click();
    }
    const settings = async () => api.decodeProjectSettings(await readFile(marker));

    await showProject();
    await item('Modules').click();
    await action('Main.dpn', 'Rename');
    const renameDialog = page.getByRole('dialog', { name: 'Rename' });
    await renameDialog.getByRole('textbox', { name: 'Name' }).fill('Module.dpn');
    await renameDialog.getByRole('button', { name: 'OK' }).click();
    await expect(item('Module.dpn')).toBeVisible();
    expect(await readFile(path.join(root, 'Modules', 'Module.dpn'))).toEqual(boardBytes);

    await action('Module.dpn', 'Cut for move');
    await item('Occupied').click();
    await paste();
    await expect(sidebar.getByRole('alert')).toContainText('Only one active PCB');
    expect(await readFile(path.join(root, 'Modules', 'Module.dpn'))).toEqual(boardBytes);
    const originalSystem = await readFile(path.join(root, 'System.dzn'));
    const originalChild = await readFile(childFile);
    const originalSettings = await settings();

    await action('Modules', 'Cut for move');
    await item('Archive').click();
    failCommit = true;
    failRollback = true;
    await paste();
    await expect(sidebar.getByRole('alert')).toContainText('Simulated interruption');
    expect(await readFile(path.join(root, 'Archive', 'Modules', 'Module.dpn'))).toEqual(boardBytes);
    expect(await settings()).toEqual({ ...originalSettings, author: 'Concurrent edit' });

    await showProject();
    expect(await readFile(path.join(root, 'Modules', 'Module.dpn'))).toEqual(boardBytes);
    expect(await readFile(path.join(root, 'System.dzn'))).toEqual(originalSystem);
    expect(await readFile(childFile)).toEqual(originalChild);
    expect(await settings()).toEqual({ ...originalSettings, author: 'Concurrent edit' });

    await action('Modules', 'Cut for move');
    await item('Archive').click();
    await paste();
    await expect.poll(async () => (await settings()).entries.find(({ id }) => id === board.boardId).path)
      .toBe('Archive/Modules/Module.dpn');
    const moved = await settings();
    expect(moved.associations).toEqual([association]);
    expect(moved.outputRecipes.map(({ directory }) => directory))
      .toEqual(Array(3).fill('Archive/Modules/outputs'));
    expect(moved.entries.find(({ id }) => id === child).path).toBe('Archive/Modules/Child.dsn');
    const updatedSystem = await api.decodeDrawing(await readFile(path.join(root, 'System.dzn')));
    const childInstance = updatedSystem.sheets[0].items.find(({ hierarchy }) => hierarchy);
    expect(childInstance.unitId).toBe(placement);
    expect(childInstance.hierarchy).toMatchObject({ documentId: child, path: 'Archive/Modules/Child.dsn' });
    expect(await readFile(path.join(root, 'Archive', 'Modules', 'Child.dsn'), 'utf8'))
      .toContain('file="../../Outside/Leaf.dsn"');
    expect(await readFile(path.join(root, 'Archive', 'Modules', 'Module.dpn'))).toEqual(boardBytes);

    await showProject();
    await item('System.dzn').click();
    await expect.poll(() => page.evaluate(() => window.layoutTest.snapshot().drawing.documentId)).toBe(top);
    await item('Archive').click();
    await item('Modules').click();
    await item('Module.dpn').click();
    const layout = page.getByRole('region', { name: 'PCB layout' });
    await expect(layout.getByRole('img', { name: 'Board layout' })).toBeVisible();
    await item('Module.dpn').click({ button: 'right' });
    await expect(menu('Move to trash')).toBeDisabled();

    const trash = page.getByRole('dialog', { name: 'Move to trash' });
    async function openModule() {
      await showProject();
      await item('Archive').click();
      await item('Modules').click();
    }
    async function previewChildTrash() {
      await action('Child.dsn', 'Move to trash');
      await expect(trash.getByText('Archive/Modules/Child.dsn', { exact: true })).toBeVisible();
      await expect(trash.getByText('Archive/Modules/Child.dsn → Archive/Modules/Module.dpn')).toBeVisible();
      await expect(trash.getByText('Archive/Modules/outputs/Module.net', { exact: true })).toBeVisible();
      await expect(trash.getByText('Archive/Modules/outputs/Module.csv', { exact: true })).toBeVisible();
      await expect(trash.getByText('Archive/Modules/outputs/Placement.csv', { exact: true })).toHaveCount(0);
    }
    const confirmTrash = () => trash.getByRole('button', { name: 'Move to trash', exact: true }).click();
    const survivorPath = path.join(root, 'System.dzn');
    const survivor = await readFile(survivorPath);
    const movedChild = path.join(root, 'Archive', 'Modules', 'Child.dsn');
    const movedChildBytes = await readFile(movedChild);

    await openModule();
    await previewChildTrash();
    await trash.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(trashed).toEqual([]);
    expect(await settings()).toEqual(moved);

    await previewChildTrash();
    const concurrent = { ...moved, author: 'New author' };
    await writeFile(marker, api.encodeProjectSettings(concurrent));
    await confirmTrash();
    await expect(sidebar.getByRole('alert')).toContainText('Open a fresh trash preview');
    expect(trashed).toEqual([]);
    expect(await readFile(movedChild)).toEqual(movedChildBytes);

    await previewChildTrash();
    failTrash = true;
    failTrashRollback = true;
    await confirmTrash();
    await expect(sidebar.getByRole('alert')).toContainText('Simulated interruption restoring trash settings');
    expect((await settings()).entries.some(({ id }) => id === child)).toBe(false);
    expect(trashed).toEqual([]);
    await openModule();
    expect(await settings()).toEqual(concurrent);

    await previewChildTrash();
    await confirmTrash();
    await expect.poll(() => trashed.includes(movedChild)).toBe(true);
    await expect(item('Child.dsn')).toHaveCount(0);
    expect(await readFile(path.join(recycleBin, 'Child.dsn'))).toEqual(movedChildBytes);
    expect(await readFile(survivorPath)).toEqual(survivor);
    const detached = await settings();
    expect(detached.entries.some(({ id }) => id === child)).toBe(false);
    expect(detached.associations ?? []).toEqual([]);
    expect(detached.outputRecipes.map(({ filename }) => filename)).toEqual(['Placement.csv']);

    await item('System.dzn').click();
    await expect.poll(() => page.evaluate(() => window.layoutTest.snapshot().drawing.documentId)).toBe(top);
    await page.evaluate(() => {
      const instance = window.layoutTest.snapshot().drawing.sheets[0].items.find(({ hierarchy }) => hierarchy);
      window.layoutTest.selectItem(instance._id);
    });
    await expect(page.getByRole('region', { name: 'Schematic hierarchy' }).getByRole('status'))
      .toContainText(/Missing or ambiguous child|child identity and project path disagree/i);
    await item('Module.dpn').click();
    await expect(layout.getByRole('img', { name: 'Board layout' })).toBeVisible();

    await openModule();
    await action('Modules', 'Move to trash');
    await expect(trash.getByText('Archive/Modules/Module.dpn', { exact: true })).toBeVisible();
    await expect(trash.getByText('Archive/Modules/outputs/Placement.csv', { exact: true })).toBeVisible();
    await confirmTrash();
    await expect.poll(() => trashed.includes(path.join(root, 'Archive', 'Modules'))).toBe(true);
    await expect(item('Modules')).toHaveCount(0);
    expect(await readFile(path.join(recycleBin, 'Modules', 'Module.dpn'))).toEqual(boardBytes);
    const remaining = await settings();
    expect(remaining.primaryBoard).toBeUndefined();
    expect(remaining.primarySchematic).toBe(top);
    expect(remaining.entries.map(({ id }) => id).sort()).toEqual([existing.boardId, top].sort());
    expect(remaining.outputRecipes ?? []).toEqual([]);
  } finally {
    await Promise.all([root, recycleBin].map((directory) => rm(directory, { recursive: true, force: true })));
  }
});

test('imports dropped project files, nested folders, and retries a failed copy', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(path.join(info.project.outputDir, 'project-import-'));
  const root = path.join(directory, 'Project');
  const assets = path.join(root, 'Assets');
  let fail = true;
  await installProjectBridge(page, directory, (request) => {
    if (fail && request.operation === 'write' && request.name === 'retry.txt') {
      fail = false;
      throw new Error('Simulated copy failure');
    }
  });
  try {
    await mkdir(assets, { recursive: true });
    const api = await layoutRuntime();
    await writeFile(path.join(root, 'Example.tcproject'), api.encodeProjectSettings({
      title: 'Project imports', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], entries: [],
    }));
    for (const name of ['Existing.txt', 'Replace.txt', 'Skip.txt'])
      await writeFile(path.join(assets, name), 'original ' + name);
    await page.goto(app.baseURL);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const sidebar = page.getByRole('region', { name: 'Projects', exact: true });
    await sidebar.getByRole('button', { name: 'Project', exact: true }).click();
    await expect(sidebar.getByText('Project imports', { exact: true })).toBeVisible();

    const transfer = await page.evaluateHandle(() => {
      const result = new DataTransfer();
      for (const name of ['existing.TXT', 'Replace.txt', 'Skip.txt', 'retry.txt'])
        result.items.add(new File(['imported ' + name], name, { type: 'text/plain' }));
      result.items.add(new File([], 'Samples'));
      function folder(name, ...children) {
        return {
          name,
          isDirectory: true,
          createReader() {
            let index = 0;
            return { readEntries: (done) => done(children[index] ? [children[index++]] : []) };
          },
        };
      }
      const getEntry = DataTransferItem.prototype.webkitGetAsEntry;
      DataTransferItem.prototype.webkitGetAsEntry = function () {
        return this.getAsFile()?.name === 'Samples' ? folder('Samples',
          folder('Empty'),
          folder('Measurements', {
            name: 'run.csv',
            isFile: true,
            file: (done) => done(new File(['part,size'], 'run.csv', { type: 'text/csv' })),
          }),
        ) : getEntry.call(this);
      };
      return result;
    });
    const row = sidebar.getByRole('listitem').filter({
      has: page.getByRole('button', { name: 'Assets', exact: true }),
    });
    await row.dispatchEvent('dragover', { dataTransfer: transfer });
    await expect(row).toHaveClass(/project-drop-target/);
    await expect(sidebar).not.toHaveClass(/project-drop-target/);
    await row.dispatchEvent('drop', { dataTransfer: transfer });
    const dialog = page.getByRole('dialog', { name: 'Add files…' });
    await expect(dialog.getByText('Destination Assets')).toBeVisible();
    await expect(dialog.getByText(/existing.TXT is already/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep both' }).click();
    await expect(dialog.getByText(/Replace.txt is already/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(dialog.getByText(/Skip.txt is already/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(dialog.getByRole('list', { name: 'Files that could not be imported' }))
      .toContainText('retry.txt — Simulated copy failure');
    await dialog.getByRole('button', { name: 'Retry failed files' }).click();
    await expect(dialog.getByRole('status')).toHaveText('4 files imported. 1 item skipped.');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    expect(await readFile(path.join(assets, 'Existing.txt'), 'utf8')).toBe('original Existing.txt');
    expect(await readFile(path.join(assets, 'existing (2).TXT'), 'utf8')).toBe('imported existing.TXT');
    expect(await readFile(path.join(assets, 'Replace.txt'), 'utf8')).toBe('imported Replace.txt');
    expect(await readFile(path.join(assets, 'Skip.txt'), 'utf8')).toBe('original Skip.txt');
    expect(await readFile(path.join(assets, 'retry.txt'), 'utf8')).toBe('imported retry.txt');
    expect(await readFile(path.join(assets, 'Samples', 'Measurements', 'run.csv'), 'utf8')).toBe('part,size');

    await sidebar.getByRole('button', { name: 'Project folder actions' }).click({ button: 'right' });
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Add files…' }).click();
    await (await choosing).setFiles([
      { name: 'Guide.md', mimeType: 'text/markdown', buffer: Buffer.from('Project guide') },
      { name: 'Datasheet.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture') },
    ]);
    await expect(dialog.getByRole('status')).toHaveText('2 files imported. 0 items skipped.');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sidebar.getByRole('button', { name: 'Guide.md', exact: true })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Datasheet.pdf', exact: true })).toBeVisible();
    expect(await readFile(path.join(root, 'Guide.md'), 'utf8')).toBe('Project guide');
    expect((api.decodeProjectSettings(await readFile(path.join(root, 'Example.tcproject')))).entries).toEqual([]);
    await sidebar.getByRole('button', { name: 'Assets', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Samples', exact: true }).click();
    await expect(sidebar.getByRole('button', { name: 'Empty', exact: true })).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reviews and commits project changes in the real Git index', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const fixture = await mkdtemp(path.join(info.project.outputDir, 'project-git-'));
  const repo = path.join(fixture, 'working');
  const remote = path.join(fixture, 'origin.git');
  const root = path.join(repo, 'Design');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    await mkdir(root, { recursive: true });
    git('init', '--bare', '-q', '-b', 'main', remote);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'tinycad@example.test');
    git('config', 'user.name', 'TinyCAD Tests');
    git('config', 'commit.gpgSign', 'false');
    const api = await layoutRuntime();
    await writeFile(path.join(root, 'Example.tcproject'), api.encodeProjectSettings({
      title: 'Git example', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], entries: [],
    }));
    const original = Array.from({ length: 20 }, (_, index) => `Line ${index + 1}\n`).join('');
    const note = path.join(root, 'Notes.md');
    await writeFile(note, original);
    await writeFile(path.join(repo, 'Outside.txt'), 'initial');
    git('add', '--all');
    git('commit', '-qm', 'Initial project');
    git('remote', 'add', 'origin', remote);
    git('push', '-qu', 'origin', 'main');
    await writeFile(note, original.replace('Line 2\n', 'First edit\n').replace('Line 18\n', 'Second edit\n'));
    await writeFile(path.join(repo, 'Outside.txt'), 'outside draft');
    await installProjectBridge(page, repo);
    await page.goto(app.baseURL);
    const activity = page.getByRole('group', { name: 'Project activity bar' });
    await activity.getByRole('button', { name: 'Projects', exact: true }).click();
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    await explorer.getByRole('button', { name: 'Design', exact: true }).click();
    await expect(explorer.getByText('Git example')).toBeVisible();
    await activity.getByRole('button', { name: 'Source Control', exact: true }).click();
    const source = page.getByRole('region', { name: 'Source Control', exact: true });
    await expect(source.getByRole('combobox', { name: 'Branch', exact: true })).toHaveValue('main');
    const working = source.getByRole('list', { name: 'Unstaged changes' });
    await expect(working.getByRole('listitem').filter({ hasText: 'Outside.txt' }))
      .toContainText('Outside project');
    await working.getByRole('button', { name: 'Design/Notes.md', exact: true }).click();
    const review = page.getByRole('region', { name: 'Git review' });
    await expect(review.getByRole('tab')).toHaveText('Changes to Design/Notes.md');
    await review.getByRole('button', { name: 'Stage hunk 1', exact: true }).click();
    const staged = source.getByRole('list', { name: 'Staged changes', exact: true });
    await expect(staged).toContainText('Design/Notes.md');
    await expect(working).toContainText('Design/Notes.md');
    expect(git('diff', '--cached')).toContain('+First edit');
    expect(git('diff', '--cached')).not.toContain('+Second edit');

    git('add', '--', 'Outside.txt');
    await source.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(staged).toContainText('Outside.txt');
    await source.getByRole('textbox', { name: 'Commit message' }).fill('Review first edit');
    await source.getByRole('button', { name: 'Review commit', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Commit staged changes' });
    await expect(confirmation.getByRole('list')).toContainText('Outside.txt · Outside project');
    await confirmation.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(git('log', '-1', '--format=%s').trim()).toBe('Review first edit');
    expect(git('diff')).toContain('+Second edit');

    await source.getByRole('button', { name: 'History', exact: true }).first().click();
    const history = page.getByRole('dialog', { name: 'Commit history' });
    await history.getByRole('button', { name: 'Review first edit' }).click();
    await expect(review.getByRole('tab')).toContainText('Review first edit');
    await expect(review.getByRole('tabpanel')).toContainText('+First edit');
    await expect(review.getByRole('tabpanel')).not.toContainText('outside draft');
    await review.getByRole('button', { name: 'Close Git review' }).click();
    await expect(source.getByRole('button', { name: '1 outgoing' })).toBeEnabled();
    await source.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(source.getByRole('button', { name: '0 outgoing' })).toBeDisabled();
    expect(git('--git-dir=' + remote, 'rev-parse', 'refs/heads/main')).toBe(git('rev-parse', 'HEAD'));
    expect(git('--git-dir=' + remote, 'show', 'main:Design/Notes.md'))
      .toBe(original.replace('Line 2\n', 'First edit\n'));
    expect(await readFile(note, 'utf8')).toContain('Second edit');

    await activity.getByRole('button', { name: 'Projects', exact: true }).click();
    await explorer.getByRole('button', { name: 'Example.tcproject', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Git file history', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'History · Design/Example.tcproject' }))
      .toContainText('Initial project');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('switches branches with clean linked editors and retains unsaved drawing edits', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'checkout-editors-'));
  const marker = path.join(root, 'Checkout.tcproject');
  const circuitPath = path.join(root, 'Circuit.dzn');
  const boardPath = path.join(root, 'Board.dpn');
  const auxiliaryPath = path.join(root, 'Auxiliary.dsn');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  let pending = marker;
  try {
    const api = await layoutRuntime();
    const drawing = api.blank();
    const auxiliary = api.blank();
    const board = api.createBoard('Main board', 2, [
      { x: 0, y: 0 }, { x: 2e6, y: 0 }, { x: 2e6, y: 2e6 }, { x: 0, y: 2e6 },
    ]);
    const saveDrawing = (name) => api.encodeDrawing({
      ...drawing, sheets: drawing.sheets.map((sheet) => ({ ...sheet, name })),
    }, 'zip-v1').then((bytes) => writeFile(circuitPath, bytes));
    const saveAuxiliary = async (name) => writeFile(auxiliaryPath, await api.encodeDrawing({
      ...auxiliary, sheets: auxiliary.sheets.map((sheet) => ({ ...sheet, name })),
    }, 'xml'));
    await saveDrawing('Main circuit');
    await saveAuxiliary('Main auxiliary');
    await writeFile(boardPath, await api.encodeBoard(board));
    const settings = {
      title: 'Checkout example', author: 'Main author', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], primarySchematic: drawing.documentId, primaryBoard: board.boardId,
      entries: [
        { kind: 'schematic', id: drawing.documentId, path: 'Circuit.dzn' },
        { kind: 'schematic', id: auxiliary.documentId, path: 'Auxiliary.dsn' },
        { kind: 'board', id: board.boardId, path: 'Board.dpn' },
      ],
    };
    await writeFile(marker, api.encodeProjectSettings(settings));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'tinycad@example.test');
    git('config', 'user.name', 'TinyCAD Tests');
    git('config', 'commit.gpgSign', 'false');
    git('add', '--all');
    git('commit', '-qm', 'Main project');
    git('switch', '-qc', 'revision');
    await saveDrawing('Revision circuit');
    await saveAuxiliary('Revision auxiliary');
    await writeFile(marker, api.encodeProjectSettings({ ...settings, author: 'Revision author' }));
    await writeFile(boardPath, await api.encodeBoard({
      ...board, title: 'Revision board', copperLayers: board.copperLayers.slice(0, 1),
    }));
    git('commit', '-qam', 'Revision project');
    git('switch', '-q', 'main');
    await installProjectBridge(page, root, undefined, () => {
      const file = pending;
      pending = undefined;
      return file;
    });
    await page.goto(app.baseURL + '?project=1');
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    await explorer.getByRole('button', { name: 'Open schematic', exact: true }).click();
    const sheetName = () => page.evaluate(() => window.layoutTest.snapshot().drawing.sheets[0].name);
    await expect.poll(sheetName).toBe('Main circuit');
    await explorer.getByRole('button', { name: 'Auxiliary.dsn', exact: true }).click();
    await expect.poll(sheetName).toBe('Main auxiliary');
    await page.getByRole('tab', { name: 'Circuit.dzn', exact: true }).click();
    await explorer.getByRole('button', { name: 'Board.dpn', exact: true }).click();
    const layout = page.getByRole('region', { name: 'PCB layout' });
    await clickPcbCommand(layout, 'View board tools');
    await expect(layout.getByLabel('Copper layers')).toHaveValue('2');
    await page.getByRole('tab', { name: 'Circuit.dzn', exact: true }).click();

    await explorer.getByRole('button', { name: 'Project Settings…', exact: true }).click();
    const author = page.getByRole('textbox', { name: 'Author', exact: true });
    await expect(author).toHaveValue('Main author');
    const activity = page.getByRole('group', { name: 'Project activity bar' });
    await activity.getByRole('button', { name: 'Source Control', exact: true }).click();
    const source = page.getByRole('region', { name: 'Source Control', exact: true });
    const branch = source.getByRole('combobox', { name: 'Branch', exact: true });
    await branch.selectOption('revision');
    const switching = page.getByRole('dialog', { name: 'Switch branch' });
    await switching.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(branch).toHaveValue('revision');
    await expect.poll(sheetName).toBe('Revision circuit');
    await expect(author).toHaveValue('Revision author');
    await page.getByRole('tab', { name: 'Auxiliary.dsn', exact: true }).click();
    await expect.poll(sheetName).toBe('Revision auxiliary');
    await page.getByRole('tab', { name: 'Circuit.dzn', exact: true }).click();
    await page.getByRole('tab', { name: 'Board.dpn', exact: true }).click();
    await clickPcbCommand(layout, 'View board tools');
    await expect(layout.getByLabel('Copper layers')).toHaveValue('1');
    await page.getByRole('tab', { name: 'Circuit.dzn', exact: true }).click();

    await page.evaluate(() => window.layoutTest.renameCurrentSheet('Retained edit'));
    await page.getByRole('tab', { name: 'Checkout.tcproject', exact: true }).click();
    await author.fill('Retained author');
    await branch.selectOption('main');
    await switching.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(branch).toHaveValue('revision');
    expect(await sheetName()).toBe('Retained edit');
    await branch.selectOption('main');
    await switching.getByRole('button', { name: 'Retain edits and continue' }).click();
    await expect(branch).toHaveValue('main');
    expect(await sheetName()).toBe('Retained edit');
    await expect(author).toHaveValue('Retained author');
    expect(api.decodeProjectSettings(await readFile(marker)).author).toBe('Main author');
    expect((await api.decodeDrawing(await readFile(circuitPath))).sheets[0].name).toBe('Main circuit');
    await expect(source.getByText('Open project files have unsaved edits.')).toBeVisible();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolves text and native board conflicts through Source Control', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'git-merge-editors-'));
  const marker = path.join(root, 'Merge.tcproject');
  const boardPath = path.join(root, 'Board.dpn');
  const notesPath = path.join(root, 'Notes.md');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let pending = marker;
  try {
    const api = await layoutRuntime();
    const board = api.createBoard('Base board', 2, [
      { x: 0, y: 0 }, { x: 2e6, y: 0 }, { x: 2e6, y: 2e6 }, { x: 0, y: 2e6 },
    ]);
    const incoming = await api.encodeBoard({
      ...board, title: 'Incoming board', copperLayers: board.copperLayers.slice(0, 1),
    });
    await writeFile(marker, api.encodeProjectSettings({
      title: 'Merge example', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], primaryBoard: board.boardId,
      entries: [{ kind: 'board', id: board.boardId, path: 'Board.dpn' }],
    }));
    await writeFile(boardPath, await api.encodeBoard(board));
    await writeFile(notesPath, 'Base notes\n');
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'tinycad@example.test');
    git('config', 'user.name', 'TinyCAD Tests');
    git('config', 'commit.gpgSign', 'false');
    git('add', '--all');
    git('commit', '-qm', 'Base project');
    git('switch', '-qc', 'incoming');
    await writeFile(boardPath, incoming);
    await writeFile(notesPath, 'Incoming notes\n');
    git('commit', '-qam', 'Incoming edits');
    git('switch', '-q', 'main');
    await writeFile(boardPath, await api.encodeBoard({ ...board, title: 'Current board' }));
    await writeFile(notesPath, 'Current notes\n');
    git('commit', '-qam', 'Current edits');
    expect(() => git('merge', 'incoming')).toThrow();

    await installProjectBridge(page, root, undefined, () => {
      const selected = pending;
      pending = undefined;
      return selected;
    });
    await page.goto(app.baseURL + '?project=1');
    const activity = page.getByRole('group', { name: 'Project activity bar' });
    await activity.getByRole('button', { name: 'Source Control', exact: true }).click();
    const source = page.getByRole('region', { name: 'Source Control', exact: true });
    const conflicts = source.getByRole('list', { name: 'Conflicts', exact: true });
    await conflicts.getByRole('button', { name: 'Notes.md', exact: true }).click();

    const merge = page.getByRole('dialog', { name: 'Resolve Notes.md', exact: true });
    await expect(merge.getByRole('region', { name: 'Base', exact: true })).toContainText('Base notes');
    await expect(merge.getByRole('region', { name: 'Current', exact: true })).toContainText('Current notes');
    await expect(merge.getByRole('region', { name: 'Incoming', exact: true })).toContainText('Incoming notes');
    await merge.getByRole('textbox', { name: 'Merged result' }).fill('Combined notes\n');
    await merge.getByRole('button', { name: 'Stage merged result' }).click();
    await expect(merge).toHaveCount(0);
    expect(git('show', ':Notes.md')).toBe('Combined notes\n');

    await conflicts.getByRole('button', { name: 'Board.dpn', exact: true }).click();
    const wholeBoard = page.getByRole('dialog', { name: 'Resolve Board.dpn', exact: true });
    await expect(wholeBoard.getByRole('region', { name: 'Incoming', exact: true })).toContainText('Incoming board');
    await expect(wholeBoard.getByRole('textbox', { name: 'Merged result' })).toHaveCount(0);
    await wholeBoard.getByRole('button', { name: 'Use incoming version' }).click();
    await expect(wholeBoard).toHaveCount(0);
    await expect(conflicts).toHaveCount(0);
    expect(await readFile(boardPath)).toEqual(Buffer.from(incoming));
    expect(git('ls-files', '-u')).toBe('');

    await activity.getByRole('button', { name: 'Projects', exact: true }).click();
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    await explorer.getByRole('button', { name: 'Board.dpn', exact: true }).click();
    await expect(page.getByRole('region', { name: 'PCB layout' }).getByLabel('Copper layers')).toHaveValue('1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function projectDatasheetFixture() {
  const content = '0 0 1 rg 0 0 72 72 re f\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 5 0 R >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  pdf += offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

test('edits project file tabs, views a datasheet and reports a partial Save All', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'file-tabs-'));
  const marker = path.join(root, 'Tabs.tcproject');
  const circuit = path.join(root, 'Circuit.dzn');
  const boardPath = path.join(root, 'Board.dpn');
  let pending = marker;
  try {
    const api = await layoutRuntime();
    const drawing = api.blank();
    const board = api.createBoard('Project board', 2, [
      { x: 0, y: 0 }, { x: 2e6, y: 0 }, { x: 2e6, y: 2e6 }, { x: 0, y: 2e6 },
    ]);
    const recipe = { id: crypto.randomUUID(), kind: 'bom', schematic: drawing.documentId, directory: 'outputs', filename: 'BOM.csv' };
    const initialSettings = {
      title: 'File tabs', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], primarySchematic: drawing.documentId, primaryBoard: board.boardId,
      entries: [
        { kind: 'schematic', id: drawing.documentId, path: 'Circuit.dzn' },
        { kind: 'board', id: board.boardId, path: 'Board.dpn' },
      ],
      outputRecipes: [recipe],
      associations: [{ schematic: drawing.documentId, board: board.boardId }],
    };
    await writeFile(marker, api.encodeProjectSettings(initialSettings));
    await writeFile(circuit, await api.encodeDrawing(drawing, 'zip-v1'));
    await writeFile(boardPath, await api.encodeBoard(board));
    await writeFile(path.join(root, 'Notes.md'), '\ufeff# Notes\r\n');
    await writeFile(path.join(root, 'BOM.csv'), 'ref,value\r\nR1,330\r\n');
    await writeFile(path.join(root, 'Vendor.pdf'), projectDatasheetFixture());
    await writeFile(path.join(root, 'Figure.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>');
    await installProjectBridge(page, root, undefined, () => {
      const choice = pending;
      pending = undefined;
      return choice;
    });
    await page.goto(app.baseURL + '?project=1');
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    const tabs = page.getByRole('tablist', { name: 'Project files', exact: true });
    await explorer.getByRole('button', { name: 'Open schematic', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.layoutTest.snapshot().drawing.documentId)).toBe(drawing.documentId);
    await page.evaluate(() => window.layoutTest.renameCurrentSheet('Unsaved circuit'));
    await explorer.getByRole('button', { name: 'Board.dpn', exact: true }).click();
    const boardEditor = page.getByRole('region', { name: 'PCB layout' });
    await clickPcbCommand(boardEditor, 'View board tools');
    await boardEditor.getByLabel('Copper layers').selectOption('1');

    await explorer.getByRole('button', { name: 'Notes.md', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit Notes.md' }).fill('# Updated notes\nLine two\n');
    await page.getByRole('button', { name: 'Preview Markdown' }).click();
    await expect(page.getByRole('heading', { name: 'Updated notes' })).toBeVisible();
    await explorer.getByRole('button', { name: 'BOM.csv', exact: true }).click();
    const csv = page.getByRole('textbox', { name: 'Edit BOM.csv' });
    await csv.fill('ref,value\nR1,470\n');
    await tabs.getByRole('tab', { name: 'Notes.md *', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Updated notes' })).toBeVisible();
    await explorer.getByRole('button', { name: 'Figure.svg', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Figure.svg', exact: true })).toBeVisible();
    await explorer.getByRole('button', { name: 'Vendor.pdf', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Page 1 of 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    const canvas = page.getByRole('img', { name: 'Vendor.pdf, page 2' });
    await expect.poll(() => canvas.evaluate((element) =>
      Array.from(element.getContext('2d').getImageData(10, 10, 1, 1).data),
    )).toEqual([0, 0, 255, 255]);

    await explorer.getByRole('button', { name: 'Project Settings…', exact: true }).click();
    const metadata = page.getByRole('tabpanel', { name: 'Tabs.tcproject', exact: true });
    await expect(metadata.getByRole('textbox', { name: 'Project name' })).toHaveValue('File tabs');
    await metadata.getByRole('textbox', { name: 'Project name' }).fill('  Amplifier & test  ');
    await metadata.getByRole('textbox', { name: 'Author' }).fill('  Alex & Jo  ');
    await metadata.getByRole('combobox', { name: 'Primary PCB' }).selectOption('');
    await expect(tabs.getByRole('tab', { name: 'Tabs.tcproject *', exact: true })).toBeVisible();

    await writeFile(path.join(root, 'BOM.csv'), 'external version');
    await page.getByRole('button', { name: 'Save All', exact: true }).click();
    const summary = page.getByRole('dialog', { name: 'Save All', exact: true });
    const saved = summary.getByRole('list', { name: 'Saved files' });
    await expect(saved).toContainText('Notes.md');
    await expect(saved).toContainText('Board.dpn');
    await expect(saved).toContainText('Circuit.dzn');
    await expect(saved).toContainText('Tabs.tcproject');
    await expect(summary.getByRole('list', { name: 'Files still needing attention' })).toContainText('BOM.csv');
    await summary.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await readFile(path.join(root, 'Notes.md'), 'utf8')).toBe('\ufeff# Updated notes\r\nLine two\r\n');
    expect(await readFile(path.join(root, 'BOM.csv'), 'utf8')).toBe('external version');
    expect((await api.decodeDrawing(await readFile(circuit))).sheets[0].name).toBe('Unsaved circuit');
    expect((await api.decodeBoard(await readFile(boardPath))).copperLayers).toHaveLength(1);
    const storedSettings = api.decodeProjectSettings(await readFile(marker));
    const { primaryBoard, ...remainingSettings } = initialSettings;
    expect(storedSettings).toEqual({
      ...remainingSettings,
      title: 'Amplifier & test',
      author: 'Alex & Jo',
      entries: [...initialSettings.entries].sort((a, b) => a.path.localeCompare(b.path)),
    });
    await expect(explorer.getByText('Amplifier & test', { exact: true })).toBeVisible();
    await expect(metadata.getByRole('textbox', { name: 'Project name' })).toHaveValue('Amplifier & test');
    await metadata.getByRole('textbox', { name: 'Author' }).fill('Retained author draft');
    await writeFile(marker, api.encodeProjectSettings({ ...storedSettings, author: 'External author' }));
    await page.getByRole('button', { name: 'Save file', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'changed on disk' })).toBeVisible();
    await expect(metadata.getByRole('textbox', { name: 'Author' })).toHaveValue('Retained author draft');
    expect(api.decodeProjectSettings(await readFile(marker)).author).toBe('External author');

    await tabs.getByRole('tab', { name: 'BOM.csv *', exact: true }).click();
    await expect(csv).toHaveValue('ref,value\nR1,470\n');
    await tabs.getByRole('button', { name: 'Close BOM.csv', exact: true }).click();
    const choosing = page.getByRole('dialog', { name: 'Close BOM.csv' });
    await choosing.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(csv).toBeVisible();
    await explorer.getByRole('button', { name: 'Project folder actions' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New file…', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'New file…' });
    await create.getByRole('textbox', { name: 'Name' }).fill('Build.txt');
    await create.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit Build.txt' }).fill('Assembly instructions\n');
    await page.evaluate(() => window.hierarchyTestMenu('file-save'));
    await expect.poll(() => readFile(path.join(root, 'Build.txt'), 'utf8')).toBe('Assembly instructions\n');
  } finally {
    await page.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('maps system wires and generates separate outputs for boards sharing a source', async ({ page }, info) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  await mkdir(info.project.outputDir, { recursive: true });
  const workspace = await mkdtemp(path.join(info.project.outputDir, 'system-wiring-'));
  const root = path.join(workspace, 'Original');
  const copy = path.join(workspace, 'Copied');
  const marker = path.join(root, 'System.tcproject');
  let pending = marker;
  try {
    const api = await layoutRuntime();
    const fixture = new URL('../../../examples/pcb/led-classroom/Reference/', import.meta.url);
    const main = await api.decodeBoard(await readFile(new URL('LED.dpn', fixture)));
    const sensor = { ...main, boardId: crypto.randomUUID(), title: 'Sensor PCB' };
    const source = await api.decodeDrawing(await readFile(new URL('LED.dzn', fixture)));
    const circuitSheet = source.sheets[0];
    source.sheets = [{
      ...circuitSheet,
      items: circuitSheet.items.map((item) => item.NodeName === 'symbol' ? {
        ...item, text: item.text.map((field) =>
          field.description === 'Value' && field.value === '330' ? { ...field, value: '470' } : field,
        ),
      } : item),
    }];
    const system = {
      ...source, documentId: crypto.randomUUID(),
      sheets: [{ ...circuitSheet, id: crypto.randomUUID(), name: 'Connections', items: [], symbols: {} }],
    };
    const mainPath = path.join(root, 'Main/Board.dpn');
    const sensorPath = path.join(root, 'Sensor/Board.dpn');
    const systemPath = path.join(root, 'System.dsn');
    const mainBytes = await api.encodeBoard(main);
    const sensorBytes = await api.encodeBoard(sensor);
    await mkdir(path.join(root, 'Main'), { recursive: true });
    await mkdir(path.join(root, 'Sensor'));
    await writeFile(mainPath, mainBytes);
    await writeFile(sensorPath, sensorBytes);
    await writeFile(systemPath, await api.encodeDrawing(system, 'xml'));
    await writeFile(path.join(root, 'Main/Circuit.dsn'), await api.encodeDrawing(source, 'xml'));
    const settings = {
      title: 'System wiring', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], primarySchematic: system.documentId,
      entries: [
        { kind: 'schematic', id: system.documentId, path: 'System.dsn' },
        { kind: 'schematic', id: source.documentId, path: 'Main/Circuit.dsn' },
        { kind: 'board', id: main.boardId, path: 'Main/Board.dpn' },
        { kind: 'board', id: sensor.boardId, path: 'Sensor/Board.dpn' },
      ],
      associations: [main, sensor].map(({ boardId }) => ({ schematic: source.documentId, board: boardId })),
    };
    expect(() => api.encodeProjectSettings({
      ...settings, entries: [...settings.entries.slice(0, -1), { ...settings.entries.at(-1), path: 'Main/Other.dpn' }],
    })).toThrow('Only one active PCB');
    await writeFile(marker, api.encodeProjectSettings(settings));
    await installProjectBridge(page, workspace, undefined, () => {
      const result = pending;
      pending = undefined;
      return result;
    });
    await page.goto(app.baseURL + '?project=1');
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    const panel = page.getByRole('region', { name: 'Schematic hierarchy' });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const tabs = page.getByRole('tablist', { name: 'Project files', exact: true });
    const snapshot = () => page.evaluate(() => window.layoutTest.snapshot());
    const active = async () => {
      const state = await snapshot();
      return state.drawing.sheets[state.sheet];
    };
    const point = (event, coords) => page.evaluate(
      ([event, coords]) => window.layoutTest.pointer(event, coords), [event, coords],
    );
    const folder = (name) => explorer.getByRole('button', { name, exact: true }).click();
    await folder('System.dsn');
    await expect(tabs.getByRole('tab', { name: 'System.dsn', exact: true })).toBeVisible();
    await folder('Main');
    await folder('Circuit.dsn');
    await panel.getByRole('button', { name: 'Add hierarchical symbol' }).click();
    await expect.poll(async () => (await active()).hierarchicalSymbol).toBe(true);
    await page.getByRole('button', { name: 'Pin', exact: true }).click();
    await point('lbuttondown', [225, 225]);
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('SIGNAL');
    await expect.poll(async () => (await active()).items.find((item) => item.NodeName === 'pin')?.name).toBe('SIGNAL');
    await save.click();
    await expect(save).toBeDisabled();
    await tabs.getByRole('tab', { name: 'System.dsn', exact: true }).click();

    const place = async (board, position) => {
      await explorer.getByRole('button', { name: 'Board.dpn', exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Place board instance', exact: true }).click();
      await expect.poll(async () => (await snapshot()).adding?.hierarchy?.boardInstance?.boardId).toBe(board.boardId);
      await point('lbuttondown', position);
      await expect.poll(async () => (await active()).items.some((item) => item.hierarchy?.boardInstance?.boardId === board.boardId)).toBe(true);
    };
    await place(main, [400, 400]);
    await folder('Main');
    await folder('Sensor');
    await place(sensor, [650, 400]);
    const placements = (await active()).items.filter((item) => item.hierarchy?.boardInstance);
    expect(placements.map((item) => item.text.find(({ description }) => description === 'Name')?.value))
      .toEqual(['Main/Board.dpn', 'Sensor/Board.dpn']);
    const [first, second] = placements.map((item) => new api.updateSymbol(item).active_points()[0].slice(0, 2));
    await page.evaluate(() => window.layoutTest.command('add_wire_point_to_point'));
    await point('lbuttondown', first);
    await point('mousemove', second);
    await point('lbuttondown', second);
    await expect.poll(async () => (await active()).items.some((item) => item.NodeName === 'wire')).toBe(true);
    const reviewButton = panel.getByRole('button', { name: 'Review system connections…' });
    const review = page.getByRole('dialog', { name: 'System connections' });
    await reviewButton.click();
    await expect(review.getByRole('list', { name: 'System connection findings' })).toContainText('H1 · SIGNAL: map this port');
    await review.getByRole('button', { name: 'Close' }).click();
    for (const [index, placement] of placements.entries()) {
      await page.evaluate((id) => window.layoutTest.selectItem(id), placement._id);
      await panel.getByRole('button', { name: 'Map board ports…' }).click();
      const mapping = page.getByRole('dialog', { name: 'Map board ports' });
      await mapping.getByRole('combobox', { name: 'Map SIGNAL' }).selectOption({
        label: index === 0 ? 'J1 · 1 · +5 V · Pads 1' : 'J1 · 2 · 0 V · Pads 2',
      });
      await mapping.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(mapping).toBeHidden();
    }
    await save.click();
    await expect(save).toBeDisabled();
    const saved = await api.decodeDrawing(await readFile(systemPath));
    const bindings = saved.sheets[0].items.filter((item) => item.hierarchy).map(({ hierarchy }) => hierarchy.boardInstance);
    const connector = main.appliedCircuit.components.find(({ reference }) => reference === 'J1');
    expect(bindings.map(({ boardId, ports }) => [boardId, ports[0].componentId, ports[0].signalId])).toEqual([
      [main.boardId, connector.id, connector.signals[0].id],
      [sensor.boardId, connector.id, connector.signals[1].id],
    ]);
    await expect(api.buildHierarchicalNetlist({ path: 'System.dsn', drawing: saved }, async () => {
      throw new Error('A board instance cannot be expanded');
    })).rejects.toThrow('Compile the source schematic of the individual PCB');
    pending = marker;
    await page.reload();
    await folder('System.dsn');
    await reviewButton.click();
    await expect(review.getByRole('list', { name: 'System connection findings' })).toHaveCount(0);
    const network = review.getByRole('list', { name: 'System nets' }).locator(':scope > li');
    await expect(network).toHaveCount(1);
    await expect(network).toContainText('H1 · SIGNAL · Main/Board.dpn · J1 · 1 · +5 V · Pads 1');
    await expect(network).toContainText('H2 · SIGNAL · Sensor/Board.dpn · J1 · 2 · 0 V · Pads 2');
    await review.getByRole('button', { name: 'Close' }).click();

    await folder('Main');
    await explorer.getByRole('button', { name: 'Circuit.dsn', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Update PCB from Schematic… · Sensor/Board.dpn', exact: true }).click();
    const eco = page.getByRole('dialog', { name: 'Update PCB from Schematic' });
    await expect(eco).toContainText('Main/Circuit.dsn → Sensor/Board.dpn');
    await eco.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(eco).toBeHidden();
    const sensorUpdated = await api.decodeBoard(await readFile(sensorPath));
    expect(sensorUpdated.components.find(({ reference }) => reference === 'R1').value).toBe('470');
    expect(await readFile(mainPath)).toEqual(Buffer.from(mainBytes));
    expect(sensorUpdated.tracks).toEqual(sensor.tracks);

    const outputDialog = page.getByRole('dialog', { name: 'Project outputs' });
    const outputFolder = outputDialog.getByRole('textbox', { name: 'Output folder' });
    const runOutput = async (target) => {
      await outputDialog.getByRole('listitem').filter({ hasText: target })
        .getByRole('button', { name: 'Run', exact: true }).click();
      await expect(outputDialog.getByRole('status')).toHaveText('Generated ' + target);
    };
    for (const [directory, board] of [['Main', main], ['Sensor', sensor]]) {
      if (directory === 'Sensor') {
        await folder('Main');
        await folder(directory);
      }
      await explorer.getByRole('button', { name: 'Board.dpn', exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Configure PCB outputs…' }).click();
      await outputDialog.getByRole('button', { name: 'Add netlist recipe' }).click();
      const circuitSource = outputDialog.getByRole('combobox', { name: 'Circuit source' });
      await expect(circuitSource).toHaveValue('board:' + board.boardId);
      await expect(outputFolder).toHaveValue(directory + '/outputs');
      await circuitSource.selectOption('schematic:' + source.documentId);
      await expect(outputFolder).toHaveValue('outputs');
      await circuitSource.selectOption('board:' + board.boardId);
      await expect(outputFolder).toHaveValue(directory + '/outputs');
      await outputDialog.getByRole('button', { name: 'Save recipe' }).click();
      await runOutput(directory + '/outputs/circuit.net');
      await outputDialog.getByRole('button', { name: 'Add PCB output recipe' }).click();
      await expect(outputDialog.getByLabel('Source PCB').locator('option:checked')).toHaveText(directory + '/Board.dpn');
      await expect(outputFolder).toHaveValue(directory + '/outputs/pcb');
      const bomFolder = directory === 'Sensor' ? 'Sensor/assembly' : 'Main/outputs/pcb';
      await outputFolder.fill(bomFolder);
      await outputDialog.getByRole('button', { name: 'Save recipe' }).click();
      await runOutput(bomFolder + '/bom.csv');
      await outputDialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
    const output = (target) => readFile(path.join(root, target), 'utf8');
    const firstNet = await output('Main/outputs/circuit.net');
    expect(firstNet).toContain('J1.1');
    expect(await output('Sensor/outputs/circuit.net')).toBe(firstNet);
    const manifests = await Promise.all(['Main', 'Sensor'].map(async (directory) =>
      JSON.parse(await output(directory + '/outputs/circuit.net.manifest.json')),
    ));
    expect(manifests.map(({ sources }) => Object.keys(sources))).toEqual([['Main/Circuit.dsn'], ['Main/Circuit.dsn']]);
    expect(manifests[0].recipeDigest).not.toBe(manifests[1].recipeDigest);
    expect(await output('Main/outputs/pcb/bom.csv')).toContain('"R1","1","330"');
    expect(await output('Sensor/assembly/bom.csv')).toContain('"R1","1","470"');
    const recipes = api.decodeProjectSettings(await readFile(marker)).outputRecipes;
    expect(recipes.filter(({ kind }) => kind === 'netlist')).toEqual(expect.arrayContaining([
      expect.objectContaining({ board: main.boardId, directory: 'Main/outputs' }),
      expect.objectContaining({ board: sensor.boardId, directory: 'Sensor/outputs' }),
    ]));
    expect(recipes.filter(({ kind }) => kind === 'netlist').every(({ schematic }) => schematic === undefined)).toBe(true);

    await cp(root, copy, { recursive: true });
    const targets = recipes.map(({ directory, filename }) => directory + '/' + filename);
    for (const target of targets) await rm(path.join(copy, target));
    pending = path.join(copy, 'System.tcproject');
    await page.reload();
    await folder('System.dsn');
    await reviewButton.click();
    await expect(network).toHaveCount(1);
    await expect(network).toContainText('Main/Board.dpn · J1 · 1 · +5 V · Pads 1');
    await expect(network).toContainText('Sensor/Board.dpn · J1 · 2 · 0 V · Pads 2');
    await review.getByRole('button', { name: 'Close' }).click();
    await explorer.getByRole('button', { name: 'Project outputs…', exact: true }).click();
    for (const target of targets) {
      await runOutput(target);
      expect(await readFile(path.join(copy, target), 'utf8')).toBe(await output(target));
      expect(await readFile(path.join(copy, target + '.manifest.json'), 'utf8')).toBe(
        await output(target + '.manifest.json'),
      );
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('updates a daughterboard from its own source without changing the motherboard', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'separate-board-sources-'));
  try {
    const api = await layoutRuntime();
    const examples = new URL('../../../examples/pcb/', import.meta.url);
    for (const [folder, fixture, name] of [
      ['Main', 'led-classroom/Reference', 'LED'],
      ['Sensor', 'op-amp-filter', 'Filter'],
    ]) {
      await mkdir(path.join(root, folder));
      for (const extension of ['.dpn', '.dzn']) {
        const filename = name + extension;
        await cp(new URL(fixture + '/' + filename, examples), path.join(root, folder, filename));
      }
    }
    const mainPath = path.join(root, 'Main/LED.dpn');
    const sensorPath = path.join(root, 'Sensor/Filter.dpn');
    const sourcePath = path.join(root, 'Sensor/Filter.dzn');
    const mainBytes = await readFile(mainPath);
    const main = await api.decodeBoard(mainBytes);
    const sensor = await api.decodeBoard(await readFile(sensorPath));
    const mainSource = await api.decodeDrawing(await readFile(path.join(root, 'Main/LED.dzn')));
    const sensorSource = await api.decodeDrawing(await readFile(sourcePath));
    const resistor = sensorSource.sheets.flatMap(({ items }) => items).find((item) =>
      item.NodeName === 'symbol' && item.text.some(({ description, value }) => description === 'Ref' && value === 'R1'),
    );
    resistor.text.find(({ description }) => description === 'Value').value = '12k';
    await writeFile(sourcePath, await api.encodeDrawing(sensorSource, 'zip-v1'));

    const marker = path.join(root, 'Two boards.tcproject');
    await writeFile(marker, api.encodeProjectSettings({
      title: 'Two boards', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(), requiredFeatures: [],
      entries: [
        { kind: 'schematic', id: mainSource.documentId, path: 'Main/LED.dzn' },
        { kind: 'board', id: main.boardId, path: 'Main/LED.dpn' },
        { kind: 'schematic', id: sensorSource.documentId, path: 'Sensor/Filter.dzn' },
        { kind: 'board', id: sensor.boardId, path: 'Sensor/Filter.dpn' },
      ],
      associations: [
        { schematic: mainSource.documentId, board: main.boardId },
        { schematic: sensorSource.documentId, board: sensor.boardId },
      ],
    }));
    let pending = marker;
    await installProjectBridge(page, root, undefined, () => {
      const opened = pending;
      pending = undefined;
      return opened;
    });
    await page.goto(app.baseURL + '?project=1');
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    await explorer.getByRole('button', { name: 'Sensor', exact: true }).click();
    await explorer.getByRole('button', { name: 'Filter.dzn', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Update PCB from Schematic…', exact: true }).click();

    const eco = page.getByRole('dialog', { name: 'Update PCB from Schematic' });
    await expect(eco).toContainText('Sensor/Filter.dzn → Sensor/Filter.dpn');
    await eco.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(eco).toBeHidden();
    const updated = await api.decodeBoard(await readFile(sensorPath));
    expect(updated.components.find(({ reference }) => reference === 'R1').value).toBe('12k');
    expect(updated.tracks).toEqual(sensor.tracks);
    expect(updated.footprints).toEqual(sensor.footprints);
    expect(await readFile(mainPath)).toEqual(mainBytes);

    const outputDialog = page.getByRole('dialog', { name: 'Project outputs' });
    for (const [folder, name] of [['Sensor', 'Filter'], ['Main', 'LED']]) {
      if (folder === 'Main') {
        await explorer.getByRole('button', { name: 'Sensor', exact: true }).click();
        await explorer.getByRole('button', { name: folder, exact: true }).click();
      }
      await explorer.getByRole('button', { name: name + '.dpn', exact: true }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Configure PCB outputs…' }).click();
      await outputDialog.getByRole('button', { name: 'Add netlist recipe' }).click();
      await outputDialog.getByRole('button', { name: 'Save recipe' }).click();
      const target = folder + '/outputs/circuit.net';
      await outputDialog.getByRole('listitem').filter({ hasText: target })
        .getByRole('button', { name: 'Run', exact: true }).click();
      await expect(outputDialog.getByRole('status')).toHaveText('Generated ' + target);
      const manifest = JSON.parse(await readFile(path.join(root, target + '.manifest.json'), 'utf8'));
      expect(Object.keys(manifest.sources)).toEqual([folder + '/' + name + '.dzn']);
      await outputDialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps independent PCB tabs and saves edits on inactive boards', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'board-tabs-'));
  const marker = path.join(root, 'Boards.tcproject');
  let pending = marker;
  try {
    const api = await layoutRuntime();
    const points = [{ x: 0, y: 0 }, { x: 3e6, y: 0 }, { x: 3e6, y: 3e6 }, { x: 0, y: 3e6 }];
    const power = api.createBoard('Power', 2, points);
    const sensor = api.createBoard('Sensor', 2, points);
    const loose = api.createBoard('Loose', 2, points);
    await mkdir(path.join(root, 'Power'));
    await mkdir(path.join(root, 'Sensor'));
    await writeFile(path.join(root, 'Power', 'Board.dpn'), await api.encodeBoard(power));
    await writeFile(path.join(root, 'Sensor', 'Board.dpn'), await api.encodeBoard(sensor));
    await writeFile(path.join(root, 'Loose.dpn'), await api.encodeBoard(loose));
    const entries = [
      { kind: 'board', id: power.boardId, path: 'Power/Board.dpn' },
      { kind: 'board', id: sensor.boardId, path: 'Sensor/Board.dpn' },
    ];
    await writeFile(marker, api.encodeProjectSettings({
      title: 'Two boards', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], entries, primaryBoard: power.boardId,
    }));

    await installProjectBridge(page, root, undefined, () => {
      const result = pending;
      pending = undefined;
      return result;
    });
    await page.goto(app.baseURL + '?project=1');
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    const layout = page.getByRole('region', { name: 'PCB layout', exact: true });
    const tabs = page.getByRole('tablist', { name: 'Project files', exact: true });
    const layers = layout.getByLabel('Copper layers');

    await explorer.getByRole('button', { name: 'Power', exact: true }).click();
    await explorer.getByRole('button', { name: 'Board.dpn', exact: true }).click();
    await clickPcbCommand(layout, 'View board tools');
    await layers.selectOption('1');
    await expect(tabs.getByRole('tab', { name: 'Power/Board.dpn *', exact: true })).toBeVisible();
    await explorer.getByRole('button', { name: 'Power', exact: true }).click();
    await explorer.getByRole('button', { name: 'Sensor', exact: true }).click();
    await explorer.getByRole('button', { name: 'Board.dpn', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Sensor/Board.dpn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await clickPcbCommand(layout, 'View board tools');
    await expect(layers).toHaveValue('2');
    await layers.selectOption('1');

    await tabs.getByRole('tab', { name: 'Power/Board.dpn *', exact: true }).click();
    await clickPcbCommand(layout, 'View board tools');
    await expect(layers).toHaveValue('1');
    await layout.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(layers).toHaveValue('2');
    await layout.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(layers).toHaveValue('1');
    await tabs.getByRole('tab', { name: 'Sensor/Board.dpn *', exact: true }).click();
    await clickPcbCommand(layout, 'View board tools');
    await expect(layers).toHaveValue('1');
    await page.getByRole('button', { name: 'Save All', exact: true }).click();
    const summary = page.getByRole('dialog', { name: 'Save All', exact: true });
    const saved = summary.getByRole('list', { name: 'Saved files', exact: true });
    await expect(saved).toContainText('Power/Board.dpn');
    await expect(saved).toContainText('Sensor/Board.dpn');
    await summary.getByRole('button', { name: 'Close', exact: true }).click();
    for (const entry of entries)
      expect((await api.decodeBoard(await readFile(path.join(root, entry.path)))).copperLayers).toHaveLength(1);

    await tabs.getByRole('tab', { name: 'Power/Board.dpn', exact: true }).click();
    await clickPcbCommand(layout, 'View board tools');
    await layers.selectOption('2');
    await tabs.getByRole('button', { name: 'Close Power/Board.dpn', exact: true }).click();
    const close = page.getByRole('dialog', { name: 'Close Power/Board.dpn', exact: true });
    await close.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(layers).toHaveValue('2');
    await tabs.getByRole('button', { name: 'Close Power/Board.dpn', exact: true }).click();
    await close.getByRole('button', { name: 'Discard and close', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Sensor/Board.dpn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: /Power\/Board\.dpn/ })).toHaveCount(0);
    expect((await api.decodeBoard(await readFile(path.join(root, 'Power', 'Board.dpn')))).copperLayers).toHaveLength(1);

    await explorer.getByRole('button', { name: 'Sensor', exact: true }).click();
    await explorer.getByRole('button', { name: 'Loose.dpn', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Loose.dpn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await clickPcbCommand(layout, 'View board tools');
    await layers.selectOption('1');
    await layout.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Loose.dpn', exact: true })).toBeVisible();
    expect((await api.decodeBoard(await readFile(path.join(root, 'Loose.dpn')))).copperLayers).toHaveLength(1);
    expect(api.decodeProjectSettings(await readFile(marker)).entries).toEqual(entries);

    await tabs.getByRole('tab', { name: 'Sensor/Board.dpn', exact: true }).click();
    await clickPcbCommand(layout, 'View board tools');
    await layers.selectOption('2');
    await tabs.getByRole('tab', { name: 'Loose.dpn', exact: true }).click();
    await page.evaluate(() => window.hierarchyTestMenu('file-close-project'));
    const projectClose = page.getByRole('dialog', { name: 'Close Project', exact: true });
    await projectClose.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'Sensor/Board.dpn *', exact: true })).toBeVisible();
    await page.evaluate(() => window.hierarchyTestMenu('file-close-project'));
    await projectClose.getByRole('button', { name: 'Save and close', exact: true }).click();
    await expect(projectClose).toHaveCount(0);
    await expect(tabs).toHaveCount(0);
    expect((await api.decodeBoard(await readFile(path.join(root, 'Sensor', 'Board.dpn')))).copperLayers).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps independent schematic tabs and saves a dirty inactive drawing', async ({ page }, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const root = await mkdtemp(path.join(info.project.outputDir, 'schematic-tabs-'));
  const marker = path.join(root, 'Schematics.tcproject');
  const aFile = path.join(root, 'A.dzn');
  const bFile = path.join(root, 'B.dsn');
  let pending = marker;
  try {
    const api = await layoutRuntime();
    const a = api.blank();
    const b = api.blank();
    const simulation = api.createSimulationSheet(a.sheets[0], 'Experiment');
    const runId = crypto.randomUUID();
    simulation.simulation.retainResults = true;
    simulation.simulation.runs.push({
      id: runId, created: new Date().toISOString(), state: 'complete', backend: 'wasm',
      buildId: 'fixture', circuitHash: 'fixture', setupHash: 'fixture', analysis: api.defaultAnalysis(),
      parameters: {}, samples: 1, pinned: false, dataState: 'available',
    });
    a.sheets.push(simulation);
    const result = { vectors: [{ name: 'out', unit: 'V', real: [2.5] }], scale: 'out', log: 'fixture' };
    await writeFile(aFile, await api.encodeDrawing(a, 'zip-v1', new Map([[runId, result]])));
    await writeFile(bFile, await api.encodeDrawing(b, 'xml'));
    await writeFile(marker, api.encodeProjectSettings({
      title: 'Independent schematics', projectId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
      requiredFeatures: [], primarySchematic: a.documentId,
      entries: [
        { kind: 'schematic', id: a.documentId, path: 'A.dzn' },
        { kind: 'schematic', id: b.documentId, path: 'B.dsn' },
      ],
    }));
    await installProjectBridge(page, root, undefined, () => {
      const file = pending;
      pending = undefined;
      return file;
    });
    await page.goto(app.baseURL + '?project=1');
    const explorer = page.getByRole('region', { name: 'Projects', exact: true });
    const tabs = page.getByRole('tablist', { name: 'Project files', exact: true });
    const sheetName = () => page.evaluate(() => window.layoutTest.snapshot().drawing.sheets[0].name);
    const edit = (name) => page.evaluate((value) => window.layoutTest.renameCurrentSheet(value), name);
    await explorer.getByRole('button', { name: 'A.dzn', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'A.dzn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await edit('A first edit');
    await edit('A second edit');
    await explorer.getByRole('button', { name: 'B.dsn', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'B.dsn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(sheetName).toBe(b.sheets[0].name);
    await edit('B pending edit');
    await tabs.getByRole('tab', { name: 'A.dzn *', exact: true }).click();
    await expect.poll(sheetName).toBe('A second edit');
    await page.evaluate(() => window.hierarchyTestMenu('edit-undo'));
    await expect.poll(sheetName).toBe('A first edit');
    await page.evaluate(() => window.hierarchyTestMenu('edit-redo'));
    await expect.poll(sheetName).toBe('A second edit');

    await explorer.getByRole('button', { name: 'B.dsn', exact: true }).click();
    await expect.poll(sheetName).toBe('B pending edit');
    await expect.poll(() => page.evaluate(
      (id) => window.layoutTest.hasSchematicRecovery(id), a.documentId,
    )).toBe(true);
    const external = { ...b, sheets: b.sheets.map((sheet) => ({ ...sheet, name: 'External B' })) };
    await writeFile(bFile, await api.encodeDrawing(external, 'xml'));
    await page.getByRole('button', { name: 'Save All', exact: true }).click();
    const summary = page.getByRole('dialog', { name: 'Save All', exact: true });
    await expect(summary.getByRole('list', { name: 'Saved files', exact: true })).toContainText('A.dzn');
    await expect(summary.getByRole('list', { name: 'Files still needing attention', exact: true })).toContainText('B.dsn');
    await summary.getByRole('button', { name: 'Close', exact: true }).click();
    const savedResults = new Map();
    const savedA = await api.decodeDrawing(await readFile(aFile), savedResults);
    expect(savedA.sheets[0].name).toBe('A second edit');
    expect(savedResults.get(runId).vectors[0].real).toEqual([2.5]);
    expect((await api.decodeDrawing(await readFile(bFile))).sheets[0].name).toBe('External B');
    await expect.poll(sheetName).toBe('B pending edit');

    await tabs.getByRole('button', { name: 'Close B.dsn', exact: true }).click();
    const close = page.getByRole('dialog', { name: 'Close B.dsn', exact: true });
    await close.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.poll(sheetName).toBe('B pending edit');
    await tabs.getByRole('button', { name: 'Close B.dsn', exact: true }).click();
    await close.getByRole('button', { name: 'Discard and close', exact: true }).click();
    await expect(tabs.getByRole('tab', { name: 'A.dzn', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: /B\.dsn/ })).toHaveCount(0);
    await expect.poll(sheetName).toBe('A second edit');

    await explorer.getByRole('button', { name: 'B.dsn', exact: true }).click();
    await expect.poll(sheetName).toBe('External B');
    await edit('Saved from inactive tab');
    await expect(tabs.getByRole('tab', { name: 'B.dsn *', exact: true })).toBeVisible();
    await tabs.getByRole('tab', { name: 'A.dzn', exact: true }).click();
    await tabs.getByRole('button', { name: 'Close B.dsn', exact: true }).click();
    await close.getByRole('button', { name: 'Save and close', exact: true }).click();
    await expect(close).toBeHidden();
    await expect(tabs.getByRole('tab', { name: /B\.dsn/ })).toHaveCount(0);
    await expect.poll(sheetName).toBe('A second edit');
    expect((await api.decodeDrawing(await readFile(bFile))).sheets[0].name).toBe('Saved from inactive tab');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
