import { defineConfig } from '@playwright/test';
import { BASE_URL, EMAIL_SINK, PORT, WEBHOOK_SECRET } from './tests/e2e/support/env';

// End-to-end tests (tests/e2e) against a dev server of their own, started on
// port 4322 with the test-mode switches on (see src/lib/testMode.ts): emails go
// to a file instead of being sent, Google Calendar is off, and the daily email
// and check-in quotas aren't touched. The database IS the shared live one, so
// every test writes only ZZZ-prefixed rows and they're deleted before and
// after each run.
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/support/globalSetup.ts',
  globalTeardown: './tests/e2e/support/globalTeardown.ts',
  // One at a time: the tests share one database and some read its counts.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/.output/report' }]],
  outputDir: 'tests/e2e/.output/results',
  use: {
    baseURL: BASE_URL,
    // The Edge already installed on Windows, so Playwright needs no browser download.
    channel: 'msedge',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node tests/e2e/support/devServer.mjs`,
    url: BASE_URL,
    // Never reuse a server that might not have the test switches on: it would send real emails.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E_EMAIL_SINK: EMAIL_SINK,
      E2E_DISABLE_GOOGLE: '1',
      E2E_SKIP_USAGE_COUNTERS: '1',
      E2E_PORT: String(PORT),
      RESEND_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
  },
});
