import { defineConfig } from '@playwright/test';
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
export default defineConfig({
  testDir: './tests/debug-e2e',
  outputDir: '../../runtime/debug-playwright-results',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:8782', channel: 'chrome', viewport: {width: 1440, height: 900}, screenshot: 'only-on-failure' },
  webServer: {
    command: 'cd ../.. && PORT=8782 APP_ENV=staging PUBLIC_ORIGIN=http://127.0.0.1:8782 bun scripts/server-process.ts',
    url: 'http://127.0.0.1:8782/api/health', reuseExistingServer: false,
  },
});
