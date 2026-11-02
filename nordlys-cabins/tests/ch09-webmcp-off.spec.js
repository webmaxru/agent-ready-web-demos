// Chapter 9: the same pages in a Chromium without WebMCP (the default today).
import { test, expect } from '@playwright/test';
import { startServer } from './helpers/server.js';

let server;
test.beforeAll(async () => { server = await startServer({ upto: 9 }); });
test.afterAll(async () => server?.close());

test('without WebMCP, the pages work and the scripts stay quiet', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto(`${server.url}/cabins`);
  expect(await page.evaluate(() => 'modelContext' in document)).toBe(false);
  await page.selectOption('#search-region', 'Lofoten');
  await page.click('#search button[type=submit]');
  await page.waitForURL(/region=Lofoten/);
  await page.goto(`${server.url}/book/fjellro`);
  await expect(page.locator('.agent-note')).toBeHidden();
  expect(errors).toEqual([]);
});
