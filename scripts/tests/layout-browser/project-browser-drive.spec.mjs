import { expect, test } from '@playwright/test';
import { layoutRuntime } from '../../lib/layout-runtime.mjs';
import { serveLayoutApp } from './serve-app.mjs';

let app;
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await serveLayoutApp('layout-browser', 'google', 'production', {
    GOOGLE_CLIENT_ID_PROD: 'project-browser-test',
  });
});
test.afterAll(async () => {
  await app?.close();
});

test('Google mode opens the remembered Drive project folder and its project schematic', async ({
  page,
}) => {
  const api = await layoutRuntime();
  const drawing = api.blank();
  const data = await api.encodeDrawing(drawing, 'xml');
  const archive = await api.encodeProjectArchive({
    projectId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    title: 'Shared circuit',
    requiredFeatures: [],
    entries: [
      {
        kind: 'schematic',
        id: drawing.documentId,
        path: api.projectEntryPath('schematic', drawing.documentId),
        data,
      },
    ],
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'tinycad.driveProjectFolder.test-account',
      JSON.stringify({ id: 'designs', name: 'My projects' }),
    );
    const user = {
      getBasicProfile: () => ({
        getId: () => 'test-account',
        getName: () => 'Test',
        getImageUrl: () => '',
        getEmail: () => 'test@example.test',
      }),
      getAuthResponse: () => ({ access_token: 'test-token' }),
    };
    window.gapi = {
      load: (_, callback) => callback(),
      auth2: {
        init: async () => {},
        getAuthInstance: () => ({
          signIn: async () => user,
          currentUser: { get: () => user },
        }),
      },
    };
  });
  const listed = [];
  await page.route('https://**/*', (route) => route.abort());
  await page.route('https://www.googleapis.com/drive/v3/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('spaces') === 'appDataFolder')
      return route.fulfill({ json: { files: [] } });
    if (url.pathname.endsWith('/files')) {
      listed.push(url.searchParams.get('q'));
      return route.fulfill({
        json: {
          files: [
            {
              id: 'project',
              name: 'Shared.tcproject',
              mimeType: 'application/zip',
            },
          ],
        },
      });
    }
    if (url.searchParams.get('alt') === 'media')
      return route.fulfill({
        body: Buffer.from(archive),
        contentType: 'application/zip',
      });
    return route.fulfill({ json: { version: '1' } });
  });
  const sidebar = page.getByRole('region', { name: 'Projects', exact: true });
  async function open() {
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(
      sidebar.getByText('My projects', { exact: true }),
    ).toBeVisible();
    await sidebar
      .getByRole('button', { name: 'Shared.tcproject', exact: true })
      .click();
    await sidebar
      .getByRole('button', { name: 'Open schematic', exact: true })
      .click();
  }
  await page.goto(app.baseURL);
  await open();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(drawing.documentId);
  expect(listed).toEqual(["'designs' in parents and trashed = false"]);
  await page.evaluate(() =>
    window.layoutTest.renameCurrentSheet('Local Drive recovery'),
  );
  await expect(
    page.getByRole('status').filter({ hasText: 'Recovery copy saved at' }),
  ).toBeVisible();
  await page.reload();
  await open();
  const recovery = page.getByRole('dialog', { name: 'Recover project edits' });
  await recovery
    .getByRole('button', { name: 'Discard copy and open saved' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(drawing.documentId);
  expect(
    await page.evaluate(
      () => window.layoutTest.snapshot().drawing.sheets[0].name,
    ),
  ).toBe(drawing.sheets[0].name);
  await page.reload();
  await open();
  await expect
    .poll(() =>
      page.evaluate(() => window.layoutTest.snapshot().drawing.documentId),
    )
    .toBe(drawing.documentId);
  await expect(recovery).toHaveCount(0);
});
