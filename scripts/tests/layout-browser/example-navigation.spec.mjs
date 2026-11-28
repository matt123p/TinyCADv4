import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveLayoutApp } from './serve-app.mjs';
import { packageExamples } from '../../package-examples.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let app;
const root = new URL('../../../', import.meta.url);
const { version } = JSON.parse(
  await readFile(new URL('package.json', root), 'utf8'),
);
const welcomeTitle = `TinyCAD v${version}`;
test.beforeAll(async () => {
  test.setTimeout(120000);
  app = await serveLayoutApp('layout-browser', 'filesystem', 'development', {
    testStartupWelcome: true,
  });
});
test.afterAll(async () => {
  await app?.close();
});

test('example controls live in the browser title bar and explanation survives hiding', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('@griffel/')) {
      errors.push(message.text());
    }
  });
  const examples = testInfo.outputPath('bundled-examples');
  await packageExamples(
    fileURLToPath(new URL('bundled-examples', root)),
    examples,
  );
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
        body: await readFile(
          folder === 'bundled-examples'
            ? join(examples, relative)
            : new URL(folder + '/' + relative, root),
        ),
        contentType: type,
      });
    });
  }
  const requests = new Set();
  page.on('request', (request) => requests.add(request.url()));
  await page.goto(app.baseURL);
  const dialog = page.getByRole('dialog');
  const startup = dialog.getByRole('checkbox', {
    name: 'Show welcome page on startup',
  });
  await expect(startup).toBeChecked();
  await startup.uncheck();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const header = page.locator('.top-bar-right');
  const open = header.getByRole('button', {
    name: 'Open Example',
    exact: true,
  });
  await expect(open).toBeVisible();
  await expect(dialog).toHaveCount(0);
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
  const browse = dialog.getByRole('main', { name: 'Example browser' });
  await expect(startup).not.toBeChecked();
  await expect(dialog).toHaveAccessibleName(welcomeTitle);
  await expect(dialog.getByText(`v${version}`, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('combobox', { name: 'Language', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Language', { exact: true })).toHaveCount(0);
  await expect(
    browse.getByRole('heading', { name: 'Welcome to TinyCAD' }),
  ).toBeVisible();
  await expect(
    browse.getByRole('heading', { name: 'Explore examples' }),
  ).toBeVisible();
  const firstDrawing = 'https://docs.tinycad.net/v4/Your-first-drawing/';
  await page
    .context()
    .route(firstDrawing, (route) =>
      route.fulfill({ body: 'First drawing guide' }),
    );
  const guidePage = page.context().waitForEvent('page');
  await browse
    .getByRole('link', { name: 'Help with your first drawing' })
    .click();
  const guide = await guidePage;
  await expect(guide).toHaveURL(firstDrawing);
  await guide.close();
  for (const [name, url] of [
    ['AI Assistant guide', 'https://docs.tinycad.net/v4/AI-Assistant/'],
    ['Simulation guide', 'https://docs.tinycad.net/v4/Simulation/'],
    ['Ask on Discord', 'https://discord.gg/bdXnjhrSYQ'],
    [
      'Report an issue on GitHub',
      'https://github.com/matt123p/TinyCADv4/issues',
    ],
  ]) {
    await expect(
      dialog.getByRole('link', { name, exact: true }),
    ).toHaveAttribute('href', url);
  }
  for (const name of [
    'Electronics',
    'Schematics',
    'SPICE tutorial',
    'XSPICE and digital tutorial',
  ]) {
    const card = browse.getByRole('button', { name, exact: true });
    await expect(card).toBeVisible();
    await expect(card.getByRole('img')).toBeVisible();
  }
  const circuit = browse.getByText('VCC', { exact: true });
  await expect(circuit).toBeVisible();
  await expect(browse.getByRole('region', { name: 'Open Recent' })).toHaveCount(
    0,
  );
  const desktopBounds = await dialog.boundingBox();
  expect(desktopBounds.width).toBeCloseTo(1120, 0);
  expect(desktopBounds.height).toBeCloseTo(800, 0);
  await expect(
    dialog.getByText('Examples open as editable copies.'),
  ).toHaveCount(0);
  expect(
    await browse.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeLessThanOrEqual(0);
  await dialog.screenshot({ path: testInfo.outputPath('welcome.png') });
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 430, height: 800 });
  await expect(circuit).toBeVisible();
  const narrowBounds = await dialog.boundingBox();
  expect(narrowBounds.width).toBeCloseTo(430 * 0.96, 0);
  expect(narrowBounds.height).toBeCloseTo(800 * 0.94, 0);
  await expect(
    browse.getByRole('button', { name: 'New drawing' }),
  ).toBeVisible();
  expect(
    await browse.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(
    await browse.evaluate((element) => element.clientWidth),
  );
  await page.setViewportSize(desktopViewport);
  await expect(browse.getByRole('textbox')).toHaveCount(0);
  await browse.getByRole('button', { name: 'Schematics', exact: true }).click();
  await expect(
    browse.getByRole('button', { name: 'Two-person podcast studio' }),
  ).toBeVisible();
  await expect(
    browse.getByRole('button', { name: 'Small office network' }),
  ).toBeVisible();
  await expect(
    browse.getByRole('heading', { name: 'Welcome to TinyCAD' }),
  ).toHaveCount(0);
  await browse.getByRole('button', { name: 'All groups', exact: true }).click();
  await browse
    .getByRole('button', { name: 'Electronics', exact: true })
    .click();
  await expect(
    browse.getByRole('button', { name: 'ESP32 climate and display station' }),
  ).toBeVisible();
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
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.click();
  const issuePage = page.context().waitForEvent('page');
  const issuesUrl = 'https://github.com/matt123p/TinyCADv4/issues';
  await page
    .context()
    .route(issuesUrl, (route) => route.fulfill({ body: 'Issue tracker' }));
  await page
    .getByRole('menuitem', { name: 'Report an issue on GitHub' })
    .click();
  const tracker = await issuePage;
  await expect(tracker).toHaveURL(issuesUrl);
  await tracker.close();
  await help.click();
  await page.getByRole('menuitem', { name: 'About TinyCAD' }).click();
  const about = page.getByRole('dialog', { name: 'TinyCAD', exact: true });
  await expect(about).toBeVisible();
  await expect(about.getByText('About TinyCAD', { exact: true })).toHaveCount(
    0,
  );
  await expect(about.getByText('TinyCAD', { exact: true })).toBeVisible();
  await about.getByRole('button', { name: 'Close', exact: true }).click();
  await open.click();
  await page.evaluate(() => {
    window.showOpenFilePicker = async () => {
      window.filePickerOpened = true;
      return [];
    };
  });
  await browse.getByRole('button', { name: 'Open file…', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: 'Unsaved Changes' });
  await expect(unsaved).toBeVisible();
  expect(await page.evaluate(() => window.filePickerOpened)).toBeUndefined();
  await unsaved
    .getByRole('button', { name: 'Continue Without Saving' })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.filePickerOpened)).toBe(true);
  await open.click();
  await browse
    .getByRole('button', { name: 'New drawing', exact: true })
    .click();
  await expect(unsaved).toBeVisible();
  await unsaved
    .getByRole('button', { name: 'Continue Without Saving' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(explanation).toHaveCount(0);
  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    const handle = await directory.getFileHandle('Recent drawing.dsn', {
      create: true,
    });
    const response = await fetch('bundled-examples/drawings/AMP.dsn');
    const writer = await handle.createWritable();
    await writer.write(await response.arrayBuffer());
    await writer.close();
    window.showOpenFilePicker = async () => [handle];
  });
  await open.click();
  await browse.getByRole('button', { name: 'Open file…', exact: true }).click();
  const fileTitle = page
    .locator('.top-bar-left')
    .getByText('Recent drawing.dsn', { exact: true });
  await expect(fileTitle).toBeVisible();
  await open.click();
  const recent = browse.getByRole('region', { name: 'Open Recent' });
  const recentDrawing = recent.getByRole('button', {
    name: 'Recent drawing.dsn',
  });
  await expect(recentDrawing).toBeVisible();
  await expect(circuit).toHaveCount(0);
  await startup.check();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(startup).toBeChecked();
  await recentDrawing.click();
  await expect(dialog).toHaveCount(0);
  await expect(fileTitle).toBeVisible();
  await page.getByRole('button', { name: 'Language menu' }).click();
  const languageOptions = page.getByRole('menuitemradio');
  await expect(languageOptions).toHaveCount(9);
  await expect(languageOptions.locator('svg[viewBox="0 0 24 16"]')).toHaveCount(
    9,
  );
  await expect(
    page.getByRole('menuitemradio', { name: 'English' }),
  ).toBeChecked();
  await page.getByRole('menuitemradio', { name: 'Français' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  expect(errors).toEqual([]);
});

test('welcome language follows browser preferences, localizes every guide and survives reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const unsupported = new URLSearchParams(location.search).has('unsupported');
    Object.defineProperty(navigator, 'language', { value: 'sv-SE' });
    Object.defineProperty(navigator, 'languages', {
      value: unsupported ? ['sv-SE', 'pt-BR'] : ['sv-SE', 'de-AT', 'en-GB'],
    });
  });
  await page.route('**/bundled-examples/config.json', (route) =>
    route.fulfill({ json: { version: 1, groups: [], assets: [] } }),
  );
  await page.goto(app.baseURL);
  const welcome = page.getByRole('dialog', {
    name: welcomeTitle,
    exact: true,
  });
  const language = welcome.getByRole('combobox');
  const html = page.locator('html');
  await expect(language).toContainText('Deutsch');
  const flag = 'svg[viewBox="0 0 24 16"]';
  await expect(language.locator(flag)).toBeVisible();
  await expect(html).toHaveAttribute('lang', 'de');

  for (const [choice, label] of [
    ['en', 'English'],
    ['nl', 'Nederlands'],
    ['fr', 'Français'],
    ['es', 'Español'],
    ['de', 'Deutsch'],
    ['it', 'Italiano'],
    ['ja', '日本語'],
    ['pl', 'Polski'],
    ['zh-CN', '中文 (简体)'],
  ]) {
    await language.click();
    const option = welcome.getByRole('option', { name: label, exact: true });
    await expect(option.locator(flag)).toBeVisible();
    await option.click();
    await expect(language).toContainText(label);
    await expect(html).toHaveAttribute('lang', choice);
    const prefix = choice === 'en' ? '' : `${choice}/`;
    for (const pagePath of [
      'Your-first-drawing/',
      'AI-Assistant/',
      'Simulation/',
    ]) {
      await expect(
        welcome.locator(
          `a[href="https://docs.tinycad.net/v4/${prefix}${pagePath}"]`,
        ),
      ).toBeVisible();
    }
  }

  await page.reload();
  await expect(language).toContainText('中文 (简体)');
  await expect(html).toHaveAttribute('lang', 'zh-CN');
  await page.evaluate(() => localStorage.removeItem('tinycad.language'));
  await page.goto(`${app.baseURL}?unsupported=1`);
  await expect(language).toContainText('English');
  await expect(html).toHaveAttribute('lang', 'en');
});
