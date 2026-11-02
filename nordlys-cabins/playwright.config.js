import { defineConfig, devices } from '@playwright/test';

// Browser tests. Each spec starts its own Nordlys server on a free port with
// tests/helpers/server.js, so chapter specs can pick their own UPTO and VARIANT.
// Locally this uses the Chromium that Playwright has cached; in CI the workflow
// runs `npx playwright install --with-deps chromium` first.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
