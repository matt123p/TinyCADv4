import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveLayoutApp } from './serve-app.mjs';

let app;
const root = new URL('../../../', import.meta.url);
test.beforeAll(async () => {
  test.setTimeout(120000);
  app = await serveLayoutApp();
});
test.afterAll(async () => {
  await app?.close();
});

test('example controls live in the browser title bar and explanation survives hiding', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const folder of ['bundled-examples', 'bundled-libraries']) {
    await page.route(`**/${folder}/**`, async (route) => {
      const relative = new URL(route.request().url()).pathname.split(
        `/${folder}/`,
      )[1];
      const type = relative.endsWith('.json')
        ? 'application/json'
        : relative.endsWith('.svg')
        ? 'image/svg+xml'
        : relative.endsWith('.png')
        ? 'image/png'
        : 'application/octet-stream';
      await route.fulfill({
        body: await readFile(new URL(folder + '/' + relative, root)),
        contentType: type,
      });
    });
  }
  await page.goto(app.baseURL);
  const header = page.locator('.top-bar-right');
  const open = header.getByRole('button', {
    name: 'Open Example',
    exact: true,
  });
  await expect(open).toBeVisible();
  await expect(
    page
      .locator('.toolbar-container')
      .getByRole('button', { name: 'Open Example', exact: true }),
  ).toHaveCount(0);
  await expect(
    header.getByRole('button', {
      name: 'Show example explanation',
      exact: true,
    }),
  ).toHaveCount(0);
  const autoLayout = page.getByRole('button', {
    name: 'Auto-layout',
    exact: true,
  });
  await expect(autoLayout).toBeVisible();
  expect(
    await autoLayout.evaluate((button) =>
      button.previousElementSibling?.getAttribute('aria-label'),
    ),
  ).toBe('Simulation');
  await autoLayout.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await open.click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Examples', exact: true })
    .first()
    .click();
  await dialog
    .getByRole('button', { name: 'Transistor amplifier', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Open drawing', exact: true })
    .click();
  const explanation = header.getByRole('button', {
    name: 'Show example explanation',
    exact: true,
  });
  await expect(explanation).toBeVisible();
  await explanation.click();
  await expect(
    header.getByRole('button', {
      name: 'Hide example explanation',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('complementary', { name: 'Example explanation' }),
  ).toBeVisible();
  await header
    .getByRole('button', { name: 'Hide example explanation', exact: true })
    .click();
  await expect(explanation).toHaveAttribute('aria-pressed', 'false');
  await explanation.click();
  await expect(
    page.getByRole('complementary', { name: 'Example explanation' }),
  ).toBeVisible();
  await page
    .getByRole('complementary', { name: 'Example explanation' })
    .getByRole('button', { name: 'Hide example explanation', exact: true })
    .click();
  await expect(explanation).toHaveAttribute('aria-pressed', 'false');
  await explanation.click();
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Show charts', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '.tmp/example-titlebar.png' });
  expect(errors).toEqual([]);
});
