import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './tests/browser', testMatch: 'plugins.spec.mjs', timeout: 60000,
  fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, launchOptions: { args: ['--no-sandbox'] }, screenshot: 'only-on-failure' },
  webServer: { command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory dist', cwd: fileURLToPath(new URL('../', import.meta.url)), url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 15000 },
});
