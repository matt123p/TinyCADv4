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

async function installProjectBridge(page, documents, beforeRequest) {
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
    await beforeRequest?.(request);
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
    await projects
      .getByRole('button', { name: 'Actions for Board.dpn' })
      .click();
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
    await projects
      .getByRole('button', { name: 'Actions for Board.dpn' })
      .click();
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
      .getByRole('button', { name: 'Actions for Leaf.dsn' })
      .click();
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
    const pcbLayout = page.getByRole('dialog', {
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
    await pcbLayout.getByRole('button', { name: 'Place and save' }).click();
    await expect(
      pcbLayout.getByRole('list', { name: 'Placed components' }),
    ).toContainText('R9');
    await pcbLayout.getByRole('button', { name: 'Close', exact: true }).click();

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
    await projects
      .getByRole('button', { name: 'Leaf.dpn', exact: true })
      .click();
    await pcbLayout
      .getByRole('button', { name: 'Update PCB from Schematic…' })
      .click();
    await expect(eco.getByRole('status')).toHaveText('The board is current.');
    await eco.getByRole('button', { name: 'Close', exact: true }).click();
    await projects
      .getByRole('button', { name: 'Actions for Leaf.dsn' })
      .click();
    await page
      .getByRole('menuitem', {
        name: 'Update PCB from Schematic…',
        exact: true,
      })
      .click();
    await expect(eco.getByRole('status')).toHaveText('The board is current.');
    await eco.getByRole('button', { name: 'Close', exact: true }).click();

    await projects.getByRole('button', { name: 'Parent folder' }).click();
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
        .getByRole('button', { name: 'Actions for Leaf.dpn' })
        .click();
      await page
        .getByRole('menuitem', { name: 'Update PCB from Schematic…' })
        .click();
    }
    await renameLeafPart('R10');
    await page.evaluate(() =>
      window.dispatchEvent(new Event('tinycad:project-files-changed')),
    );
    await expect(leafRow).toContainText('Schematic changes pending');
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
    const boardNet = pcbLayout.getByLabel('Board net', { exact: true });
    await boardNet.selectOption(oldNet.id);
    await expect(
      pcbLayout.getByRole('list', { name: 'Schematic net terminals' }),
    ).toContainText('R1');
    await expect(
      pcbLayout
        .getByRole('img', { name: 'Board layout' })
        .locator('[data-net-highlighted="true"]'),
    ).toHaveCount(1);
    await pcbLayout.getByRole('button', { name: 'Close', exact: true }).click();
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
    await expect(
      eco.getByRole('list', { name: 'Affected copper' }),
    ).toContainText(traceId + ' · Net assignment needs review');
    await eco.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await readFile(pcbPath)).toEqual(routedBefore);
    await previewLeafUpdate();
    await expect(
      eco.getByRole('list', { name: 'Affected copper' }),
    ).toContainText(traceId);
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
    await expect(
      eco.getByRole('list', { name: 'Affected copper' }),
    ).toContainText(traceId);
    await eco.getByRole('button', { name: 'Apply circuit update' }).click();
    await expect(eco).toBeHidden();
    const routed = await api.decodeBoard(await readFile(pcbPath));
    const { netId: originalNetId, ...trackGeometry } = track;
    expect(routed.tracks).toEqual([{ ...trackGeometry, reviewRequired: true }]);
    await projects
      .getByRole('button', { name: 'Actions for Leaf.dpn' })
      .click();
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
    await projects.getByRole('button', { name: 'Parent folder' }).click();
    await writeFile(leafPath, leafBeforeRemoval);
    const rootFile = path.join(copy, rootPath);
    const rootBeforeAnnotation = await readFile(rootFile);
    const childBeforeAnnotation = await readFile(leafPath);
    async function boardMenu(action) {
      await projects
        .getByRole('button', { name: 'Actions for Board.dpn' })
        .click();
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

test('imports a footprint, edits pad coordinates, and exports native and dimensioned files', async ({
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
    await projects
      .getByRole('button', { name: 'Project folder actions' })
      .click();
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
    await editor.getByLabel('Open footprint').setInputFiles({
      name: 'Test.kicad_mod',
      mimeType: 'text/plain',
      buffer: Buffer.from(`(footprint "Test" (version 20241229) (layer "F.Cu")
        (fp_line (start -2 1) (end 2 1) (stroke (width 0.15) (type solid)) (layer "F.SilkS"))
        (pad "01" smd rect (at 0 0) (size 1.2 1.6) (layers "F.Cu" "F.Mask" "F.Paste"))
      )`),
    });
    await expect(
      editor.getByRole('img', { name: 'Footprint pad preview' }),
    ).toBeVisible();
    await editor.getByLabel('Pad X (mm)', { exact: true }).fill('1.5');
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
    const footprintDownload = page.waitForEvent('download');
    await editor
      .getByRole('button', { name: 'Export footprint', exact: true })
      .click();
    const native = await api.decodeFootprintLibrary(
      await readFile(await (await footprintDownload).path()),
    );
    expect(native.definition.pads[0].positionNm.x).toBe(1_500_000);
    expect(native.definition.datasheetUrl).toBe(datasheetUrl);
    expect(native.definition.graphics[0].layer).toBe('F.SilkS');
    await editor
      .getByRole('button', { name: 'Edit artwork', exact: true })
      .click();
    await editor
      .getByLabel('Graphic shape', { exact: true })
      .selectOption('rect');
    await editor.getByLabel('Layer', { exact: true }).selectOption('F.CrtYd');
    await editor
      .getByLabel('Graphic points', { exact: false })
      .fill('-3,-2\n4,2');
    await editor
      .getByRole('button', { name: 'Add graphic', exact: true })
      .click();
    await expect(
      editor.getByLabel('Graphic', { exact: true }).locator('option:checked'),
    ).toHaveText(/F.CrtYd/);

    const dimensionDownload = page.waitForEvent('download');
    await editor.getByRole('button', { name: 'Export 1:1 SVG' }).click();
    const drawing = await readFile(
      await (await dimensionDownload).path(),
      'utf8',
    );
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

    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await projects
      .getByRole('button', { name: 'Project folder actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Footprint editor…' }).click();
    await editor.getByLabel('Name', { exact: true }).fill('Test');
    await editor.getByLabel('New pad label', { exact: true }).fill('01');
    await editor
      .getByLabel('Pad shape', { exact: true })
      .selectOption('rectangle');
    await editor.getByRole('button', { name: 'Add pad', exact: true }).click();
    await editor.getByLabel('New pad label', { exact: true }).fill('MH');
    await editor.getByLabel('Pad shape', { exact: true }).selectOption('hole');
    await editor.getByLabel('X (mm)', { exact: true }).fill('3');
    await editor.getByLabel('Drill width (mm)', { exact: true }).fill('0.8');
    await editor.getByRole('button', { name: 'Add pad', exact: true }).click();

    await editor.getByRole('button', { name: 'Map as device' }).click();
    for (const [label, value] of [
      ['Package name', 'Test Package'],
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
      .getByRole('button', { name: 'Actions for Circuit.dsn', exact: true })
      .click();
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
    await picker
      .getByLabel('Device revision')
      .selectOption({ label: 'Test · 1 · 2 pads' });
    await picker.getByLabel('Signal for pad 01 (1)').selectOption({ index: 1 });
    await picker
      .getByRole('button', { name: 'Preview device changes' })
      .click();
    await picker.getByRole('button', { name: 'Stage reviewed device' }).click();
    await transfer.getByRole('button', { name: 'Create linked PCB' }).click();
    const layout = page.getByRole('dialog', {
      name: 'PCB layout',
      exact: true,
    });
    await layout
      .getByRole('list', { name: 'Unplaced components' })
      .getByRole('button', { name: /^R1/ })
      .click();
    await layout.getByRole('button', { name: 'Place and save' }).click();
    await expect(
      layout.getByRole('list', { name: 'Placed components' }),
    ).toContainText('R1');
    await layout.getByRole('button', { name: 'Close', exact: true }).click();
    await rm(libraryPath);
    const pcb = await api.decodeBoard(
      await readFile(path.join(directory, 'Circuit.dpn')),
    );
    expect(pcb.footprints).toHaveLength(1);
    expect(pcb.footprintDefinitions[0].pads).toEqual(device.footprint.pads);
    expect(pcb.footprintDefinitions[0].pads[1].stack.drill.plated).toBe(false);
    expect(pcb.deviceDefinitions[0].assignments[1].kind).toBe('mechanical');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
