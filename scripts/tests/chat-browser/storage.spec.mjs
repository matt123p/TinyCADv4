import { test, expect } from '@playwright/test';
import { serveLayoutApp } from '../layout-browser/serve-app.mjs';
import { ChatSecretStore } from '../../../electron/chat-secrets.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
let app;
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await serveLayoutApp('chat-storage', 'electron');
});
test.afterAll(async () => {
  await app?.close();
});

for (const secure of [true, false])
  test(`Electron ${
    secure ? 'encrypted' : 'memory-only'
  } API credentials and preferences survive the correct lifecycle`, async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), 'tinycad-storage-ui-'));
    const aesKey = randomBytes(32);
    const encryption = {
      encrypt(text) {
        const iv = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', aesKey, iv);
        const data = Buffer.concat([
          cipher.update(text, 'utf8'),
          cipher.final(),
        ]);
        return Buffer.concat([iv, cipher.getAuthTag(), data]).toString(
          'base64',
        );
      },
      decrypt(text) {
        const data = Buffer.from(text, 'base64'),
          cipher = createDecipheriv(
            'aes-256-gcm',
            aesKey,
            data.subarray(0, 12),
          );
        cipher.setAuthTag(data.subarray(12, 28));
        return Buffer.concat([
          cipher.update(data.subarray(28)),
          cipher.final(),
        ]).toString('utf8');
      },
    };
    let vault = new ChatSecretStore(directory, secure ? encryption : undefined);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.exposeFunction('testSecret', async (operation, value) => ({
      result: await vault.command(operation, value),
    }));
    await page.addInitScript(() => {
      window.electronAPI = {
        chatSecret: (operation, value) => window.testSecret(operation, value),
        chatgptAccount: async () => ({
          result: { available: true, connected: false },
        }),
        ...Object.fromEntries(
          [
            'fileLoaded',
            'recentFiles',
            'libraryLoaded',
            'libraryLoadFailed',
            'libraries',
            'onMenuCommand',
            'onMenuCommandWithData',
            'onAppClosing',
            'onSimulation',
          ].map((name) => [name, () => () => {}]),
        ),
        setTitle() {},
        setMenuMode() {},
      };
    });
    await page.route('https://llm.example/custom/v1/models', (route) =>
      route.fulfill({ json: { data: [{ id: 'test-model' }] } }),
    );
    try {
      await page.goto(app.baseURL);
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      await page
        .getByRole('button', { name: 'AI settings', exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'AI settings',
        exact: true,
      });
      await dialog
        .getByLabel('Provider', { exact: true })
        .selectOption('compatible');
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(dialog).toContainText(
        secure
          ? 'operating system’s secure storage'
          : 'Secure storage is unavailable',
      );
      await dialog
        .getByLabel('API key', { exact: true })
        .fill('secret-ui-api-key');
      await dialog
        .getByLabel('API base URL', { exact: true })
        .fill('https://llm.example/custom/v1');
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      const thinking = dialog.getByRole('slider', {
        name: 'Thinking level',
        exact: true,
      });
      await thinking.press('End');
      await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const preferences = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('tinycad.chat.settings.v1')),
      );
      expect(preferences.endpoint).toBe('https://llm.example/custom/v1');
      expect(preferences.thinkingLevel).not.toBe('medium');
      expect(
        await page.evaluate(() => JSON.stringify({ ...localStorage })),
      ).not.toContain('secret-ui-api-key');
      if (secure)
        expect(
          await readFile(join(directory, 'api-key.json'), 'utf8'),
        ).not.toContain('secret-ui-api-key');
      // Simulate an application restart, not just a renderer reload.
      vault = new ChatSecretStore(directory, secure ? encryption : undefined);
      await page.reload();
      await page.getByRole('button', { name: 'Chat', exact: true }).click();
      if (secure) {
        await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
        await page
          .getByRole('button', { name: 'AI settings', exact: true })
          .click();
        await expect(dialog).toContainText('Connected using an API key');
        await expect(
          dialog.getByRole('slider', { name: 'Thinking level' }),
        ).toHaveAttribute('aria-valuetext', 'Max');
        await dialog
          .getByRole('button', { name: 'Clear API key', exact: true })
          .click();
        await expect(dialog).not.toBeVisible();
        await page.reload();
        await page.getByRole('button', { name: 'Chat', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Click here to Sign in to use AI' }),
        ).toBeEnabled();
        expect(await vault.command('load')).toEqual({});
      }
      // Reconnecting must keep the endpoint, model and thinking preference.
      await page
        .getByRole('button', { name: 'AI settings', exact: true })
        .click();
      await dialog
        .getByLabel('Provider', { exact: true })
        .selectOption('compatible');
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(
        dialog.getByLabel('API base URL', { exact: true }),
      ).toHaveValue(preferences.endpoint);
      await dialog
        .getByLabel('API key', { exact: true })
        .fill('replacement-key');
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(
        dialog.getByRole('slider', { name: 'Thinking level' }),
      ).toHaveAttribute('aria-valuetext', 'Max');
      await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test('Electron remembers API-key authentication without restoring a cleared connection', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      'tinycad.chat.settings.v1',
      JSON.stringify({
        provider: 'openai',
        endpoint: '',
        model: 'gpt-6.1-sol',
        thinkingLevel: 'high',
      }),
    );
    localStorage.setItem(
      'tinycad.chat.connection.v1',
      JSON.stringify({
        kind: 'api-key',
        provider: 'openai',
        active: false,
        endpoint: '',
      }),
    );
    window.electronAPI = {
      chatSecret: async () => ({ result: { secure: false } }),
      chatgptAccount: async () => ({
        result: { available: true, connected: false },
      }),
      ...Object.fromEntries(
        [
          'fileLoaded',
          'recentFiles',
          'libraryLoaded',
          'libraryLoadFailed',
          'libraries',
          'onMenuCommand',
          'onMenuCommandWithData',
          'onAppClosing',
          'onSimulation',
        ].map((name) => [name, () => () => {}]),
      ),
      setTitle() {},
      setMenuMode() {},
    };
  });
  await page.goto(app.baseURL);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Click here to Sign in to use AI' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
  await dialog.getByLabel('Provider', { exact: true }).selectOption('openai');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(
    dialog.getByRole('radio', { name: 'Use API Key', exact: true }),
  ).toBeChecked();
  await expect(dialog.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(dialog).toContainText('Secure storage is unavailable');
  expect(errors).toEqual([]);
});
