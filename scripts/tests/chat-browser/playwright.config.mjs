import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  maxFailures: 1,
  timeout: 60000,
  reporter: 'list',
  outputDir: '../../../.tmp/chat-browser-results',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1500, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
