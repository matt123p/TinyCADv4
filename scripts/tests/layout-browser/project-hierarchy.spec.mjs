import { test, expect } from '@playwright/test';
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

async function installProjectBridge(page, documents) {
  const senderFrame = {};
  const sender = { mainFrame: senderFrame };
  let handler;
  registerProjectFiles({
    ipcMain: {
      handle: (_, callback) => {
        handler = callback;
      },
    },
    getWindow: () => ({ webContents: sender }),
    store: { get: (_, fallback) => fallback },
    documents,
  });
  const browser = page.context();
  await installElectronBridge(browser);
  await browser.exposeBinding('hierarchyTestFiles', async (_, request) => {
    if (request.data) request.data = Uint8Array.from(request.data);
    const result = await handler({ sender, senderFrame }, request);
    return result?.data ? { ...result, data: Array.from(result.data) } : result;
  });
  await browser.addInitScript(() => {
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
  });
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
        .click();
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
        .getByRole('button', { name: 'Actions for ' + name, exact: true })
        .click();
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses expanded project connectivity for exports and cross-probes mapped board pads after a rename', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await mkdir(info.project.outputDir, { recursive: true });
  const directory = await mkdtemp(
    path.join(info.project.outputDir, 'hierarchy-board-'),
  );
  await installProjectBridge(page, directory);
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
      components: [{ id: componentId, logicalId: part.id }],
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
      .getByRole('button', { name: 'Actions for Board.dpn' })
      .click();
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
    const versionBeforeErc = (await snapshotUI()).drawingVersion;
    await page.evaluate(() => window.hierarchyTestMenu('tools-drc'));
    const erc = page.getByRole('dialog', { name: 'Design Rules Check' });
    await erc.getByRole('checkbox', { name: 'Unconnected nets' }).check();
    await erc.getByRole('button', { name: 'OK', exact: true }).click();
    const issue = page.getByRole('row').filter({ hasText: 'H7_H1_R9' });
    await expect(issue).toContainText('Unconnected nets');
    expect((await snapshotUI()).drawingVersion).toBe(versionBeforeErc);
    await issue.click();
    await expect
      .poll(async () => (await snapshotUI()).drawing.documentId)
      .toBe(source.documentId);
    await expect(
      page.getByRole('region', { name: 'Schematic hierarchy' }),
    ).toContainText('H7 / H1 · Blocks/Leaf.dsn');
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
