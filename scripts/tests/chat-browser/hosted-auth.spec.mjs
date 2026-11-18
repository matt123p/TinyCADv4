import { test, expect } from '@playwright/test';
import { serveLayoutApp } from '../layout-browser/serve-app.mjs';

// Bundle-graph tests cover both browser targets. Exercise the UI with the
// filesystem target, which can open the editor without a Google Drive session.
for (const target of ['filesystem']) {
  for (const environment of ['production', 'development']) {
    test(`${target} browser (${environment}) has no chatbot UI or account requests`, async ({ page }) => {
      test.setTimeout(180000);
      const app = await serveLayoutApp('layout-browser', target, environment);
      const authRequests = [];
      await page.route('**/api/chat/**', route => {
        authRequests.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript(() => {
        localStorage.setItem('tinycad.chat.connection.v1', JSON.stringify({ active: true, kind: 'chatgpt' }));
      });
      try {
        await page.goto(app.baseURL);
        await expect(page.locator('.toolbar-container:visible')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Chat', exact: true })).toHaveCount(0);
        await expect(page.locator('#tinycad-chat')).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'AI settings', exact: true })).toHaveCount(0);
        expect(authRequests).toEqual([]);
      } finally {
        await app.close();
      }
    });
  }
}
