import { test, expect } from '@playwright/test';
import { serveLayoutApp } from './serve-app.mjs';
import { readFile } from 'node:fs/promises';

let app;
test.beforeAll(async () => { test.setTimeout(120000); app = await serveLayoutApp(); });
test.afterAll(async () => { await app?.close(); });

test.beforeEach(async ({ page }) => {
  // File picker only: drawing parsing, save serialization and the app are real.
  await page.addInitScript(() => {
    const xml = `<TinyCADSheets><TinyCAD><NAME>Layout test</NAME>
      <DETAILS><Size width="1455" height="1020"/><GRID spacing="50" snap="1"/></DETAILS>
      <FONT id="0"><HEIGHT>-10</HEIGHT><FACENAME>Arial</FACENAME><WEIGHT>400</WEIGHT><ITALIC>0</ITALIC></FONT>
      <WIRE a="100,100" b="300,100"/><WIRE a="300,100" b="300,300"/><WIRE a="300,100" b="500,100"/>
      <LABEL pos="101,100" direction="3" style="0" font="0">SIGNAL</LABEL>
      <WIRE a="800,500" b="1000,500"/><LABEL pos="801,500" direction="3" style="0" font="0">FIXED</LABEL>
      </TinyCAD></TinyCADSheets>`;
    const handle = {
      name: 'Layout.dsn', kind: 'file',
      getFile: async () => new File([window.layoutDrawingXML ?? xml], 'Layout.dsn', { type: 'application/xml' }),
      createWritable: async () => ({ write: async value => { window.savedLayout = value; }, close: async () => {} }),
    };
    window.showOpenFilePicker = async () => [handle];
    window.showSaveFilePicker = async () => handle;
    window.layoutWorkerErrors = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('error', event => window.layoutWorkerErrors.push(event.message));
      }
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.testErrors = errors;
  await page.goto(app.baseURL);
  await expect(page.getByRole('button', { name: 'Auto-layout', exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(page.testErrors).toEqual([]);
  expect(await page.evaluate(() => window.layoutWorkerErrors)).toEqual([]);
});

const snapshot = page => page.evaluate(() => window.layoutTest.snapshot());
const dialog = page => page.getByRole('dialog');
const openDialog = page => page.getByRole('button', { name: 'Auto-layout', exact: true }).click();
async function openDrawing(page, name = 'Layout test') {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).drawing.sheets[0].name).toBe(name);
}
async function runLayout(page, timeout = 10000) {
  await dialog(page).getByRole('button', { name: 'Go', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0, { timeout });
}
function geometry(items) {
  return items.map(({ _id, NodeName, point, d_points, rotation, text }) => ({ _id, NodeName, point, d_points, rotation, text }));
}

for (const fixture of ['amplifier.dsn', 'amplifier-with-pin-loops.dsn']) {
  test(`the real worker leaves the amplifier transistor pins clean: ${fixture}`, async ({ page }) => {
    test.setTimeout(60000);
    const xml = await readFile(new URL('../fixtures/' + fixture, import.meta.url), 'utf8');
    await page.evaluate(xml => { window.layoutDrawingXML = xml; }, xml);
    await openDrawing(page, 'Sheet');
    await openDialog(page);
    await dialog(page).getByRole('radio', { name: 'High', exact: true }).check();
    await runLayout(page, 30000);
    const drawing = (await snapshot(page)).drawing;
    const items = drawing.sheets[0].items;
    const transistors = items.filter(i => i.NodeName === 'symbol' &&
      i.text.some(t => t.description === 'Ref' && ['Q1', 'Q2'].includes(t.value)));
    expect(transistors).toHaveLength(2);
    for (const symbol of transistors) {
      // The fixture's NPN artwork is 40x40, rotated once, with these three anchors.
      const [x, y] = symbol.point, centre = [x - 20, y - 20];
      for (const p of [[x, y], [x, y - 40], [x - 40, y - 20]]) {
        const incident = items.filter(i => i.NodeName === 'wire' &&
          i.d_points.some(q => q[0] === p[0] && q[1] === p[1]));
        expect(incident.length).toBeGreaterThan(0);
        for (const wire of incident) {
          const q = wire.d_points.find(q => q[0] !== p[0] || q[1] !== p[1]);
          expect((q[0] - p[0]) * (p[0] - centre[0]) + (q[1] - p[1]) * (p[1] - centre[1])).toBeGreaterThan(0);
        }
      }
    }
  });
}

test('toolbar opens the explanation, scopes, levels and default settings', async ({ page }) => {
  await openDialog(page);
  await expect(dialog(page).locator('p').first()).toContainText(/components.*wires.*labels/);
  await expect(dialog(page).getByRole('radio', { name: 'Whole sheet', exact: true })).toBeChecked();
  await expect(dialog(page).getByRole('radio', { name: 'Selected Items', exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole('radio', { name: 'Medium', exact: true })).toBeChecked();
  for (const [level, description] of [
    ['High', 'Allows all components to move, and adjusts wires and labels.'],
    ['Medium', 'Allows up to two large components to move, while adjusting smaller components, wires, and labels.'],
    ['Low', 'Keeps large components fixed, while adjusting smaller components, wires, and labels.'],
  ]) {
    await expect(dialog(page).getByRole('radio', { name: level, exact: true })).toHaveAccessibleDescription(description);
    await dialog(page).getByRole('radio', { name: level, exact: true }).check();
    await expect(dialog(page).getByRole('radio', { name: level, exact: true })).toBeChecked();
  }
  await expect(dialog(page).getByText("If you don't like the result, use Undo to revert the changes.", { exact: true })).toBeVisible();
});

test('a real worker reports a no-op without changing a blank drawing', async ({ page }) => {
  const before = await snapshot(page);
  await openDialog(page);
  await dialog(page).getByRole('button', { name: 'Go', exact: true }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('No layout improvements were found.');
  const after = await snapshot(page);
  expect(after.drawing).toEqual(before.drawing);
  expect(after.drawingVersion).toBe(before.drawingVersion);
  expect(after.past).toBe(before.past);
});

for (const level of ['High', 'Medium', 'Low']) {
  test(`Selected Items at ${level} preserves everything outside the selection`, async ({ page }) => {
    await openDrawing(page);
    await page.evaluate(() => window.layoutTest.selectLabel('SIGNAL'));
    const before = await snapshot(page);
    await openDialog(page);
    await expect(dialog(page).getByRole('radio', { name: 'Selected Items', exact: true })).toBeChecked();
    await dialog(page).getByRole('radio', { name: level, exact: true }).check();
    await runLayout(page);
    const after = await snapshot(page);
    const excluded = items => items.filter(item => !before.selectedIds.includes(item._id));
    expect(excluded(after.drawing.sheets[0].items)).toEqual(excluded(before.drawing.sheets[0].items));
    expect(geometry(after.drawing.sheets[0].items)).not.toEqual(geometry(before.drawing.sheets[0].items));
    expect(after.selectedIds).toEqual(before.selectedIds);
    expect(after.past).toBe(1);
    await page.getByRole('button', { name: /^Undo/ }).click();
    expect((await snapshot(page)).drawing).toEqual(before.drawing);
    await page.getByRole('button', { name: /^Redo/ }).click();
    expect((await snapshot(page)).drawing).toEqual(after.drawing);
  });
}

test('Whole sheet overrides selection and improves both independent sections', async ({ page }) => {
  await openDrawing(page);
  await page.evaluate(() => window.layoutTest.selectLabel('SIGNAL'));
  const before = await snapshot(page);
  await openDialog(page);
  await dialog(page).getByRole('radio', { name: 'Whole sheet', exact: true }).check();
  await dialog(page).getByRole('radio', { name: 'High', exact: true }).check();
  await runLayout(page);
  const after = await snapshot(page);
  for (const text of ['SIGNAL', 'FIXED']) {
    const label = drawing => drawing.sheets[0].items.find(item => item.NodeName === 'label' && item.text === text);
    expect(label(after.drawing).point).not.toEqual(label(before.drawing).point);
  }
});

test('a selection rectangle limits layout to a subsection with several wires and labels', async ({ page }) => {
  await openDrawing(page);
  await page.evaluate(() => window.layoutTest.selectSection());
  const before = await snapshot(page);
  expect(before.selectedIds.length).toBeGreaterThanOrEqual(4);
  const fixed = before.drawing.sheets[0].items.find(item => item.NodeName === 'label' && item.text === 'FIXED');
  expect(before.selectedIds).not.toContain(fixed._id);
  await openDialog(page);
  await expect(dialog(page).getByRole('radio', { name: 'Selected Items', exact: true })).toBeChecked();
  await runLayout(page);
  const after = await snapshot(page);
  const excluded = items => items.filter(item => !before.selectedIds.includes(item._id));
  expect(excluded(after.drawing.sheets[0].items)).toEqual(excluded(before.drawing.sheets[0].items));
  expect(geometry(after.drawing.sheets[0].items)).not.toEqual(geometry(before.drawing.sheets[0].items));
});

test('auto-layout is hidden while editing library symbols', async ({ page }) => {
  await page.goto(app.baseURL + '?action=new-library');
  await expect(page.getByRole('button', { name: 'Duplicate Symbol', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-layout', exact: true })).toHaveCount(0);
});

for (const running of [false, true]) {
  test(`Cancel ${running ? 'during computation' : 'before Go'} leaves the drawing and history untouched`, async ({ page }) => {
    await openDrawing(page);
    const before = await snapshot(page);
    await openDialog(page);
    if (running) {
      // Both clicks occur in one task, before any worker response can be handled.
      await dialog(page).evaluate(node => {
        const buttons = [...node.querySelectorAll('button')];
        buttons.find(button => button.textContent === 'Go').click();
        buttons.find(button => button.textContent === 'Cancel').click();
      });
    } else await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
    // A subsequent real run proves the terminated worker cannot interfere.
    await openDialog(page); await runLayout(page);
    expect((await snapshot(page)).past).toBe(1);
  });
}

test('Escape dismisses the dialog without changing the drawing', async ({ page }) => {
  await openDrawing(page);
  const before = await snapshot(page);
  await openDialog(page); await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

test('changing the document during computation discards the pending result', async ({ page }) => {
  await openDrawing(page); await openDialog(page);
  await dialog(page).evaluate(node => {
    [...node.querySelectorAll('button')].find(button => button.textContent === 'Go').click();
    window.layoutTest.replaceSheet();
  });
  const replaced = await snapshot(page);
  await expect(dialog(page).getByRole('status')).toHaveText(
    'The sheet changed while auto-layout was running. Run it again to use the current sheet.',
  );
  expect(await snapshot(page)).toEqual(replaced);
  await runLayout(page);
});

test('saving and reopening a layout retains its native wire and label geometry', async ({ page }) => {
  await openDrawing(page); await openDialog(page); await runLayout(page);
  const laidOut = await snapshot(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const saved = window.savedLayout;
    return typeof saved === 'string' ? saved : saved ? new TextDecoder().decode(saved) : '';
  })).toContain('<TinyCADSheets>');
  await page.evaluate(() => {
    const xml = window.savedLayout;
    window.showOpenFilePicker = async () => [{ name: 'Reopened.dsn', getFile: async () => new File([xml], 'Reopened.dsn') }];
  });
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  await expect(page.getByText('Reopened.dsn', { exact: true })).toBeVisible();
  const reopened = await snapshot(page);
  const persisted = drawing => geometry(drawing.sheets[0].items).map(({ _id, ...item }) => item);
  expect(persisted(reopened.drawing)).toEqual(persisted(laidOut.drawing));
});
