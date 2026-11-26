import { selectPcbNet, clickPcbCommand, pcbMenuName } from './pcb-controls.mjs';
import { build } from 'esbuild';
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import { expect, test } from '@playwright/test';
import { _electron } from 'playwright';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutRuntime } from '../../lib/layout-runtime.mjs';
import { librarySqlite } from '../../lib/library-from-sql.mjs';
import { installElectronBridge } from '../chat-browser/electron-bridge.mjs';
import { serveLayoutApp } from './serve-app.mjs';
import { boardWorkspaceMenus } from '../../../electron/drawingMenus.js';

const starterLibrary = new URL('../../../bundled-footprints/starter-v1.tplib', import.meta.url);

async function portableBoard(api) {
  const SQL = await librarySqlite();
  const db = new SQL.Database(await readFile(starterLibrary));
  const draft = await api.readStarterFootprint(db, api.readStarterFootprints(db).find(({ id }) => id === 'dip-8'));
  db.close();
  const definition = draft.definition;
  const point = (x, y) => ({ x, y });
  const base = api.createBoard('Portable board', 2, [
    point(0, 0), point(40e6, 0), point(40e6, 40e6), point(0, 40e6),
  ]);
  const id = () => crypto.randomUUID();
  const netId = id();
  const signalId = id();
  const deviceId = id();
  const pin = definition.pads.find(({ label }) => label === '1');
  const components = ['U1', 'U2'].map((reference) => ({
    id: id(), reference, deviceId, role: 'electrical', signals: [{ signalId, netId }],
  }));
  const footprints = components.map(({ id: componentId }, index) => ({
    id: id(), componentId, deviceId, positionNm: point((12 + 16 * index) * 1e6, 20e6),
    rotationMicrodegree: 0, side: 'top', locked: false,
  }));
  const [first, second] = footprints.map(({ positionNm }) =>
    point(positionNm.x + pin.positionNm.x, positionNm.y + pin.positionNm.y));
  const outside = 20e6 + Math.sign(pin.positionNm.y) * 10e6;
  const points = [first, point(first.x, outside), point(second.x, outside), second];
  return {
    ...base,
    fabrication: { profileId: 'classroom-v1', thicknessNm: 1.6e6 },
    requiredFeatures: [...base.requiredFeatures, 'embedded-devices', 'physical-padstacks', 'routed-copper', 'fabrication-settings'],
    nets: [{ id: netId, name: 'Signal' }],
    components, footprints, footprintDefinitions: [definition], modelAssets: draft.assets,
    deviceDefinitions: [{
      id: deviceId, footprintId: definition.id, revision: '1', definitionDigest: definition.definitionDigest,
      packageName: definition.name, packageSource: 'Embedded starter fixture', signalIds: [signalId],
      assignments: definition.pads.map(({ id: padId }) => padId === pin.id
        ? { padId, kind: 'signal', signalId }
        : { padId, kind: 'mechanical' }),
    }],
    tracks: points.slice(1).map((end, index) => ({
      id: id(), netId, layerId: 'top', widthNm: 500_000, start: points[index], end,
    })),
  };
}

// Use the real desktop file handler and disk. Only native dialogs, recent-file
// preferences and the IPC transport are supplied by the test.
async function desktopIo() {
  const result = await build({
    stdin: {
      contents: "export { dialog } from 'electron'; export { loadFile, saveFile } from './io.js';",
      resolveDir: fileURLToPath(new URL('../../../electron/', import.meta.url)),
    },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{
      name: 'desktop-file-services',
      setup(builder) {
        builder.onResolve({ filter: /^electron(-store)?$/ }, ({ path }) => ({ path, namespace: 'desktop-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'desktop-test' }, ({ path }) => ({
          contents: path === 'electron'
            ? 'export const dialog = {};'
            : 'export default class Store extends Map {}',
        }));
      },
    }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
}

async function desktopFiles(page, source, destination) {
  const { dialog, loadFile, saveFile } = await desktopIo();
  if (!dialog) throw new Error('Desktop file dialog adapter unavailable.');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
  dialog.showErrorBox = (_, message) => { throw new Error(message); };
  await installElectronBridge(page);
  function receive(channel, invoke) {
    return new Promise((resolve) => {
      const mainWindow = { webContents: { send: (event, payload) => {
        if (event === channel) resolve(payload);
      } } };
      invoke(mainWindow);
    });
  }
  await page.exposeFunction('loadPortableBoard', async (id) => {
    expect(id).toBe(source);
    const loaded = await receive('file-loaded', (window) => loadFile(window, id, false));
    return { ...loaded, content: [...loaded.content] };
  });
  await page.exposeFunction('savePortableBoard', ({ content, ...request }) =>
    receive('file-saved', (window) => saveFile(window, { ...request, content: Uint8Array.from(content) })));
  await page.exposeFunction('portableBoardMenuCommand', (menus, menuName, label) => {
    let command;
    const menu = boardWorkspaceMenus(menus, (value) => { command = value; })
      .find((item) => item.label === menuName);
    const item = menu?.submenu.find((entry) => entry.label === label);
    if (!item?.enabled) throw new Error('PCB menu command unavailable: ' + label);
    item.click();
    return command;
  });
  await page.addInitScript(() => {
    const api = window.electronAPI;
    let loaded;
    let saved;
    let menuCommand;
    window.portableBoardMenus = [];
    api.setBoardMenus = (menus) => { window.portableBoardMenus = menus; };
    api.onMenuCommand = (callback) => {
      menuCommand = callback;
      return () => { menuCommand = undefined; };
    };
    window.invokePortableBoardMenu = async (menuName, label) => {
      menuCommand(await window.portableBoardMenuCommand(window.portableBoardMenus, menuName, label));
    };
    api.fileLoaded = (callback) => { loaded = callback; return () => { loaded = undefined; }; };
    api.fileSaved = (callback) => { saved = callback; return () => { saved = undefined; }; };
    api.loadFile = async ({ id }) => {
      const data = await window.loadPortableBoard(id);
      loaded?.({ ...data, content: Uint8Array.from(data.content) });
    };
    api.saveFile = async (data) => saved?.(await window.savePortableBoard({ ...data, content: [...data.content] }));
  });
}

async function browserFiles(page, source, destination) {
  await page.exposeFunction('loadPortableBoard', async (name) =>
    [...await readFile(name === path.basename(source) ? source : destination)]);
  await page.exposeFunction('savePortableBoard', (bytes) => writeFile(destination, Uint8Array.from(bytes)));
  await page.addInitScript(({ sourceName, destinationName }) => {
    window.showOpenFilePicker = async () => [{
      name: sourceName,
      getFile: async () => new File([Uint8Array.from(await window.loadPortableBoard(sourceName))], sourceName),
    }];
    window.showSaveFilePicker = async () => ({
      name: destinationName,
      getFile: async () => new File([Uint8Array.from(await window.loadPortableBoard(destinationName))], destinationName),
      createWritable: async () => ({
        write: (bytes) => window.savePortableBoard([...bytes]),
        close: async () => {},
        abort: async () => {},
      }),
    });
  }, { sourceName: path.basename(source), destinationName: path.basename(destination) });
}

for (const target of ['filesystem', 'electron']) {
  test(`opens and re-saves a portable PCB offline in ${target}`, async ({ page: browserPage }, info) => {
    test.setTimeout(180000);
    await mkdir(info.project.outputDir, { recursive: true });
    const root = await mkdtemp(path.join(info.project.outputDir, 'portable-pcb-'));
    const source = path.join(root, 'Copied.dpn');
    const destination = path.join(root, 'Saved.dpn');
    let app;
    let electron;
    let page = browserPage;
    try {
      const api = await layoutRuntime();
      const board = await portableBoard(api);
      const bytes = Buffer.from(await api.encodeBoard(board));
      const original = path.join(root, 'Original.dpn');
      await writeFile(original, bytes);
      await copyFile(original, source);
      await rm(original);
      const executablePath = target === 'electron' && process.env.TINYCAD_TEST_ELECTRON;
      if (executablePath) {
        const env = { ...process.env, ELECTRON_IS_DEV: '0' };
        delete env.ELECTRON_RUN_AS_NODE;
        electron = await _electron.launch({
          executablePath,
          timeout: 30_000,
          args: [path.resolve(fileURLToPath(new URL('../../../', import.meta.url))), source,
            '--user-data-dir=' + path.join(root, 'profile'),
            '--host-resolver-rules=MAP * ~NOTFOUND',
            '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
          env,
        });
        page = await electron.firstWindow();
        await electron.evaluate(({ BrowserWindow, dialog }, { boardPath, exports }) => {
          globalThis.portableTestPickers = 0;
          dialog.showSaveDialog = async () => {
            globalThis.portableTestPickers += 1;
            return { canceled: false, filePath: boardPath };
          };
          globalThis.portableTestDownloads = new Map();
          BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (_, item) => {
            const name = item.getFilename();
            if (!Object.hasOwn(exports, name)) return;
            item.setSavePath(exports[name]);
            item.once('done', (_, state) => globalThis.portableTestDownloads.set(name, state));
          });
        }, {
          boardPath: destination,
          exports: Object.fromEntries(['Saved.drc.json', 'pcb-cam-preview.zip'].map((name) => [name, path.join(root, name)])),
        });
      } else {
        if (target === 'electron') await desktopFiles(page, source, destination);
        else await browserFiles(page, source, destination);
        app = await serveLayoutApp('layout-browser', target);
      }
      await page.route('**/*', (route) => {
        const url = route.request().url();
        const local = app ? url.startsWith(app.baseURL) : url.startsWith('file:');
        return local && !/\.(tplib|tclib)(\?|$)/i.test(url) ? route.continue() : route.abort();
      });
      if (app) {
        await page.addInitScript(() => {
          window.pcbModelRequests = [];
          window.Worker = class extends Worker {
            postMessage(data, ...options) {
              if (data?.board)
                window.pcbModelRequests.push([data.kind, data.board?.modelAssets?.length ?? 0]);
              return super.postMessage(data, ...options);
            }
          };
        });
        const url = new URL(app.baseURL);
        if (target === 'electron') url.searchParams.set('file', source);
        await page.goto(url.href);
      }
      if (target === 'filesystem') {
        await page.getByRole('button', { name: 'File', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
      }

      async function nativeCommand(...labels) {
        return electron.evaluate(({ Menu, BrowserWindow }, labels) => {
          const command = labels.reduce((menu, label, index) => {
            const items = index === 0 ? menu.items : menu?.submenu?.items;
            return items?.find((item) => {
              const name = item.label.replace(/&&|&(?=\S)/g, (mark) => mark === '&&' ? '&' : '');
              return index === labels.length - 1 ? name.startsWith(label) : name === label;
            });
          }, Menu.getApplicationMenu());
          if (!command?.enabled) throw new Error('Native menu command unavailable: ' + labels.join(' > '));
          command.click(command, BrowserWindow.getAllWindows()[0], {});
        }, labels);
      }

      async function download(button, filename) {
        if (!electron) {
          const event = page.waitForEvent('download');
          await button.click();
          return readFile(await (await event).path());
        }
        await button.click();
        await expect.poll(() => electron.evaluate((_, name) => globalThis.portableTestDownloads.get(name), filename))
          .toBe('completed');
        return readFile(path.join(root, filename));
      }

      const editor = page.getByRole('region', { name: 'PCB layout' });
      async function runPcbCommand(label) {
        if (electron) return nativeCommand(pcbMenuName(label), label);
        if (target === 'filesystem') return clickPcbCommand(editor, label);
        await expect.poll(() => page.evaluate(() => window.portableBoardMenus.map(({ title }) => title)))
          .toEqual(['Board', 'Copper', 'Fabrication']);
        return page.evaluate(([menu, label]) => window.invokePortableBoardMenu(menu, label), [pcbMenuName(label), label]);
      }
      const dialogGeometry = (dialog) => dialog.evaluate((surface) => {
        const footer = surface.querySelector('.fui-DialogActions');
        return [surface.offsetWidth, surface.offsetHeight, footer.offsetTop, footer.offsetHeight];
      });
      await expect(editor.getByRole('img', { name: 'Board layout' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Project activity bar' })).toHaveCount(0);
      await expect(editor.locator('[data-track]')).toHaveCount(3);
      const fileMenu = editor.getByRole('button', { name: 'File', exact: true });
      if (target === 'filesystem') await expect(fileMenu).toBeVisible();
      else await expect(fileMenu).toHaveCount(0);

      if (electron) {
        const canvas = editor.getByRole('img', { name: 'Board layout' });
        const fit = await canvas.getAttribute('data-view-box');
        await nativeCommand('View', 'Zoom In');
        await expect(canvas).not.toHaveAttribute('data-view-box', fit);
        await editor.getByRole('button', { name: 'Fit board' }).click();
        await expect(canvas).toHaveAttribute('data-view-box', fit);
      }
      await runPcbCommand('PCB Size & Shape…');
      const outline = page.getByRole('dialog', { name: 'PCB Size & Shape' });
      await expect(outline).toHaveClass(/\bfui-DialogSurface\b/);
      const outlineGeometry = await dialogGeometry(outline);
      await outline.getByLabel('Shape', { exact: true }).selectOption('custom');
      await expect(outline.getByRole('button', { name: 'Apply outline', exact: true })).toBeInViewport();
      const customOutlineGeometry = await dialogGeometry(outline);
      expect(customOutlineGeometry[0]).toBeGreaterThan(outlineGeometry[0]);
      await outline.getByRole('button', { name: 'Cancel', exact: true }).click();

      await editor.getByRole('button', { name: 'Save As…' }).click();
      await expect(page).toHaveTitle('TinyCAD - Saved.dpn');
      expect(await readFile(destination)).toEqual(bytes);
      const copied = await api.decodeBoard(await readFile(destination));
      expect(copied.modelAssets).toHaveLength(1);
      expect(copied.deviceDefinitions).toHaveLength(1);
      expect(copied.footprintDefinitions).toHaveLength(1);
      expect(copied.footprints.map(({ deviceId }) => deviceId)).toEqual(board.footprints.map(({ deviceId }) => deviceId));
      if (app) {
        await editor.getByRole('button', { name: 'Route track', exact: true }).click();
        await selectPcbNet(editor, { label: 'Signal' });
        await expect.poll(() => page.evaluate(() => window.pcbModelRequests)).toEqual(expect.arrayContaining([
          ['geometry', 0], ['route-clearance', 0],
        ]));
        await editor.getByRole('button', { name: 'Cancel route', exact: true }).click();
      }

      await runPcbCommand('Run design checks…');
      const checks = page.getByRole('region', { name: 'PCB design checks' });
      await expect(checks.getByText('Physical connectivity · checked', { exact: true })).toBeVisible();
      const report = JSON.parse(await download(
        checks.getByRole('button', { name: 'Save report…' }), 'Saved.drc.json',
      ));
      expect(report.issues.filter(({ code }) => ['open', 'short', 'floating-copper', 'missing-terminal'].includes(code))).toEqual([]);
      expect(report.fabrication).toMatchObject({ profileId: 'classroom-v1', thicknessNm: 1.6e6 });
      expect(report.inputDigest).toBe(createHash('sha256').update(JSON.stringify(copied)).digest('hex'));
      await checks.getByRole('button', { name: 'Close', exact: true }).click();

      await runPcbCommand('Inspect in 3D…');
      const viewer = page.getByRole('dialog', { name: '3D board inspection' });
      await expect(viewer.getByRole('img', { name: 'Interactive 3D PCB' })).toBeVisible();
      const models = viewer.getByRole('list', { name: '3D components' });
      for (const reference of ['U1', 'U2']) {
        await expect(models.getByRole('button', { name: reference, exact: true })).toBeVisible();
      }
      await expect(models.getByText('Generated STEP envelope', { exact: false })).toHaveCount(2);
      await viewer.getByRole('button', { name: 'Close', exact: true }).click();
      if (app) expect(await page.evaluate(() => window.pcbModelRequests)).toEqual(expect.arrayContaining([
        ['check', 1], ['inspect', 1],
      ]));

      await runPcbCommand('Manufacturing preview…');
      const cam = page.getByRole('dialog', { name: 'Manufacturing preview' });
      await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible();
      await expect(cam.locator('[data-plating="plated"]')).toHaveCount(16);
      const bundle = await download(
        cam.getByRole('button', { name: 'Download preview bundle…' }), 'pcb-cam-preview.zip',
      );
      const zip = new ZipReader(new Uint8ArrayReader(bundle));
      const entries = await zip.getEntries();
      expect(entries.map(({ filename }) => filename)).toEqual(expect.arrayContaining(['manifest.json', 'placement.csv', 'bom.csv']));
      const placement = await entries.find(({ filename }) => filename === 'placement.csv').getData(new TextWriter());
      await zip.close();
      for (const reference of ['U1', 'U2']) expect(placement).toContain(reference);
      await cam.getByRole('button', { name: 'Close', exact: true }).click();

      await runPcbCommand('Fabrication settings…');
      const fabrication = page.getByRole('dialog', { name: 'Fabrication settings' });
      await expect(fabrication).toHaveClass(/\bfui-DialogSurface\b/);
      const fabricationGeometry = await dialogGeometry(fabrication);
      await fabrication.getByText('Board stackup', { exact: true }).click();
      await fabrication.getByLabel('Substrate material').scrollIntoViewIfNeeded();
      const body = fabrication.locator('.fui-DialogContent');
      const scrollTop = await body.evaluate((content) => {
        content.scrollTop = content.scrollHeight;
        return content.scrollTop;
      });
      expect(scrollTop).toBeGreaterThan(0);
      expect(await dialogGeometry(fabrication)).toEqual(fabricationGeometry);
      await expect(fabrication.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
      await fabrication.getByLabel('Board thickness (mm)').fill('1.2');
      await fabrication.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(fabrication).toBeHidden();
      await runPcbCommand('Hole or slot…');
      const drill = page.getByRole('dialog', { name: 'Add hole or slot' });
      await drill.getByText('Advanced', { exact: true }).click();
      await drill.getByLabel('Screw-head diameter (mm)').fill('2');
      await drill.getByRole('button', { name: 'Add hole or slot', exact: true }).click();
      await expect(drill.getByRole('alert')).toContainText('screw-head keep-out');
      await drill.getByLabel('Screw-head diameter (mm)').fill('6');
      await drill.getByLabel('Screw-head side').selectOption('bottom');
      await drill.getByLabel('Extra component clearance (mm)').fill('1');
      await drill.getByRole('button', { name: 'Add hole or slot', exact: true }).click();
      await expect(drill).toBeHidden();
      await expect(editor.locator('[data-hole]')).toHaveCount(1);
      await expect(editor.locator('[data-screw-head="bottom"]')).toHaveCount(1);
      const beforeInspection = await readFile(destination);
      await runPcbCommand('Inspect board rules…');
      const inspector = page.getByRole('dialog', { name: 'Inspect PCB rules' });
      await expect(inspector).toHaveClass(/\bfui-DialogSurface\b/);
      const inspectorGeometry = await dialogGeometry(inspector);
      await inspector.getByRole('tab', { name: 'Openings', exact: true }).click();
      const opening = inspector.getByLabel('Opening', { exact: true });
      const mountingHole = opening.getByRole('option', { name: /^Non-plated hole / });
      await opening.selectOption(await mountingHole.getAttribute('value'));
      await expect(inspector).toContainText('required 0.6 mm (minNonPlatedDrillNm)');
      await expect(inspector).toContainText('Opening is contained.');
      expect(await dialogGeometry(inspector)).toEqual(inspectorGeometry);
      await inspector.getByRole('button', { name: 'Close', exact: true }).click();
      expect(await readFile(destination)).toEqual(beforeInspection);
      await editor.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(editor.locator('[data-hole]')).toHaveCount(0);
      await editor.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(editor.locator('[data-hole]')).toHaveCount(1);
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).toHaveTitle('TinyCAD - Saved.dpn');
      const edited = await api.decodeBoard(await readFile(destination));
      expect(edited.fabrication.thicknessNm).toBe(1.2e6);
      expect(edited.mechanicalHoles).toHaveLength(1);
      expect(edited.mechanicalHoles[0]).toMatchObject({
        screwHeadDiameterNm: 6e6, screwHeadSide: 'bottom', bodyClearanceNm: 1e6,
      });
      expect(edited.tracks).toEqual(copied.tracks);
      expect(edited.modelAssets).toEqual(copied.modelAssets);

      const connections = page.getByRole('dialog', { name: 'PCB connections' });
      const unchangedOnDisk = await readFile(destination);
      const pickers = electron && await electron.evaluate(() => globalThis.portableTestPickers);
      const SQL = await librarySqlite();
      const db = new SQL.Database(await readFile(starterLibrary));
      const [starter] = await api.readStarterDevices(db);
      db.close();
      const device = await api.writeLibraryDevice(starter.definition);
      const canvas = editor.getByRole('img', { name: 'Board layout' });
      async function placeDevice(reference, x, y) {
        await runPcbCommand('Board connections…');
        await connections.getByLabel('Reviewed device file').setInputFiles({
          name: 'test.tcdevice.json', mimeType: 'application/json', buffer: Buffer.from(device),
        });
        await connections.getByLabel('Component reference').fill(reference);
        await connections.getByRole('button', { name: 'Add device' }).click();
        await expect(connections.getByRole('status')).toHaveText('Device added to unplaced components.');
        await connections.getByRole('button', { name: 'Done', exact: true }).click();
        await page.getByRole('list', { name: 'Unplaced components' }).getByRole('button', { name: new RegExp('^' + reference) }).click();
        await page.getByRole('img', { name: 'Footprint pad preview' }).dragTo(canvas);
        await expect(canvas.locator('[data-placement-preview]')).toHaveCount(1);
        await canvas.evaluate((svg) => svg.scrollIntoView());
        const point = await canvas.evaluate((svg, [x, y]) => {
          const screen = new DOMPoint(x, -y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
          return { x: screen.x, y: screen.y };
        }, [x, y]);
        await page.mouse.click(point.x, point.y);
        return point;
      }
      const point = await placeDevice('J99', 34_000_000, 6_000_000);
      await expect(canvas.locator('[data-component]')).toHaveCount(3);
      const placed = canvas.locator('[data-footprint-reference]').filter({
        has: page.locator('title').filter({ hasText: /^J99$/ }),
      });
      await expect(placed).toBeVisible();
      const placedBounds = await placed.boundingBox();
      await page.mouse.move(point.x + 10, point.y + 10);
      await expect(canvas.locator('[data-placement-preview]')).toHaveCount(0);
      expect(await placed.boundingBox()).toEqual(placedBounds);
      expect(await readFile(destination)).toEqual(unchangedOnDisk);
      if (target === 'electron') {
        const componentId = await placed.getAttribute('data-footprint-reference');
        const pad = canvas.locator(`[data-component=${JSON.stringify(componentId)}] [data-board-pad]`).first();
        const bounds = await pad.boundingBox();
        const scale = await canvas.locator('[data-svg-drawing]').evaluate((drawing) => drawing.getScreenCTM().a);
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        await page.mouse.move(x, y);
        await expect(canvas.locator('[data-selection-outline="hover"]')).toBeVisible();
        await page.mouse.down();
        await page.mouse.move(x - 2_000_000 * scale, y, { steps: 5 });
        await expect(canvas.locator('[data-footprint-move-preview]')).toHaveCount(1);
        await page.mouse.up();
        await expect.poll(async () => (await placed.boundingBox()).x).toBeLessThan(placedBounds.x - scale * 1_000_000);
        await editor.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(() => placed.boundingBox()).toEqual(placedBounds);
        expect(await readFile(destination)).toEqual(unchangedOnDisk);
      }
      await editor.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(canvas.locator('[data-component]')).toHaveCount(2);
      expect(await readFile(destination)).toEqual(unchangedOnDisk);
      await editor.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(canvas.locator('[data-component]')).toHaveCount(3);
      expect(await readFile(destination)).toEqual(unchangedOnDisk);
      if (electron) {
        await expect.poll(() => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
          .toBe('TinyCAD - Saved.dpn*');
        expect(await electron.evaluate(() => globalThis.portableTestPickers)).toBe(pickers);
        await nativeCommand('File', 'Save');
      } else {
        await editor.getByRole('button', { name: 'Save', exact: true }).click();
      }
      await expect(page).toHaveTitle('TinyCAD - Saved.dpn');
      const saved = await api.decodeBoard(await readFile(destination));
      expect(saved.footprints).toHaveLength(3);
      const component = saved.components.find(({ reference }) => reference === 'J99');
      expect(saved.footprints.find(({ componentId }) => componentId === component.id).positionNm)
        .toEqual({ x: 34_000_000, y: 6_000_000 });

      await runPcbCommand('Board connections…');
      await connections.getByLabel('Net name').fill('Test point');
      await connections.getByRole('button', { name: 'Add net' }).click();
      await expect(connections.getByRole('status')).toHaveText('Board net added.');
      await connections.getByLabel('Component', { exact: true }).selectOption({ label: 'U2' });
      await connections.getByLabel('Electrical pads').selectOption({ label: '1' });
      await connections.getByLabel('Assign to net').selectOption({ label: 'Test point' });
      await connections.getByRole('button', { name: 'Apply pad assignment' }).click();
      await expect(connections.getByRole('status')).toContainText('Run design checks');
      await connections.getByRole('button', { name: 'Done' }).click();
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).toHaveTitle('TinyCAD - Saved.dpn');
      const updated = await api.decodeBoard(await readFile(destination));
      expect(updated.nets).toHaveLength(2);
      const addedNet = updated.nets.find(({ name }) => name === 'Test point');
      expect(updated.components.find(({ reference }) => reference === 'U2').signals[0].netId).toBe(addedNet.id);
      expect(updated.tracks.map(({ start, end }) => ({ start, end }))).toEqual(
        edited.tracks.map(({ start, end }) => ({ start, end })),
      );
      expect(updated.tracks.some(({ reviewRequired }) => reviewRequired)).toBe(true);
      if (electron) {
        await nativeCommand('File', 'New', 'New PCB Footprint Library');
        const footprintEditor = page.getByRole('dialog', { name: 'Footprint editor' });
        await expect(footprintEditor).toBeVisible();
        await footprintEditor.getByRole('button', { name: 'Close', exact: true }).click();
        const untitled = path.join(root, 'New PCB.dpn');
        await electron.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => {
            globalThis.portableTestPickers += 1;
            return { canceled: false, filePath };
          };
          dialog.showOpenDialog = async ({ filters }) => {
            globalThis.portableTestOpenFilters = filters;
            return { canceled: false, filePaths: [filePath] };
          };
        }, untitled);
        await nativeCommand('File', 'New', 'New PCB');
        await expect(page).toHaveTitle('TinyCAD - Untitled.dpn*');
        await runPcbCommand('View board tools');
        await page.getByRole('region', { name: 'Board tools', exact: true })
          .getByLabel('Grid (mm)', { exact: true }).fill('1');
        await placeDevice('J1', 34_000_000, 14_000_000);
        await expect(canvas.locator('[data-component]')).toHaveCount(1);
        await expect(canvas.locator('[data-placement-preview]')).toHaveCount(0);
        expect(await electron.evaluate(() => globalThis.portableTestPickers)).toBe(pickers);
        await expect(readFile(untitled)).rejects.toMatchObject({ code: 'ENOENT' });
        await nativeCommand('File', 'Save');
        await expect.poll(() => electron.evaluate(() => globalThis.portableTestPickers)).toBe(pickers + 1);
        await expect(page).toHaveTitle('TinyCAD - New PCB.dpn');
        await nativeCommand('Board', 'Close board');
        await expect(editor).toBeHidden();
        await nativeCommand('File', 'Open');
        await expect.poll(() => electron.evaluate(() => globalThis.portableTestOpenFilters))
          .toContainEqual({ name: 'TinyCAD Design Files', extensions: ['dsn', 'dzn', 'dpn'] });
        await expect(canvas.locator('[data-component]')).toHaveCount(1);
        expect((await api.decodeBoard(await readFile(untitled))).footprints[0].positionNm)
          .toEqual({ x: 34_000_000, y: 14_000_000 });
      } else if (target === 'electron') {
        await runPcbCommand('Close board');
        await expect(editor).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.portableBoardMenus)).toEqual([]);
      }
      expect(await readFile(source)).toEqual(bytes);
    } finally {
      await electron?.close();
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
