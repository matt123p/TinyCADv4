import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveLayoutApp } from './serve-app.mjs';
import { networkArtwork } from '../../lib/network-artwork.mjs';

let app;
const root = new URL('../../../', import.meta.url);
const recipe = JSON.parse(await readFile(new URL('library-recipes/network-layout.json', root), 'utf8'));
const { library } = networkArtwork(recipe);

test.beforeAll(async () => {
  test.setTimeout(120000);
  app = await serveLayoutApp();
});
test.afterAll(async () => { await app?.close(); });
test.beforeEach(async ({ page }) => {
  page.testErrors = [];
  page.on('pageerror', error => page.testErrors.push(error.message));
  await page.route('**/bundled-libraries/**', async route => {
    const relative = new URL(route.request().url()).pathname.split('/bundled-libraries/')[1];
    await route.fulfill({
      body: await readFile(new URL('bundled-libraries/' + relative, root)),
      contentType: relative.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    });
  });
  await page.goto(app.baseURL);
  await expect(page.getByRole('tab', { name: 'Standard', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => { expect(page.testErrors).toEqual([]); });

const rowNamed = (page, name) => page.locator('li[role="button"]').filter({
  has: page.locator('span').filter({ hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }),
});

test('standard library rows show complete draggable artwork before selection', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Choose a standard library' }).selectOption('network-layout');
  await expect(page.locator('li[role="button"] svg.symbol-svg')).toHaveCount(recipe.devices.length);
  const name = 'Switch - 19in 1U - 48 RJ45 + 4 SFP+';
  const row = rowNamed(page, name);
  await row.scrollIntoViewIfNeeded();
  const preview = row.locator('svg.symbol-svg');
  await expect(preview).toBeVisible();
  const geometry = await preview.evaluate(svg => {
    const view = svg.viewBox.baseVal;
    const face = svg.querySelector('rect');
    const bounds = face.getBBox();
    const screen = face.getBoundingClientRect();
    return { view: { width: view.width, height: view.height },
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      faceWidth: screen.width, viewportWidth: svg.getBoundingClientRect().width };
  });
  expect(geometry.bounds.x).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.y).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.x + geometry.bounds.width).toBeLessThanOrEqual(geometry.view.width + 0.01);
  expect(geometry.bounds.y + geometry.bounds.height).toBeLessThanOrEqual(geometry.view.height + 0.01);
  expect(geometry.faceWidth / geometry.viewportWidth).toBeGreaterThan(0.9);
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  const payload = await row.locator('div.symbol-svg[draggable]').evaluate(element => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    return JSON.parse(dataTransfer.getData('application/json'));
  });
  expect(payload.name.Name).toBe(name);
  expect(payload.symbolData[0].filter(item => item.NodeName === 'pin')).toHaveLength(52);
  await page.getByPlaceholder('Search libraries...').fill('48 RJ45 + 4 SFP+');
  await expect(page.locator('li[role="button"] svg.symbol-svg')).toHaveCount(1);
  await page.screenshot({ path: '.tmp/library-picker-standard.png' });
});

test('personal libraries retain inline artwork when expanded', async ({ page }) => {
  await page.getByRole('tab', { name: 'My Libraries', exact: true }).click();
  await page.evaluate(library => window.layoutTest.installLibrary(library), {
    ...library, fileId: 'preview-local', name: 'Preview library', modified: null,
  });
  await page.getByRole('button', { name: /^Preview library/ }).click();
  await expect(page.locator('li[role="button"] svg.symbol-svg')).toHaveCount(recipe.devices.length);
  const row = rowNamed(page, 'Switch - desktop - 5 RJ45');
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
});

test('online search results display their draggable thumbnails in the list', async ({ page }) => {
  const cors = { 'access-control-allow-origin': new URL(app.baseURL).origin,
    'access-control-allow-credentials': 'true' };
  await page.route(/\/api\/search\/Search\?/i, route => route.fulfill({
    headers: cors, json: { total: 1, pageSize: 20, labels: [], symbols: [{
      symbolID: 1706, nameID: 10896, name: 'Network Router', description: 'Router preview',
      owner: 'fixture', locked: false, labels: [], downloads: 1, created: '2026-01-01',
    }] },
  }));
  await page.route(/\/api\/Search\/Thumbnail\?/i, route => route.fulfill({
    headers: cors, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="blue"/></svg>',
  }));
  await page.getByRole('tab', { name: 'Online', exact: true }).click();
  await page.getByPlaceholder('Search TinyCAD.net...').fill('router');
  const row = rowNamed(page, 'Network Router');
  const thumbnail = row.locator('img[draggable]');
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
});
