import { readFile } from 'node:fs/promises';
import { librarySqlite } from '../../lib/library-from-sql.mjs';
import { expect, test } from '@playwright/test';
import { layoutRuntime } from '../../lib/layout-runtime.mjs';
import { serveLayoutApp } from './serve-app.mjs';
import { thermalFixture } from '../pcb-thermal-fixture.mjs';
import { placementFixture } from '../pcb-placement-fixture.mjs';

let app;
test.beforeAll(async () => {
  test.setTimeout(120000);
  app = await serveLayoutApp();
});
test.afterAll(async () => app?.close());

async function holdPcbWorkerReplies(page) {
  await page.addInitScript(() => {
    const pending = [];
    window.pcbReplies = {
      hold: undefined,
      count: () => pending.length,
      cancelled: () => pending.every(({ worker }) => worker.terminated),
      release(error, repeat = false) {
        const { worker, data } = pending.shift();
        const event = new MessageEvent('message', {
          data: error ? { id: data.id, kind: 'error', error } : data,
        });
        worker.onmessage(event);
        if (repeat) worker.onmessage(event);
      },
    };
    window.Worker = class extends Worker {
      terminate() {
        this.terminated = true;
        super.terminate();
      }

      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          if (!window.pcbReplies.hold || event.data.kind !== window.pcbReplies.hold) return;
          event.stopImmediatePropagation();
          pending.push({ worker: this, data: event.data });
          window.pcbReplies.hold = undefined;
        });
      }
    };
  });
}

test('opens and edits a standalone PCB in the shared shell', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const api = await layoutRuntime();
  const base = api.createBoard('Copied board', 2, [
    { x: 0, y: 0 },
    { x: 30_000_000, y: 0 },
    { x: 30_000_000, y: 20_000_000 },
    { x: 0, y: 20_000_000 },
  ]);
  const signal = crypto.randomUUID();
  const source = { ...base, nets: [{ id: signal, name: 'Supply' }] };
  await page.addInitScript(
    (bytes) => {
      function handle(name) {
        return {
          name,
          kind: 'file',
          getFile: async () => new File([new Uint8Array(bytes)], name),
          createWritable: async () => ({
            write: async (value) => {
              window.savedBoard = [...value];
            },
            close: async () => {},
            abort: async () => {},
          }),
        };
      }
      window.showOpenFilePicker = async (options) => {
        window.openTypes = options.types;
        return [handle('Copied.dpn')];
      };
      window.showSaveFilePicker = async (options) => {
        window.saveTypes = options.types;
        return handle('Copy.dpn');
      };
    },
    [...(await api.encodeBoard(source))],
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await holdPcbWorkerReplies(page);

  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const board = page.getByRole('region', { name: 'PCB layout' });
  await expect(board.getByRole('img', { name: 'Board layout' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.openTypes)).flatMap(({ accept }) =>
      Object.values(accept).flat(),
    ),
  ).toContain('.dpn');

  const canvas = board.getByRole('img', { name: 'Board layout' });
  const rulers = board.locator('.svg-viewport-with-rulers canvas');
  const toggleRulers = board.getByRole('button', { name: 'Toggle rulers' });
  const initialSize = page.viewportSize();
  async function expectRulerIndicators() {
    const bounds = await canvas.boundingBox();
    const x = Math.round(bounds.width * 0.4);
    const y = Math.round(bounds.height * 0.4);
    await canvas.hover({ position: { x, y } });
    await expect.poll(() => rulers.evaluateAll((rails, [x, y]) => {
      return rails.map((rail, i) => {
        const at = i === 0 ? x : y;
        const pixels = rail.getContext('2d').getImageData(i === 0 ? at - 2 : 0, i === 0 ? 0 : at - 2,
          i === 0 ? 5 : 20, i === 0 ? 20 : 5).data;
        return pixels.some((red, channel) => channel % 4 === 0 && red > 240 && pixels[channel + 1] < 30);
      });
    }, [x, y])).toEqual([true, true]);
  }
  await expect(rulers).toHaveCount(2);
  await expectRulerIndicators();
  const boardTools = board.getByRole('complementary', { name: 'Board tools' });
  const initialTools = await boardTools.boundingBox();
  await board.getByRole('separator', { name: 'Resize board tools' }).focus();
  await page.keyboard.press('ArrowLeft');
  expect((await boardTools.boundingBox()).width).toBeGreaterThan(initialTools.width);
  const properties = board.getByRole('region', { name: 'Board properties' });
  const toggleProperties = board.getByRole('button', { name: 'Toggle board properties' });
  await toggleProperties.click();
  await expect(properties).toBeHidden();
  await toggleProperties.click();
  await expect(properties).toBeVisible();
  const bounds = await canvas.boundingBox();
  const anchor = { x: Math.round(bounds.x + bounds.width * 0.4), y: Math.round(bounds.y + bounds.height * 0.4) };
  const worldAtAnchor = () => canvas.evaluate((svg, { x, y }) => {
    const point = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM().inverse());
    return [Math.round(point.x), Math.round(point.y)];
  }, anchor);
  const original = await worldAtAnchor();
  const initialView = await canvas.getAttribute('viewBox');
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Shift');
  await expect(canvas).not.toHaveAttribute('viewBox', initialView);
  const anchored = await worldAtAnchor();
  expect(Math.hypot(anchored[0] - original[0], anchored[1] - original[1])).toBeLessThan(5);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(anchor.x + 35, anchor.y + 30);
  await page.mouse.up({ button: 'middle' });
  expect(await worldAtAnchor()).not.toEqual(original);
  await expectRulerIndicators();
  await page.setViewportSize({ width: initialSize.width - 100, height: initialSize.height - 100 });
  await expectRulerIndicators();
  await toggleRulers.click();
  await expect(rulers).toHaveCount(0);
  await toggleRulers.click();
  await expect(rulers).toHaveCount(2);
  await page.setViewportSize(initialSize);
  await board.getByRole('button', { name: 'Fit board', exact: true }).click();
  await canvas.click({ button: 'right' });
  const boardMenu = page.getByRole('menu');
  await expect(boardMenu.getByRole('menuitem', { name: 'Zoom In', exact: true })).toBeVisible();
  await expect(boardMenu.getByRole('menuitem', { name: 'Move on board' })).toHaveCount(0);
  await boardMenu.getByRole('menuitem', { name: 'Zoom In', exact: true }).click();
  await expect(boardMenu).toBeHidden();
  await expect(canvas).not.toHaveAttribute('viewBox', initialView);
  await board.getByLabel('Board drawing', { exact: true }).focus();
  await page.keyboard.press('Shift+F10');
  await boardMenu.getByRole('menuitem', { name: 'Fit board', exact: true }).click();
  await expect(canvas).toHaveAttribute('viewBox', initialView);
  const beforePan = (await canvas.getAttribute('viewBox')).split(' ');
  await canvas.hover();
  await page.mouse.wheel(15, 30);
  await expect(canvas).not.toHaveAttribute('viewBox', initialView);
  expect((await canvas.getAttribute('viewBox')).split(' ').slice(2)).toEqual(beforePan.slice(2));
  await board.getByRole('button', { name: 'Fit board', exact: true }).click();
  const toolbar = await board.getByRole('toolbar', { name: 'PCB commands' }).boundingBox();
  const workspaces = await page.getByRole('group', { name: 'Design workspaces' }).boundingBox();
  expect(toolbar.y).toBeLessThan(workspaces.y);
  await expect(page).toHaveTitle('TinyCAD - Copied.dpn');
  await expect(page.locator('.top-bar-left')).toContainText('Copied.dpn');

  const openGuide = board.getByRole('button', { name: 'First board guide', exact: true });
  await openGuide.focus();
  await page.keyboard.press('Enter');
  const guide = board.getByRole('region', { name: 'First board guide' });
  await expect(guide.getByRole('status')).toHaveText('Step 1 of 6 · Review parts');
  await expect(guide).toContainText('Create PCB from Schematic…');
  await guide.getByRole('button', { name: 'Next step' }).click();
  await guide.getByRole('button', { name: 'Set board outline…' }).click();
  const outline = page.getByRole('dialog', { name: 'Set board outline' });
  await outline.getByLabel('Shape').selectOption('rounded');
  await outline.getByLabel('Width (mm)').fill('40');
  await outline.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(outline).toBeHidden();
  await board.getByRole('button', { name: 'Add cutout…' }).click();
  const cutout = page.getByRole('dialog', { name: 'Add board cutout' });
  await cutout.getByLabel('Shape').selectOption('circle');
  await cutout.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(cutout).toBeHidden();
  await board.getByRole('button', { name: 'Hole or slot…' }).click();
  const drill = page.getByRole('dialog', { name: 'Add hole or slot' });
  await drill.getByLabel('Slot length (mm)').fill('4');
  await drill.getByRole('checkbox', { name: 'Plated' }).check();
  await drill.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drill).toBeHidden();
  await expect(board.locator('[data-hole]')).toHaveCount(1);
  await board.getByLabel('Copper layers').selectOption('1');
  await guide.getByLabel('Guide step').selectOption({ label: 'Route connections' });
  await guide.getByRole('button', { name: 'Start routing' }).click();
  await board.getByLabel('Board net').selectOption(signal);
  const clickBoard = async (x, y) => {
    const position = await board
      .getByRole('img', { name: 'Board layout' })
      .evaluate(
        (svg, [x, y]) => {
          const position = new DOMPoint(x, -y).matrixTransform(
            svg.getScreenCTM(),
          );
          return { x: position.x, y: position.y };
        },
        [x, y],
      );
    await page.mouse.click(position.x, position.y);
  };
  await clickBoard(15_000_000, 9_000_000);
  await clickBoard(20_000_000, 9_000_000);
  const finishRoute = board.getByRole('button', { name: 'Finish route' });
  await expect(finishRoute).toBeEnabled();
  await finishRoute.click();
  await expect(
    board.getByRole('button', { name: 'Route track' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: 'Circuit Design', exact: true })
    .click();
  await expect(board).toBeHidden();
  await page.getByRole('button', { name: 'PCB Design', exact: true }).click();
  await expect(board.getByLabel('Copper layers')).toHaveValue('1');
  await board.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(board.getByLabel('Copper layers')).toHaveValue('1');
  await board.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(board.getByLabel('Copper layers')).toHaveValue('2');
  await board.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(board.getByLabel('Copper layers')).toHaveValue('1');
  await board.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.evaluate(() => { window.pcbReplies.hold = 'geometry'; });
  await board.getByRole('button', { name: 'Add copper zone…' }).click();
  const zone = page.getByRole('dialog', { name: 'Add copper zone' });
  await zone.getByLabel('Outline (X, Y in mm)', { exact: true }).fill('2, 2\n35, 2\n35, 18\n2, 18');
  await zone.getByLabel('Disconnected copper').selectOption('retain');
  await zone.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(zone).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await expect(board.getByText('Filling zones…')).toBeVisible();
  await board.getByRole('button', { name: 'Cancel zone fill' }).click();
  await expect(board.getByText('Zone fill is stale.')).toBeVisible();
  await expect(board.getByText(/· Unsaved/)).toBeVisible();
  await expect(board.locator('[data-zone-fill]')).toHaveCount(0);
  await page.evaluate(() => {
    window.pcbReplies.release();
    window.pcbReplies.hold = 'geometry';
  });
  await expect(board.locator('[data-zone-fill]')).toHaveCount(0);
  await board.getByRole('button', { name: 'Refill zones' }).click();
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await page.evaluate(() => window.pcbReplies.release('Deliberate test failure'));
  await expect(board.getByText('Zone fill failed.')).toBeVisible();
  await board.getByRole('button', { name: 'Retry zone fill' }).click();
  await expect(board.locator('[data-zone-fill]')).toHaveCount(1);
  await openGuide.click();
  await guide.getByLabel('Guide step').selectOption({ label: 'Set up the board' });
  await guide.getByRole('button', { name: 'Choose fabrication settings…' }).click();
  const fabrication = page.getByRole('dialog', { name: 'Fabrication settings' });
  await fabrication.getByRole('combobox', { name: 'Fabrication profile' }).selectOption('classroom-v1');
  await fabrication.getByRole('textbox', { name: 'Board thickness (mm)' }).fill('1.2');
  await fabrication.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(fabrication).toBeHidden();
  await guide.getByLabel('Guide step').selectOption({ label: 'Check the board' });
  await guide.getByRole('button', { name: 'Check this revision…' }).click();
  const checks = page.getByRole('dialog', { name: 'PCB design checks' });
  await expect(checks.getByRole('list', { name: 'PCB findings' })).toContainText('Copper is disconnected from every required terminal.');
  await expect(checks.getByText(/Silkscreen and courtyard · not applicable/)).toBeVisible();
  await expect(checks.getByRole('list', { name: 'PCB findings' })).toContainText('outside the selected fabrication profile');
  await checks.getByRole('button', { name: 'Waive finding…' }).click();
  await checks.getByRole('textbox', { name: 'Reason for waiver' }).fill('Intentional fixture test land');
  await checks.getByRole('button', { name: 'Save waiver' }).click();
  await expect(checks.getByText('Waived. Intentional fixture test land')).toBeVisible();
  await checks.getByRole('button', { name: 'Close', exact: true }).click();
  await guide.getByRole('button', { name: 'Next step' }).click();
  await guide.getByRole('button', { name: 'Open manufacturing preview…' }).click();
  const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
  await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible();
  await expect(cam.locator('[data-plating="plated"]')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
  expect((await download).suggestedFilename()).toBe('pcb-cam-preview.zip');
  await cam.getByText('Home-etch print templates', { exact: true }).click();
  await cam.getByLabel('Print orientation').selectOption('mirrored');
  const drillDownload = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download drill template' }).click();
  const etchDrill = await drillDownload;
  expect(etchDrill.suggestedFilename()).toMatch(/^pcb-home-etch-drill-mirrored-r\d+\.svg$/);
  const print = await readFile(await etchDrill.path(), 'utf8');
  expect(print).toContain('MIRRORED · X reflected');
  expect(print).toContain('data-slot-mm=');
  expect(print).toContain('data-calibration-mm="10"');
  expect(print).toContain('No hole plating');
  await cam.getByRole('button', { name: 'Close', exact: true }).click();
  await guide.getByRole('button', { name: 'Close guide' }).click();
  await expect(guide).toBeHidden();
  await expect(openGuide).toBeFocused();
  await page.evaluate(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
      return kind === 'webgl2' ? null : getContext.call(this, kind, ...options);
    };
  });
  await board.getByRole('button', { name: 'Inspect in 3D…' }).click();
  const offlineViewer = page.getByRole('dialog', { name: '3D board inspection' });
  await expect(offlineViewer.getByRole('alert')).toContainText('WebGL 2 is unavailable');
  await offlineViewer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(board.getByRole('img', { name: 'Board layout' })).toBeVisible();
  await board.getByRole('button', { name: 'Save As…' }).click();
  await expect(board.getByText('Copy.dpn', { exact: true })).toBeVisible();
  const saved = await api.decodeBoard(
    Uint8Array.from(await page.evaluate(() => window.savedBoard)),
  );
  expect(saved.boardId).toBe(source.boardId);
  expect(saved.copperLayers).toHaveLength(1);
  expect(
    saved.profile.outline.filter(({ kind }) => kind === 'arc'),
  ).toHaveLength(4);
  expect(saved.profile.cutouts).toHaveLength(1);
  expect(saved.mechanicalHoles).toHaveLength(1);
  expect(saved.mechanicalHoles[0].plated).toBe(true);
  expect(saved.tracks).toHaveLength(1);
  expect(saved.zones).toHaveLength(1);
  expect(saved.waivers).toHaveLength(1);
  expect(saved.fabrication).toEqual({ profileId: 'classroom-v1', thicknessNm: 1_200_000 });
  expect(saved.zones[0]).toMatchObject({ netId: signal, islands: 'retain' });
  expect(saved.tracks[0]).toMatchObject({
    netId: signal,
    start: { x: 15_000_000, y: 9_000_000 },
    end: { x: 20_000_000, y: 9_000_000 },
  });
  expect(errors).toEqual([]);
});


test('reviews unsupported KiCad via spans and downloads their source records', async ({ page }) => {
  const api = await layoutRuntime();
  const base = api.createBoard('Local board', 2, [
    { x: 0, y: 0 }, { x: 24e6, y: 0 }, { x: 24e6, y: 16e6 }, { x: 0, y: 16e6 },
  ]);
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Local.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Local.dpn'),
      createWritable: async () => ({
        write: async (value) => { window.savedLocalBoard = [...value]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(base)]);
  const fixture = await readFile(new URL('../fixtures/kicad-via-review.kicad_pcb', import.meta.url));
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('button', { name: 'Review KiCad board…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review KiCad board' });
  await dialog.getByLabel('KiCad board file').setInputFiles({
    name: 'mixed.kicad_pcb', mimeType: 'application/octet-stream', buffer: fixture,
  });
  await expect(dialog.getByRole('status')).toContainText('3 unsupported of 4 vias');
  const list = dialog.getByRole('list', { name: 'Unsupported KiCad vias' });
  for (const text of ['Blind via 2 · F.Cu → In1.Cu', 'Buried via 3 · In1.Cu → In2.Cu', 'Microvia 4 · In2.Cu → B.Cu'])
    await expect(list).toContainText(text);
  await expect(dialog.getByText('Production export is unavailable for this review.')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download via report…' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('mixed.via-review.json');
  const report = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(report.productionExportAllowed).toBe(false);
  expect(report.unsupportedVias.map(({ kind }) => kind)).toEqual(['blind', 'buried', 'microvia']);
  expect(report.unsupportedVias.every(({ expression }) => fixture.includes(expression))).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  const original = [...await api.encodeBoard(base)];
  await expect.poll(() => page.evaluate(() => window.savedLocalBoard)).toEqual(original);
});

test('uses Beginner routing defaults without weakening board rules or checks', async ({ page }) => {
  const api = await layoutRuntime();
  const base = api.createBoard('Teaching view fixture', 1, [
    { x: 0, y: 0 }, { x: 30e6, y: 0 }, { x: 30e6, y: 20e6 }, { x: 0, y: 20e6 },
  ]);
  const netId = crypto.randomUUID();
  const source = {
    ...base,
    requiredFeatures: ['straight-outline', 'routed-copper'],
    nets: [{ id: netId, name: 'Supply' }],
    rules: { minWidthNm: 620_000, clearanceNm: 250_000, edgeClearanceNm: 300_000, minViaAnnulusNm: 180_000 },
    tracks: [{ id: crypto.randomUUID(), netId, layerId: 'top', widthNm: 300_000,
      start: { x: 5e6, y: 13e6 }, end: { x: 10e6, y: 13e6 } }],
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Teaching.dpn',
      getFile: async () => new File([new Uint8Array(window.teachingSaved ?? bytes)], 'Teaching.dpn'),
      createWritable: async () => ({
        write: async (value) => { window.teachingSaved = [...value]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const mode = workspace.getByLabel('PCB view');
  await expect(mode).toHaveValue('engineering');
  const inspection = page.getByRole('dialog', { name: 'PCB design checks' });
  const readFinding = async () => {
    await workspace.getByRole('button', { name: 'Run design checks…' }).click();
    const issue = inspection.getByRole('listitem').filter({ hasText: 'Track is narrower than the board minimum.' });
    await expect(issue).toContainText('Measured 0.3 mm. Required 0.62 mm.');
    const text = await issue.innerText();
    await inspection.getByRole('button', { name: 'Close', exact: true }).click();
    return text;
  };
  const engineeringFinding = await readFinding();
  await mode.selectOption('beginner');
  const guide = workspace.getByRole('region', { name: 'First board guide' });
  await expect(guide).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Measure distance' })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Export KiCad board…' })).toHaveCount(0);
  expect(await readFinding()).toBe(engineeringFinding);
  await workspace.getByRole('button', { name: 'Fabrication settings…' }).click();
  const fabrication = page.getByRole('dialog', { name: 'Fabrication settings' });
  await expect(fabrication.getByLabel('Minimum track width (mm)')).toHaveCount(0);
  await fabrication.getByRole('combobox', { name: 'Fabrication profile' }).selectOption('classroom-v1');
  await fabrication.getByRole('button', { name: 'Apply', exact: true }).click();
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await expect(workspace.getByText('Track width 0.62 mm')).toBeVisible();
  await expect(mode).toBeDisabled();
  await workspace.getByLabel('Board net').selectOption(netId);
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  for (const x of [5e6, 15e6]) {
    const where = await canvas.evaluate((svg, x) => {
      const point = new DOMPoint(x, -6e6).matrixTransform(svg.getScreenCTM());
      return { x: point.x, y: point.y };
    }, x);
    await page.mouse.click(where.x, where.y);
  }
  await workspace.getByRole('button', { name: 'Finish route' }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.teachingSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.teachingSaved)));
  expect(saved.rules).toEqual(source.rules);
  expect(saved.tracks[1].widthNm).toBe(source.rules.minWidthNm);
  await page.getByRole('button', { name: 'Circuit Design', exact: true }).click();
  await page.getByRole('button', { name: 'PCB Design', exact: true }).click();
  await expect(mode).toHaveValue('beginner');
  await mode.selectOption('engineering');
  await expect(workspace.getByRole('button', { name: 'Measure distance' })).toBeVisible();
  await expect(canvas.locator('[data-track]')).toHaveCount(2);
});

test('moves selected footprints together and undoes them as one edit', async ({ page }) => {
  const api = await layoutRuntime();
  const source = placementFixture(api);
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Group.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Group.dpn'),
      createWritable: async () => ({
        write: async (data) => {
          if (window.failGroupSave) throw new Error('Simulated write failure');
          window.groupSaved = [...data];
        },
        close: async () => {},
        abort: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('list', { name: 'Placed components', exact: true })
    .getByRole('button', { name: 'U1', exact: true }).click();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const secondPad = canvas.locator('[data-component="' + source.components[1].id + '"] path').first();
  await secondPad.click({ modifiers: ['Shift'] });
  await expect(canvas.locator('[data-placement-group="true"]')).toHaveCount(2);
  await workspace.getByLabel('Include U2 in placement group').uncheck();
  await expect(canvas.locator('[data-placement-group="true"]')).toHaveCount(1);
  await workspace.getByLabel('Include U2 in placement group').check();
  const group = workspace.getByRole('group', { name: 'Placement group' });
  await group.getByLabel('Group X offset (mm)').fill('2');
  await group.getByLabel('Group Y offset (mm)').fill('3');
  const apply = group.getByRole('button', { name: 'Apply group placement' });
  const [first, second] = source.footprints;
  const x = (part) => canvas.locator('[data-component="' + part.componentId + '"] text').locator('..');
  await page.evaluate(() => { window.failGroupSave = true; });
  await apply.click();
  await expect(x(first)).toHaveAttribute('transform', /^translate\(12000000 /);
  await expect(x(second)).toHaveAttribute('transform', /^translate\(17000000 /);
  expect(await page.evaluate(() => window.groupSaved)).toBeUndefined();
  const save = workspace.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(workspace.getByRole('alert')).toContainText('Simulated write failure');
  await expect(x(first)).toHaveAttribute('transform', /^translate\(12000000 /);
  await expect(workspace.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.failGroupSave = false; });
  await save.click();
  await expect.poll(() => page.evaluate(() => window.groupSaved?.length ?? 0)).toBeGreaterThan(0);
  await expect(x(first)).toHaveAttribute('transform', /^translate\(12000000 /);
  await expect(x(second)).toHaveAttribute('transform', /^translate\(17000000 /);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.groupSaved)));
  expect(saved.revision).toBe(source.revision + 1);
  expect(saved.footprints[1].side).toBe('bottom');
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(x(first)).toHaveAttribute('transform', /^translate\(10000000 /);
  await expect(x(second)).toHaveAttribute('transform', /^translate\(15000000 /);
});

test('searches, previews and places queued footprints in order', async ({ page }) => {
  const api = await layoutRuntime();
  const fixture = placementFixture(api);
  const source = {
    ...fixture,
    footprints: [],
    components: fixture.components.map((part, index) => ({
      ...part,
      value: index === 0 ? 'Marker' : 'Connector',
    })),
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Queue.dpn',
      getFile: async () => new File([new Uint8Array(window.queueSaved ?? bytes)], 'Queue.dpn'),
      createWritable: async () => ({
        write: async (data) => {
          if (window.failQueueSave) throw new Error('Simulated write failure');
          window.queueSaved = [...data];
        },
        close: async () => {},
        abort: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const tray = workspace.getByRole('region', { name: 'Unplaced components' });
  const results = tray.getByRole('list', { name: 'Unplaced components' });
  const search = tray.getByLabel('Search unplaced components');
  await workspace.getByRole('button', { name: 'First board guide', exact: true }).click();
  const guide = workspace.getByRole('region', { name: 'First board guide' });
  await guide.getByLabel('Guide step').selectOption({ label: 'Place footprints' });
  await expect(guide).toContainText('3 components to place');
  await guide.getByRole('button', { name: 'Go to unplaced components' }).click();
  await expect(search).toBeFocused();
  await search.fill('GROUP TEST');
  await expect(results.getByRole('listitem')).toHaveCount(3);
  await search.fill('marker');
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await results.getByRole('button', { name: 'U1 · Marker' }).click();
  await expect(tray.getByRole('img', { name: 'Footprint pad preview' })).toBeVisible();
  await tray.getByLabel('Queue U1 for placement').check();
  await search.fill('u2');
  await tray.getByLabel('Queue U2 for placement').check();
  await tray.getByRole('button', { name: 'Start sequential placement' }).click();
  const position = (label) => workspace.getByLabel(label, { exact: true });
  const save = workspace.getByRole('button', { name: 'Place at coordinates' });
  await expect(tray.getByRole('status')).toHaveText('2 remaining · Place U1');
  await expect(save).toBeDisabled();
  await position('X (mm)').fill('-1');
  await position('Y (mm)').fill('10');
  await page.evaluate(() => { window.failQueueSave = true; });
  await save.click();
  await expect(workspace.getByRole('alert')).toContainText('inside the board outline');
  await expect(tray.getByRole('status')).toHaveText('2 remaining · Place U1');
  await position('X (mm)').fill('11');
  await save.click();
  await expect(tray.getByRole('status')).toHaveText('1 remaining · Place U2');
  await expect(save).toBeDisabled();
  await position('X (mm)').fill('20');
  await position('Y (mm)').fill('13');
  await save.click();
  await expect(tray.getByRole('status')).toBeHidden();
  await expect(guide).toContainText('1 component');
  await expect(tray.getByText('No components match this search.')).toBeVisible();
  expect(await page.evaluate(() => window.queueSaved)).toBeUndefined();
  await page.evaluate(() => { window.failQueueSave = false; });
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.queueSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.queueSaved)));
  expect(saved.footprints.map(({ componentId }) => componentId)).toEqual(
    source.components.slice(0, 2).map(({ id }) => id),
  );
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(results.getByRole('button', { name: 'U2 · Connector' })).toBeVisible();
  await expect(workspace.getByRole('list', { name: 'Placed components', exact: true })).toContainText('U1');
});

test('builds and reopens a manually connected standalone PCB', async ({ page }) => {
  const api = await layoutRuntime();
  const fixture = placementFixture(api);
  const { definitionDigest: ignored, ...footprint } = fixture.footprintDefinitions[0];
  const signalId = crypto.randomUUID();
  const reviewedDevice = await api.writeLibraryDevice({
    format: 'tinycad-device', version: 1, id: crypto.randomUUID(), revision: '1',
    name: 'Test terminal', packageNames: ['Terminal'], mount: 'surface-mount',
    bodyNm: { width: 450_000, height: 450_000 }, source: 'Synthetic browser test',
    license: 'CC0-1.0', review: { by: 'Test fixture', evidence: 'Synthetic dimensions' },
    footprint: { ...footprint, definitionDigest: await api.deviceDigest(footprint) },
    terminals: [{ id: signalId, name: 'Contact' }],
    assignments: [{ padId: footprint.pads[0].id, kind: 'signal', signalId }],
  });
  await page.addInitScript(() => {
    const handle = {
      name: 'Manual.dpn',
      kind: 'file',
      getFile: async () => new File([new Uint8Array(window.manualPcb)], 'Manual.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.manualPcb = [...data]; },
        close: async () => {},
      }),
    };
    window.showOpenFilePicker = async () => [handle];
    window.boardPickerCalls = 0;
    window.showSaveFilePicker = async () => {
      window.boardPickerCalls += 1;
      return handle;
    };
  });
  await page.goto(app.baseURL + '?workspace=pcb');
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const connectionButton = workspace.getByRole('button', { name: 'Board connections…' });
  const dialog = page.getByRole('dialog', { name: 'PCB connections' });
  const netName = dialog.getByLabel('Net name');
  await connectionButton.click();
  await netName.fill('Supply');
  await dialog.getByRole('button', { name: 'Add net' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Board net added.');
  await netName.fill('supply');
  await dialog.getByRole('button', { name: 'Add net' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('That name already belongs to a board net.');
  await netName.fill('');
  for (const reference of ['J1', 'J2']) {
    await dialog.getByLabel('Reviewed device file').setInputFiles({
      name: 'terminal.tcdevice.json', mimeType: 'application/json', buffer: Buffer.from(reviewedDevice),
    });
    await dialog.getByLabel('Component reference').fill(reference);
    await dialog.getByRole('button', { name: 'Add device' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Device added to unplaced components.');
    await dialog.getByLabel('Component', { exact: true }).selectOption({ label: reference });
    await dialog.getByLabel('Electrical pads').selectOption({ label: '1' });
    await dialog.getByLabel('Assign to net').selectOption({ label: 'Supply' });
    await dialog.getByRole('button', { name: 'Apply pad assignment' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Pad assignment updated.');
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const tray = workspace.getByRole('region', { name: 'Unplaced components' });
  for (const [index, reference] of ['J1', 'J2'].entries()) {
    await tray.getByRole('button', { name: reference + ' · Test terminal' }).click();
    await workspace.getByLabel('X (mm)', { exact: true }).fill(String(10 + 10 * index));
    await workspace.getByLabel('Y (mm)', { exact: true }).fill('10');
    await workspace.getByRole('button', { name: 'Place at coordinates' }).click();
    await expect(canvas.locator('[data-component]')).toHaveCount(index + 1);
  }
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await workspace.getByLabel('Board net').selectOption({ label: 'Supply' });
  await workspace.getByText('Enter route coordinates', { exact: true }).click();
  for (const x of ['10', '20']) {
    await workspace.getByLabel('Waypoint X (mm)').fill(x);
    await workspace.getByLabel('Waypoint Y (mm)').fill('10');
    await workspace.getByRole('button', { name: 'Add waypoint' }).click();
    await expect(workspace.getByLabel('Route waypoints')).toContainText('X ' + x + ' mm');
  }
  await workspace.getByRole('button', { name: 'Finish route' }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  expect(await page.evaluate(() => [window.boardPickerCalls, window.manualPcb])).toEqual([0, undefined]);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.boardPickerCalls)).toBe(1);
  const readBoard = async () => api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.manualPcb)));
  await expect.poll(async () => (await readBoard()).tracks?.length).toBe(1);
  const saved = await readBoard();
  const [net] = saved.nets;
  expect(saved.nets.map(({ name }) => name)).toEqual(['Supply']);
  expect(saved.deviceDefinitions).toHaveLength(1);
  expect(saved.footprintDefinitions).toHaveLength(1);
  expect(saved.components.map(({ signals }) => signals)).toEqual([
    [{ signalId, netId: net.id }], [{ signalId, netId: net.id }],
  ]);
  expect(saved.tracks[0]).toMatchObject({
    netId: net.id, start: { x: 10e6, y: 10e6 }, end: { x: 20e6, y: 10e6 },
  });
  const kernel = await api.loadPolygonKernel(await readFile(
    new URL('../../../node_modules/clipper2-wasm/dist/es/clipper2z.wasm', import.meta.url),
  ));
  const { features, drills } = api.boardCopperGeometry(saved);
  const copper = api.analyseCopper(kernel, features, drills);
  expect(copper.shorts).toEqual([]);
  expect(copper.assembledOpens.nets).toEqual([]);
  await workspace.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await connectionButton.click();
  await dialog.getByLabel('Component', { exact: true }).selectOption({ label: 'J2' });
  await dialog.getByLabel('Electrical pads').selectOption({ label: '1' });
  await expect(dialog.getByLabel('Assign to net')).toHaveValue(net.id);
  await dialog.getByLabel('Assign to net').selectOption('');
  await dialog.getByRole('button', { name: 'Apply pad assignment' }).click();
  await expect(dialog.getByRole('status')).toContainText('Run design checks');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await connectionButton.click();
  await dialog.getByLabel('Component', { exact: true }).selectOption({ label: 'J2' });
  await dialog.getByLabel('Electrical pads').selectOption({ label: '1' });
  await expect(dialog.getByLabel('Assign to net')).toHaveValue(net.id);
});

test('keeps independent placement locks through edits and reopening', async ({ page }) => {
  const api = await layoutRuntime();
  const source = placementFixture(api);
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Locked.dpn',
      getFile: async () => new File([new Uint8Array(window.lockSaved ?? bytes)], 'Locked.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.lockSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  const open = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  };
  await open();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const select = workspace.getByRole('list', { name: 'Placed components', exact: true })
    .getByRole('button', { name: 'U1', exact: true });
  await select.click();
  const position = workspace.getByRole('group', { name: 'Position U1' });
  const x = position.getByLabel('X (mm)', { exact: true });
  const rotation = position.getByLabel('Rotation (°)', { exact: true });
  const lockPosition = position.getByLabel('Lock position', { exact: true });
  const lockRotation = position.getByLabel('Lock rotation', { exact: true });
  await x.fill('12');
  await lockPosition.check();
  await expect(x).toBeDisabled();
  await expect(x).toHaveValue('10');
  await rotation.fill('90');
  await position.getByRole('button', { name: 'Apply position' }).click();
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => {
    const bytes = await page.evaluate(() => window.lockSaved);
    if (!bytes) return;
    const saved = await api.decodeBoard(Uint8Array.from(bytes));
    return saved.footprints[0].rotationMicrodegree;
  }).toBe(90_000_000);

  await lockRotation.check();
  await expect(rotation).toBeDisabled();
  await position.getByRole('button', { name: 'Lock component', exact: true }).click();
  await expect(position.getByLabel('Board side', { exact: true })).toBeDisabled();
  await expect(position.getByRole('button', { name: 'Apply position' })).toBeDisabled();
  await position.getByRole('button', { name: 'Unlock component', exact: true }).click();
  await expect(lockPosition).toBeChecked();
  await expect(lockRotation).toBeChecked();
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => {
    const bytes = await page.evaluate(() => window.lockSaved);
    return (await api.decodeBoard(Uint8Array.from(bytes))).footprints[0];
  }).toMatchObject({
    positionLocked: true, rotationLocked: true, locked: false,
    positionNm: source.footprints[0].positionNm, rotationMicrodegree: 90_000_000,
  });
  await workspace.getByRole('button', { name: 'Close', exact: true }).click();
  await open();
  await select.click();
  await expect(lockPosition).toBeChecked();
  await expect(lockRotation).toBeChecked();
  await expect(x).toBeDisabled();
  await expect(rotation).toHaveValue('90');
});

test('previews transformed placement airwires without editing the board', async ({ page }) => {
  const api = await layoutRuntime();
  const fixture = placementFixture(api);
  const signalId = crypto.randomUUID();
  const netId = crypto.randomUUID();
  const [device] = fixture.deviceDefinitions;
  const [footprint] = fixture.footprintDefinitions;
  const [pad] = footprint.pads;
  const source = {
    ...fixture,
    nets: [{ id: netId, name: 'Supply' }],
    components: fixture.components.map((component) => ({
      ...component,
      role: 'electrical',
      signals: [{ signalId, netId }],
    })),
    deviceDefinitions: [{
      ...device,
      signalIds: [signalId],
      assignments: [{ padId: pad.id, kind: 'signal', signalId }],
    }],
    footprintDefinitions: [{
      ...footprint,
      pads: [{ ...pad, positionNm: { x: 1_000_000, y: 2_000_000 } }],
    }],
    footprints: fixture.footprints.slice(0, 1),
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Airwires.dpn',
      getFile: async () => new File(
        [new Uint8Array(window.airwireSaved ?? bytes)], 'Airwires.dpn',
      ),
      createWritable: async () => ({
        write: async (data) => { window.airwireSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('list', { name: 'Unplaced components', exact: true })
    .getByRole('button', { name: 'U2' }).click();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const preview = canvas.locator('[data-placement-preview]');
  const guide = preview.locator('[data-placement-airwire]');
  const placeOnBoard = workspace.getByRole('button', { name: 'Place on board', exact: true });
  const footprintImage = workspace.getByRole('img', { name: 'Footprint pad preview' });
  await footprintImage.dragTo(canvas);
  await expect(preview).toHaveCount(1);
  await canvas.click({ button: 'right' });
  await expect(preview).toHaveCount(0);
  await placeOnBoard.focus();
  await page.keyboard.press('Enter');
  await canvas.hover();
  await expect(preview).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await placeOnBoard.click();
  const x = workspace.getByLabel('X (mm)', { exact: true });
  const y = workspace.getByLabel('Y (mm)', { exact: true });
  await x.fill('20');
  await y.fill('18');
  await workspace.getByLabel('Rotation (°)', { exact: true }).fill('90');
  await workspace.getByLabel('Board side', { exact: true }).selectOption('bottom');
  await expect(guide).toHaveAttribute('d', 'M18000000,-17000000 L11000000,-12000000');
  await expect(preview.getByText('8.60 mm')).toHaveCount(0);
  await workspace.getByLabel('Show straight-line estimates').check();
  await expect(preview.getByText('8.60 mm')).toBeVisible();

  const pointer = await canvas.evaluate((svg) => {
    const point = new DOMPoint(24_000_000, -23_000_000).matrixTransform(svg.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(pointer.x, pointer.y);
  await expect(guide).toHaveAttribute('d', 'M22000000,-22000000 L11000000,-12000000');
  await expect(preview.getByText('14.87 mm')).toBeVisible();
  await expect(x).toHaveValue('20');
  await expect(y).toHaveValue('18');
  await expect(canvas.locator('[data-component]')).toHaveCount(1);
  expect(await page.evaluate(() => window.airwireSaved)).toBeUndefined();

  await page.mouse.click(pointer.x, pointer.y);
  await expect(x).toHaveValue('24');
  await expect(y).toHaveValue('23');
  await expect(canvas.locator('[data-component]')).toHaveCount(2);
  await expect(page).toHaveTitle('TinyCAD - Airwires.dpn*');
  await expect(page.locator('.top-bar-left')).toContainText('Airwires.dpn*');
  await page.mouse.move(pointer.x + 35, pointer.y + 20);
  await expect(preview).toHaveCount(0);
  expect(await page.evaluate(() => window.airwireSaved)).toBeUndefined();
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.airwireSaved?.length ?? 0)).toBeGreaterThan(0);
  const savedBytes = await page.evaluate(() => window.airwireSaved);
  const saved = await api.decodeBoard(Uint8Array.from(savedBytes));
  expect(saved.footprints[1]).toMatchObject({
    componentId: source.components[1].id,
    positionNm: { x: 24_000_000, y: 23_000_000 },
    rotationMicrodegree: 90_000_000,
    side: 'bottom',
  });
  expect(saved.tracks ?? []).toEqual([]);
  const placedFootprint = canvas.locator('[data-component="' + source.components[1].id + '"]');
  await placedFootprint.locator('path').first().click({ button: 'right' });
  const moveCommand = page.getByRole('menuitem', { name: 'Move on board', exact: true });
  await expect(moveCommand).toBeVisible();
  await moveCommand.click();
  await canvas.hover();
  await expect(preview).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await x.fill('26');
  await expect(preview).toHaveCount(0);
  expect(await page.evaluate(() => window.airwireSaved)).toEqual(savedBytes);

});

test('adds a wire jumper and keeps bare-copper connectivity separate', async ({ page }) => {
  const api = await layoutRuntime();
  const base = api.createBoard('Single-sided board', 1, [
    { x: 0, y: 0 }, { x: 30e6, y: 0 }, { x: 30e6, y: 20e6 }, { x: 0, y: 20e6 },
  ]);
  const netId = crypto.randomUUID();
  const source = { ...base, nets: [{ id: netId, name: 'Supply' }] };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Single.dpn',
      getFile: async () => new File([new Uint8Array(window.jumperSaved ?? bytes)], 'Single.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.jumperSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('button', { name: 'Add wire jumper…' }).click();
  const jumper = page.getByRole('dialog', { name: 'Add wire jumper' });
  await jumper.getByLabel('Jumper net').selectOption(netId);
  for (const [label, value] of [['A X', '8'], ['A Y', '6'], ['B X', '16'], ['B Y', '10']])
    await jumper.getByLabel(label + ' (mm)', { exact: true }).fill(value);
  await jumper.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(jumper).toBeHidden();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const land = canvas.locator('[data-jumper-end="A"]');
  await expect(land).toBeVisible();
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await land.click();
  await expect(workspace.getByLabel('Board net')).toHaveValue(netId);
  const second = await canvas.evaluate((svg) => {
    const p = new DOMPoint(5e6, -6e6).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(second.x, second.y);
  await workspace.getByRole('button', { name: 'Finish route' }).click();
  await expect.poll(() => canvas.locator('[data-track]').count()).toBeGreaterThan(0);

  const checks = page.getByRole('dialog', { name: 'PCB design checks' });
  const runChecks = async (expected) => {
    await workspace.getByRole('button', { name: 'Run design checks…' }).click();
    await expect(checks.getByRole('list', { name: 'PCB findings' })).toContainText(expected);
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
  };
  await runChecks('Separate bare copper islands require fitted wire jumpers');
  await workspace.getByRole('button', { name: 'Edit JP1…' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit wire jumper' });
  await edit.getByLabel('Fit jumper').uncheck();
  await edit.getByRole('button', { name: 'Apply', exact: true }).click();
  await runChecks('Required terminals remain in separate copper islands');
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.jumperSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.jumperSaved)));
  expect(saved.jumpers[0]).toMatchObject({ netId, reference: 'JP1', fitted: false });
  const [wire] = saved.jumpers;
  const { start } = saved.tracks[0];
  const distance = Math.hypot(start.x - wire.start.x, start.y - wire.start.y);
  expect(distance).toBeGreaterThan(wire.drillNm / 2);
  expect(distance).toBeLessThan(wire.landWidthNm / 2);
  expect(saved.tracks.at(-1).end).toEqual({ x: 5e6, y: 6e6 });
});

test('edits a net class and per-net rules used by the route inspector', async ({ page }) => {
  const api = await layoutRuntime();
  const signal = crypto.randomUUID();
  const other = crypto.randomUUID();
  const base = api.createBoard('Net rule editing', 2, [
    { x: 0, y: 0 }, { x: 24e6, y: 0 }, { x: 24e6, y: 16e6 }, { x: 0, y: 16e6 },
  ]);
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: signal, name: 'Supply' }, { id: other, name: 'Signal' }],
    tracks: [{
      id: crypto.randomUUID(), netId: other, layerId: 'top', widthNm: 250_000,
      start: { x: 6e6, y: 7e6 }, end: { x: 17e6, y: 7e6 },
    }],
    vias: [{
      id: crypto.randomUUID(), netId: signal, positionNm: { x: 10e6, y: 7.9e6 },
      diameterNm: 800_000, drillNm: 400_000,
    }],
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Net rules.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Net rules.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.netRulesSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const open = workspace.getByRole('button', { name: 'Net rules…', exact: true });
  const dialog = page.getByRole('dialog', { name: 'PCB net rules' });
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
  await open.click();
  await dialog.getByLabel('Class name').fill('Power');
  await dialog.getByLabel('Minimum track width (mm)').fill('0.35');
  await dialog.getByLabel('Copper clearance (mm)').fill('0.6');
  await apply.click();
  await expect(dialog).toBeHidden();
  await open.click();
  await dialog.getByLabel('Edit rules for').selectOption('net:' + signal);
  await dialog.getByRole('combobox', { name: 'Net class', exact: true }).selectOption({ label: 'Power' });
  await dialog.getByLabel('Preferred track width (mm)').fill('0.45');
  await apply.click();
  await expect(dialog).toBeHidden();
  await open.click();
  await dialog.getByLabel('Edit rules for').selectOption('new-clearance');
  await dialog.getByLabel('Rule name').fill('Power via spacing');
  await dialog.getByLabel('First net class').selectOption({ label: 'Power' });
  await dialog.getByLabel('First object type').selectOption('via');
  await dialog.getByLabel('Second net class').selectOption('default');
  await dialog.getByLabel('Second object type').selectOption('track');
  await dialog.getByLabel('Minimum clearance (mm)').fill('0.8');
  await apply.click();
  await expect(dialog).toBeHidden();
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await workspace.getByLabel('Board net').selectOption(signal);
  const widths = workspace.getByLabel('Track width preset');
  await expect(widths.getByRole('option', { name: 'Minimum (0.35 mm)' })).toHaveCount(1);
  await expect(widths.getByRole('option', { name: 'Preferred (0.45 mm)' })).toHaveCount(1);
  await workspace.getByRole('button', { name: 'Cancel route', exact: true }).click();
  await workspace.getByRole('button', { name: 'Run design checks…' }).click();
  const checks = page.getByRole('dialog', { name: 'PCB design checks' });
  await expect(checks.getByRole('list', { name: 'Matched clearance rules' })).toContainText('Power via spacing · 0.8 mm');
  await checks.getByRole('button', { name: 'Close', exact: true }).click();
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.netRulesSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.netRulesSaved)));
  expect(saved.netClasses).toMatchObject([{ name: 'Power', rules: { minWidthNm: 350_000, clearanceNm: 600_000 } }]);
  expect(saved.nets.find(({ id }) => id === signal)).toMatchObject({
    classId: saved.netClasses[0].id, routingRules: { preferredWidthNm: 450_000 },
  });
  expect(saved.clearanceRules).toMatchObject([{
    name: 'Power via spacing', firstClass: saved.netClasses[0].id, firstKind: 'via',
    secondClass: 'default', secondKind: 'track', clearanceNm: 800_000,
  }]);
});

test('applies board track-width, through-via presets and solder mask tenting to a saved route', async ({ page }) => {
  const api = await layoutRuntime();
  const point = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const base = api.createBoard('Routing presets', 2, [point(0, 0), point(24, 0), point(24, 16), point(0, 16)]);
  const netId = crypto.randomUUID();
  const source = { ...base, nets: [{ id: netId, name: 'Signal' }] };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Presets.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Presets.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.presetsSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('button', { name: 'Fabrication settings…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fabrication settings' });
  await dialog.getByLabel('Fabrication profile').selectOption('classroom-v1');
  await dialog.getByLabel('Preferred track width (mm)').fill('0.4');
  await dialog.getByLabel('Maximum track width (mm)').fill('0.22');
  await dialog.getByLabel('Minimum via annular ring (mm)').fill('0.25');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Maximum track width is below the effective minimum');
  await dialog.getByLabel('Maximum track width (mm)').fill('0.45');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await workspace.getByLabel('Board net').selectOption(netId);
  const width = workspace.getByLabel('Track width preset');
  await expect(width.getByRole('option', { name: 'Minimum (0.25 mm)' })).toHaveCount(1);
  await expect(width.getByRole('option', { name: 'Preferred (0.4 mm)' })).toHaveCount(1);
  await expect(workspace.getByText('Maximum track width 0.45 mm')).toBeVisible();
  const style = workspace.getByLabel('Through-via style');
  await expect(style.getByRole('option', { name: 'Preferred (0.9 mm diameter, 0.4 mm drill)' })).toHaveCount(1);
  await width.selectOption('custom');
  await workspace.getByLabel('Track width (mm)').fill('0.5');
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const pick = async (x, y) => {
    const position = await canvas.evaluate((svg, p) => {
      const cursor = new DOMPoint(p.x, -p.y).matrixTransform(svg.getScreenCTM());
      return [cursor.x, cursor.y];
    }, point(x, y));
    await page.mouse.click(...position);
  };
  await pick(5, 7);
  await pick(10, 7);
  await expect(workspace.getByRole('alert')).toContainText('Track width is above the board maximum.');
  await width.selectOption('preferred');
  await style.selectOption('preferred');
  await pick(10, 7);
  await workspace.getByLabel('Route layer').selectOption('bottom');
  await pick(17, 7);
  await workspace.getByRole('button', { name: 'Finish route' }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(2);
  await canvas.locator('[data-via]').click();
  const tenting = workspace.getByRole('combobox', { name: 'Via solder mask', exact: true });
  await expect(tenting).toHaveValue('both');
  await tenting.selectOption('top');
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tenting).toHaveValue('both');
  await workspace.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(tenting).toHaveValue('top');
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.presetsSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.presetsSaved)));
  expect(saved.rules).toMatchObject({
    minWidthNm: 180_000, preferredWidthNm: 400_000, maxWidthNm: 450_000,
    clearanceNm: 200_000, edgeClearanceNm: 250_000,
  });
  expect(saved.tracks.map(({ widthNm, layerId }) => [widthNm, layerId])).toEqual([[400_000, 'top'], [400_000, 'bottom']]);
  expect(saved.vias).toMatchObject([{
    netId, positionNm: point(10, 7), diameterNm: 900_000, drillNm: 400_000, tenting: 'top',
  }]);
});

test('creates a routing region and enforces its width and clearance in the router', async ({ page }) => {
  const api = await layoutRuntime();
  const point = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const netId = crypto.randomUUID();
  const foreign = crypto.randomUUID();
  const base = api.createBoard('Routing region', 2, [point(0, 0), point(24, 0), point(24, 16), point(0, 16)]);
  const source = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: netId, name: 'Signal' }, { id: foreign, name: 'Foreign' }],
    tracks: [{
      id: crypto.randomUUID(), netId: foreign, layerId: 'top', widthNm: 250_000,
      start: point(4, 9.25), end: point(16, 9.25),
    }],
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Region.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Region.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.regionSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('button', { name: 'Add routing region…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add routing region' });
  await dialog.getByLabel('Name', { exact: true }).fill('Wide corridor');
  await dialog.getByLabel('Copper layers').selectOption('top');
  await dialog.getByLabel('Outline (X, Y in mm)').fill('8, 5\n13, 5\n13, 10\n8, 10');
  await dialog.getByLabel('Minimum track width (mm)').fill('0.4');
  await dialog.getByLabel('Copper clearance (mm)').fill('0.6');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  await expect(canvas.locator('[data-routing-region]')).toBeVisible();
  const screen = (x, y) => canvas.evaluate((svg, p) => {
    const cursor = new DOMPoint(p.x, -p.y).matrixTransform(svg.getScreenCTM());
    return [cursor.x, cursor.y];
  }, point(x, y));
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await workspace.getByLabel('Board net').selectOption(netId);
  await page.mouse.click(...await screen(4, 7));
  await page.mouse.move(...await screen(16, 7));
  const preview = canvas.locator('[data-route-preview]');
  await expect(preview).toHaveAttribute('data-route-preview', 'blocked');
  await page.mouse.click(...await screen(16, 7));
  await expect(workspace.getByRole('alert')).toContainText('routing region');
  await workspace.getByLabel('Track width preset').selectOption('custom');
  await workspace.getByLabel('Track width (mm)').fill('0.45');
  await page.mouse.move(...await screen(15, 7));
  await expect(preview).toHaveAttribute('data-route-preview', 'clear');
  await page.mouse.click(...await screen(16, 7));
  await workspace.getByRole('button', { name: 'Finish route' }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await page.mouse.click(...await screen(4, 8.5));
  await page.mouse.move(...await screen(16, 8.5));
  await expect(preview).toHaveAttribute('data-route-preview', 'blocked');
  await page.mouse.click(...await screen(16, 8.5));
  await expect(workspace.getByRole('alert')).toContainText('routing region');
  await workspace.getByRole('button', { name: 'Cancel route', exact: true }).click();
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.regionSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.regionSaved)));
  expect(saved.routingRegions).toMatchObject([{ name: 'Wide corridor', minWidthNm: 400_000, clearanceNm: 600_000, side: 'top' }]);
  expect(saved.tracks.find((track) => track.netId === netId)).toMatchObject({
    netId, start: point(4, 7), end: point(16, 7), widthNm: 450_000,
  });
});

const decimalCommaBrowser = test.extend({ locale: 'de-DE' });

decimalCommaBrowser('stops a manual route at foreign copper and saves horizontal vertical and diagonal legs', async ({ page }) => {
  await holdPcbWorkerReplies(page);
  await page.addInitScript(() => localStorage.setItem('tinycad.language', 'en'));
  const api = await layoutRuntime();
  const point = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const base = api.createBoard('Manual route obstacle', 1, [point(0, 0), point(24, 0), point(24, 20), point(0, 20)]);
  const signal = crypto.randomUUID();
  const foreign = crypto.randomUUID();
  const obstacle = {
    id: crypto.randomUUID(), netId: foreign, layerId: 'top', widthNm: 400_000,
    start: point(10, 2), end: point(10, 13), locked: true,
  };
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: signal, name: 'Signal' }, { id: foreign, name: 'Foreign' }],
    tracks: [obstacle],
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Obstacle.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Obstacle.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.obstacleSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const screen = (x, y) => canvas.evaluate((svg, { x, y }) => {
    const cursor = new DOMPoint(x, -y).matrixTransform(svg.getScreenCTM());
    return [cursor.x, cursor.y];
  }, point(x, y));
  const finish = workspace.getByRole('button', { name: 'Finish route', exact: true });
  const routeToggle = workspace.getByRole('button', { name: 'Route track', exact: true });
  const clearance = workspace.getByRole('status', { name: 'Route clearance' });
  await routeToggle.press('Enter');
  await page.evaluate(() => { window.pcbReplies.hold = 'route-clearance'; });
  await workspace.getByLabel('Board net').selectOption(signal);
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await expect(clearance).toHaveText('Preparing route clearance…');
  await page.mouse.click(...await screen(4, 7));
  await page.evaluate(() => window.pcbReplies.release('Deliberate route preview failure'));
  await expect(clearance).toHaveText('Route preview unavailable. Deliberate route preview failure');
  const retry = workspace.getByRole('button', { name: 'Retry route preview', exact: true });
  await page.evaluate(() => { window.pcbReplies.hold = 'route-clearance'; });
  await retry.press('Enter');
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await expect(clearance).toHaveText('Preparing route clearance…');
  await expect(workspace.getByLabel('Route layer')).toBeFocused();
  await page.evaluate(() => window.pcbReplies.release());
  await expect(clearance).toHaveText('');
  // The first waypoint survives a failed clearance job.
  await page.mouse.move(...await screen(16, 10));
  const preview = canvas.locator('[data-route-preview]');
  await expect(preview).toHaveAttribute('data-route-preview', 'blocked');
  await expect(preview).toHaveAttribute('d', 'M4000000,-7000000 L13000000,-7000000 L16000000,-10000000');
  await page.mouse.click(...await screen(16, 10));
  await expect(workspace.getByRole('alert')).toContainText('Track blocked');
  await expect(finish).toBeDisabled();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await workspace.getByLabel('Route bend').selectOption('diagonal-first');
  await page.mouse.move(...await screen(7, 16));
  await expect(preview).toHaveAttribute('data-route-preview', 'clear');
  await expect(preview).toHaveAttribute('d', 'M4000000,-7000000 L7000000,-10000000 L7000000,-16000000');
  await page.mouse.click(...await screen(7, 16));
  await page.mouse.click(...await screen(16, 16));
  await page.evaluate(() => { window.pcbReplies.hold = 'route'; });
  await finish.click();
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await expect(finish).toBeDisabled();
  await workspace.getByRole('button', { name: 'Cancel route', exact: true }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await expect(workspace.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await workspace.getByLabel('Copper layers').selectOption('2');

  await page.evaluate(() => { window.pcbReplies.hold = 'route-clearance'; });
  await routeToggle.press('Enter');
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(2);
  await expect(clearance).toHaveText('Preparing route clearance…');
  await workspace.getByLabel('Route layer').press('Escape');
  await expect(routeToggle).toBeFocused();
  await expect(clearance).toHaveCount(0);
  expect(await page.evaluate(() => window.pcbReplies.cancelled())).toBe(true);
  // Deliver the earlier cancelled route and clearance replies.
  await page.evaluate(() => {
    window.pcbReplies.release();
    window.pcbReplies.release('Late cancelled clearance error');
  });
  await expect(workspace.getByRole('alert')).toHaveCount(0);
  await routeToggle.press('Enter');
  await expect(clearance).toHaveText('');
  await workspace.getByText('Enter route coordinates', { exact: true }).press('Enter');
  const waypoints = workspace.getByRole('status', { name: 'Route waypoints' });
  const x = workspace.getByLabel('Waypoint X (mm)', { exact: true });
  const y = workspace.getByLabel('Waypoint Y (mm)', { exact: true });
  async function enterPoint(a, b) {
    await x.fill(String(a));
    await y.fill(String(b));
    await y.press('Enter');
  }
  await enterPoint('4,0', '7,0');
  await expect(waypoints).toHaveText('Last point at X 4 mm, Y 7 mm.');
  await enterPoint(16, 10);
  await expect(workspace.getByRole('alert')).toContainText('Track blocked');
  await expect(waypoints).toHaveText('Last point at X 4 mm, Y 7 mm.');
  await enterPoint('7,0', '16,0');
  await expect(waypoints).toHaveText('Last point at X 7 mm, Y 16 mm.');
  await enterPoint(16, 16);
  await expect(waypoints).toHaveText('Last point at X 16 mm, Y 16 mm.');
  await page.evaluate(() => { window.pcbReplies.hold = 'route'; });
  await finish.press('Enter');
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await expect(finish).toBeDisabled();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await page.evaluate(() => window.pcbReplies.release(undefined, true));
  await expect(canvas.locator('[data-track]')).toHaveCount(4);
  await expect(workspace.getByRole('alert')).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.obstacleSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.obstacleSaved)));
  expect(saved.revision).toBe(board.revision + 2);
  expect(saved.copperLayers).toHaveLength(2);
  expect(saved.tracks.find(({ id }) => id === obstacle.id)).toEqual(obstacle);
  expect(saved.tracks.filter(({ netId }) => netId === signal).map(({ start, end }) => [start, end])).toEqual([
    [point(4, 7), point(7, 10)], [point(7, 10), point(7, 16)], [point(7, 16), point(16, 16)],
  ]);
});

test('snaps a rotated off-grid pad and an existing track at different zoom levels', async ({ page }) => {
  const api = await layoutRuntime();
  const base = placementFixture(api);
  const netId = crypto.randomUUID();
  const signalId = crypto.randomUUID();
  const footprint = base.footprintDefinitions[0];
  const pad = footprint.pads[0];
  const first = base.footprints[1];
  const padPosition = api.placeFootprintPoint({ x: 2_200_000, y: 0 }, first);
  const second = {
    ...base.footprints[2], side: 'bottom', rotationMicrodegree: 0,
    positionNm: { x: 30_000_000, y: padPosition.y },
  };
  const originalTrack = {
    id: crypto.randomUUID(), netId, layerId: 'bottom', widthNm: 450_000,
    start: { x: 22_000_000, y: padPosition.y },
    end: api.placeFootprintPoint({ x: 2_200_000, y: 0 }, second),
  };
  const source = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: netId, name: 'Signal' }],
    footprintDefinitions: [{ ...footprint, pads: [{
      ...pad,
      stack: { copper: { top: { kind: 'polygon', vertices: [
        { x: 1_700_000, y: -550_000 }, { x: 2_700_000, y: -550_000 },
        { x: 2_700_000, y: 550_000 }, { x: 1_700_000, y: 550_000 },
      ] } } },
    }] }],
    deviceDefinitions: [{
      ...base.deviceDefinitions[0],
      signalIds: [signalId],
      assignments: [{ padId: pad.id, kind: 'signal', signalId }],
    }],
    components: base.components.slice(1).map((component) => ({
      ...component, signals: [{ signalId, netId }],
    })),
    footprints: [first, second],
    tracks: [originalTrack],
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Copper.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Copper.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.copperSnapSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const findings = page.getByRole('dialog', { name: 'PCB design checks' });
  await workspace.getByRole('button', { name: 'Run design checks…' }).click();
  await expect(findings.getByText('Required terminals remain in separate copper islands.', { exact: true })).toBeVisible();
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  const viewPosition = (position) => canvas.evaluate((svg, { x, y }) => {
    const p = new DOMPoint(x, -y).matrixTransform(svg.getScreenCTM());
    return [p.x, p.y];
  }, position);
  const marker = canvas.locator('[data-route-snap]');
  const checkPadSnap = async () => {
    await page.mouse.move(...await viewPosition(padPosition));
    await expect(marker).toHaveAttribute('cx', String(padPosition.x));
    await expect(marker).toHaveAttribute('cy', String(-padPosition.y));
  };
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await workspace.getByLabel('Route layer').selectOption('bottom');
  await checkPadSnap();
  const initialView = await canvas.getAttribute('viewBox');
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Shift');
  await expect(canvas).not.toHaveAttribute('viewBox', initialView);
  await page.mouse.move(...await viewPosition({ x: padPosition.x + 400_000, y: padPosition.y }));
  await checkPadSnap();
  await page.mouse.click(...await viewPosition(padPosition));
  await expect(workspace.getByLabel('Board net')).toHaveValue(netId);
  const trackPick = { x: 24_300_000, y: padPosition.y };
  await page.mouse.move(...await viewPosition(trackPick));
  await expect(marker).toHaveAttribute('cy', String(-padPosition.y));
  const snappedTrackX = Number(await marker.getAttribute('cx'));
  expect(Math.abs(snappedTrackX - trackPick.x)).toBeLessThan(150_000);
  await page.mouse.click(...await viewPosition(trackPick));
  await workspace.getByRole('button', { name: 'Finish route' }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.copperSnapSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.copperSnapSaved)));
  const branch = saved.tracks.find(({ id }) => id !== originalTrack.id);
  expect(branch).toMatchObject({
    start: padPosition,
    end: { y: padPosition.y },
    layerId: 'bottom',
    netId,
  });
  expect(Math.abs(branch.end.x - snappedTrackX)).toBeLessThan(150_000);
  await workspace.getByRole('button', { name: 'Run design checks…' }).click();
  await expect(findings.getByRole('status')).toContainText('The implemented checks found no issues');
  await expect(findings.getByText('Physical connectivity · checked', { exact: true })).toBeVisible();
});

test('authors placement areas and locates their design check findings', async ({ page }) => {
  const api = await layoutRuntime();
  const source = placementFixture(api);
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Areas.dpn',
      getFile: async () => new File([new Uint8Array(window.areaSaved ?? bytes)], 'Areas.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.areaSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('button', { name: 'Add placement area…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add placement area' });
  await dialog.getByLabel('Name', { exact: true }).fill('Antenna clearance');
  await dialog.getByLabel('Assembly side').selectOption('top');
  await dialog.getByLabel('Outline (X, Y in mm)').fill('9, 9\n11, 9\n11, 11\n9, 11');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  await expect(canvas.locator('[data-placement-area]')).toHaveCount(1);
  const readView = async () => (await canvas.getAttribute('viewBox')).split(' ').map(Number);
  const fitBoard = workspace.getByRole('button', { name: 'Fit board', exact: true });
  const fitSelection = workspace.getByRole('button', { name: 'Fit selection', exact: true });
  const fullBoard = await readView();
  await expect(fitSelection).toBeDisabled();
  const canvasBox = await canvas.boundingBox();
  const middle = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(middle.x + 125, middle.y + 40);
  await page.mouse.up({ button: 'middle' });
  await expect.poll(readView).not.toEqual(fullBoard);
  await workspace.getByRole('button', { name: 'Run design checks…' }).click();
  const checks = page.getByRole('dialog', { name: 'PCB design checks' });
  const finding = checks.getByRole('list', { name: 'PCB findings' }).getByRole('listitem')
    .filter({ hasText: 'U1 origin intersects top keep-out' });
  await expect(finding).toContainText('Antenna clearance');
  await expect(checks.getByText(/Placement keep-in and keep-out areas · limited/)).toBeVisible();
  await finding.getByRole('button', { name: /U1 origin intersects top keep-out/ }).focus();
  await page.keyboard.press('Enter');
  await expect(checks).toBeHidden();
  await expect(workspace.getByRole('group', { name: 'Position U1' })).toBeVisible();
  await expect(canvas.locator('[data-check-marker]')).toHaveCount(1);
  const [left, top, width, height] = await readView();
  expect(left + width / 2).toBe(10e6);
  expect(top + height / 2).toBe(-10e6);
  expect(width).toBeLessThan(fullBoard[2]);
  await fitBoard.click();
  await expect.poll(readView).toEqual(fullBoard);
  await fitSelection.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readView())[2]).toBeLessThan(fullBoard[2]);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.areaSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.areaSaved)));
  expect(saved.placementAreas[0]).toMatchObject({ name: 'Antenna clearance', kind: 'keep-out', side: 'top' });
  expect(saved.footprints).toEqual(source.footprints);
  expect(saved.outline).toEqual(source.outline);
  await workspace.getByRole('button', { name: 'Remove Antenna clearance' }).click();
  await expect(canvas.locator('[data-placement-area]')).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvas.locator('[data-placement-area]')).toHaveCount(1);
});

test('shows a clipped thermal in design checks and the manufacturing review', async ({ page }) => {
  const api = await layoutRuntime();
  const { clipped } = thermalFixture(api);
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Thermal.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Thermal.dpn'),
    }];
  }, [...await api.encodeBoard(clipped)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await workspace.getByRole('button', { name: 'Run design checks…' }).click();
  const checks = page.getByRole('dialog', { name: 'PCB design checks' });
  const findings = checks.getByRole('list', { name: 'PCB findings' });
  await expect(findings.getByRole('listitem').filter({ hasText: /^East/ }))
    .toContainText(/Measured 0\.179\d+ mm\. Required 0\.3 mm/);
  await expect(findings).toContainText('North · Thermal spoke does not bridge the land and pour.');
  await checks.getByRole('button', { name: 'Close', exact: true }).click();
  await workspace.getByRole('button', { name: 'CAM read-back preview…' }).click();
  const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
  await cam.getByText(/Manufacturing review · .* release blockers/).click();
  const blockers = cam.getByRole('list', { name: 'Release blockers' });
  await expect(blockers).toContainText('East · Filled thermal spoke is below the required bridge width.');
  await expect(blockers).toContainText('North · Thermal spoke does not bridge the land and pour.');
});

test('moves and flips the asymmetric connector reference and exports the final drills', async ({ page }, info) => {
  test.setTimeout(90_000);
  const bytes = await readFile(new URL('../../../examples/pcb/connector/Connector.dpn', import.meta.url));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith(app.baseURL) && !/\.tplib($|\?)/.test(url) ? route.continue() : route.abort();
  });
  await page.addInitScript((source) => {
    window.showOpenFilePicker = async () => [{
      name: 'Connector.dpn',
      getFile: async () => new File([new Uint8Array(window.connectorSaved ?? source)], 'Connector.dpn'),
      createWritable: async () => ({
        write: async (data) => { window.connectorSaved = [...data]; },
        close: async () => {},
      }),
    }];
  }, [...bytes]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const part = workspace.getByRole('list', { name: 'Placed components', exact: true })
    .getByRole('button', { name: 'J1', exact: true });
  await part.click();
  const position = workspace.getByRole('group', { name: 'Position J1' });
  const centres = () => canvas.locator('[data-component] > path[fill-rule="evenodd"]').evaluateAll((paths) =>
    [...new Set(paths.map((path) => {
      const { x, y, width, height } = path.getBBox();
      return [(x + width / 2) / 1e6, -(y + height / 2) / 1e6].join(',');
    }))].sort());
  async function move(x, y, angle, side) {
    await position.getByLabel('X (mm)', { exact: true }).fill(x);
    await position.getByLabel('Y (mm)', { exact: true }).fill(y);
    await position.getByLabel('Rotation (°)', { exact: true }).fill(angle);
    await position.getByLabel('Board side', { exact: true }).selectOption(side);
    await position.getByRole('button', { name: 'Apply position' }).click();
  }
  await expect.poll(centres).toEqual(['26,10.5', '26,16.5', '30.7,13.5']);
  await move('16', '16', '0', 'top');
  await expect.poll(centres).toEqual(['16.5,16', '19.5,11.3', '22.5,16']);
  await move('26', '17', '90', 'bottom');
  await expect.poll(centres).toEqual(['26,10.5', '26,16.5', '30.7,13.5']);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  const api = await layoutRuntime();
  await expect.poll(async () => {
    const savedBytes = await page.evaluate(() => window.connectorSaved);
    if (!savedBytes) return;
    const saved = await api.decodeBoard(Uint8Array.from(savedBytes));
    return saved.footprints[0];
  }).toMatchObject({
    side: 'bottom', positionNm: { x: 26e6, y: 17e6 }, rotationMicrodegree: 90e6,
  });

  await workspace.getByRole('button', { name: 'Inspect in 3D…' }).click();
  const viewer = page.getByRole('dialog', { name: '3D board inspection' });
  await expect(viewer.getByRole('img', { name: 'Interactive 3D PCB' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Bottom', exact: true }).click();
  const parts = viewer.getByRole('list', { name: '3D components' });
  await expect(parts.getByText('Generated STEP envelope', { exact: false })).toBeVisible();
  await parts.getByRole('button', { name: 'J1', exact: true }).click();
  await viewer.getByRole('button', { name: 'Show on 2D board' }).click();
  await expect(viewer).toBeHidden();
  const fabricationButton = workspace.getByRole('button', { name: 'Fabrication settings…' });
  await fabricationButton.click();
  const settings = page.getByRole('dialog', { name: 'Fabrication settings' });
  const notes = 'Protect pads <2> & keep test points open.\nVerify slot width.';
  await settings.getByText('Board stackup', { exact: true }).click();
  await settings.getByLabel('Substrate material', { exact: true }).fill('FR-4');
  await settings.getByLabel('Dielectric thickness (mm)', { exact: true }).fill('1.5');
  await settings.getByLabel('Top copper thickness (mm)', { exact: true }).fill('0.035');
  await settings.getByLabel('Bottom copper thickness (mm)', { exact: true }).fill('0.028');
  await settings.getByLabel('Relative permittivity', { exact: true }).fill('4,35');
  await settings.getByText('Fabrication drawing details', { exact: true }).click();
  await settings.getByLabel('Surface finish', { exact: true }).fill('Lead-free HASL');
  const thicknessTolerance = settings.getByLabel('Board thickness tolerance (± mm)', { exact: true });
  await thicknessTolerance.fill('1.6');
  await settings.getByLabel('Outline and cutout tolerance (± mm)', { exact: true }).fill('0.15');
  await settings.getByLabel('Finished plated hole and slot tolerance (± mm)', { exact: true }).fill('0.08');
  await settings.getByLabel('Finished non-plated hole and slot tolerance (± mm)', { exact: true }).fill('0.05');
  await settings.getByLabel('Fabrication notes', { exact: true }).fill(notes);
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('thickness tolerance smaller than board thickness');
  await thicknessTolerance.fill('0.10');
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(settings).toBeHidden();
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  const fabrication = {
    thicknessNm: 1_600_000, surfaceFinish: 'Lead-free HASL', notes,
    stackup: {
      substrateMaterial: 'FR-4', dielectricThicknessNm: 1_500_000,
      topCopperThicknessNm: 35_000, bottomCopperThicknessNm: 28_000,
      relativePermittivity: 4.35,
    },
    thicknessToleranceNm: 100_000, outlineToleranceNm: 150_000,
    platedOpeningToleranceNm: 80_000, nonPlatedOpeningToleranceNm: 50_000,
  };
  await expect.poll(async () => {
    const data = await page.evaluate(() => window.connectorSaved);
    return (await api.decodeBoard(Uint8Array.from(data))).fabrication;
  }).toEqual(fabrication);
  await workspace.getByRole('button', { name: 'CAM read-back preview…' }).click();
  const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
  await expect(cam.locator('[data-plating="plated"]')).toHaveCount(3);
  await expect(cam.locator('[data-plating="non-plated"]')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
  await (await download).saveAs(info.outputPath('connector-cam-preview.zip'));
  await cam.getByText(/Manufacturing review · .* release blockers/).click();
  const pdfDownload = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download 1:1 fabrication PDF…' }).click();
  const pdfPath = info.outputPath('connector-fabrication.pdf');
  await (await pdfDownload).saveAs(pdfPath);
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: Uint8Array.from(await readFile(pdfPath)) }).promise;
  try {
    const sheet = await doc.getPage(1);
    expect(doc.numPages).toBe(1);
    expect(sheet.view[2] * 25.4 / 72).toBeCloseTo(92, 4);
    expect(sheet.view[3] * 25.4 / 72).toBeCloseTo(100, 4);
    const { fnArray, argsArray } = await sheet.getOperatorList();
    const stack = [];
    let scale = [1, 1];
    let outlineSize;
    let scaleBar;
    for (const [index, op] of fnArray.entries()) {
      const args = argsArray[index];
      if (op === OPS.save) stack.push(scale);
      else if (op === OPS.restore) scale = stack.pop();
      else if (op === OPS.transform) scale = [scale[0] * args[0], scale[1] * args[3]];
      else if (op === OPS.constructPath && args[2]) {
        const [left, top, right, bottom] = args[2];
        if (left === 0 && top === -32 && right === 44 && bottom === 0)
          outlineSize = [44 * Math.abs(scale[0]), 32 * Math.abs(scale[1])];
        if (right - left === 10 && top === bottom) scaleBar = 10 * Math.abs(scale[0]);
      }
    }
    expect(outlineSize?.[0] * 25.4 / 72).toBeCloseTo(44, 4);
    expect(outlineSize?.[1] * 25.4 / 72).toBeCloseTo(32, 4);
    expect(scaleBar * 25.4 / 72).toBeCloseTo(10, 4);
    const content = (await sheet.getTextContent()).items.map(({ str }) => str).join(' ');
    for (const label of [
      'Board bounds 44 × 32 mm', 'L1 top / L2 bottom', 'Surface finish · Lead-free HASL',
      'Thickness tolerance · ±0.1 mm', 'Outline and cutouts · ±0.15 mm',
      'Finished plated holes and slots · ±0.08 mm', 'Finished non-plated holes and slots · ±0.05 mm',
      'Substrate material · FR-4', 'Dielectric thickness · 1.5 mm',
      'Top copper thickness · 0.035 mm', 'Bottom copper thickness · 0.028 mm',
      'Relative permittivity · 4.35', 'Dielectric loss tangent · Unknown',
      'Protect pads <2> & keep test points open.', 'Verify slot width.', '10 mm',
    ]) expect(content).toContain(label);
  } finally {
    await doc.destroy();
  }
  const reviewDownload = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download release review…' }).click();
  const reviewPath = info.outputPath('connector-manufacturing-review.zip');
  await (await reviewDownload).saveAs(reviewPath);
  const { ZipReader, Uint8ArrayReader, TextWriter } = await import('@zip.js/zip.js');
  const zip = new ZipReader(new Uint8ArrayReader(await readFile(reviewPath)));
  try {
    const entries = await zip.getEntries();
    const read = (name) => entries.find(({ filename }) => filename === name).getData(new TextWriter());
    expect(JSON.parse(await read('manifest.json')).fabrication).toEqual(fabrication);
    expect(JSON.parse(await read('checks.json')).fabrication.stackup).toEqual(fabrication.stackup);
    expect(await read('fabrication.svg')).toContain('Protect pads &lt;2&gt; &amp; keep test points open.');
  } finally {
    await zip.close();
  }
});

test('inspects embedded models from a copied board with no network library or project', async ({ page }) => {
  test.setTimeout(90_000);
  const api = await layoutRuntime();
  const SQL = await librarySqlite();
  const db = new SQL.Database(await readFile(new URL('../../../bundled-footprints/starter-v1.tplib', import.meta.url)));
  const draft = await api.readStarterFootprint(db, api.readStarterFootprints(db).find(({ id }) => id === 'dip-8'));
  db.close();
  const id = () => crypto.randomUUID();
  const definition = draft.definition;
  const devices = [{ id: id(), footprintId: definition.id, revision: '1',
    definitionDigest: definition.definitionDigest, packageName: definition.name,
    packageSource: 'Embedded starter fixture', signalIds: [],
    assignments: definition.pads.map(({ id }) => ({ padId: id, kind: 'mechanical' })),
  }];
  const components = ['U1', 'U2'].map((reference) => ({ id: id(), reference, deviceId: devices[0].id }));
  const base = api.createBoard('Offline models', 2, [
    { x: 0, y: 0 }, { x: 30e6, y: 0 }, { x: 30e6, y: 30e6 }, { x: 0, y: 30e6 },
  ]);
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'embedded-devices', 'physical-padstacks'],
    components, deviceDefinitions: devices,
    footprintDefinitions: [{ ...definition, models: [
      ...definition.models,
      { ...definition.models[0], assetId: undefined, source: 'missing.step', quality: 'imported-unreviewed' },
    ].map(({ assetId, ...model }) => ({ ...model, ...(assetId ? { assetId } : {}) })) }],
    modelAssets: draft.assets,
    footprints: components.map(({ id: componentId }, index) => ({
      id: id(), componentId, deviceId: devices[0].id,
      positionNm: { x: (10 + 10 * index) * 1e6, y: 15e6 },
      rotationMicrodegree: (index ? 90 : 0) * 1e6,
      side: index ? 'bottom' : 'top', locked: false,
    })),
  };
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(app.baseURL) && !/\.tplib($|\?)/.test(url)) return route.continue();
    return route.abort();
  });
  const requests = [];
  const workers = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => {
    const seen = { url: worker.url(), closed: false };
    workers.push(seen);
    worker.on('close', () => { seen.closed = true; });
  });
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Copied.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Copied.dpn'),
    }];
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const editor = page.getByRole('region', { name: 'PCB layout' });
  await expect(editor.getByRole('img', { name: 'Board layout' })).toBeVisible();
  expect(requests.some((url) => /BoardInspection|board\.worker|occt-import-js/.test(url))).toBe(false);

  await editor.getByRole('button', { name: 'Inspect in 3D…' }).click();
  const viewer = page.getByRole('dialog', { name: '3D board inspection' });
  await expect(viewer.getByRole('img', { name: 'Interactive 3D PCB' })).toBeVisible();
  const parts = viewer.getByRole('list', { name: '3D components' });
  await expect(parts.getByText('Generated STEP envelope', { exact: false })).toHaveCount(2);
  await expect(parts.getByText('Missing STEP model', { exact: false })).toHaveCount(2);
  const canvas = await viewer.locator('canvas').elementHandle();
  await viewer.getByRole('button', { name: 'Bottom', exact: true }).click();
  await parts.getByRole('button', { name: 'U2', exact: true }).click();
  await viewer.getByRole('button', { name: 'Show on 2D board' }).click();
  await expect(viewer).toBeHidden();
  await expect.poll(() => canvas.evaluate((element) => (
    !element.isConnected && element.getContext('webgl2')?.isContextLost()
  ))).toBe(true);
  await expect(editor.getByRole('img', { name: 'Board layout' })).toBeVisible();
  await expect.poll(() => workers.some(({ url, closed }) => /board\.worker/.test(url) && closed)).toBe(true);
  expect(errors).toEqual([]);
});


test('recovers committed PCB edits and saves a separate copy after an external change', async ({
  context, page,
}) => {
  test.setTimeout(90_000);
  const api = await layoutRuntime();
  const board = api.createBoard('Recoverable', 2, [
    { x: 0, y: 0 }, { x: 30e6, y: 0 }, { x: 30e6, y: 20e6 }, { x: 0, y: 20e6 },
  ]);
  let disk = [...await api.encodeBoard(board)];
  let detached;
  await context.exposeBinding('testRecoveryDisk', async (_, operation, bytes) => {
    if (operation === 'read') return disk;
    if (operation === 'write') disk = bytes;
    if (operation === 'fork') detached = bytes;
  });
  await context.addInitScript(() => {
    const handle = (name, operation) => ({
      name,
      getFile: async () => new File([Uint8Array.from(await window.testRecoveryDisk('read'))], name),
      createWritable: async () => ({
        write: async (bytes) => window.testRecoveryDisk(operation, Array.from(bytes)),
        close: async () => {},
        abort: async () => {},
      }),
    });
    window.showOpenFilePicker = async () => [handle('Recoverable.dpn', 'write')];
    window.showSaveFilePicker = async () => handle('Separate.dpn', 'fork');
  });
  const open = async (target) => {
    await target.goto(app.baseURL);
    await target.getByRole('button', { name: 'File', exact: true }).click();
    await target.getByRole('menuitem', { name: 'Open', exact: true }).click();
  };
  const editor = (target) => target.getByRole('region', { name: 'PCB layout' });
  const recovery = (target) => target.getByRole('dialog', { name: 'Recover PCB edits' });

  await open(page);
  await editor(page).getByLabel('Copper layers').selectOption('1');
  await expect(editor(page).getByText('Recovery saved for PCB revision 1.')).toBeVisible();
  const concurrent = await context.newPage();
  await open(concurrent);
  await recovery(concurrent).getByRole('button', { name: 'Restore edits' }).click();
  await editor(concurrent).getByLabel('Copper layers').selectOption('2');
  await expect(editor(concurrent).getByText('Recovery saved for PCB revision 2.')).toBeVisible();
  await page.close();
  await concurrent.close();

  const restored = await context.newPage();
  await open(restored);
  await expect(recovery(restored)).toContainText('Recovery revision 2');
  await recovery(restored).getByRole('button', { name: 'Restore edits' }).click();
  await expect(editor(restored).getByLabel('Copper layers')).toHaveValue('2');
  await editor(restored).getByLabel('Copper layers').selectOption('1');
  await expect(editor(restored).getByText('Recovery saved for PCB revision 3.')).toBeVisible();
  disk = [...await api.encodeBoard({ ...board, revision: 1, title: 'External edit' })];
  const newest = disk.slice();
  await editor(restored).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor(restored).getByText('This PCB changed on disk. Reopen it or use Save As.')).toBeVisible();
  expect(disk).toEqual(newest);
  await restored.close();

  const stale = await context.newPage();
  await open(stale);
  await recovery(stale).getByRole('button', { name: 'Open recovery copy' }).click();
  await expect(editor(stale).getByLabel('Copper layers')).toHaveValue('1');
  await editor(stale).getByRole('button', { name: 'Save As…' }).click();
  await expect(editor(stale).getByText('Separate.dpn', { exact: true })).toBeVisible();
  expect((await api.decodeBoard(Uint8Array.from(detached))).copperLayers).toHaveLength(1);
  expect(disk).toEqual(newest);
  await stale.close();

  const clean = await context.newPage();
  await open(clean);
  await expect(editor(clean).getByLabel('Copper layers')).toHaveValue('2');
  await expect(recovery(clean)).toHaveCount(0);
});

test('snaps measurements and saves PCB dimensions independently of the outline', async ({ page }) => {
  test.setTimeout(90_000);
  const api = await layoutRuntime();
  const a = { x: 254_000, y: 254_000 };
  const b = { x: 10_414_000, y: 254_000 };
  const board = api.createBoard('Dimensions', 2, [a, b,
    { x: b.x, y: 7_874_000 }, { x: a.x, y: 7_874_000 },
  ]);
  await page.addInitScript((original) => {
    window.showOpenFilePicker = async () => {
      const saved = sessionStorage.getItem('dimensionTestBoard');
      const name = saved ? 'Dimension-copy.dpn' : 'Dimension.dpn';
      return [{ name, getFile: async () => new File([
        Uint8Array.from(saved ? JSON.parse(saved) : original),
      ], name) }];
    };
    window.showSaveFilePicker = async () => ({
      name: 'Dimension-copy.dpn',
      createWritable: async () => ({
        write: async (bytes) => sessionStorage.setItem('dimensionTestBoard', JSON.stringify([...bytes])),
        close: async () => {},
        abort: async () => {},
      }),
    });
  }, [...await api.encodeBoard(board)]);
  const editor = page.getByRole('region', { name: 'PCB layout' });
  const canvas = editor.getByRole('img', { name: 'Board layout' });
  async function open() {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await expect(canvas).toBeVisible();
  }
  await page.goto(app.baseURL);
  await open();
  const profile = canvas.locator(':scope > path').first();
  const outlinePath = await profile.getAttribute('d');

  await editor.getByText('Dimensions and datum', { exact: true }).click();
  await editor.getByRole('button', { name: 'Set measurement datum…' }).click();
  const datum = page.getByRole('dialog', { name: 'Measurement datum' });
  await datum.getByLabel('Datum X').fill('10 mil');
  await datum.getByLabel('Datum Y').fill('10 mil');
  await datum.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(datum).toBeHidden();
  await expect(canvas.locator('[data-measurement-datum]')).toHaveAttribute('transform', 'translate(254000,-254000)');

  await editor.getByRole('button', { name: 'Measure distance', exact: true }).click();
  for (const point of [a, b]) {
    const client = await canvas.evaluate((svg, { x, y }) => {
      const p = new DOMPoint(x, -y).matrixTransform(svg.getScreenCTM());
      return { x: p.x + 4, y: p.y - 3 };
    }, point);
    await page.mouse.click(client.x, client.y);
  }
  await expect(editor.getByRole('status').filter({ hasText: 'Distance 10.160 mm' })).toBeVisible();
  await editor.getByRole('button', { name: 'Save measurement as dimension…' }).click();
  const dialog = page.getByRole('dialog', { name: 'PCB dimension' });
  await expect(dialog.getByLabel('Start X')).toHaveValue('0');
  await expect(dialog.getByLabel('End X')).toHaveValue('10.16');
  await expect(dialog.getByLabel('End Y')).toHaveValue('0');
  await dialog.getByLabel('Dimension direction').selectOption('horizontal');
  await dialog.getByLabel('Line offset').fill('-100 mil');
  await dialog.getByLabel('Display unit').selectOption('mil');
  await dialog.getByLabel('Dimension label').fill('Mounting span');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  const annotation = canvas.locator('[data-dimension]');
  await expect(annotation).toContainText('Mounting span · 400 mil');

  await editor.getByRole('button', { name: 'Edit Mounting span · 400 mil…' }).click();
  await dialog.getByLabel('Dimension label').fill('Board width');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(annotation).toContainText('Board width · 400 mil');
  await expect(profile).toHaveAttribute('d', outlinePath);
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(annotation).toContainText('Mounting span · 400 mil');
  await editor.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(annotation).toContainText('Board width · 400 mil');
  await editor.getByRole('button', { name: 'Save As…' }).click();
  await expect(editor.getByText('Dimension-copy.dpn', { exact: true })).toBeVisible();

  const bytes = Uint8Array.from(await page.evaluate(() => JSON.parse(sessionStorage.getItem('dimensionTestBoard'))));
  const saved = await api.decodeBoard(bytes);
  expect(saved.outline).toEqual(board.outline);
  expect(saved.annotations.datum).toEqual(a);
  expect(saved.annotations.dimensions).toEqual([expect.objectContaining({
    start: a, end: b, offsetNm: -2_540_000, label: 'Board width', unit: 'mil',
  })]);

  await page.reload();
  await open();
  await expect(annotation).toContainText('Board width · 400 mil');
  await expect(profile).toHaveAttribute('d', outlinePath);
});

test('edits custom line and arc profiles with located topology errors and explicit gap repair', async ({ page }) => {
  test.setTimeout(90_000);
  const api = await layoutRuntime();
  const board = api.createBoard('Custom outline', 2, [
    { x: 0, y: 0 }, { x: 40e6, y: 0 }, { x: 40e6, y: 30e6 }, { x: 0, y: 30e6 },
  ]);
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Profile.dpn',
      getFile: async () => new File([Uint8Array.from(bytes)], 'Profile.dpn'),
    }];
    window.showSaveFilePicker = async () => ({
      name: 'Custom-profile.dpn',
      createWritable: async () => ({
        write: async (contents) => { window.savedProfile = [...contents]; },
        close: async () => {},
        abort: async () => {},
      }),
    });
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const editor = page.getByRole('region', { name: 'PCB layout' });
  const canvas = page.locator('svg[aria-label="Board layout"]');
  await expect(canvas).toBeVisible();
  const outline = canvas.locator(':scope > path').first();
  const originalPath = await outline.getAttribute('d');
  await editor.getByRole('button', { name: 'Board outline…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Set board outline' });
  await dialog.getByLabel('Shape', { exact: true }).selectOption('custom');
  const first = dialog.getByRole('group', { name: 'Edge 1', exact: true });
  const second = dialog.getByRole('group', { name: 'Edge 2', exact: true });
  await second.getByLabel('Type', { exact: true }).selectOption('arc');
  await second.getByLabel('Centre X').fill('40');
  await second.getByLabel('Centre Y').fill('15');
  await first.getByLabel('End X').fill('39.99');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Edge 1 and edge 2');
  await expect(dialog.locator('[data-profile-issue]')).toHaveAttribute('cx', '39990000');
  await expect(first.getByRole('button', { name: 'Close small gap after edge 1' })).toHaveCount(0);
  await expect(outline).toHaveAttribute('d', originalPath);

  await first.getByLabel('End X').fill('39.9995');
  const repair = first.getByRole('button', { name: 'Close small gap after edge 1' });
  await repair.click();
  await expect(first.getByLabel('End X')).toHaveValue('40');
  await expect(second.getByLabel('Centre Y')).toHaveValue('15');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(outline).not.toHaveAttribute('d', originalPath);
  await editor.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(outline).toHaveAttribute('d', originalPath);
  await editor.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(outline).not.toHaveAttribute('d', originalPath);

  async function tryCutout() {
    await editor.getByRole('button', { name: 'Add cutout…', exact: true }).click();
    const cutout = page.getByRole('dialog', { name: 'Add board cutout' });
    await cutout.getByLabel('Shape', { exact: true }).selectOption('circle');
    await cutout.getByLabel('Centre X (mm)').fill('10');
    await cutout.getByLabel('Centre Y (mm)').fill('10');
    await cutout.getByRole('button', { name: 'Apply', exact: true }).click();
    return cutout;
  }
  await expect(await tryCutout()).toBeHidden();
  const invalidCutout = await tryCutout();
  await expect(invalidCutout.getByRole('alert')).toContainText('Cutout 2');
  await expect(invalidCutout.getByRole('alert')).toContainText('cannot touch, intersect or contain');
  await expect(invalidCutout.locator('[data-profile-issue]')).toBeVisible();
  await invalidCutout.getByRole('button', { name: 'Cancel', exact: true }).click();

  await editor.getByRole('button', { name: 'Edit cutout 1…', exact: true }).click();
  const editedCutout = page.getByRole('dialog', { name: 'Edit board cutout' });
  await expect(editedCutout.getByLabel('Shape', { exact: true })).toHaveValue('custom');
  await expect(editedCutout.locator('[data-profile-edge]')).toHaveCount(2);
  await editedCutout.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editedCutout).toBeHidden();

  await editor.getByRole('button', { name: 'Save As…', exact: true }).click();
  await expect(editor.getByText('Custom-profile.dpn', { exact: true })).toBeVisible();
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedProfile)));
  expect(saved.profile.cutouts).toHaveLength(1);
  expect(saved.profile.outline[1]).toMatchObject({
    kind: 'arc', start: { x: 40e6, y: 0 }, end: { x: 40e6, y: 30e6 },
    centre: { x: 40e6, y: 15e6 }, clockwise: false,
  });
});

test('drags a segment and edits a corner with clearance checks, then routes a branch', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  await holdPcbWorkerReplies(page);
  const api = await layoutRuntime();
  const p = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const base = api.createBoard('Editing tracks', 2, [p(0, 0), p(40, 0), p(40, 30), p(0, 30)]);
  const net = crypto.randomUUID();
  const foreign = crypto.randomUUID();
  const track = (start, end, netId = net) => ({
    id: crypto.randomUUID(), start, end, netId, widthNm: 500_000, layerId: 'top',
  });
  const a = track(p(5, 5), p(20, 5));
  const b = track(p(20, 5), p(20, 15));
  const obstacle = track(p(8, 12), p(15, 12), foreign);
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: net, name: 'Signal' }, { id: foreign, name: 'Obstacle' }],
    tracks: [a, b, obstacle],
  };
  await page.addInitScript((data) => {
    window.showOpenFilePicker = async () => [{
      name: 'Tracks.dpn',
      getFile: async () => new File([Uint8Array.from(data)], 'Tracks.dpn'),
    }];
    window.showSaveFilePicker = async () => ({
      name: 'Tracks-edited.dpn',
      createWritable: async () => ({
        write: async (bytes) => { window.savedTracks = [...bytes]; },
        close: async () => {},
        abort: async () => {},
      }),
    });
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const layout = page.getByRole('region', { name: 'PCB layout' });
  const canvas = layout.getByRole('img', { name: 'Board layout' });
  const selected = layout.getByRole('group', { name: 'Selected track', exact: true });
  const trackA = canvas.locator(`[data-track="${a.id}"]`);
  const pathA = 'M5000000,-5000000 L20000000,-5000000';
  await expect(trackA).toHaveAttribute('d', pathA);
  const client = (x, y) => canvas.evaluate((svg, [x, y]) => {
    const point = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.getScreenCTM());
    return { x: point.x, y: point.y };
  }, [x, y]);
  const pick = async (x, y) => {
    const point = await client(x, y);
    await page.mouse.click(point.x, point.y);
  };
  await pick(12.5, 5);
  await selected.getByRole('button', { name: 'Drag segment', exact: true }).click();
  const drag = layout.getByRole('group', { name: 'Drag segment', exact: true });
  const handle = canvas.locator('[data-track-edit-handle]');
  await expect(handle).toBeVisible();
  const from = await client(12.5, 5);
  const to = await client(12.5, 8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect(drag.getByLabel('Handle Y (mm)')).toHaveValue('8');
  await expect(canvas.locator('[data-track-edit-piece]')).toHaveCount(3);
  await expect(trackA).toHaveAttribute('d', pathA);
  await page.evaluate(() => { window.pcbReplies.hold = 'track-edit'; });
  await drag.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await drag.getByRole('button', { name: 'Cancel track edit', exact: true }).press('Escape');
  await expect(drag).toBeHidden();
  await page.evaluate(() => window.pcbReplies.release());
  await expect(trackA).toHaveAttribute('d', pathA);
  await expect(layout.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await selected.getByRole('button', { name: 'Drag segment', exact: true }).click();
  await drag.getByLabel('Handle Y (mm)').fill('8');
  await drag.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect(drag).toBeHidden();
  await expect(trackA).toHaveAttribute('d', 'M5000000,-8000000 L20000000,-8000000');
  await expect(canvas.locator('[data-track]')).toHaveCount(5);

  await layout.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(trackA).toHaveAttribute('d', pathA);
  await expect(canvas.locator('[data-track]')).toHaveCount(3);
  await selected.getByRole('button', { name: 'Move end corner', exact: true }).click();
  const corner = layout.getByRole('group', { name: 'Move corner', exact: true });
  await corner.getByLabel('Handle X (mm)').fill('10');
  await corner.getByLabel('Handle Y (mm)').fill('12');
  await corner.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect(layout.getByRole('alert')).toContainText('Track blocked');
  await expect(trackA).toHaveAttribute('d', pathA);
  await corner.getByLabel('Handle X (mm)').fill('16');
  await corner.getByLabel('Handle Y (mm)').fill('7');
  await corner.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect(corner).toBeHidden();
  await expect(trackA).toHaveAttribute('d', 'M5000000,-5000000 L16000000,-7000000');

  await selected.getByRole('button', { name: 'Branch from track', exact: true }).click();
  await pick(10.5, 11);
  await layout.getByRole('button', { name: 'Finish route', exact: true }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(4);
  await layout.getByRole('button', { name: 'Save As…', exact: true }).click();
  await expect(layout.getByText('Tracks-edited.dpn', { exact: true })).toBeVisible();
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedTracks)));
  expect(saved.tracks.find(({ id }) => id === a.id)).toEqual({ ...a, end: p(16, 7) });
  expect(saved.tracks.find(({ id }) => id === b.id)).toEqual({ ...b, start: p(16, 7) });
  expect(saved.tracks.find(({ id }) => id === obstacle.id)).toEqual(obstacle);
  expect(saved.tracks.find(({ id }) => !board.tracks.some((track) => track.id === id)))
    .toMatchObject({ netId: net, start: p(10.5, 6), end: p(10.5, 11), layerId: 'top' });
});

test('previews copper deletion by connection, net and region before committing', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  const api = await layoutRuntime();
  const p = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const base = api.createBoard('Deletion scopes', 2, [p(0, 0), p(40, 0), p(40, 30), p(0, 30)]);
  const signal = crypto.randomUUID();
  const foreignNet = crypto.randomUUID();
  const track = (start, end, layerId = 'top', netId = signal) => ({
    id: crypto.randomUUID(), start, end, netId, widthNm: 500_000, layerId,
  });
  const spine = track(p(2, 5), p(22, 5));
  const branch = track(p(12, 5), p(12, 12));
  const tail = track(spine.end, p(25, 7));
  const lower = track(tail.end, p(30, 7), 'bottom');
  const separate = track(p(13, 10), p(17, 10), 'bottom');
  const foreign = track(p(14, 13), p(18, 13), 'top', foreignNet);
  const via = { id: crypto.randomUUID(), netId: signal, positionNm: tail.end, diameterNm: 800_000, drillNm: 400_000 };
  const board = {
    ...base, requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: signal, name: 'Signal' }, { id: foreignNet, name: 'Unrelated' }],
    tracks: [spine, branch, tail, lower, separate, foreign], vias: [via],
  };
  await page.addInitScript((data) => {
    window.showOpenFilePicker = async () => [{
      name: 'Delete.dpn', getFile: async () => new File([Uint8Array.from(data)], 'Delete.dpn'),
    }];
    window.showSaveFilePicker = async () => ({
      name: 'Delete-edited.dpn',
      createWritable: async () => ({
        write: async (bytes) => { window.savedDeletion = [...bytes]; },
        close: async () => {},
        abort: async () => {},
      }),
    });
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const layout = page.getByRole('region', { name: 'PCB layout' });
  const canvas = layout.getByRole('img', { name: 'Board layout' });
  const preview = layout.getByRole('group', { name: 'Copper deletion preview', exact: true });
  const selectedTracks = canvas.locator('[data-deletion-track]');
  const selectedVias = canvas.locator('[data-deletion-via]');
  const spinePath = canvas.locator(`[data-track="${spine.id}"]`);
  await expect(canvas.locator('[data-track]')).toHaveCount(6);
  const pick = async (x, y) => {
    const at = await canvas.evaluate((svg, [x, y]) => {
      const p = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    }, [x, y]);
    await page.mouse.click(at.x, at.y);
  };
  const cancel = () => preview.getByRole('button', { name: 'Cancel deletion', exact: true }).click();
  const confirm = preview.getByRole('button', { name: 'Confirm deletion', exact: true });

  await pick(8, 5);
  await layout.getByRole('button', { name: 'Delete connection…', exact: true }).click();
  await expect(selectedTracks).toHaveCount(1);
  await expect(selectedTracks).toHaveAttribute('d', 'M2000000,-5000000 L12000000,-5000000');
  await expect(spinePath).toHaveAttribute('d', 'M2000000,-5000000 L22000000,-5000000');
  await cancel();

  await pick(18, 5);
  await layout.getByRole('button', { name: 'Delete connection…', exact: true }).click();
  await expect(preview.getByRole('status')).toContainText('3 track segments and 1 via selected');
  await expect(selectedVias).toHaveAttribute('data-deletion-via', via.id);
  await confirm.click();
  await expect(preview).toBeHidden();
  await expect(canvas.locator('[data-track]')).toHaveCount(4);
  await expect(spinePath).toHaveAttribute('d', 'M2000000,-5000000 L12000000,-5000000');
  await layout.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(6);

  await pick(25, 7);
  await layout.getByRole('button', { name: 'Delete selected copper…', exact: true }).click();
  await expect(selectedVias).toHaveCount(1);
  await expect(selectedTracks).toHaveCount(0);
  await cancel();
  await layout.getByRole('button', { name: 'Delete routed net…', exact: true }).click();
  await expect(preview).toContainText('Delete unlocked tracks and vias on Signal.');
  await expect(selectedTracks).toHaveCount(5);
  await expect(selectedVias).toHaveCount(1);
  await cancel();

  await layout.getByRole('button', { name: 'Delete region…', exact: true }).click();
  await pick(11, 3);
  await expect(confirm).toBeDisabled();
  await pick(26, 14);
  await expect(canvas.locator('[data-deletion-region]')).toHaveAttribute('width', '15000000');
  await expect(selectedTracks).toHaveCount(4);
  await preview.getByLabel('Copper selection layer', { exact: true }).selectOption('top');
  await expect(selectedTracks).toHaveCount(3);
  await expect(preview.getByRole('status')).toContainText('Through-vias span both layers.');
  await confirm.click();
  await expect(preview).toBeHidden();
  await expect(canvas.locator('[data-track]')).toHaveCount(3);
  await layout.getByRole('button', { name: 'Save As…', exact: true }).click();
  await expect(layout.getByText('Delete-edited.dpn', { exact: true })).toBeVisible();
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedDeletion)));
  expect(saved.tracks).toEqual([spine, lower, separate]);
  expect(saved.vias).toEqual([]);
});

test('previews route cleanup and saves locked copper through an undoable cleanup', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  const api = await layoutRuntime();
  const p = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const base = api.createBoard('Cleanup', 2, [p(0, 0), p(40, 0), p(40, 30), p(0, 30)]);
  const net = crypto.randomUUID();
  const track = (start, end, flags = {}) => ({
    id: crypto.randomUUID(), start, end, netId: net, widthNm: 500_000, layerId: 'top', ...flags,
  });
  const left = track(p(2, 5), p(5, 5));
  const a = track(left.end, p(10, 5));
  const b = track(a.end, p(15, 5));
  const duplicate = track(b.end, b.start);
  const climb = track(a.start, p(7, 17));
  const down = track(climb.end, b.end);
  const right = track(b.end, p(20, 5), { locked: true });
  const via = { id: crypto.randomUUID(), netId: net, positionNm: right.end, diameterNm: 800_000, drillNm: 400_000 };
  const board = {
    ...base, requiredFeatures: [...base.requiredFeatures, 'routed-copper'],
    nets: [{ id: net, name: 'Signal' }], tracks: [left, a, b, duplicate, climb, down, right], vias: [via],
  };
  await page.addInitScript((data) => {
    window.showOpenFilePicker = async () => [{
      name: 'Cleanup.dpn', getFile: async () => new File([Uint8Array.from(data)], 'Cleanup.dpn'),
    }];
    window.showSaveFilePicker = async () => ({
      name: 'Cleanup-edited.dpn',
      createWritable: async () => ({
        write: async (bytes) => { window.savedCleanup = [...bytes]; },
        close: async () => {},
        abort: async () => {},
      }),
    });
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const layout = page.getByRole('region', { name: 'PCB layout' });
  const canvas = layout.getByRole('img', { name: 'Board layout' });
  const tracks = canvas.locator('[data-track]');
  await expect(tracks).toHaveCount(7);
  const clickBoard = async (x, y) => {
    const point = await canvas.evaluate((svg, [x, y]) => {
      const pos = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.getScreenCTM());
      return { x: pos.x, y: pos.y };
    }, [x, y]);
    await page.mouse.click(point.x, point.y);
  };
  await clickBoard(3, 5);
  await layout.getByRole('button', { name: 'Lock track', exact: true }).click();
  await expect(layout.getByRole('button', { name: 'Drag segment', exact: true })).toBeDisabled();
  await expect(layout.getByRole('button', { name: 'Delete selected copper…', exact: true })).toBeDisabled();
  await expect(canvas.locator(`[data-track="${left.id}"]`)).toHaveAttribute('data-route-locked', 'true');
  await clickBoard(20, 5);
  await layout.getByRole('button', { name: 'Lock via', exact: true }).click();
  await expect(canvas.locator(`[data-via="${via.id}"]`)).toHaveAttribute('data-route-locked', 'true');

  await layout.getByRole('button', { name: 'Clean up routed net…', exact: true }).click();
  const preview = layout.getByRole('group', { name: 'Routing cleanup preview', exact: true });
  await expect(preview.getByRole('status')).toContainText('Merge 1 collinear join, remove 1 duplicate and 2 redundant loop segments');
  await expect(canvas.locator('[data-deletion-track]')).toHaveCount(2);
  await expect(tracks).toHaveCount(7);
  await preview.getByRole('button', { name: 'Cancel cleanup', exact: true }).click();
  await expect(canvas.locator('[data-deletion-track]')).toHaveCount(0);

  await layout.getByRole('button', { name: 'Clean up routed net…', exact: true }).click();
  await preview.getByRole('button', { name: 'Apply cleanup', exact: true }).click();
  await expect(tracks).toHaveCount(3);
  await layout.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tracks).toHaveCount(7);
  await expect(canvas.locator(`[data-track="${left.id}"]`)).toHaveAttribute('data-route-locked', 'true');
  await layout.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(tracks).toHaveCount(3);

  await layout.getByRole('button', { name: 'Save As…', exact: true }).click();
  await expect(layout.getByText('Cleanup-edited.dpn', { exact: true })).toBeVisible();
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedCleanup)));
  expect(saved.tracks).toEqual([{ ...left, locked: true }, { ...a, end: b.end }, right]);
  expect(saved.vias).toEqual([{ ...via, locked: true }]);
});
