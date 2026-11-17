import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { serveLayoutApp } from './serve-app.mjs';

let app;
test.beforeAll(async () => {
  test.setTimeout(120000);
  app = await serveLayoutApp();
});
test.afterAll(async () => { await app?.close(); });

test('Import Image preserves PNG/JPEG and converts other browser formats to still PNG with Undo/Redo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.baseURL);
  const images = () => page.evaluate(() => window.layoutTest.snapshot().drawing.sheets[0].items.filter(item => item.NodeName === 'image'));
  const chooseImage = async file => {
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Image...', exact: true }).click();
    await (await chooser).setFiles(file);
  };
  for (const [format, mime, expected] of [['png', 'image/png', 'PNG'], ['jpeg', 'image/jpeg', 'JPEG'], ['gif', 'image/gif', 'PNG'], ['webp', 'image/webp', 'PNG'], ['svg', 'image/svg+xml', 'PNG']]) {
    const buffer = format === 'svg'
      ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="60" height="40" fill="#286b9a"/></svg>')
      : await sharp({ create: { width: 120, height: 80, channels: 3, background: '#286b9a' } }).toFormat(format).toBuffer();
    await chooseImage({ name: `reference.${format}`, mimeType: mime, buffer });
    await expect.poll(async () => (await images()).length).toBe(1);
    const [image] = await images();
    expect(image.imageData.type).toBe(expected);
    if (['png', 'jpeg'].includes(format)) {
      expect(image.imageData.imageData).toBe(`data:${mime};base64,${buffer.toString('base64')}`);
    } else {
      expect(image.imageData.imageData).toMatch(/^data:image\/png;base64,/);
      const converted = Buffer.from(image.imageData.imageData.split(',')[1], 'base64');
      const metadata = await sharp(converted).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.pages ?? 1).toBe(1);
      expect(image.imageData.size).toBe(converted.length);
      if (format === 'svg') {
        const pixels = await sharp(converted).ensureAlpha().raw().toBuffer();
        expect(pixels[3]).toBe(255);
        expect(pixels.at(-1)).toBe(0);
      }
    }
    expect(image.point.every(Number.isFinite)).toBe(true);
    expect(image.point_b[0] - image.point[0]).toBe(120);
    expect(image.point_b[1] - image.point[1]).toBe(80);
    await page.getByRole('button', { name: 'Undo (Ctrl-Z)', exact: true }).click();
    await expect.poll(async () => (await images()).length).toBe(0);
    await page.getByRole('button', { name: 'Redo (Ctrl-Y)', exact: true }).click();
    await expect.poll(async () => (await images()).length).toBe(1);
    await page.getByRole('button', { name: 'Undo (Ctrl-Z)', exact: true }).click();
  }
  await chooseImage({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('dialog')).toContainText('Could not read the image. Select an image format supported by your browser.');
  expect(await images()).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('image properties crop the rendered bitmap and survive XML save/reopen', async ({ page }) => {
  await page.goto(app.baseURL);
  const buffer = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#286b9a' } }).png().toBuffer();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Image...', exact: true }).click();
  await (await chooser).setFiles({ name: 'clipping.png', mimeType: 'image/png', buffer });
  const rendered = page.locator('svg[overflow="hidden"] > image[href^="data:image/png"]').first();
  const current = () => page.evaluate(() => window.layoutTest.snapshot().drawing.sheets[0].items.find(item => item.NodeName === 'image'));
  await rendered.scrollIntoViewIfNeeded();
  await rendered.click();
  const box = await rendered.locator('..').boundingBox();
  await page.mouse.move(box.x + box.width, box.y + box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 60, box.y + box.height, { steps: 6 });
  await page.mouse.up();
  const stretched = await current();
  const ratio = item => (item.point_b[0] - item.point[0]) / (item.point_b[1] - item.point[1]);
  expect(ratio(stretched)).toBeGreaterThan(2.1);
  await page.getByRole('button', { name: 'Reset aspect ratio', exact: true }).click();
  const reset = await current();
  expect(ratio(reset)).toBeCloseTo(2);
  expect(reset.point).toEqual(stretched.point);
  expect(reset.point_b[0]).toBe(stretched.point_b[0]);
  await page.getByRole('button', { name: 'Undo (Ctrl-Z)', exact: true }).click();
  expect(ratio(await current())).toBeCloseTo(ratio(stretched));
  await page.getByRole('button', { name: 'Redo (Ctrl-Y)', exact: true }).click();
  expect(ratio(await current())).toBeCloseTo(2);
  await page.getByRole('checkbox', { name: 'Fixed aspect ratio', exact: true }).check();
  for (const [side, value] of [['Left',10],['Right',20],['Top',5],['Bottom',15]]) {
    const field = page.getByRole('spinbutton', { name: `${side} clipping (px)`, exact: true });
    await field.fill(String(value));
    await field.press('Tab');
  }
  await expect.poll(async () => (await current()).clip_bottom).toBe(15);
  const edited = await current();
  expect(edited.fixed_aspect).toBe(true);
  expect([edited.clip_left,edited.clip_right,edited.clip_top,edited.clip_bottom]).toEqual([10,20,5,15]);
  await expect(rendered.locator('..')).toHaveAttribute('viewBox', '10 5 170 80');
  await page.getByRole('button', { name: 'Undo (Ctrl-Z)', exact: true }).click();
  await expect.poll(async () => (await current()).clip_bottom).toBe(0);
  await page.getByRole('button', { name: 'Redo (Ctrl-Y)', exact: true }).click();
  await expect.poll(async () => (await current()).clip_bottom).toBe(15);
  await page.screenshot({ path: test.info().outputPath('image-properties.png') });
  const xml = await page.evaluate(() => window.layoutTest.saveAndReopen());
  expect(xml).toMatch(/<METAFILE[^>]*fixed_aspect="1"/);
  for (const [key,value] of [['clip_left',10],['clip_right',20],['clip_top',5],['clip_bottom',15]]) expect(xml).toContain(`${key}="${value}"`);
  const reopened = await current();
  expect(reopened.fixed_aspect).toBe(true);
  expect([reopened.clip_left,reopened.clip_right,reopened.clip_top,reopened.clip_bottom]).toEqual([10,20,5,15]);
  expect(reopened.point).toEqual(edited.point);
  expect(reopened.point_b).toEqual(edited.point_b);
  expect(reopened.imageData.imageData).toBe(edited.imageData.imageData);
  const legacyXml = xml.replace(/ (fixed_aspect|clip_left|clip_right|clip_top|clip_bottom)="[^"]*"/g, '');
  await page.evaluate(xml => window.layoutTest.reopenXml(xml), legacyXml);
  const legacy = await current();
  expect(legacy.fixed_aspect).toBe(false);
  expect([legacy.clip_left,legacy.clip_right,legacy.clip_top,legacy.clip_bottom]).toEqual([0,0,0,0]);
});
