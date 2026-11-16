import { test, expect } from '@playwright/test';
import { serveLayoutApp } from '../layout-browser/serve-app.mjs';
let app;
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await serveLayoutApp('chat-browser');
});
test.afterAll(async () => {
  await app?.close();
});

test('production browser offers API keys without ChatGPT OAuth or subscription promises, even on localhost', async ({
  page,
}) => {
  const errors = [],
    authRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/chat/chatgpt/**', (route) => {
    authRequests.push(route.request().url());
    return route.fulfill({
      status: 500,
      json: { error: 'No hosted OAuth service' },
    });
  });
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'gpt-6.1-sol' }] } }),
  );
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Click here to connect AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await expect(dialog).not.toContainText('subscription');
  await dialog.getByLabel('Provider', { exact: true }).selectOption('openai');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: /ChatGPT/i })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /ChatGPT/i })).toHaveCount(0);
  await expect(dialog).not.toContainText('Sign In with ChatGPT');
  await expect(dialog).not.toContainText('subscription');
  await expect(dialog.getByLabel('API key', { exact: true })).toBeVisible();
  await dialog
    .getByLabel('API key', { exact: true })
    .fill('browser-private-api-key');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(authRequests).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain('browser-private-api-key');
  expect(errors).toEqual([]);
});
