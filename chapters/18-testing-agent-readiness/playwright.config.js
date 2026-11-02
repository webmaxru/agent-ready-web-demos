import { defineConfig, devices } from '@playwright/test';

// Agent-path tests against a running Nordlys. Locally, Playwright starts the
// server itself. In CI, or against staging, set NORDLYS_URL and it is reused.
const PORT = 4318;
export const BASE = process.env.NORDLYS_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github'], ['json', { outputFile: 'playwright-report.json' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-features=WebMCPTesting'] },
  },
  webServer: process.env.NORDLYS_URL ? undefined : {
    command: `node ../../nordlys-cabins/server.js --port=${PORT} --now=2026-11-10`,
    url: `${BASE}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
