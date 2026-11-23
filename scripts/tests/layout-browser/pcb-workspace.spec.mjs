import { closeStandaloneBoard, clickPcbCommand, clickPcbPoint, drawPcbOutline, pcbMenuItem, pcbNetRow, selectCopperRow, selectPcbNet } from './pcb-controls.mjs';
import { readFile } from 'node:fs/promises';
import { librarySqlite } from '../../lib/library-from-sql.mjs';
import { expect, test } from '@playwright/test';
import { layoutRuntime } from '../../lib/layout-runtime.mjs';
import { serveLayoutApp } from './serve-app.mjs';
import { thermalFixture } from '../pcb-thermal-fixture.mjs';
import { placementFixture } from '../pcb-placement-fixture.mjs';
import { zoneConnectionFixture } from '../pcb-zone-connection-fixture.mjs';
import { classroomBoard } from '../../pcb/classroom-fixture.mjs';

let app;
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });
test.beforeAll(async () => {
  test.setTimeout(120000);
  app = await serveLayoutApp();
});
test.afterAll(async () => app?.close());

async function expectTrackEndpoints(track, coordinates) {
  await expect.poll(() => track.evaluate((line) => {
    const drawing = line.closest('[data-svg-drawing]');
    const matrix = drawing.getScreenCTM().inverse().multiply(line.getScreenCTM());
    return [[line.x1, line.y1], [line.x2, line.y2]].flatMap(([x, y]) => {
      const point = new DOMPoint(x.baseVal.value, y.baseVal.value).matrixTransform(matrix);
      return [Math.round(point.x), Math.round(point.y)];
    });
  })).toEqual(coordinates);
}

const drawingCentre = (locator) => locator.evaluate((shape) => {
  const box = shape.getBBox();
  const drawing = shape.closest('[data-svg-drawing]') ?? shape.ownerSVGElement;
  const matrix = drawing.getScreenCTM().inverse().multiply(shape.getScreenCTM());
  const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix);
  return [Math.round(point.x), Math.round(point.y)];
});

async function holdPcbWorkerReplies(page) {
  await page.addInitScript(() => {
    const pending = [];
    const requests = [];
    const overlaps = [];
    window.pcbReplies = {
      hold: undefined,
      count: () => pending.length,
      requests: (kind) => requests.filter((item) => item.kind === kind).length,
      overlaps: () => overlaps,
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
      postMessage(data, ...options) {
        const { kind } = data;
        const analysis = ['check', 'cam'].includes(kind);
        if (analysis || kind === 'geometry') {
          const conflicting = requests.find((item) => !item.worker.terminated &&
            (analysis ? item.kind === 'geometry' : ['check', 'cam'].includes(item.kind)));
          if (conflicting) overlaps.push([conflicting.kind, kind]);
          requests.push({ kind, worker: this });
        }
        return super.postMessage(data, ...options);
      }

      terminate() {
        this.terminated = true;
        super.terminate();
      }

      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          const { kind, change } = event.data;
          const replyKind = kind === 'routing-edit' ? change.kind : kind;
          if (!window.pcbReplies.hold || replyKind !== window.pcbReplies.hold) return;
          event.stopImmediatePropagation();
          pending.push({ worker: this, data: event.data });
          window.pcbReplies.hold = undefined;
        });
      }
    };
  });
}

test('releases the idle schematic worker in PCB Design and rebuilds on return', async ({ page }) => {
  test.setTimeout(45_000);
  const workers = [];
  page.on('worker', (worker) => {
    const record = { worker, closed: false };
    workers.push(record);
    worker.on('close', () => { record.closed = true; });
  });
  const loadSchematic = (label) => page.evaluate((name) => {
    window.layoutTest.reopenXml('<TinyCADSheets><TinyCAD><NAME>Main</NAME>' +
      '<WIRE a="10,20" b="40,20" />' +
      '<LABEL pos="10,20" font="1" color="208000" direction="3" style="0">' +
      name + '</LABEL></TinyCAD></TinyCADSheets>');
  }, label);
  const labels = (compile = false) => page.evaluate((fresh) => window.layoutTest.netlistLabels(fresh), compile);
  const schematicWorkers = async () => {
    const names = await Promise.all(workers.map(async (record) => {
      if (!record.name && !record.closed)
        record.name = await record.worker.evaluate(() => self.name).catch(() => '');
      return record;
    }));
    return names.filter(({ name }) => name === 'tinycad-schematic-netlist');
  };

  await page.goto(app.baseURL);
  await loadSchematic('ACTIVE_BEFORE_PCB');
  await expect.poll(async () => (await schematicWorkers()).filter(({ closed }) => !closed).length).toBe(1);
  await expect.poll(() => labels()).toContain('ACTIVE_BEFORE_PCB');
  const [first] = await schematicWorkers();
  await expect(page.getByRole('group', { name: 'Design workspaces' })).toHaveCount(0);
  const openNewMenu = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New', exact: true }).click();
    return page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'New PCB', exact: true }) });
  };
  const newMenu = await openNewMenu();
  await expect(newMenu.getByRole('menuitem')).toHaveText([
    'New Design', 'New Custom Symbol Library', 'New PCB', 'New PCB Footprint Library',
  ]);
  await expect(newMenu.locator('.fui-MenuDivider')).toHaveCount(1);
  await newMenu.getByRole('menuitem', { name: 'New PCB Footprint Library' }).click();
  const footprintEditor = page.getByRole('dialog', { name: 'Footprint editor' });
  await expect(footprintEditor).toBeVisible();
  await footprintEditor.getByRole('button', { name: 'Close', exact: true }).click();
  await (await openNewMenu()).getByRole('menuitem', { name: 'New PCB', exact: true }).click();
  const pcb = page.getByRole('region', { name: 'PCB layout' });
  await expect(pcb).toBeVisible();
  await expect.poll(() => first.closed).toBe(true);

  await loadSchematic('COMPILED_WHILE_IN_PCB');
  expect(await labels(true)).toEqual(['COMPILED_WHILE_IN_PCB']);
  await expect.poll(() => page.workers().length).toBe(0);
  await expect(pcb).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Discard unsaved edits to the current PCB?');
    await dialog.dismiss();
  });
  await (await openNewMenu()).getByRole('menuitem', { name: 'New Design', exact: true }).click();
  await expect(pcb).toBeVisible();

  await closeStandaloneBoard(pcb);
  await page.getByRole('dialog', { name: 'Discard unsaved PCB edits?' })
    .getByRole('button', { name: 'Discard edits' }).click();
  await expect(pcb).toBeHidden();
  await expect.poll(async () => (await schematicWorkers()).filter(({ closed }) => !closed).length).toBe(1);
  await expect.poll(() => labels()).toEqual(['COMPILED_WHILE_IN_PCB']);
});

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
    (await page.evaluate(() => window.openTypes)).map(({ accept }) => Object.values(accept).flat()),
  ).toContainEqual(['.dsn', '.dzn', '.dpn']);

  const canvas = board.getByRole('img', { name: 'Board layout' });
  const rulers = board.locator('.svg-viewport-with-rulers canvas');
  const toggleRulers = board.getByRole('button', { name: 'Toggle rulers' });
  const initialSize = page.viewportSize();
  async function expectRulerIndicators(fraction = 0.4) {
    const bounds = await canvas.boundingBox();
    const x = Math.round(bounds.width * fraction);
    const y = Math.round(bounds.height * fraction);
    await canvas.hover({ position: { x, y } });
    await expect.poll(() => rulers.evaluateAll((rails, [x, y]) => {
      return rails.map((rail, i) => {
        const marker = rail.parentElement.querySelector('[data-ruler-pointer]');
        if (!marker || getComputedStyle(marker).backgroundColor !== 'rgb(255, 0, 0)') return false;
        const edge = rail.getBoundingClientRect();
        const line = marker.getBoundingClientRect();
        return Math.abs(i === 0 ? line.left - edge.left - x : line.top - edge.top - y) <= 2;
      });
    }, [x, y])).toEqual([true, true]);
  }
  await expect(rulers).toHaveCount(2);
  await expectRulerIndicators();
  await rulers.evaluateAll((rails) => {
    window.rulerSizeChanges = 0;
    window.rulerRepaints = 0;
    window.rulerStrokes = 0;
    window.rulerSizeObserver = new MutationObserver((records) => {
      window.rulerSizeChanges += records.length;
    });
    for (const rail of rails) {
      window.rulerSizeObserver.observe(rail, { attributeFilter: ['width', 'height'] });
      const context = rail.getContext('2d');
      const fill = context.fillRect.bind(context);
      context.fillRect = (...args) => {
        window.rulerRepaints++;
        return fill(...args);
      };
      const stroke = context.stroke.bind(context);
      context.stroke = (...args) => {
        window.rulerStrokes++;
        return stroke(...args);
      };
    }
  });
  await expectRulerIndicators(0.55);
  expect(await page.evaluate(() => {
    window.rulerSizeObserver.disconnect();
    return [window.rulerSizeChanges, window.rulerRepaints];
  })).toEqual([0, 0]);
  const properties = board.getByRole('region', { name: 'Board properties' });
  const initialProperties = await properties.boundingBox();
  await properties.getByRole('separator', { name: 'Resize board properties' }).focus();
  await page.keyboard.press('ArrowUp');
  expect((await properties.boundingBox()).height).toBeGreaterThan(initialProperties.height);
  await expect(board.getByRole('button', { name: /Toggle (board properties|footprint browser)/ })).toHaveCount(0);
  const footprints = page.getByRole('region', { name: 'Footprints', exact: true });
  await expect(footprints).toBeVisible();
  await page.getByRole('button', { name: 'Hide side panel', exact: true }).click();
  await expect(footprints).toBeHidden();
  await expect(properties).toBeVisible();
  await page.getByRole('button', { name: 'Show side panel', exact: true }).click();
  await expect(footprints).toBeVisible();
  const bounds = await canvas.boundingBox();
  const anchor = { x: Math.round(bounds.x + bounds.width * 0.4), y: Math.round(bounds.y + bounds.height * 0.4) };
  const worldAtAnchor = () => canvas.evaluate((svg, { x, y }) => {
    const point = new DOMPoint(x, y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM().inverse());
    return [Math.round(point.x), Math.round(point.y)];
  }, anchor);
  const original = await worldAtAnchor();
  const initialView = await canvas.getAttribute('data-view-box');
  const displayViewport = await canvas.getAttribute('viewBox');
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Shift');
  await expect(canvas).not.toHaveAttribute('data-view-box', initialView);
  await expect(canvas).toHaveAttribute('viewBox', displayViewport);
  const anchored = await worldAtAnchor();
  expect(Math.hypot(anchored[0] - original[0], anchored[1] - original[1])).toBeLessThan(5);
  const steppedView = await canvas.getAttribute('data-view-box');
  await canvas.dispatchEvent('wheel', { shiftKey: true, deltaX: 30, deltaY: 0 });
  await expect(canvas).toHaveAttribute('data-view-box', steppedView);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -50);
  await page.keyboard.up('Control');
  await expect(canvas).not.toHaveAttribute('data-view-box', steppedView);
  const widthOf = (view) => Number(view.split(' ')[2]);
  const pinchedView = await canvas.getAttribute('data-view-box');
  expect(widthOf(steppedView) / widthOf(pinchedView)).toBeCloseTo(Math.sqrt(1.25), 5);
  const pinched = await worldAtAnchor();
  expect(Math.hypot(pinched[0] - original[0], pinched[1] - original[1])).toBeLessThan(5);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(anchor.x + 35, anchor.y + 30);
  await page.mouse.up({ button: 'middle' });
  expect(await worldAtAnchor()).not.toEqual(original);
  const [rulerRepaints, rulerStrokes] = await page.evaluate(() => [window.rulerRepaints, window.rulerStrokes]);
  expect(rulerRepaints).toBeGreaterThan(0);
  expect(rulerStrokes).toBe(rulerRepaints);
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
  await expect(canvas).not.toHaveAttribute('data-view-box', initialView);
  await board.getByLabel('Board drawing', { exact: true }).focus();
  await page.keyboard.press('Shift+F10');
  await boardMenu.getByRole('menuitem', { name: 'Fit board', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-view-box', initialView);
  const beforePan = (await canvas.getAttribute('data-view-box')).split(' ');
  const viewportBeforePan = await canvas.getAttribute('viewBox');
  await canvas.hover();
  await page.mouse.wheel(15, 30);
  await expect(canvas).not.toHaveAttribute('data-view-box', initialView);
  expect((await canvas.getAttribute('data-view-box')).split(' ').slice(2)).toEqual(beforePan.slice(2));
  await expect(canvas).toHaveAttribute('viewBox', viewportBeforePan);
  await board.getByRole('button', { name: 'Fit board', exact: true }).click();
  const toolbar = await board.getByRole('toolbar', { name: 'PCB commands' }).boundingBox();
  await expect(page.getByRole('group', { name: 'Design workspaces' })).toHaveCount(0);
  expect(toolbar.y).toBeLessThan((await canvas.boundingBox()).y);
  await expect(page).toHaveTitle('TinyCAD - Copied.dpn');
  await expect(page.locator('.top-bar-left')).toContainText('Copied.dpn');

  const openGuide = board.getByRole('button', { name: 'First board guide', exact: true });
  await openGuide.focus();
  await page.keyboard.press('Enter');
  const guide = board.getByRole('region', { name: 'First board guide' });
  const ensureGuide = async () => {
    if (!(await guide.isVisible())) await openGuide.click();
    await expect(guide).toBeVisible();
  };
  await expect(guide.getByRole('status')).toHaveText('Step 1 of 6 · Review parts');
  await expect(guide).toContainText('Create PCB from Schematic…');
  await guide.getByRole('button', { name: 'Next step' }).click();
  await guide.getByRole('button', { name: 'PCB Size & Shape…' }).click();
  const outline = page.getByRole('dialog', { name: 'PCB Size & Shape' });
  await outline.getByLabel('Shape').selectOption('rounded');
  await outline.getByLabel('Width (mm)').fill('40');
  await outline.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(outline).toBeHidden();
  await clickPcbCommand(board, 'Add cutout…');
  const cutout = page.getByRole('dialog', { name: 'Add board cutout' });
  await cutout.getByLabel('Shape').selectOption('circle');
  await cutout.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(cutout).toBeHidden();
  await clickPcbCommand(board, 'Hole or slot…');
  const drill = page.getByRole('dialog', { name: 'Add hole or slot' });
  await drill.getByLabel('Slot length (mm)').fill('4');
  await drill.getByRole('checkbox', { name: 'Plated' }).check();
  await drill.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drill).toBeHidden();
  await expect(board.locator('[data-hole]')).toHaveCount(1);
  await board.getByLabel('Copper layers').selectOption('1');
  await ensureGuide();
  await guide.getByLabel('Guide step').selectOption({ label: 'Route connections' });
  await guide.getByRole('button', { name: 'Start routing' }).click();
  await selectPcbNet(board, signal);
  const clickBoard = async (x, y) => {
    const position = await board
      .getByRole('img', { name: 'Board layout' })
      .evaluate(
        (svg, [x, y]) => {
          const position = new DOMPoint(x, -y).matrixTransform(
            svg.querySelector('[data-svg-drawing]').getScreenCTM(),
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

  await clickPcbCommand(board, 'View board tools');
  await expect(board.getByLabel('Copper layers')).toHaveValue('1');
  await board.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(board.getByLabel('Copper layers')).toHaveValue('1');
  await board.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(board.getByLabel('Copper layers')).toHaveValue('2');
  await board.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(board.getByLabel('Copper layers')).toHaveValue('1');
  await board.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.evaluate(() => { window.pcbReplies.hold = 'geometry'; });
  await page.evaluate(() => localStorage.setItem('tinycad.language', 'de'));
  await clickPcbCommand(board, 'Add copper zone');
  await drawPcbOutline(canvas, [[3, 3], [8, 3], [8, 8], [3, 8]]);
  const zone = board.getByRole('form', { name: 'Copper zone properties' });
  await zone.getByLabel('Outline (X, Y in mm)', { exact: true }).fill('2,0 2,0\n35,0; 2,0\n35,0 18,0\n2,0; 18,0');
  await zone.getByLabel('Disconnected copper').selectOption('retain');
  await zone.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await expect(board.getByText('Filling zones…')).toBeVisible();
  await board.getByRole('button', { name: 'Cancel zone fill' }).click();
  await expect(board.getByText('Zone fill is stale.')).toBeVisible();
  await expect(page).toHaveTitle('TinyCAD - Copied.dpn*');
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
  await ensureGuide();
  await guide.getByLabel('Guide step').selectOption({ label: 'Set up the board' });
  await guide.getByRole('button', { name: 'Choose fabrication settings…' }).click();
  const fabrication = page.getByRole('dialog', { name: 'Fabrication settings' });
  await fabrication.getByRole('combobox', { name: 'Fabrication profile' }).selectOption('classroom-v1');
  await fabrication.getByRole('textbox', { name: 'Board thickness (mm)' }).fill('1.2');
  await fabrication.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(fabrication).toBeHidden();
  await guide.getByLabel('Guide step').selectOption({ label: 'Check the board' });
  await guide.getByRole('button', { name: 'Check this revision…' }).click();
  const checks = page.getByRole('region', { name: 'PCB design checks' });
  await expect(checks.getByRole('table', { name: 'PCB findings' })).toContainText('Copper is disconnected from every required terminal.');
  await expect(checks.getByText(/Silkscreen and courtyard · not applicable/)).toBeVisible();
  await expect(checks.getByRole('table', { name: 'PCB findings' })).toContainText('outside the selected fabrication profile');
  const waiveFinding = checks.getByRole('button', { name: 'Waive finding…' });
  const waiverReason = checks.getByRole('textbox', { name: 'Reason for waiver' });
  await waiveFinding.press('Enter');
  await expect(waiverReason).toBeFocused();
  await checks.getByRole('button', { name: 'Cancel waiver' }).press('Enter');
  await expect(waiveFinding).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(waiverReason).toBeFocused();
  await waiverReason.fill('Intentional fixture test land');
  await checks.getByRole('button', { name: 'Save waiver' }).press('Enter');
  await expect(checks.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
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
  await clickPcbCommand(board, 'Inspect in 3D…');
  const offlineViewer = page.getByRole('dialog', { name: '3D board inspection' });
  await expect(offlineViewer.getByRole('alert')).toContainText('WebGL 2 is unavailable');
  await offlineViewer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(board.getByRole('img', { name: 'Board layout' })).toBeVisible();
  await board.getByRole('button', { name: 'Save As…' }).click();
  await expect(page).toHaveTitle('TinyCAD - Copy.dpn');
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


test('draws and picks copper on both sides of the large PCB coordinate range', async ({ page }) => {
  const api = await layoutRuntime();
  const source = await api.decodeBoard(await classroomBoard());
  const shift = ({ x, y }) => ({ x: x - 47_000_000, y: y - 46_000_000 });
  const board = {
    ...source,
    outline: source.outline.map(shift),
    tracks: source.tracks.map((track) => ({ ...track, start: shift(track.start), end: shift(track.end) })),
    vias: source.vias.map((via) => ({ ...via, positionNm: shift(via.positionNm) })),
    footprints: source.footprints.map((part) => ({ ...part, positionNm: shift(part.positionNm) })),
    zones: source.zones.map((zone) => ({ ...zone, outline: zone.outline.map(shift) })),
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Large classroom.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Large classroom.dpn'),
    }];
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const layout = page.getByRole('region', { name: 'PCB layout' });
  const drawing = layout.getByRole('img', { name: 'Board layout' });
  await clickPcbCommand(layout, 'View board tools');
  const tools = page.getByRole('region', { name: 'Board tools', exact: true });
  await expect(tools.getByText('Zones filled.', { exact: true })).toBeVisible();

  for (const index of [0, -1]) {
    const track = board.tracks.at(index);
    await expectTrackEndpoints(drawing.locator(`[data-track="${track.id}"]`),
      [track.start.x, -track.start.y, track.end.x, -track.end.y]);
    const via = board.vias.at(index);
    const part = board.footprints.at(index);
    const placement = drawing.locator(`[data-component="${part.componentId}"]`);
    await expect.poll(() => drawingCentre(drawing.locator(`[data-via="${via.id}"] [data-board-opening]`)))
      .toEqual([via.positionNm.x, -via.positionNm.y]);
    await expect.poll(() => drawingCentre(placement.locator('[data-board-pad]').first()))
      .toEqual([part.positionNm.x, -part.positionNm.y]);
    const reference = drawing.locator(`[data-footprint-reference="${part.componentId}"]`);
    const textX = await reference.evaluate((text) => {
      const inverse = text.closest('[data-svg-drawing]').getScreenCTM().inverse();
      return Math.round(inverse.multiply(text.getScreenCTM()).e);
    });
    expect(textX).toBe(part.positionNm.x);
  }

  const last = board.tracks.at(-1);
  const pointer = await drawing.evaluate((svg, { start, end }) => {
    const matrix = svg.querySelector('[data-svg-drawing]').getScreenCTM();
    const p = new DOMPoint((start.x + end.x) / 2, -(start.y + end.y) / 2).matrixTransform(matrix);
    return [p.x, p.y];
  }, last);
  await page.mouse.click(...pointer);
  await expect(tools.getByRole('group', { name: 'Selected track', exact: true })).toBeVisible();
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
  await clickPcbCommand(workspace, 'Review KiCad board…');
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

test('uses one PCB workspace, shows DRC below the board, and finishes a route with End', async ({ page }) => {
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
  await expect(workspace.getByLabel('PCB view')).toHaveCount(0);
  const inspection = page.getByRole('region', { name: 'PCB design checks' });
  const readFinding = async () => {
    await clickPcbCommand(workspace, 'Run design checks…');
    const issue = inspection.getByRole('row').filter({ hasText: 'Track is narrower than the board minimum.' });
    await expect(issue).toContainText('Measured 0.3 mm. Required 0.62 mm.');
    await issue.getByRole('button', { name: /Track is narrower/ }).click();
    await expect(workspace.locator('[data-check-marker]')).toBeVisible();
    await expect(inspection).toBeVisible();
    await inspection.getByRole('button', { name: 'Close', exact: true }).click();
    await workspace.getByRole('button', { name: 'Fit board', exact: true }).click();
  };
  await readFinding();
  const layers = page.getByRole('region', { name: 'Layers', exact: true });
  await expect(layers).toBeVisible();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const topCopper = layers.getByRole('button', { name: 'Show Top copper', exact: true });
  await topCopper.click();
  await expect(canvas.locator('[data-track]')).toHaveCount(0);
  await topCopper.click();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await clickPcbCommand(workspace, 'View board tools');
  const tools = page.getByRole('region', { name: 'Board tools', exact: true });
  await expect(tools).toBeVisible();
  await clickPcbCommand(workspace, 'Fabrication settings…');
  const fabrication = page.getByRole('dialog', { name: 'Fabrication settings' });
  await expect(fabrication.getByLabel('Minimum track width (mm)')).toBeVisible();
  await fabrication.getByRole('combobox', { name: 'Fabrication profile' }).selectOption('classroom-v1');
  await fabrication.getByRole('button', { name: 'Apply', exact: true }).click();
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await expect(tools.getByLabel('Track width preset').locator('option:checked')).toHaveText('Preferred (0.62 mm)');
  await selectPcbNet(workspace, netId);
  const pick = async (x, y) => {
    const where = await canvas.evaluate((svg, [x, y]) => {
      const point = new DOMPoint(x, -y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
      return { x: point.x, y: point.y };
    }, [x, y]);
    await page.mouse.click(where.x, where.y);
  };
  await pick(5e6, 6e6);
  await pick(15e6, 6e6);
  await page.keyboard.press('End');
  await expect(canvas.locator('[data-track]')).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.teachingSaved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.teachingSaved)));
  expect(saved.rules).toEqual(source.rules);
  expect(saved.tracks[1].widthNm).toBe(source.rules.minWidthNm);
  await closeStandaloneBoard(workspace);
  await expect(workspace).toBeHidden();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect(workspace.getByLabel('PCB view')).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Measure distance' })).toBeVisible();
  await expect(canvas.locator('[data-track]')).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await pick(8e6, 6e6);
  await pick(8e6, 13e6);
  await expect(canvas.locator('[data-track]')).toHaveCount(3);
  await expect(workspace.getByRole('button', { name: 'Route track', exact: true })).toBeVisible();
});

test('imports Protel connectivity into a standalone board and shows its pins in the netlist', async ({ page }) => {
  await page.goto(app.baseURL);
  const hideSidebar = page.getByRole('button', { name: 'Hide side panel', exact: true });
  const sidebarPosition = await hideSidebar.boundingBox();
  const sidebarIcon = await hideSidebar.locator('svg').innerHTML();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New PCB', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const footprints = page.getByRole('region', { name: 'Footprints', exact: true });
  await expect(footprints).toBeVisible();
  await expect.poll(() => hideSidebar.boundingBox()).toEqual(sidebarPosition);
  expect(await hideSidebar.locator('svg').innerHTML()).toBe(sidebarIcon);
  await expect(workspace.getByRole('button', { name: /Toggle (board properties|footprint browser)/ })).toHaveCount(0);
  await hideSidebar.click();
  await expect(footprints).toBeHidden();
  await page.getByRole('button', { name: 'Show side panel', exact: true }).click();
  await expect(footprints).toBeVisible();
  await clickPcbCommand(workspace, 'Import schematic or netlist…');
  const dialog = page.getByRole('dialog', { name: 'Import schematic or netlist' });
  await dialog.getByLabel('Circuit source').setInputFiles({
    name: 'Connector.net', mimeType: 'text/plain',
    buffer: Buffer.from('[\nJ1\nHeader\nInput\n]\n[\nJ2\nHeader\nOutput\n]\n(\nPower\nJ1-1\nJ2-2\n)\n'),
  });
  await dialog.getByRole('button', { name: 'Review circuit', exact: true }).click();
  await expect(dialog.getByText('2 components, 1 net')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply to PCB', exact: true }).click();
  await expect(dialog).toBeHidden();
  await clickPcbCommand(workspace, 'View netlist');
  const row = await pcbNetRow(workspace, { label: 'Power' });
  await expect(row).toContainText('J1.1, J2.2');
});

test('picks across visible unlocked layers and provides bulk layer controls', async ({ page }) => {
  const api = await layoutRuntime();
  const nets = [
    { id: crypto.randomUUID(), name: 'Top signal' },
    { id: crypto.randomUUID(), name: 'Bottom signal' },
  ];
  const [top, bottom] = [
    { id: crypto.randomUUID(), netId: nets[0].id, layerId: 'top', widthNm: 600_000,
      start: { x: 5e6, y: 15e6 }, end: { x: 25e6, y: 15e6 } },
    { id: crypto.randomUUID(), netId: nets[1].id, layerId: 'bottom', widthNm: 600_000,
      start: { x: 15e6, y: 5e6 }, end: { x: 15e6, y: 25e6 } },
  ];
  const file = api.createBoard('Layers', 2, [
    { x: 0, y: 0 }, { x: 30e6, y: 0 }, { x: 30e6, y: 30e6 }, { x: 0, y: 30e6 },
  ]);
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{ name: 'Layers.dpn', getFile: async () => new File([Uint8Array.from(bytes)], 'Layers.dpn') }];
  }, [...await api.encodeBoard({ ...file, nets, tracks: [top, bottom],
    annotations: { graphics: [{ kind: 'line', layer: 'Cmts.User', strokeNm: 500_000, filled: false,
      start: { x: 5e6, y: 10e6 }, end: { x: 10e6, y: 10e6 } }] },
    requiredFeatures: [...file.requiredFeatures, 'routed-copper', 'board-annotations', 'board-artwork'],
  })]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const editor = page.getByRole('region', { name: 'PCB layout' });
  const canvas = editor.getByRole('img', { name: 'Board layout' });
  const panel = page.getByRole('region', { name: 'Layers', exact: true });
  const layer = (name) => panel.getByRole('button', { name, exact: true });
  const track = ({ id }) => canvas.locator(`[data-track="${id}"]`);
  const selected = canvas.locator('[data-selection-outline="selected"]');

  await expect(layer('Top copper')).toHaveCount(0);
  await clickPcbPoint(canvas, 15, 20);
  await expect(track(bottom)).toHaveAttribute('data-net-highlighted', 'true');
  await clickPcbPoint(canvas, 20, 15);
  await expect(track(top)).toHaveAttribute('data-net-highlighted', 'true');
  await expect(canvas.locator('line.selectableLineHighlight')).toHaveCount(1);
  await expect(track(bottom)).not.toHaveAttribute('data-net-highlighted', 'true');

  await clickPcbPoint(canvas, 15, 20);
  await expect(track(bottom)).toHaveAttribute('data-net-highlighted', 'true');
  await layer('Lock Bottom copper').click();
  await expect(track(bottom)).toHaveCount(1);
  await expect(track(bottom)).toHaveAttribute('pointer-events', 'none');
  await expect(selected).toHaveCount(0);
  await clickPcbPoint(canvas, 15, 15);
  await expect(track(top)).toHaveAttribute('data-net-highlighted', 'true');
  await clickPcbPoint(canvas, 15, 20);
  await expect(selected).toHaveCount(0);

  await layer('Show Bottom copper').click();
  await expect(track(bottom)).toHaveCount(0);
  await layer('Show all layers').click();
  await expect(track(bottom)).toHaveCount(1);
  await expect(layer('Lock Bottom copper')).toHaveAttribute('aria-pressed', 'true');
  await layer('Unlock all layers').click();
  await expect(layer('Lock Bottom copper')).toHaveAttribute('aria-pressed', 'false');
  await layer('Lock all layers').click();
  await expect(layer('Lock Top copper')).toHaveAttribute('aria-pressed', 'true');
  await clickPcbPoint(canvas, 15, 15);
  await expect(selected).toHaveCount(0);
  await layer('Unlock all layers').click();
  await expect(layer('Lock Bottom copper')).toHaveAttribute('aria-pressed', 'false');

  await clickPcbCommand(editor, 'Pick overlapping objects');
  await clickPcbPoint(canvas, 15, 15);
  const picker = editor.getByRole('region', { name: 'Pick overlapping objects' });
  await expect(picker.getByRole('button', { name: /Track.*Bottom signal/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /Track.*Top signal/ })).toBeVisible();
  await picker.getByRole('button', { name: /Track.*Bottom signal/ }).click();
  await expect(track(bottom)).toHaveAttribute('data-net-highlighted', 'true');
  await clickPcbPoint(canvas, 7, 10);
  await expect(editor.getByText('Selected artwork · line 1')).toBeVisible();
  await expect(canvas.locator('[data-board-artwork-index="0"] .selectableLineHighlight')).toHaveCount(1);
  await layer('Lock User comments').click();
  await clickPcbPoint(canvas, 7, 10);
  await expect(editor.getByText('Selected artwork · line 1')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await layer('Lock User comments').click();
  const [from, to] = await canvas.evaluate((svg) => {
    const matrix = svg.querySelector('[data-svg-drawing]').getScreenCTM();
    return [[7e6, -10e6], [8e6, -11e6]].map(([x, y]) => {
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return [point.x, point.y];
    });
  });
  await page.mouse.move(...from);
  await page.mouse.down();
  await expect(editor.getByText('Selected artwork · line 1')).toBeVisible();
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
  await expect(canvas.locator('[data-board-artwork-index="0"] > line').first()).toHaveAttribute('x1', '6000');
});

test('draws copper objects and previews Components and overlap picker selections', async ({ page }) => {
  const api = await layoutRuntime();
  const fixture = { ...placementFixture(api), nets: [{ id: crypto.randomUUID(), name: 'Supply' }] };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Copper.dpn', getFile: async () => new File([Uint8Array.from(bytes)], 'Copper.dpn'),
    }];
  }, [...await api.encodeBoard(fixture)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const board = page.getByRole('region', { name: 'PCB layout', exact: true });
  const canvas = board.getByRole('img', { name: 'Board layout' });
  const layers = page.getByRole('region', { name: 'Layers', exact: true });
  const topCopper = layers.getByRole('button', { name: 'Show Top copper', exact: true });
  const topPaste = layers.getByRole('button', { name: 'Show Top solder paste', exact: true });
  await topCopper.click();
  await topPaste.click();
  await layers.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(topCopper).toHaveAttribute('aria-pressed', 'true');
  await expect(topPaste).toHaveAttribute('aria-pressed', 'false');

  const component = board.getByRole('grid', { name: 'Placed components' }).getByRole('button', { name: 'U1', exact: true });
  await component.hover();
  await expect(canvas.locator('[data-selection-outline="hover"]')).toBeVisible();
  await component.click();
  await expect(canvas.locator('[data-component-selected="true"]')).toHaveCount(1);

  for (const [action, label, shape] of [
    ['Add placement area', 'Placement area', '[data-placement-area]'],
    ['Add routing region', 'Routing region', '[data-routing-region]'],
    ['Add copper zone', 'Copper zone', '[data-board-copper-object*="zone"]'],
  ]) {
    await clickPcbCommand(board, action);
    await expect(board.getByRole('region', { name: label + ' drawing' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const [x, y] of [[6, 6], [13, 6], [13, 12], [6, 12], [6, 6]]) {
      await clickPcbPoint(canvas, x, y);
    }
    const properties = board.getByRole('form', { name: label + ' properties' });
    await expect(properties).toBeVisible();
    await expect(canvas.locator(shape)).toHaveAttribute('data-copper-highlight', 'selected');
    if (label === 'Placement area') {
      await properties.getByLabel('Name', { exact: true }).fill('Antenna');
      await properties.getByRole('button', { name: 'Apply', exact: true }).click();
    }
    await clickPcbPoint(canvas, 35, 5);
  }

  const area = canvas.locator('[data-placement-area]');
  const areaRow = board.getByRole('grid', { name: 'Placed components' }).getByRole('button', { name: 'Placement area · Antenna' });
  await areaRow.hover();
  await expect(area).toHaveAttribute('data-copper-highlight', 'hover');
  await areaRow.click();
  await expect(area).toHaveAttribute('data-copper-highlight', 'selected');
  await clickPcbPoint(canvas, 35, 5);
  await clickPcbCommand(board, 'Pick overlapping objects');
  await clickPcbPoint(canvas, 10, 10);
  const picker = board.getByRole('region', { name: 'Pick overlapping objects' });
  const pickedArea = picker.getByRole('button', { name: /Placement area.*Antenna/ });
  await pickedArea.hover();
  await expect(area).toHaveAttribute('data-copper-highlight', 'hover');
  await pickedArea.click();
  await expect(picker).toBeHidden();
  await expect(board.getByRole('form', { name: 'Placement area properties' })).toBeVisible();
});

test('moves footprint references and places text on PCB silkscreen and copper', async ({ page }) => {
  const api = await layoutRuntime();
  const fixture = placementFixture(api);
  const [definition] = fixture.footprintDefinitions;
  const [pad] = definition.pads;
  const [part, bottom] = fixture.footprints;
  const source = { ...fixture, footprintDefinitions: [{
    ...definition, pads: [{ ...pad, stack: { ...pad.stack, copper: { top: pad.stack.copper.top, bottom: pad.stack.copper.top } } }],
  }] };
  await page.addInitScript((bytes) => {
    let data = Uint8Array.from(bytes);
    const handle = {
      name: 'Text.dpn', getFile: async () => new File([data], 'Text.dpn'),
      createWritable: async () => ({ write: async (bytes) => { data = bytes; window.savedBoardText = [...bytes]; }, close: async () => {} }),
    };
    window.showOpenFilePicker = async () => [handle];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  const open = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  };
  await open();
  const board = page.getByRole('region', { name: 'PCB layout', exact: true });
  const canvas = board.getByRole('img', { name: 'Board layout' });
  const layers = page.getByRole('region', { name: 'Layers', exact: true });
  const footprint = canvas.locator(`[data-component="${part.componentId}"]`);
  const reference = canvas.locator(`[data-footprint-reference="${part.componentId}"]`);
  await expect(reference.locator('title')).toHaveText('U1');
  await expect(canvas.locator(`[data-footprint-reference="${bottom.componentId}"]`)).toHaveAttribute('data-pcb-layer', 'B.SilkS');
  await footprint.locator('[data-board-pad-layer="bottom"]').hover();
  await expect(footprint.locator('.selectableLineHighlight')).toHaveCount(1);
  const eye = layers.getByRole('button', { name: 'Show Top silkscreen', exact: true });
  await eye.click();
  await expect(reference).toHaveCount(0);
  await eye.click();

  const grid = board.getByRole('grid', { name: 'Placed components' });
  await grid.getByRole('button', { name: 'U1', exact: true }).click();
  const handle = canvas.locator('[data-footprint-reference-handle][data-selection-handle]');
  const original = await reference.locator('path').getAttribute('d');
  const box = await handle.boundingBox();
  const scale = await canvas.evaluate((svg) => svg.querySelector('[data-svg-drawing]').getScreenCTM().a);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 2e6 * scale, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(reference.locator('path')).not.toHaveAttribute('d', original);
  await board.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(reference.locator('path')).toHaveAttribute('d', original);
  await board.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(reference.locator('path')).not.toHaveAttribute('d', original);

  const textTool = board.getByRole('button', { name: 'Text', exact: true });
  for (const [layer, text, x] of [['B.SilkS', 'Board rev A', 18], ['F.Cu', 'Copper text', 27]]) {
    await textTool.click();
    const fields = board.locator('.pcb-text-fields');
    await fields.getByRole('textbox', { name: 'Text' }).fill(text);
    await fields.getByRole('combobox', { name: 'Layer' }).selectOption(layer);
    await clickPcbPoint(canvas, x, 29);
    await expect(canvas.locator(`[data-board-artwork-index][data-pcb-layer="${layer}"] title`)).toHaveText(text);
    await clickPcbPoint(canvas, 35, 5);
    await expect(grid.getByRole('button', { name: text, exact: true })).toBeEnabled();
  }
  await board.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedBoardText?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedBoardText)));
  expect(saved.footprints[0].positionNm).toEqual(part.positionNm);
  expect(saved.footprints[0].referencePositionNm).toEqual({ x: 2e6, y: 1.5e6 });
  expect(saved.annotations.graphics.map(({ text, layer }) => [text, layer]))
    .toEqual([['Board rev A', 'B.SilkS'], ['Copper text', 'F.Cu']]);
  await open();
  await expect(reference.locator('path')).not.toHaveAttribute('d', original);
  await expect(canvas.locator('[data-board-artwork-index]')).toHaveCount(2);
  await clickPcbPoint(canvas, 35, 5);
  await grid.getByRole('button', { name: 'Copper text', exact: true }).click();
  const editor = board.getByRole('form', { name: 'Board text properties' });
  await editor.getByRole('textbox', { name: 'Text' }).fill('ETCH');
  await editor.getByRole('button', { name: 'Apply' }).click();
  const copperText = canvas.locator('[data-board-artwork-index][data-pcb-layer="F.Cu"]');
  await expect(copperText.locator('title')).toHaveText('ETCH');
  await board.getByLabel('Board drawing', { exact: true }).press('Delete');
  await expect(copperText).toHaveCount(0);
  await board.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(copperText.locator('title')).toHaveText('ETCH');
  await textTool.click();
  await expect(textTool).toHaveAttribute('aria-pressed', 'true');
  await textTool.click();
  await expect(textTool).toHaveAttribute('aria-pressed', 'false');
});

test('places and edits rectangles, ellipses and closed lines in Circuit Design', async ({ page }) => {
  await page.goto(app.baseURL);
  const canvas = page.locator('#svg-drawing');
  const screen = ([x, y]) => canvas.evaluate((svg, [x, y]) => {
    const point = new DOMPoint(x, y).matrixTransform(svg.querySelector('g[transform^="matrix"]').getScreenCTM());
    return [point.x, point.y];
  }, [x, y]);
  const selectShape = async (name) => {
    await page.getByRole('button', { name: 'Shapes options', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  const drag = async (from, to) => {
    await page.mouse.move(...await screen(from));
    await page.mouse.down();
    await page.mouse.move(...await screen(to), { steps: 4 });
    await page.mouse.up();
  };
  const handles = canvas.locator('[data-selection-handle]');
  const items = () => page.evaluate(() => window.layoutTest.snapshot().drawing.sheets[0].items);

  await selectShape('Rectangle');
  await drag([200, 200], [320, 320]);
  await expect(canvas.locator('rect.selectedLineHighlight')).toBeVisible();
  await expect(handles).toHaveCount(8);
  const rectangle = (await items()).find(({ NodeName }) => NodeName === 'rectangle');
  await drag(rectangle.point_b, [380, 380]);
  await expect.poll(async () => (await items()).find(({ NodeName }) => NodeName === 'rectangle').point_b)
    .not.toEqual(rectangle.point_b);

  await selectShape('Ellipse');
  await drag([480, 200], [640, 320]);
  await expect(canvas.locator('ellipse.selectedLineHighlight')).toBeVisible();
  await expect(handles).toHaveCount(8);

  await selectShape('Line');
  for (const vertex of [[200, 440], [360, 440], [360, 560], [200, 440]]) {
    const point = await screen(vertex);
    await page.mouse.move(...point);
    await page.mouse.click(...point);
  }
  await expect(canvas.locator('path.selectedLineHighlight')).toHaveAttribute('d', /Z$/);
  await expect(handles).toHaveCount(3);
  const polygon = (await items()).find(({ NodeName }) => NodeName === 'line');
  expect(polygon.polygon).toBe(true);
  await drag(polygon.d_points[2], [420, 560]);
  await expect.poll(async () => (await items()).find(({ NodeName }) => NodeName === 'line').d_points[2])
    .not.toEqual(polygon.d_points[2]);
});

test('draws, resizes and reopens native area shapes and board openings', async ({ page }) => {
  const api = await layoutRuntime();
  const net = { id: crypto.randomUUID(), name: 'Supply' };
  const boardFile = { ...api.createBoard('Shapes', 2, [
    { x: 0, y: 0 }, { x: 50e6, y: 0 }, { x: 50e6, y: 50e6 }, { x: 0, y: 50e6 },
  ]), nets: [net] };
  await page.addInitScript((bytes) => {
    let data = Uint8Array.from(bytes);
    const handle = {
      name: 'Shapes.dpn', getFile: async () => new File([data], 'Shapes.dpn'),
      createWritable: async () => ({ write: async (bytes) => { data = bytes; window.savedShapes = [...bytes]; }, close: async () => {} }),
    };
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
  }, [...await api.encodeBoard(boardFile)]);
  await page.goto(app.baseURL);
  const open = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  };
  await open();
  const board = page.getByRole('region', { name: 'PCB layout', exact: true });
  const canvas = board.getByRole('img', { name: 'Board layout' });
  const handles = canvas.locator('[data-pcb-shape-handle]');
  const screen = ([x, y]) => canvas.evaluate((svg, [x, y]) => {
    const screen = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
    return [screen.x, screen.y];
  }, [x, y]);
  const drag = async (a, b, drawing = true) => {
    await page.mouse.move(...await screen(a));
    await page.mouse.down();
    await page.mouse.move(...await screen(b), { steps: 4 });
    if (drawing) await expect(canvas.locator('[data-copper-drawing-preview]')).toBeVisible();
    await page.mouse.up();
  };
  await board.getByRole('button', { name: 'Placement area', exact: true }).click();
  await drag([4, 4], [12, 12]);
  const rectangle = canvas.locator('rect[data-placement-area]');
  await expect(rectangle).toBeVisible();
  await expect(handles).toHaveCount(8);
  const properties = board.getByRole('form', { name: 'Placement area properties' });
  await properties.getByText('Corner radius (mm)').locator('input').fill('1');
  await properties.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rectangle).toHaveAttribute('rx', '1000');
  await drag([12, 12], [15, 14], false);
  await expect(rectangle).toHaveAttribute('width', '11000');
  await board.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rectangle).toHaveAttribute('width', '8000');
  await board.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(rectangle).toHaveAttribute('width', '11000');

  await board.getByRole('button', { name: 'Routing area shape options' }).click();
  await page.getByRole('menuitem', { name: 'Circle / ellipse', exact: true }).click();
  await drag([18, 4], [28, 12]);
  const ellipse = canvas.locator('ellipse[data-routing-region]');
  await expect(ellipse).toBeVisible();
  await expect(handles).toHaveCount(8);
  await drag([28, 12], [30, 14], false);
  await expect(ellipse).toHaveAttribute('rx', '6000');

  await board.getByRole('button', { name: 'Copper area shape options' }).click();
  await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
  await drawPcbOutline(canvas, [[32, 4], [45, 4], [44, 11], [36, 13]]);
  await expect(handles).toHaveCount(4);
  await drag([44, 11], [43, 14], false);

  await expect(board.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
  await board.getByRole('button', { name: 'Board cutout shape options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
  await drag([4, 24], [11, 31]);
  await expect(canvas.locator('rect[data-board-copper-object*="cutout"]')).toBeVisible();
  await board.getByRole('button', { name: 'Hole or slot shape options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Round hole', exact: true }).click();
  await drag([21, 26], [23, 26]);
  const roundHole = canvas.locator('ellipse[data-board-opening]');
  await expect(roundHole).toBeVisible();
  await expect(handles).toHaveCount(8);
  await drag([23, 26], [24, 26], false);
  await expect(roundHole).toHaveAttribute('rx', '2500');
  await expect(roundHole).toHaveAttribute('ry', '2500');
  await board.getByRole('button', { name: 'Hole or slot shape options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Slot', exact: true }).click();
  await drag([31, 25], [39, 25]);
  const slot = canvas.locator('rect[data-board-opening]');
  await expect(slot).toBeVisible();
  await expect(handles).toHaveCount(8);
  await drag([35, 25.5], [35, 27], false);
  await expect(slot).toHaveAttribute('height', '2500');
  await clickPcbPoint(canvas, 46, 26);
  await expect(handles).toHaveCount(0);
  await page.mouse.move(...await screen([35, 26]));
  await expect(canvas.locator('[data-hole] .selectableLineHighlight')).toBeVisible();
  await page.mouse.down();
  await expect(handles).toHaveCount(8);
  await page.mouse.move(...await screen([37, 28]), { steps: 4 });
  await page.mouse.up();

  await board.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedShapes?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedShapes)));
  expect(saved.placementAreas[0].shape).toMatchObject({ kind: 'rectangle', radiusNm: 1e6, end: { x: 15e6, y: 14e6 } });
  expect(saved.routingRegions[0].shape).toMatchObject({ kind: 'ellipse', end: { x: 30e6, y: 14e6 } });
  expect(saved.zones[0].outline[2]).toEqual({ x: 43e6, y: 14e6 });
  expect(saved.profile.cutoutShapes[0].kind).toBe('rectangle');
  expect(saved.mechanicalHoles[0]).toMatchObject({ start: saved.mechanicalHoles[0].end, widthNm: 5e6 });
  expect(saved.mechanicalHoles[1]).toMatchObject({ start: { x: 33.75e6, y: 27.75e6 }, widthNm: 2.5e6 });
  expect(saved.mechanicalHoles[1].start).not.toEqual(saved.mechanicalHoles[1].end);
  await open();
  await expect(rectangle).toHaveAttribute('rx', '1000');
  await expect(canvas.locator('ellipse[data-routing-region]')).toBeVisible();
  await expect(canvas.locator('[data-hole]')).toHaveCount(2);
  const layers = page.getByRole('region', { name: 'Layers', exact: true });
  await clickPcbPoint(canvas, 45, 45);
  const picker = board.getByRole('grid', { name: 'Placed components' });
  await expect(picker.getByRole('columnheader', { name: 'Layer 1', exact: true })).toBeVisible();
  await expect(picker.getByRole('columnheader', { name: /Layer 2/ })).toBeVisible();
  const holeRow = picker.getByRole('row').filter({ hasText: 'Hole or slot · Hole 1' });
  const slotRow = picker.getByRole('row').filter({ hasText: 'Hole or slot · Slot 2' });
  const holeLayer = holeRow.getByRole('gridcell').nth(1);
  const slotLayer = slotRow.getByRole('gridcell').nth(1);
  await expect(holeLayer).toHaveText('PCB edge cuts');
  await expect(holeLayer.getByRole('img', { name: 'Visible', exact: true })).toBeVisible();
  await expect(holeLayer.getByRole('img', { name: 'Unlocked', exact: true })).toBeVisible();
  await expect(holeRow.getByRole('button')).toBeEnabled();
  await expect(slotLayer).toHaveText('PCB edge cuts');
  await expect(slotRow.getByRole('gridcell').nth(2)).toBeEmpty();
  await holeRow.getByRole('button').click();
  await expect(handles).toHaveCount(8);
  await clickPcbPoint(canvas, 45, 45);
  const regionLayers = picker.getByRole('row').filter({ hasText: 'Routing region · Routing region' });
  const topLayer = regionLayers.getByRole('gridcell').nth(1);
  await expect(topLayer).toHaveText('Top copper');
  await expect(regionLayers.getByRole('gridcell').nth(2)).toHaveText('Bottom copper');
  expect((await topLayer.boundingBox()).x).toBe((await slotLayer.boundingBox()).x);
  for (const [position, opening, element] of [
    [[7, 27], '[data-board-copper-object*="cutout"]', 'rect'],
    [[21.5, 26], 'ellipse[data-board-opening]', 'ellipse'],
    [[37, 28], 'rect[data-board-opening]', 'rect'],
  ]) {
    await page.mouse.move(...await screen(position));
    await expect(canvas.locator(opening)).toHaveAttribute('data-copper-hover', 'true');
    await expect(canvas.locator(element + '.selectableLineHighlight')).toBeVisible();
    await clickPcbPoint(canvas, ...position);
    await expect(handles).toHaveCount(8);
    await clickPcbPoint(canvas, 45, 45);
  }
  const lock = layers.getByRole('button', { name: 'Lock PCB edge cuts', exact: true });
  await lock.click();
  const eye = layers.getByRole('button', { name: 'Show PCB edge cuts', exact: true });
  await eye.click();
  await expect(slotLayer).toHaveText('PCB edge cuts');
  await expect(slotLayer.getByRole('img', { name: 'Hidden', exact: true })).toBeVisible();
  await expect(slotLayer.getByRole('img', { name: 'Locked', exact: true })).toBeVisible();
  await expect(slotRow.getByRole('button')).toBeDisabled();
  await eye.click();
  await page.mouse.move(...await screen([37, 28]));
  await expect(canvas.locator('.selectableLineHighlight')).toHaveCount(0);
  await lock.click();
  await expect(slotLayer.getByRole('img', { name: 'Visible', exact: true })).toBeVisible();
  await expect(slotLayer.getByRole('img', { name: 'Unlocked', exact: true })).toBeVisible();
  await expect(slotRow.getByRole('button')).toBeEnabled();
  await clickPcbPoint(canvas, 37, 28);
  await expect(handles).toHaveCount(8);
  await page.mouse.move(...await screen([38, 28]));
  await expect(slot).toHaveAttribute('data-copper-highlight', 'selected');
  await expect(canvas.locator('rect.selectableLineHighlight')).toBeVisible();
  await clickPcbPoint(canvas, 45, 45);
  await page.setViewportSize({ width: 900, height: 700 });
  const listMode = picker.getByRole('button', { name: 'Components', exact: true });
  await expect(listMode).toBeInViewport({ ratio: 1 });
  await listMode.click();
  await expect(page.getByRole('menuitem', { name: 'Netlist', exact: true })).toBeVisible();
});

test('uses the schematic polygon context menu to add, move, edit and remove PCB curve controls', async ({ page }) => {
  const api = await layoutRuntime();
  const file = api.createBoard('Curves', 2, [
    { x: 0, y: 0 }, { x: 40e6, y: 0 }, { x: 40e6, y: 40e6 }, { x: 0, y: 40e6 },
  ]);
  await page.addInitScript((bytes) => {
    let contents = Uint8Array.from(bytes);
    const handle = {
      name: 'Curves.dpn', getFile: async () => new File([contents], 'Curves.dpn'),
      createWritable: async () => ({ write: async (bytes) => { contents = bytes; window.savedCurves = [...bytes]; }, close: async () => {} }),
    };
    window.showOpenFilePicker = async () => [handle];
  }, [...await api.encodeBoard(file)]);
  await page.goto(app.baseURL);
  const open = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  };
  await open();
  const editor = page.getByRole('region', { name: 'PCB layout' });
  const canvas = editor.getByRole('img', { name: 'Board layout' });
  const shape = canvas.locator('path[data-placement-area]');
  const handles = canvas.locator('[data-pcb-shape-handle]');
  const screen = ([x, y]) => canvas.evaluate((svg, [x, y]) => {
    const point = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
    return [point.x, point.y];
  }, [x, y]);
  const context = async (point) => page.mouse.click(...await screen(point), { button: 'right' });
  const add = async (point, command) => {
    await context(point);
    await page.getByRole('menuitem', { name: 'Add', exact: true }).hover();
    await page.getByRole('menuitem', { name: command, exact: true }).click();
  };
  const drag = async (from, to) => {
    await page.mouse.move(...await screen(from));
    await page.mouse.down();
    await page.mouse.move(...await screen(to), { steps: 5 });
    await page.mouse.up();
  };

  await editor.getByRole('button', { name: 'Placement area shape options' }).click();
  await page.getByRole('menuitem', { name: 'Polygon', exact: true }).click();
  for (const [x, y] of [[6, 6], [20, 6], [20, 20]]) await clickPcbPoint(canvas, x, y);
  await context([6, 20]);
  await expect(handles).toHaveCount(4);
  await expect(canvas.locator('path.selectedLineHighlight')).toBeVisible();

  await add([13, 6], 'Add Point');
  await expect(handles).toHaveCount(5);
  await add([20.15, 13], 'Add Quadratic Curve');
  await expect(handles).toHaveCount(6);
  await drag([20, 13], [23, 13]);
  await expect(shape).toHaveAttribute('d', /Q23000000 -13000000/);
  await add([13, 20], 'Add Cubic Curve');
  await expect(handles).toHaveCount(8);
  await drag([15.333, 20], [16, 23]);
  await expect(shape).toHaveAttribute('d', / C16000000 -23000000/);
  await context([23, 13]);
  await page.getByRole('menuitem', { name: 'Remove Curve', exact: true }).click();
  await expect(handles).toHaveCount(7);
  await expect(shape).not.toHaveAttribute('d', / Q/);

  await clickPcbPoint(canvas, 30, 30);
  await expect(handles).toHaveCount(0);
  await drag([10, 10], [12, 12]);
  await expect(shape).toHaveAttribute('d', /^M8000000 -8000000/);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedCurves?.length ?? 0)).toBeGreaterThan(0);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedCurves)));
  expect(saved.placementAreas[0].shape.vertices.filter(({ control }) => control)).toHaveLength(2);
  expect(saved.placementAreas[0].outline.length).toBeGreaterThan(5);
  await open();
  await expect(shape).toHaveAttribute('d', / C/);
  await clickPcbPoint(canvas, 10, 10);
  await expect(handles).toHaveCount(7);
  await context([15, 8]);
  await page.getByRole('menuitem', { name: 'Delete Point', exact: true }).click();
  await expect(handles).toHaveCount(6);
});

test('uses the Circuit Design panel switcher, PCB scrollbars and drawing selection', async ({ page }) => {
  const api = await layoutRuntime();
  const fixture = placementFixture(api);
  const net = { id: crypto.randomUUID(), name: 'Test signal' };
  const track = {
    id: crypto.randomUUID(), netId: net.id, layerId: 'top', widthNm: 250_000,
    start: { x: 25_000_000, y: 28_000_000 }, end: { x: 30_000_000, y: 28_000_000 },
  };
  const source = {
    ...fixture, nets: [net], tracks: [track], requiredFeatures: [...fixture.requiredFeatures, 'routed-copper'],
  };
  const [first, second, third] = source.footprints;
  await page.addInitScript((bytes) => {
    window.boardDragWrites = 0;
    window.showOpenFilePicker = async () => [{
      name: 'Drag.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Drag.dpn'),
      createWritable: async () => ({
        write: async () => { window.boardDragWrites++; },
        close: async () => {},
        abort: async () => {},
      }),
    }];
  }, [...await api.encodeBoard(source)]);
  await page.goto(app.baseURL);
  const circuitBottom = page.locator('.bottom-panel-wrapper');
  await expect(circuitBottom.getByRole('button', { name: 'Symbols', exact: true })).toBeVisible();
  await circuitBottom.getByRole('button', { name: 'Symbols', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Netlist', exact: true }).click();
  await expect(circuitBottom.getByRole('button', { name: 'Netlist', exact: true })).toBeVisible();
  const schematicViewport = page.locator('.svg-viewport').filter({ has: page.locator('#svg-drawing') });
  await expect(schematicViewport.locator('.svg-viewport-drawing')).toBeVisible();
  const circuitPanelHeight = (await circuitBottom.boundingBox()).height;
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const properties = workspace.getByRole('region', { name: 'Board properties' });
  const components = properties.getByRole('grid', { name: 'Placed components' });
  const footprint = (part) => canvas.locator(`[data-component="${part.componentId}"]`);
  const drawing = canvas.locator('[data-svg-drawing]');
  await expect(components).toBeVisible();
  expect((await properties.boundingBox()).height).toBe(circuitPanelHeight);
  await expect(properties.getByRole('tablist')).toHaveCount(0);
  await components.getByRole('button', { name: 'Components', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Netlist', exact: true }).click();
  const netlistGrid = properties.getByRole('grid', { name: 'Board netlist' });
  await expect(netlistGrid.getByRole('button', { name: 'Netlist', exact: true })).toBeVisible();
  await netlistGrid.getByRole('button', { name: 'Netlist', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Components', exact: true }).click();
  await expect(components).toBeVisible();
  await expect(canvas.locator('..')).toHaveClass('svg-viewport-drawing');
  await expect(workspace.getByRole('complementary', { name: 'Board tools' })).toHaveCount(0);
  const before = await canvas.getAttribute('data-view-box');
  for (const axis of ['horizontal', 'vertical']) {
    const scrollbar = workspace.getByLabel(`Board layout ${axis} scroll`);
    await expect(scrollbar).toBeVisible();
    await scrollbar.press(axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown');
    await expect.poll(async () => (await canvas.getAttribute('data-view-box')).split(' ')[axis === 'horizontal' ? 0 : 1])
      .not.toBe(before.split(' ')[axis === 'horizontal' ? 0 : 1]);
  }
  await workspace.getByRole('button', { name: 'Fit board', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-view-box', await canvas.getAttribute('data-fit-view-box'));
  await components.getByRole('button', { name: 'U1', exact: true }).click();
  await expect(components).toHaveCount(0);
  await expect(properties.getByRole('group', { name: 'Position U1' })).toBeVisible();
  await expect(canvas.locator('[data-selection-outline="selected"]')).toHaveCount(1);

  const firstPad = footprint(first).locator('[data-board-pad]').first();
  await firstPad.hover();
  await expect(canvas.locator('[data-selection-outline="hover"]')).toBeVisible();
  const pad = await firstPad.boundingBox();
  const start = { x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 };
  const scale = await drawing.evaluate((element) => element.getScreenCTM().a);
  const offsetPixels = 2_000_000 * scale;
  const topLock = page.getByRole('region', { name: 'Layers', exact: true }).getByRole('button', { name: 'Lock Top copper' });
  await topLock.click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + offsetPixels, start.y, { steps: 5 });
  await expect(canvas.locator('[data-footprint-move-preview]')).toHaveCount(0);
  await page.mouse.up();
  await expect(workspace.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await topLock.click();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + offsetPixels, start.y, { steps: 5 });
  await expect(canvas.locator('[data-footprint-move-preview]')).toHaveCount(1);
  await expect(workspace.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(canvas.locator('[data-footprint-move-preview]')).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + offsetPixels, start.y, { steps: 5 });
  await page.mouse.up();
  const anchor = canvas.locator(`[data-footprint-reference="${first.componentId}"]`);
  await expect(anchor).toHaveAttribute('transform', /^matrix\(1 0 0 1 12000000 /);
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(anchor).toHaveAttribute('transform', /^matrix\(1 0 0 1 10000000 /);
  expect(await page.evaluate(() => window.boardDragWrites)).toBe(0);

  const a = await footprint(first).boundingBox();
  const b = await footprint(third).boundingBox();
  await page.mouse.move(Math.max(a.x + a.width, b.x + b.width) + 35, Math.max(a.y + a.height, b.y + b.height) + 25);
  await page.mouse.down();
  await page.mouse.move(Math.min(a.x, b.x) - 25, Math.min(a.y, b.y) - 35, { steps: 5 });
  await expect(canvas.locator('[data-selection-marquee]')).toBeVisible();
  await page.mouse.up();
  await expect(canvas.locator('[data-placement-group="true"]')).toHaveCount(3);
  await expect(footprint(second)).toHaveAttribute('data-placement-group', 'true');
  await expect(properties.getByRole('group', { name: 'Placement group' })).toBeVisible();
  const bottomLock = page.getByRole('button', { name: 'Lock Bottom copper' });
  await bottomLock.click();
  await expect(canvas.locator('[data-placement-group="true"]')).toHaveCount(2);
  await expect(footprint(second)).not.toHaveAttribute('data-placement-group', 'true');
  await bottomLock.click();
  await clickPcbPoint(canvas, 35, 5);
  await clickPcbCommand(workspace, 'View netlist');
  await properties.getByLabel('Search board netlist').fill('signal');
  const netRow = properties.getByRole('row', { name: /Test signal/ });
  const trace = canvas.locator(`[data-track="${track.id}"]`);
  await netRow.click();
  await expect(netRow).toHaveAttribute('aria-current', 'true');
  await expect(trace).toHaveAttribute('data-net-highlighted', 'true');
  await expect(properties.getByRole('button', { name: 'Clear net selection' })).toHaveCount(0);
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(netRow).not.toHaveAttribute('aria-current', 'true');
  await expect(trace).not.toHaveAttribute('data-net-highlighted', 'true');
  await expect(canvas.locator('[data-selection-outline="selected"]')).toHaveCount(0);
  await expect(netlistGrid).toBeVisible();
  await expect(components).toHaveCount(0);

  const [corner, opposite] = await drawing.evaluate((element) => {
    const matrix = element.getScreenCTM();
    return [[20_000_000, -31_000_000], [32_000_000, -14_000_000]].map(([x, y]) => {
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return [point.x, point.y];
    });
  });
  await page.mouse.move(...corner);
  await page.mouse.down();
  await page.mouse.move(...opposite, { steps: 5 });
  await page.mouse.up();
  await expect(canvas.locator('[data-placement-group="true"]')).toHaveCount(1);
  await expect(canvas.locator('[data-selection-outline="selected"]')).toHaveCount(2);
  await expect(properties.getByText('1 copper object selected')).toBeVisible();
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(netlistGrid).toBeVisible();

  await page.setViewportSize({ width: 900, height: 700 });
  const netlistBounds = await netlistGrid.boundingBox();
  const dropdownBounds = await netlistGrid.getByRole('button', { name: 'Netlist', exact: true }).boundingBox();
  const searchBounds = await netlistGrid.getByLabel('Search board netlist').boundingBox();
  expect(dropdownBounds.x + dropdownBounds.width).toBeLessThanOrEqual(netlistBounds.x + netlistBounds.width);
  expect(Math.abs(dropdownBounds.y + dropdownBounds.height / 2 - searchBounds.y - searchBounds.height / 2)).toBeLessThan(2);
  await workspace.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('menuitem', { name: 'PCB Size & Shape…' }).click();
  const dialog = page.getByRole('dialog', { name: 'PCB Size & Shape' });
  await expect(dialog).toBeVisible();
  const layoutBounds = () => dialog.evaluate((surface) => [surface.offsetWidth, surface.offsetHeight]);
  const bounds = await layoutBounds();
  await dialog.getByLabel('Shape', { exact: true }).selectOption('custom');
  expect(await layoutBounds()).toEqual(bounds);
  await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
  const edges = dialog.locator('.pcb-contour-edges');
  await edges.hover();
  await page.mouse.wheel(0, 150);
  await expect.poll(() => edges.evaluate((content) => content.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
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
  await workspace.getByRole('grid', { name: 'Placed components', exact: true })
    .getByRole('button', { name: 'U1', exact: true }).click();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const thirdPad = canvas.locator('[data-component="' + source.components[2].id + '"] [data-board-pad]').first();
  await thirdPad.click({ modifiers: ['Shift'] });
  await expect(canvas.locator('[data-placement-group="true"]')).toHaveCount(2);
  await thirdPad.click({ modifiers: ['Shift'] });
  await expect(canvas.locator('[data-placement-group="true"]')).toHaveCount(1);
  await thirdPad.click({ modifiers: ['Shift'] });
  const group = workspace.getByRole('group', { name: 'Placement group' });
  await group.getByLabel('Group X offset (mm)').fill('2');
  await group.getByLabel('Group Y offset (mm)').fill('3');
  const apply = group.getByRole('button', { name: 'Apply group placement' });
  const [first, , third] = source.footprints;
  const x = (part) => canvas.locator(`[data-footprint-reference="${part.componentId}"]`);
  await page.evaluate(() => { window.failGroupSave = true; });
  await apply.click();
  await expect(x(first)).toHaveAttribute('transform', /^matrix\(1 0 0 1 12000000 /);
  await expect(x(third)).toHaveAttribute('transform', /^matrix\(1 0 0 1 24000000 /);
  expect(await page.evaluate(() => window.groupSaved)).toBeUndefined();
  const save = workspace.getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect(workspace.getByRole('alert')).toContainText('Simulated write failure');
  await expect(x(first)).toHaveAttribute('transform', /^matrix\(1 0 0 1 12000000 /);
  await expect(workspace.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.failGroupSave = false; });
  await save.click();
  await expect.poll(() => page.evaluate(() => window.groupSaved?.length ?? 0)).toBeGreaterThan(0);
  await expect(x(first)).toHaveAttribute('transform', /^matrix\(1 0 0 1 12000000 /);
  await expect(x(third)).toHaveAttribute('transform', /^matrix\(1 0 0 1 24000000 /);
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.groupSaved)));
  expect(saved.revision).toBe(source.revision + 1);
  expect(saved.footprints[1]).toEqual(source.footprints[1]);
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(x(first)).toHaveAttribute('transform', /^matrix\(1 0 0 1 10000000 /);
  await expect(x(third)).toHaveAttribute('transform', /^matrix\(1 0 0 1 22000000 /);
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
  const tray = page.getByRole('region', { name: 'Unplaced components' });
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
  await clickPcbCommand(workspace, 'View board tools');
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
  await clickPcbCommand(workspace, 'View components');
  await expect(workspace.getByRole('grid', { name: 'Placed components', exact: true })).toContainText('U1');
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
  const openConnections = () => clickPcbCommand(workspace, 'Board connections…');
  const dialog = page.getByRole('dialog', { name: 'PCB connections' });
  const netName = dialog.getByLabel('Net name');
  await openConnections();
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
  const tray = page.getByRole('region', { name: 'Unplaced components' });
  for (const [index, reference] of ['J1', 'J2'].entries()) {
    await tray.getByRole('button', { name: reference + ' · Test terminal' }).click();
    await workspace.getByLabel('X (mm)', { exact: true }).fill(String(10 + 10 * index));
    await workspace.getByLabel('Y (mm)', { exact: true }).fill('10');
    await workspace.getByRole('button', { name: 'Place at coordinates' }).click();
    await expect(canvas.locator('[data-component]')).toHaveCount(index + 1);
  }
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await selectPcbNet(workspace, { label: 'Supply' });
  await page.evaluate(() => localStorage.setItem('tinycad.language', 'de'));
  await workspace.getByText('Enter route coordinates', { exact: true }).click();
  for (const x of ['10', '20']) {
    await workspace.getByLabel('Waypoint X (mm)').fill(x + ',0');
    await workspace.getByLabel('Waypoint Y (mm)').fill('10,0');
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
  await closeStandaloneBoard(workspace);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await openConnections();
  await dialog.getByLabel('Component', { exact: true }).selectOption({ label: 'J2' });
  await dialog.getByLabel('Electrical pads').selectOption({ label: '1' });
  await expect(dialog.getByLabel('Assign to net')).toHaveValue(net.id);
  await dialog.getByLabel('Assign to net').selectOption('');
  await dialog.getByRole('button', { name: 'Apply pad assignment' }).click();
  await expect(dialog.getByRole('status')).toContainText('Run design checks');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(1);
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await openConnections();
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
  const select = workspace.getByRole('grid', { name: 'Placed components', exact: true })
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
  await position.getByRole('checkbox', { name: 'Lock component', exact: true }).check();
  await expect(position.getByLabel('Layer', { exact: true })).toBeDisabled();
  await expect(position.getByRole('button', { name: 'Apply position' })).toBeDisabled();
  await position.getByRole('checkbox', { name: 'Lock component', exact: true }).uncheck();
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
  await closeStandaloneBoard(workspace);
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
  await page.getByRole('list', { name: 'Unplaced components', exact: true })
    .getByRole('button', { name: 'U2' }).click();
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  const preview = canvas.locator('[data-placement-preview]');
  const guide = preview.locator('[data-placement-airwire]');
  const placeOnBoard = page.getByRole('region', { name: 'Footprints', exact: true })
    .getByRole('button', { name: 'Place on board', exact: true });
  const footprintImage = page.getByRole('img', { name: 'Footprint pad preview' });
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
  await workspace.getByLabel('Layer', { exact: true }).selectOption('bottom');
  await expect(guide).toHaveAttribute('d', 'M18000000,-17000000 L11000000,-12000000');
  await expect(preview.getByText('8.60 mm')).toHaveCount(0);
  await workspace.getByLabel('Show straight-line estimates').check();
  await expect(preview.getByText('8.60 mm')).toBeVisible();

  const pointer = await canvas.evaluate((svg) => {
    const point = new DOMPoint(24_000_000, -23_000_000).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
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
  const padBounds = await placedFootprint.locator('[data-board-pad]').first().boundingBox();
  const dragStart = { x: padBounds.x + padBounds.width / 2, y: padBounds.y + padBounds.height / 2 };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 24, dragStart.y, { steps: 5 });
  const movePreview = canvas.locator('[data-footprint-move-preview]');
  await expect(movePreview).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(movePreview).toHaveCount(0);
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
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  await clickPcbCommand(workspace, 'Add wire jumper');
  await clickPcbPoint(canvas, 8, 6);
  await clickPcbPoint(canvas, 16, 10);
  await expect(workspace.getByRole('form', { name: 'Wire jumper properties' })).toBeVisible();
  const land = canvas.locator('[data-jumper-end="A"]');
  await expect(land).toBeVisible();
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await land.click();
  await expect(await pcbNetRow(workspace, netId)).toHaveAttribute('aria-current', 'true');
  await clickPcbCommand(workspace, 'View board tools');
  const second = await canvas.evaluate((svg) => {
    const p = new DOMPoint(5e6, -6e6).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(second.x, second.y);
  await page.keyboard.press('End');
  await expect.poll(() => canvas.locator('[data-track]').count()).toBeGreaterThan(0);

  const checks = page.getByRole('region', { name: 'PCB design checks' });
  const runChecks = async (expected) => {
    await clickPcbCommand(workspace, 'Run design checks…');
    await expect(checks.getByRole('table', { name: 'PCB findings' })).toContainText(expected);
    await checks.getByRole('button', { name: 'Close', exact: true }).click();
  };
  await runChecks('Separate bare copper islands require fitted wire jumpers');
  await selectCopperRow(workspace, 'Wire jumper · JP1');
  const edit = workspace.getByRole('form', { name: 'Wire jumper properties' });
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

test('inspects drilled openings with the same limits as design checks', async ({ page }) => {
  const api = await layoutRuntime();
  const point = (x, y) => ({ x: x * 1e6, y: y * 1e6 });
  const base = api.createBoard('Fabrication rules', 2, [point(0, 0), point(24, 0), point(24, 16), point(0, 16)]);
  const holes = [6, 7].map((x) => ({
    id: crypto.randomUUID(), start: point(x, 2), end: point(x, 2), widthNm: 600_000, plated: false,
  }));
  const slot = {
    id: crypto.randomUUID(), start: point(12, 8), end: point(12.6, 8),
    widthNm: 800_000, landWidthNm: 1_400_000, plated: true,
  };
  const netId = crypto.randomUUID();
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'mechanical-holes', 'fabrication-settings', 'routed-copper'],
    nets: [{ id: netId, name: 'Signal' }],
    tracks: [{ id: crypto.randomUUID(), netId, layerId: 'top', widthNm: 200_000,
      start: point(5.5, 2.49), end: point(6.5, 2.49) }],
    mechanicalHoles: [...holes, slot],
    fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Openings.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Openings.dpn'),
      createWritable: async () => {
        window.openingsWriteAttempted = true;
        throw new Error('Inspection should be read-only.');
      },
    }];
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await clickPcbCommand(workspace, 'Inspect board rules…');
  const inspector = page.getByRole('dialog', { name: 'Inspect PCB rules' });
  await inspector.getByRole('tab', { name: 'Openings', exact: true }).click();
  const opening = inspector.getByLabel('Opening', { exact: true });
  const compare = inspector.getByLabel('Compare openings', { exact: true });
  await opening.selectOption({ label: 'Plated slot 3 · X 12 mm, Y 8 mm' });
  await expect(inspector).toContainText('Opening width measured 0.8 mm, required 0.6 mm (minPlatedSlotNm).');
  await expect(inspector).toContainText('Finished slot length measured 1.4 mm, required 1.6 mm (minPlatedSlotRatio).');
  await expect(inspector.getByRole('list', { name: 'Plated pad annulus' })).toContainText('Passes.');
  await opening.selectOption({ label: 'Non-plated hole 1 · X 6 mm, Y 2 mm' });
  await compare.selectOption({ label: 'Non-plated hole 2 · X 7 mm, Y 2 mm' });
  const spacing = 'Opening spacing measured 0.4 mm, required 0.45 mm (minHoleGapNm).';
  await expect(inspector).toContainText(spacing);
  await opening.selectOption({ label: 'Non-plated hole 2 · X 7 mm, Y 2 mm' });
  await compare.selectOption({ label: 'Non-plated hole 1 · X 6 mm, Y 2 mm' });
  await expect(inspector).toContainText(spacing);
  await opening.selectOption({ label: 'Non-plated hole 1 · X 6 mm, Y 2 mm' });
  await compare.selectOption({ label: 'track 1 · Signal · top' });
  const copperClearance = inspector.getByText(/^Opening to copper clearance measured/);
  await expect(copperClearance).toContainText('Required 0.25 mm (drill-clearance).');
  const measured = (await copperClearance.textContent()).match(/measured (0\.0\d+ mm)/)?.[1];
  expect(measured).toBeDefined();
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();

  await clickPcbCommand(workspace, 'Run design checks…');
  const findings = page.getByRole('table', { name: 'PCB findings' });
  await expect(findings.locator('tbody > tr').filter({ hasText: 'Plated slot is too short' }))
    .toContainText('Measured 1.4 mm. Required 1.6 mm.');
  await expect(findings.locator('tbody > tr').filter({ hasText: 'Spacing between drill or slot edges' }))
    .toContainText('Measured 0.4 mm. Required 0.45 mm.');
  await expect(findings.locator('tbody > tr').filter({ hasText: 'Copper violates drill or slot clearance' }).first())
    .toContainText('Measured ' + measured + '. Required 0.25 mm.');
  expect(await page.evaluate(() => window.openingsWriteAttempted)).toBeUndefined();
});

test('inspects mask, paste and legend with the same limits as design checks', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const api = await layoutRuntime();
  const fixture = placementFixture(api);
  const [definition] = fixture.footprintDefinitions;
  const [pad] = definition.pads;
  const point = (x, y) => ({ x, y });
  const face = (left, right) => ({
    kind: 'polygon',
    vertices: [point(left, -200_000), point(right, -200_000), point(right, 200_000), point(left, 200_000)],
  });
  const land = face(-300_000, 300_000);
  const board = {
    ...fixture,
    requiredFeatures: [...fixture.requiredFeatures, 'fabrication-settings'],
    fabrication: { profileId: 'classroom-v1', thicknessNm: 1_600_000 },
    footprintDefinitions: [{
      ...definition,
      pads: [{
        ...pad,
        stack: { copper: { top: land }, mask: { top: land }, paste: { top: face(-300_000, -100_000) } },
      }],
      graphics: [{
        kind: 'line', layer: 'F.SilkS', strokeNm: 100_000, filled: false,
        start: point(-250_000, 0), end: point(250_000, 0),
      }, {
        kind: 'text', layer: 'F.SilkS', strokeNm: 160_000, filled: false,
        at: point(0, 2e6), sizeNm: point(600_000, 900_000),
        text: 'R1', visible: true, rotationMicrodegree: 90_000_000, align: ['left'],
      }, {
        kind: 'rect', layer: 'F.CrtYd', strokeNm: 50_000, filled: false,
        start: point(-500_000, -500_000), end: point(500_000, 500_000),
      }],
    }],
    footprints: fixture.footprints.map((footprint, index) => index === 1 ? {
      ...footprint, positionNm: point(10_680_000, 10_000_000), side: 'top', rotationMicrodegree: 0,
    } : footprint),
  };
  await page.addInitScript((bytes) => {
    window.showOpenFilePicker = async () => [{
      name: 'Artwork.dpn',
      getFile: async () => new File([new Uint8Array(bytes)], 'Artwork.dpn'),
    }];
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  await clickPcbCommand(workspace, 'Inspect board rules…');
  const inspector = page.getByRole('dialog', { name: 'Inspect PCB rules' });
  await inspector.getByRole('tab', { name: 'Artwork', exact: true }).click();
  const object = inspector.getByLabel('Artwork object', { exact: true });
  const compare = inspector.getByLabel('Compare artwork', { exact: true });
  await object.selectOption({ label: 'Mask opening 1 · top' });
  await compare.selectOption({ label: 'Mask opening 3 · top' });
  await expect(inspector).toContainText('Mask web measured 0.08 mm, required 0.13 mm (minMaskWebNm).');
  await expect(inspector).toContainText('The aperture contains the land and required margin.');
  await object.selectOption({ label: 'Paste aperture 2 · top' });
  await expect(inspector).toContainText('Paste land coverage measured 33.3%, required 50% (minPasteLandCoveragePermille).');
  await expect(inspector).toContainText('The minimum opening does not fit.');
  const legend = object.getByRole('option', { name: /^Legend .* · top$/ }).first();
  await object.selectOption(await legend.getAttribute('value'));
  await compare.selectOption({ label: 'Mask opening 1 · top' });
  await expect(inspector).toContainText('Legend stroke measured 0.1 mm, required 0.15 mm (minSilkStrokeNm).');
  await expect(inspector).toContainText('Legend to mask clearance measured 0 mm, required 0.15 mm (minSilkMaskGapNm).');
  const text = object.getByRole('option', { name: /^Legend .* · top$/ }).nth(1);
  await object.selectOption(await text.getAttribute('value'));
  await expect(inspector).toContainText('Legend text height measured 0.9 mm, required 1 mm (minSilkTextHeightNm).');
  const courtyard = object.getByRole('option', { name: /^Courtyard .* · top$/ }).first();
  await object.selectOption(await courtyard.getAttribute('value'));
  const nextCourtyard = compare.getByRole('option', { name: /^Courtyard .* · top$/ }).first();
  await compare.selectOption(await nextCourtyard.getAttribute('value'));
  await expect(inspector).toContainText('Courtyards overlap.');
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();

  await clickPcbCommand(workspace, 'Run design checks…');
  const findings = page.getByRole('table', { name: 'PCB findings' });
  await expect(findings.locator('tbody > tr').filter({ hasText: 'Solder-mask web is narrower' }))
    .toContainText('Measured 0.08 mm. Required 0.13 mm.');
  const pasteFinding = findings.locator('tbody > tr').filter({ hasText: 'Paste aperture covers 33.3%' }).first();
  await expect(pasteFinding).toContainText('Measured 33.3%. Required 50%.');
  await expect(pasteFinding.getByText('Error', { exact: true })).toBeVisible();
  await pasteFinding.getByText('Finding details', { exact: true }).click();
  await expect(pasteFinding).toContainText('Layers · copper-top, paste-top');
  await expect(pasteFinding).toContainText('minPasteLandCoveragePermille');
  await expect(findings).toContainText('Silkscreen stroke is thinner than the fabrication minimum.');
  const textFinding = findings.locator('tbody > tr').filter({ hasText: 'Silkscreen text is shorter' }).first();
  await expect(textFinding).toContainText('Measured 0.9 mm. Required 1 mm.');
  await expect(findings).toContainText('Footprint courtyards overlap on the same assembly side.');
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
    requiredFeatures: [...base.requiredFeatures, 'routed-copper', 'routing-regions'],
    routingRegions: [{
      id: crypto.randomUUID(), name: 'Supply corridor', side: 'top', exclusions: [], clearanceNm: 300_000,
      outline: [{ x: 5e6, y: 6e6 }, { x: 15e6, y: 6e6 }, { x: 15e6, y: 10e6 }, { x: 5e6, y: 10e6 }],
    }],
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
  const open = () => clickPcbCommand(workspace, 'Net rules…');
  const dialog = page.getByRole('dialog', { name: 'PCB net rules' });
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
  await open();
  await dialog.getByLabel('Class name').fill('Power');
  await dialog.getByLabel('Minimum track width (mm)').fill('0.35');
  await dialog.getByLabel('Copper clearance (mm)').fill('0.6');
  await apply.click();
  await expect(dialog).toBeHidden();
  await open();
  await dialog.getByLabel('Edit rules for').selectOption('net:' + signal);
  await dialog.getByRole('combobox', { name: 'Net class', exact: true }).selectOption({ label: 'Power' });
  await dialog.getByLabel('Preferred track width (mm)').fill('0.45');
  await apply.click();
  await expect(dialog).toBeHidden();
  await open();
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
  await selectPcbNet(workspace, signal);
  const widths = workspace.getByLabel('Track width preset');
  await expect(widths.getByRole('option', { name: 'Minimum (0.35 mm)' })).toHaveCount(1);
  await expect(widths.getByRole('option', { name: 'Preferred (0.45 mm)' })).toHaveCount(1);
  await workspace.getByRole('button', { name: 'Cancel route', exact: true }).click();
  await clickPcbCommand(workspace, 'Inspect board rules…');
  const inspect = page.getByRole('dialog', { name: 'Inspect PCB rules' });
  const object = inspect.getByLabel('Copper object', { exact: true });
  const comparison = inspect.getByLabel('Compare with', { exact: true });
  await object.selectOption({ label: 'via 2 · Supply · top' });
  await expect(inspect).toContainText('Via annulus required 0.13 mm, measured 0.2 mm.');
  await comparison.selectOption({ label: 'track 1 · Signal · top' });
  await expect(inspect).toContainText('Copper clearance required 0.8 mm, measured 0.375098 mm.');
  await expect(inspect.getByRole('list', { name: 'Matched clearance rules' })).toContainText('Power via spacing');
  await expect(inspect.getByRole('list', { name: 'Regional clearance measurements' })).toContainText('Required 0.3 mm, measured 0.375098 mm');
  await object.selectOption({ label: 'track 1 · Signal · top' });
  await expect(inspect).toContainText('Track width required 0.18 mm minimum, measured 0.25 mm.');
  await comparison.selectOption({ label: 'via 2 · Supply · top' });
  await expect(inspect).toContainText('Copper clearance required 0.8 mm, measured 0.375098 mm.');
  await inspect.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => window.netRulesSaved)).toBeUndefined();
  await clickPcbCommand(workspace, 'Run design checks…');
  const checks = page.getByRole('region', { name: 'PCB design checks' });
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
  await clickPcbCommand(workspace, 'Fabrication settings…');
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
  await selectPcbNet(workspace, netId);
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
      const cursor = new DOMPoint(p.x, -p.y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
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
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  await clickPcbCommand(workspace, 'Add routing region');
  await drawPcbOutline(canvas, [[8, 5], [13, 5], [13, 10], [8, 10]]);
  const dialog = workspace.getByRole('form', { name: 'Routing region properties' });
  await dialog.getByLabel('Name', { exact: true }).fill('Wide corridor');
  await dialog.getByLabel('Copper layers').selectOption('top');
  await dialog.getByLabel('Exclude tracks').uncheck();
  await dialog.getByLabel('Minimum track width (mm)').fill('0.4');
  await dialog.getByLabel('Copper clearance (mm)').fill('0.6');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(canvas.locator('[data-routing-region]')).toBeVisible();
  const screen = (x, y) => canvas.evaluate((svg, p) => {
    const cursor = new DOMPoint(p.x, -p.y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
    return [cursor.x, cursor.y];
  }, point(x, y));
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await selectPcbNet(workspace, netId);
  await page.mouse.click(...await screen(4, 7));
  await page.mouse.move(...await screen(16, 7));
  const preview = canvas.locator('[data-route-preview]');
  const blockedMarker = canvas.locator('[data-route-blocked-marker]');
  await expect(preview).toHaveAttribute('data-route-preview', 'blocked');
  await expect(preview).not.toHaveCSS('stroke-dasharray', 'none');
  await expect(blockedMarker).toBeVisible();
  await page.emulateMedia({ forcedColors: 'active' });
  const palette = await page.evaluate(() => {
    const token = document.createElement('span');
    token.style.forcedColorAdjust = 'none';
    token.style.backgroundColor = 'Canvas';
    token.style.color = 'Highlight';
    token.style.borderColor = 'CanvasText';
    document.body.append(token);
    const style = getComputedStyle(token);
    const colors = { canvas: style.backgroundColor, ink: style.borderTopColor, highlight: style.color };
    token.remove();
    return colors;
  });
  const outline = canvas.locator('[data-board-profile]');
  await expect(outline).toHaveCSS('fill', palette.canvas);
  await expect(outline).toHaveCSS('stroke', palette.ink);
  await expect(canvas.locator('[data-track]')).toHaveCSS('stroke', palette.ink);
  await expect(preview).toHaveCSS('stroke', palette.ink);
  await expect(blockedMarker.locator('circle')).toHaveCSS('fill', palette.canvas);
  await page.mouse.click(...await screen(16, 7));
  await expect(workspace.getByRole('alert')).toContainText('routing region');
  await page.evaluate(() => localStorage.setItem('tinycad.language', 'de'));
  const tools = page.getByRole('region', { name: 'Board tools', exact: true });
  await tools.getByLabel('Track width preset').selectOption('custom');
  await tools.getByLabel('Track width (mm)').fill('0,45');
  await page.mouse.move(...await screen(15, 7));
  await expect(preview).toHaveAttribute('data-route-preview', 'clear');
  await expect(preview).toHaveAttribute('stroke-width', '450000');
  await expect(preview).toHaveCSS('stroke', palette.highlight);
  await expect(preview).toHaveCSS('stroke-dasharray', 'none');
  await expect(blockedMarker).toHaveCount(0);
  await page.mouse.click(...await screen(16, 7));
  await page.keyboard.press('End');
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
    const cursor = new DOMPoint(x, -y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
    return [cursor.x, cursor.y];
  }, point(x, y));
  const finish = workspace.getByRole('button', { name: 'Finish route', exact: true });
  const routeToggle = workspace.getByRole('button', { name: 'Route track', exact: true });
  const clearance = workspace.getByRole('status', { name: 'Route clearance' });
  await routeToggle.press('Enter');
  await page.evaluate(() => { window.pcbReplies.hold = 'route-clearance'; });
  await selectPcbNet(workspace, signal);
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
  await expect(workspace.getByText('Checking copper edit…', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'Cancel route', exact: true }).click();
  await expect(workspace.getByText('Checking copper edit…', { exact: true })).toHaveCount(0);
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
  await selectPcbNet(workspace, signal);
  await expect(clearance).toHaveText('');
  await workspace.getByText('Enter route coordinates', { exact: true }).press('Enter');
  const waypoints = workspace.getByRole('status', { name: 'Route waypoints' });
  const x = workspace.getByLabel('Waypoint X (mm)', { exact: true });
  const y = workspace.getByLabel('Waypoint Y (mm)', { exact: true });
  // Keep the already translated UI in English and exercise the browser locale for input.
  await page.evaluate(() => localStorage.removeItem('tinycad.language'));
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
  const findings = page.getByRole('region', { name: 'PCB design checks' });
  await clickPcbCommand(workspace, 'Run design checks…');
  await expect(findings.getByText('Required terminals remain in separate copper islands.', { exact: true })).toBeVisible();
  await findings.getByRole('button', { name: 'Close', exact: true }).click();
  const viewPosition = (position) => canvas.evaluate((svg, { x, y }) => {
    const p = new DOMPoint(x, -y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
    return [p.x, p.y];
  }, position);
  const marker = canvas.locator('[data-route-snap]');
  const checkPadSnap = async () => {
    await page.mouse.move(...await viewPosition(padPosition));
    await expect.poll(() => drawingCentre(marker)).toEqual([padPosition.x, -padPosition.y]);
  };
  await workspace.getByRole('button', { name: 'Route track', exact: true }).click();
  await workspace.getByLabel('Route layer').selectOption('bottom');
  await checkPadSnap();
  const initialView = await canvas.getAttribute('data-view-box');
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Shift');
  await expect(canvas).not.toHaveAttribute('data-view-box', initialView);
  await page.mouse.move(...await viewPosition({ x: padPosition.x + 400_000, y: padPosition.y }));
  await checkPadSnap();
  await page.mouse.click(...await viewPosition(padPosition));
  await expect(await pcbNetRow(workspace, netId)).toHaveAttribute('aria-current', 'true');
  await clickPcbCommand(workspace, 'View board tools');
  const trackPick = { x: 24_300_000, y: padPosition.y };
  await page.mouse.move(...await viewPosition(trackPick));
  await expect.poll(async () => {
    const [x, y] = await drawingCentre(marker);
    return y === -padPosition.y && Math.abs(x - trackPick.x) < 150_000;
  }).toBe(true);
  const [snappedTrackX] = await drawingCentre(marker);
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
  await clickPcbCommand(workspace, 'Run design checks…');
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
  const canvas = workspace.getByRole('img', { name: 'Board layout' });
  await clickPcbCommand(workspace, 'Add placement area');
  await drawPcbOutline(canvas, [[9, 9], [11, 9], [11, 11], [9, 11]]);
  const dialog = workspace.getByRole('form', { name: 'Placement area properties' });
  await dialog.getByLabel('Name', { exact: true }).fill('Antenna clearance');
  await dialog.getByLabel('Assembly side').selectOption('top');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(canvas.locator('[data-placement-area]')).toHaveCount(1);
  const readView = async () => (await canvas.getAttribute('data-view-box')).split(' ').map(Number);
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
  await clickPcbCommand(workspace, 'Run design checks…');
  const checks = page.getByRole('region', { name: 'PCB design checks' });
  const finding = checks.getByRole('table', { name: 'PCB findings' }).locator('tbody > tr')
    .filter({ hasText: 'U1 origin intersects top keep-out' });
  await expect(finding).toContainText('Antenna clearance');
  await expect(checks.getByText(/Placement keep-in and keep-out areas · limited/)).toBeVisible();
  await finding.getByRole('button', { name: /U1 origin intersects top keep-out/ }).focus();
  await page.keyboard.press('Enter');
  await expect(checks).toBeVisible();
  await expect(canvas.locator('[data-component-selected="true"]')).toHaveCount(1);
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
  await checks.getByRole('button', { name: 'Close', exact: true }).click();
  await selectCopperRow(workspace, 'Placement area · Antenna clearance');
  await expect(workspace.getByRole('region', { name: 'Placement area', exact: true })
    .getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await workspace.getByLabel('Board drawing', { exact: true }).press('Delete');
  await expect(canvas.locator('[data-placement-area]')).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvas.locator('[data-placement-area]')).toHaveCount(1);
});

test('finishes pending zone fills before design checks and CAM review', async ({ page }) => {
  const api = await layoutRuntime();
  const fixture = zoneConnectionFixture(api);
  await holdPcbWorkerReplies(page);
  await page.addInitScript((source) => {
    window.showOpenFilePicker = async () => [{
      name: 'Zone clearances.dpn',
      getFile: async () => new File([Uint8Array.from(source)], 'Zone clearances.dpn'),
    }];
  }, [...await api.encodeBoard(fixture)]);
  await page.goto(app.baseURL);
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const holdFill = () => page.evaluate(() => { window.pcbReplies.hold = 'geometry'; });
  const fillRequests = () => page.evaluate(() => window.pcbReplies.requests('geometry'));
  const pending = () => page.evaluate(() => window.pcbReplies.count());
  await holdFill();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await clickPcbCommand(workspace, 'View board tools');
  for (const [operation, dialogName, kind] of [
    ['Run design checks…', 'PCB design checks', 'check'],
    ['CAM read-back preview…', 'CAM read-back preview', 'cam'],
  ]) {
    await expect.poll(pending).toBe(1);
    const previousRequests = await fillRequests();
    const analysisRequests = () => page.evaluate((type) => window.pcbReplies.requests(type), kind);
    await clickPcbCommand(workspace, operation);
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Filling zones…', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.pcbReplies.cancelled())).toBe(false);
    expect(await analysisRequests()).toBe(0);
    if (kind === 'check') {
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(await analysisRequests()).toBe(0);
      expect(await fillRequests()).toBe(previousRequests);
      await clickPcbCommand(workspace, operation);
    }
    await page.evaluate(() => window.pcbReplies.release());
    const ready = kind === 'check' ? 'Save report…' : 'Download preview bundle…';
    await expect(dialog.getByRole('button', { name: ready })).toBeEnabled();
    expect(await analysisRequests()).toBe(1);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(workspace.getByText('Zones filled.', { exact: true })).toBeVisible();
    expect(await fillRequests()).toBe(previousRequests);
    if (kind === 'check') {
      await workspace.getByRole('button', { name: 'Cancel zone fill' }).click();
      await holdFill();
      await workspace.getByRole('button', { name: 'Refill zones' }).click();
    }
  }

  const completedRequests = await fillRequests();
  const fill = await workspace.locator('[data-zone-fill]').getAttribute('d');
  await clickPcbCommand(workspace, 'Run design checks…');
  const checks = page.getByRole('region', { name: 'PCB design checks' });
  await expect(checks.getByRole('button', { name: 'Save report…' })).toBeEnabled();
  await checks.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(workspace.locator('[data-zone-fill]')).toHaveAttribute('d', fill);
  expect(await fillRequests()).toBe(completedRequests);
  expect(await page.evaluate(() => window.pcbReplies.overlaps())).toEqual([]);
});

test('saves independent zone no-connect settings and exports the refilled copper', async ({ page }, info) => {
  const api = await layoutRuntime();
  const fixture = zoneConnectionFixture(api);
  await page.addInitScript((source) => {
    const handle = {
      name: 'Zone clearances.dpn',
      getFile: async () => new File([
        Uint8Array.from(JSON.parse(sessionStorage.getItem('zoneConnectionSaved') ?? 'null') ?? source),
      ], 'Zone clearances.dpn'),
      createWritable: async () => ({
        write: async (bytes) => {
          sessionStorage.setItem('zoneConnectionWrites',
            String(Number(sessionStorage.getItem('zoneConnectionWrites')) + 1));
          sessionStorage.setItem('zoneConnectionSaved', JSON.stringify([...bytes]));
        },
        close: async () => {},
      }),
    };
    window.showOpenFilePicker = async () => [handle];
  }, [...await api.encodeBoard(fixture)]);
  const workspace = page.getByRole('region', { name: 'PCB layout' });
  const open = async () => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await clickPcbCommand(workspace, 'View board tools');
    await expect(workspace.getByText('Zones filled.', { exact: true })).toBeVisible();
  };
  await page.goto(app.baseURL);
  await open();
  const initialPath = await workspace.locator('[data-zone-fill]').getAttribute('d');
  await selectCopperRow(workspace, /Copper zone ·/);
  const dialog = workspace.getByRole('form', { name: 'Copper zone properties' });
  await dialog.getByLabel('Pads', { exact: true }).selectOption('none');
  await dialog.getByLabel('Vias', { exact: true }).selectOption('none');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(workspace.getByText('Zones filled.', { exact: true })).toBeVisible();
  const isolatedPath = await workspace.locator('[data-zone-fill]').getAttribute('d');
  expect(isolatedPath).not.toEqual(initialPath);
  expect(await page.evaluate(() => Number(sessionStorage.getItem('zoneConnectionWrites')))).toBe(0);
  await workspace.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('zoneConnectionWrites')))).toBe(1);
  const bytes = Uint8Array.from(await page.evaluate(() => JSON.parse(sessionStorage.getItem('zoneConnectionSaved'))));
  const saved = await api.decodeBoard(bytes);
  expect(saved.zones[0]).toMatchObject({ padConnection: 'none', viaConnection: 'none', clearanceNm: 400_000 });
  expect(saved.footprints).toEqual(fixture.footprints);
  expect(saved.vias).toEqual(fixture.vias);
  await page.reload();
  await open();
  await expect(workspace.locator('[data-zone-fill]')).toHaveAttribute('d', isolatedPath);
  await selectCopperRow(workspace, /Copper zone ·/);
  await expect(dialog.getByLabel('Pads', { exact: true })).toHaveValue('none');
  await expect(dialog.getByLabel('Vias', { exact: true })).toHaveValue('none');
  await clickPcbCommand(workspace, 'CAM read-back preview…');
  const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
  await expect(cam.getByRole('img', { name: 'CAM read-back' })).toBeVisible();
  const download = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
  await (await download).saveAs(info.outputPath('zone-no-connect-cam-preview.zip'));
  expect(await page.evaluate(() => Number(sessionStorage.getItem('zoneConnectionWrites')))).toBe(1);
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
  await clickPcbCommand(workspace, 'Run design checks…');
  const checks = page.getByRole('region', { name: 'PCB design checks' });
  const findings = checks.getByRole('table', { name: 'PCB findings' });
  await expect(findings.getByRole('row').filter({ has: page.getByRole('button', { name: /^East/ }) }))
    .toContainText(/Measured 0\.179\d+ mm\. Required 0\.3 mm/);
  await expect(findings).toContainText('North · Thermal spoke does not bridge the land and pour.');
  await checks.getByRole('button', { name: 'Close', exact: true }).click();
  await clickPcbCommand(workspace, 'CAM read-back preview…');
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
  const part = workspace.getByRole('grid', { name: 'Placed components', exact: true })
    .getByRole('button', { name: 'J1', exact: true });
  await part.click();
  const position = workspace.getByRole('group', { name: 'Position J1' });
  const centres = () => canvas.locator('[data-component] > [data-board-pad]').evaluateAll((lands) =>
    [...new Set(lands.map((land) => {
      const { x, y, width, height } = land.getBBox();
      return [(x + width / 2) / 1e6, -(y + height / 2) / 1e6].join(',');
    }))].sort());
  async function move(x, y, angle, side) {
    await position.getByLabel('X (mm)', { exact: true }).fill(x);
    await position.getByLabel('Y (mm)', { exact: true }).fill(y);
    await position.getByLabel('Rotation (°)', { exact: true }).fill(angle);
    await position.getByLabel('Layer', { exact: true }).selectOption(side);
    await position.getByRole('button', { name: 'Apply position' }).click();
  }
  await expect.poll(centres).toEqual(['26,10.5', '26,16.5', '30.7,13.5']);
  await expect(canvas.locator('polygon[data-board-pad]')).toHaveCount(6);
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

  await clickPcbCommand(workspace, 'Inspect in 3D…');
  const viewer = page.getByRole('dialog', { name: '3D board inspection' });
  await expect(viewer.getByRole('img', { name: 'Interactive 3D PCB' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Bottom', exact: true }).click();
  const parts = viewer.getByRole('list', { name: '3D components' });
  await expect(parts.getByText('Generated STEP envelope', { exact: false })).toBeVisible();
  await parts.getByRole('button', { name: 'J1', exact: true }).click();
  await viewer.getByRole('button', { name: 'Show on 2D board' }).click();
  await expect(viewer).toBeHidden();
  await page.evaluate(() => localStorage.setItem('tinycad.language', 'de'));
  await clickPcbCommand(workspace, 'Fabrication settings…');
  const settings = page.getByRole('dialog', { name: 'Fabrication settings' });
  const notes = 'Protect pads <2> & keep test points open.\nVerify slot width.';
  await settings.getByText('Board stackup', { exact: true }).click();
  await settings.getByLabel('Substrate material', { exact: true }).fill('FR-4');
  await settings.getByLabel('Dielectric thickness (mm)', { exact: true }).fill('1.5');
  await settings.getByLabel('Top copper thickness (mm)', { exact: true }).fill('0,035');
  await settings.getByLabel('Bottom copper thickness (mm)', { exact: true }).fill('0,028');
  await settings.getByLabel('Relative permittivity', { exact: true }).fill('4,35');
  await settings.getByText('Fabrication drawing details', { exact: true }).click();
  await settings.getByLabel('Surface finish', { exact: true }).fill('Lead-free HASL');
  const thicknessTolerance = settings.getByLabel('Board thickness tolerance (± mm)', { exact: true });
  await thicknessTolerance.fill('1,6');
  await settings.getByLabel('Outline and cutout tolerance (± mm)', { exact: true }).fill('0,15');
  await settings.getByLabel('Finished plated hole and slot tolerance (± mm)', { exact: true }).fill('0,08');
  await settings.getByLabel('Finished non-plated hole and slot tolerance (± mm)', { exact: true }).fill('0,05');
  await settings.getByLabel('Fabrication notes', { exact: true }).fill(notes);
  await settings.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('thickness tolerance smaller than board thickness');
  await thicknessTolerance.fill('0,10');
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
  await clickPcbCommand(workspace, 'CAM read-back preview…');
  const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
  await expect(cam.locator('[data-plating="plated"]')).toHaveCount(3);
  await expect(cam.locator('[data-plating="non-plated"]')).toHaveCount(2);
  const camDrawing = cam.getByRole('img', { name: 'CAM read-back' });
  const fittedCam = await camDrawing.getAttribute('data-view-box');
  await camDrawing.hover();
  await page.mouse.wheel(0, -100);
  await expect(camDrawing).not.toHaveAttribute('data-view-box', fittedCam);
  const download = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
  await (await download).saveAs(info.outputPath('connector-cam-preview.zip'));
  await cam.getByText(/Manufacturing review · .* release blockers/).click();
  await expect(cam.getByRole('list', { name: 'Release blockers' }))
    .toContainText('Select a fabrication profile and board thickness.');
  await expect(cam.getByRole('button', { name: 'Release and download…' })).toBeDisabled();
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

  await clickPcbCommand(editor, 'Inspect in 3D…');
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


test('persists standalone PCB edits only through Save and Save As', async ({ context, page }) => {
  const api = await layoutRuntime();
  const board = api.createBoard('Save only', 2, [
    { x: 0, y: 0 }, { x: 30e6, y: 0 }, { x: 30e6, y: 20e6 }, { x: 0, y: 20e6 },
  ]);
  let disk = [...await api.encodeBoard(board)];
  let detached;
  await context.exposeBinding('testBoardDisk', async (_, operation, bytes) => {
    if (operation === 'read') return disk;
    if (operation === 'write') disk = bytes;
    if (operation === 'copy') detached = bytes;
  });
  await context.addInitScript(() => {
    const handle = (name, operation) => ({
      name,
      getFile: async () => new File([Uint8Array.from(await window.testBoardDisk('read'))], name),
      createWritable: async () => ({
        write: async (bytes) => window.testBoardDisk(operation, Array.from(bytes)),
        close: async () => {},
        abort: async () => {},
      }),
    });
    window.showOpenFilePicker = async () => [handle('Save only.dpn', 'write')];
    window.showSaveFilePicker = async () => handle('Separate.dpn', 'copy');
  });
  async function open(target) {
    await target.goto(app.baseURL);
    await target.getByRole('button', { name: 'File', exact: true }).click();
    await target.getByRole('menuitem', { name: 'Open', exact: true }).click();
    const editor = target.getByRole('region', { name: 'PCB layout' });
    await expect(editor.getByRole('img', { name: 'Board layout' })).toBeVisible();
    await clickPcbCommand(editor, 'View board tools');
    return editor;
  }

  const editor = await open(page);
  const original = disk.slice();
  await page.clock.install();
  await editor.getByLabel('Copper layers').selectOption('1');
  await expect(page).toHaveTitle('TinyCAD - Save only.dpn*');
  await page.clock.runFor(1000);
  expect(disk).toEqual(original);
  const reopened = await context.newPage();
  const opened = await open(reopened);
  await expect(opened.getByLabel('Copper layers')).toHaveValue('2');
  await expect(reopened.getByRole('dialog', { name: 'Recover PCB edits' })).toHaveCount(0);

  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveTitle('TinyCAD - Save only.dpn');
  expect((await api.decodeBoard(Uint8Array.from(disk))).copperLayers).toHaveLength(1);

  await opened.getByLabel('Copper layers').selectOption('1');
  await opened.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(opened.getByText('This PCB changed on disk. Reopen it or use Save As.')).toBeVisible();
  const current = disk.slice();
  await opened.getByRole('button', { name: /Save As/ }).click();
  await expect(reopened).toHaveTitle('TinyCAD - Separate.dpn');
  expect((await api.decodeBoard(Uint8Array.from(detached))).copperLayers).toHaveLength(1);
  expect(disk).toEqual(current);
  await reopened.close();
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
  const profile = canvas.locator('[data-svg-drawing] > path').first();
  const outlinePath = await profile.getAttribute('d');

  await clickPcbCommand(editor, 'Set measurement datum…');
  const datum = page.getByRole('dialog', { name: 'Measurement datum' });
  await datum.getByLabel('Datum X').fill('10 mil');
  await datum.getByLabel('Datum Y').fill('10 mil');
  await datum.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(datum).toBeHidden();
  await expect.poll(() => canvas.locator('[data-measurement-datum]').evaluate((marker) => {
    const { e, f } = marker.transform.baseVal.getItem(0).matrix;
    return [e, f];
  })).toEqual([254000, -254000]);

  await editor.getByRole('button', { name: 'Measure distance', exact: true }).click();
  for (const point of [a, b]) {
    const client = await canvas.evaluate((svg, { x, y }) => {
      const p = new DOMPoint(x, -y).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
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

  await editor.getByText('Dimensions and datum', { exact: true }).click();
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
  await expect(page).toHaveTitle('TinyCAD - Dimension-copy.dpn');

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

test('inspects and locates a routed cutout that blocks manufacturing release', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 900, height: 700 });
  const api = await layoutRuntime();
  const point = (x, y) => ({ x, y });
  const edges = (ring) => ring.map((start, index) => ({
    kind: 'line', start, end: ring[(index + 1) % ring.length],
  }));
  const outer = [point(0, 0), point(30e6, 0), point(30e6, 20e6), point(0, 20e6)];
  const cutout = [point(5e6, 5e6), point(12e6, 5e6), point(12e6, 5.8e6), point(5e6, 5.8e6)];
  const { outline: originalOutline, ...base } = api.createBoard('Routed feature fixture', 2, outer);
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures.filter((feature) => feature !== 'straight-outline'),
      'analytic-profile', 'fabrication-settings'],
    fabrication: { profileId: 'two-layer-smt-v1', thicknessNm: 1_600_000 },
    profile: { outline: edges(originalOutline), cutouts: [edges(cutout)] },
  };
  await page.addInitScript((source) => {
    window.showOpenFilePicker = async () => [{
      name: 'Narrow cutout.dpn',
      getFile: async () => new File([Uint8Array.from(source)], 'Narrow cutout.dpn'),
      createWritable: async () => {
        window.cutoutWriteAttempted = true;
        throw new Error('Inspection must not write files.');
      },
    }];
  }, [...await api.encodeBoard(board)]);
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  const editor = page.getByRole('region', { name: 'PCB layout' });
  await clickPcbCommand(editor, 'Inspect board rules…');
  const inspector = page.getByRole('dialog', { name: 'Inspect PCB rules' });
  await inspector.getByRole('tab', { name: 'Outline', exact: true }).click();
  const outlineChecks = inspector.getByRole('list', { name: 'Routed outline checks' });
  await expect(outlineChecks.getByRole('listitem').filter({ hasText: 'Cutout 1' }))
    .toContainText('minimum 1 mm (minNonPlatedSlotNm). Measured 0.8 mm. Feature below minimum.');
  await expect(outlineChecks.getByRole('listitem').filter({ hasText: 'Board material' })).toContainText('Passed.');
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();

  await (await pcbMenuItem(editor, 'Run design checks…')).press('Enter');
  const checks = page.getByRole('region', { name: 'PCB design checks' });
  const locate = checks.getByRole('button', { name: 'Cutout 1 has a feature narrower than the fabrication minimum.' });
  const findings = checks.getByRole('table', { name: 'PCB findings' });
  await expect(findings.getByRole('columnheader')).toHaveText(['Severity', 'Finding']);
  const cutoutFinding = findings.getByRole('row').filter({ hasText: 'Cutout 1 has a feature narrower' });
  await expect(cutoutFinding).toContainText('Measured 0.8 mm. Required 1 mm.');
  await expect(locate).toHaveAccessibleDescription('Error');
  await expect(checks.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(locate).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cutoutFinding.getByText('Finding details', { exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cutoutFinding.getByText(/Board position/)).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(locate).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(checks).toBeHidden();
  await expect(editor.getByLabel('Board drawing', { exact: true })).toBeFocused();
  await expect(editor.locator('[data-check-marker]')).toBeVisible();
  await clickPcbCommand(editor, 'CAM read-back preview…');
  const cam = page.getByRole('dialog', { name: 'CAM read-back preview' });
  await cam.getByText(/Manufacturing review · [1-9][0-9]* release blockers/).click();
  await expect(cam.getByRole('list', { name: 'Release blockers' })).toContainText('Cutout 1 has a feature narrower');
  await expect(cam.getByRole('button', { name: 'Release and download…' })).toBeDisabled();
  const download = page.waitForEvent('download');
  await cam.getByRole('button', { name: 'Download preview bundle…' }).click();
  await (await download).saveAs(info.outputPath('narrow-cutout-cam-preview.zip'));
  expect(await page.evaluate(() => window.cutoutWriteAttempted)).toBeUndefined();

  await page.evaluate(() => localStorage.setItem('tinycad.language', 'de'));
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'Datei', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Öffnen', exact: true }).click();
  await editor.getByRole('button', { name: 'Copper', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Leiterplatte prüfen…' }).click();
  const translated = page.getByRole('dialog', { name: 'Leiterplattenprüfung' });
  const translatedFindings = translated.getByRole('table', { name: 'Leiterplattenbefunde' });
  await expect(translatedFindings.getByRole('columnheader')).toHaveText(['Schweregrad', 'Befund']);
  const translatedFinding = translatedFindings.getByRole('button', {
    name: 'Cutout 1 has a feature narrower than the fabrication minimum.',
  });
  await expect(translatedFinding).toHaveAccessibleDescription('Fehler');
  await expect(translatedFindings).toContainText('Gemessen 0,8 mm. Erforderlich 1 mm.');
  await expect(translated.getByText('Prüfumfang', { exact: true })).toBeVisible();
  await expect(translated.getByRole('listitem').filter({ hasText: 'Routed outline and cutouts' }))
    .toContainText('Routed outline and cutouts · geprüft · fehlgeschlagen');
  const reportDownload = page.waitForEvent('download');
  await translated.getByRole('button', { name: 'Bericht speichern…' }).click();
  const saved = JSON.parse(await readFile(await (await reportDownload).path(), 'utf8'));
  expect(saved.issues.find(({ code }) => code === 'fabrication-outline-width')).toMatchObject({
    severity: 'error',
    message: 'Cutout 1 has a feature narrower than the fabrication minimum.',
    measurement: { measured: 800_000, required: 1_000_000, unit: 'nm' },
  });
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
  const outline = canvas.locator('[data-svg-drawing] > path').first();
  const originalPath = await outline.getAttribute('d');
  await clickPcbCommand(editor, 'PCB Size & Shape…');
  const dialog = page.getByRole('dialog', { name: 'PCB Size & Shape' });
  await dialog.getByLabel('Shape', { exact: true }).selectOption('custom');
  const first = dialog.getByRole('group', { name: 'Edge 1', exact: true });
  const second = dialog.getByRole('group', { name: 'Edge 2', exact: true });
  await second.getByLabel('Type', { exact: true }).selectOption('arc');
  await second.getByLabel('Centre X').fill('40');
  await second.getByLabel('Centre Y').fill('15');
  await first.getByLabel('End X').fill('39.99');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Edge 1 and edge 2');
  await expect.poll(async () => (await drawingCentre(dialog.locator('[data-profile-issue]')))[0])
    .toBe(39_990_000);
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
    await clickPcbCommand(editor, 'Add cutout…');
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

  await page.getByRole('region', { name: 'Board tools' }).getByRole('button', { name: 'Edit cutout 1…', exact: true }).click();
  const editedCutout = page.getByRole('dialog', { name: 'Edit board cutout' });
  await expect(editedCutout.getByLabel('Shape', { exact: true })).toHaveValue('custom');
  await expect(editedCutout.locator('[data-profile-edge]')).toHaveCount(2);
  await editedCutout.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(editedCutout).toBeHidden();

  await editor.getByRole('button', { name: 'Save As…', exact: true }).click();
  await expect(page).toHaveTitle('TinyCAD - Custom-profile.dpn');
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
  const endpointsA = [5e6, -5e6, 20e6, -5e6];
  await expectTrackEndpoints(trackA, endpointsA);
  const client = (x, y) => canvas.evaluate((svg, [x, y]) => {
    const point = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
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
  await expectTrackEndpoints(trackA, endpointsA);
  await page.evaluate(() => { window.pcbReplies.hold = 'track-edit'; });
  await drag.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pcbReplies.count())).toBe(1);
  await expect(drag.getByRole('status')).toHaveText('Checking copper edit…');
  await drag.getByRole('button', { name: 'Cancel track edit', exact: true }).press('Escape');
  await expect(drag).toBeHidden();
  await page.evaluate(() => window.pcbReplies.release());
  await expectTrackEndpoints(trackA, endpointsA);
  await expect(layout.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await selected.getByRole('button', { name: 'Drag segment', exact: true }).click();
  await drag.getByLabel('Handle Y (mm)').fill('8');
  await drag.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect(drag).toBeHidden();
  await expectTrackEndpoints(trackA, [5e6, -8e6, 20e6, -8e6]);
  await expect(canvas.locator('[data-track]')).toHaveCount(5);

  await layout.getByRole('button', { name: 'Undo', exact: true }).click();
  await expectTrackEndpoints(trackA, endpointsA);
  await expect(canvas.locator('[data-track]')).toHaveCount(3);
  await selected.getByRole('button', { name: 'Move end corner', exact: true }).click();
  const corner = layout.getByRole('group', { name: 'Move corner', exact: true });
  await corner.getByLabel('Handle X (mm)').fill('10');
  await corner.getByLabel('Handle Y (mm)').fill('12');
  await corner.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect(layout.getByRole('alert')).toContainText('Track blocked');
  await expectTrackEndpoints(trackA, endpointsA);
  await corner.getByLabel('Handle X (mm)').fill('16');
  await corner.getByLabel('Handle Y (mm)').fill('7');
  await corner.getByRole('button', { name: 'Apply track edit', exact: true }).click();
  await expect(corner).toBeHidden();
  await expectTrackEndpoints(trackA, [5e6, -5e6, 16e6, -7e6]);

  await selected.getByRole('button', { name: 'Branch from track', exact: true }).click();
  await pick(10.5, 11);
  await layout.getByRole('button', { name: 'Finish route', exact: true }).click();
  await expect(canvas.locator('[data-track]')).toHaveCount(4);
  await layout.getByRole('button', { name: 'Save As…', exact: true }).click();
  await expect(page).toHaveTitle('TinyCAD - Tracks-edited.dpn');
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedTracks)));
  expect(saved.tracks.find(({ id }) => id === a.id)).toEqual({ ...a, end: p(16, 7) });
  expect(saved.tracks.find(({ id }) => id === b.id)).toEqual({ ...b, start: p(16, 7) });
  expect(saved.tracks.find(({ id }) => id === obstacle.id)).toEqual(obstacle);
  expect(saved.tracks.find(({ id }) => !board.tracks.some((track) => track.id === id)))
    .toMatchObject({ netId: net, start: p(10.5, 6), end: p(10.5, 11), layerId: 'top' });
});

test('selects a connected copper run and deletes copper immediately with Undo', async ({ page }) => {
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
  const tools = page.getByRole('region', { name: 'Board tools', exact: true });
  const region = tools.getByRole('group', { name: 'Delete copper in region', exact: true });
  const spineTrack = canvas.locator(`[data-track="${spine.id}"]`);
  const tracks = canvas.locator('[data-track]');
  const vias = canvas.locator('[data-via]');
  await expect(tracks).toHaveCount(6);
  const pick = async (x, y, count = 1) => {
    const at = await canvas.evaluate((svg, [x, y]) => {
      const p = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
      return { x: p.x, y: p.y };
    }, [x, y]);
    await page.mouse.click(at.x, at.y, { clickCount: count });
  };
  const undo = () => layout.getByRole('button', { name: 'Undo', exact: true }).click();

  await pick(23.5, 6, 2);
  await expect(layout.getByText('4 copper objects selected')).toBeVisible();
  await pick(18, 5);
  await tools.getByRole('button', { name: 'Delete connection', exact: true }).click();
  await expect(region).toBeHidden();
  await expect(tracks).toHaveCount(4);
  await expectTrackEndpoints(spineTrack, [2e6, -5e6, 12e6, -5e6]);
  await undo();
  await expect(tracks).toHaveCount(6);

  await pick(25, 7);
  await tools.getByRole('button', { name: 'Delete selected copper', exact: true }).click();
  await expect(vias).toHaveCount(0);
  await undo();
  await expect(vias).toHaveCount(1);

  await pick(18, 5);
  await tools.getByRole('button', { name: 'Delete routed net', exact: true }).click();
  await expect(tracks).toHaveCount(1);
  await undo();
  await expect(tracks).toHaveCount(6);

  await clickPcbCommand(layout, 'View board tools');
  await tools.getByRole('button', { name: 'Delete region…', exact: true }).click();
  await region.getByLabel('Copper selection layer', { exact: true }).selectOption('top');
  await pick(11, 3);
  await pick(26, 14);
  await expect(region).toBeHidden();
  await expect(tracks).toHaveCount(3);
  await layout.getByRole('button', { name: 'Save As…', exact: true }).click();
  await expect(page).toHaveTitle('TinyCAD - Delete-edited.dpn');
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
  const modelBoard = await api.decodeBoard(await readFile(
    new URL('../../../examples/pcb/connector/Connector.dpn', import.meta.url),
  ));
  const { deviceDefinitions, footprintDefinitions, modelAssets } = modelBoard;
  const board = {
    ...base,
    requiredFeatures: [...base.requiredFeatures, 'routed-copper', 'embedded-devices', 'physical-padstacks'],
    deviceDefinitions, footprintDefinitions, modelAssets, footprints: [],
    nets: [{ id: net, name: 'Signal' }], tracks: [left, a, b, duplicate, climb, down, right], vias: [via],
  };
  await page.addInitScript((data) => {
    window.cleanupReplies = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.kind === 'cleanup') window.cleanupReplies.push(data);
        });
      }
    };
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
      const pos = new DOMPoint(x * 1e6, -y * 1e6).matrixTransform(svg.querySelector('[data-svg-drawing]').getScreenCTM());
      return { x: pos.x, y: pos.y };
    }, [x, y]);
    await page.mouse.click(point.x, point.y);
  };
  await clickBoard(3, 5);
  await layout.getByRole('checkbox', { name: 'Lock track', exact: true }).check();
  await expect(layout.getByRole('button', { name: 'Drag segment', exact: true })).toBeDisabled();
  await expect(layout.getByRole('button', { name: 'Delete selected copper…', exact: true })).toBeDisabled();
  await expect(canvas.locator(`[data-track="${left.id}"]`)).toHaveAttribute('data-route-locked', 'true');
  await clickBoard(20, 5);
  await layout.getByRole('checkbox', { name: 'Lock via', exact: true }).check();
  await expect(canvas.locator(`[data-via="${via.id}"]`)).toHaveAttribute('data-route-locked', 'true');

  await layout.getByRole('button', { name: 'Clean up routed net…', exact: true }).click();
  const preview = layout.getByRole('group', { name: 'Routing cleanup preview', exact: true });
  await expect(preview.getByRole('status')).toContainText('Merge 1 collinear join, remove 1 duplicate and 2 redundant loop segments');
  await expect(canvas.locator('[data-deletion-track]')).toHaveCount(2);
  const [reply] = await page.evaluate(() => window.cleanupReplies);
  expect(reply).toEqual({
    id: expect.any(Number),
    kind: 'cleanup',
    change: {
      removedTrackIds: [b.id, duplicate.id, climb.id, down.id],
      replacements: [{ ...a, end: b.end }],
      loops: expect.arrayContaining([climb, down]),
      merged: 1,
      duplicates: 1,
    },
  });
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
  await expect(page).toHaveTitle('TinyCAD - Cleanup-edited.dpn');
  const saved = await api.decodeBoard(Uint8Array.from(await page.evaluate(() => window.savedCleanup)));
  expect(saved.tracks).toEqual([{ ...left, locked: true }, { ...a, end: b.end }, right]);
  expect(saved.vias).toEqual([{ ...via, locked: true }]);
  expect(saved.modelAssets).toEqual(modelAssets);
  expect(saved.footprintDefinitions).toEqual(footprintDefinitions);
});
