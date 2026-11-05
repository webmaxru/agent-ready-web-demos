import { test, expect } from '@playwright/test';
import { startServer } from './helpers/server.js';
import { walkBooking } from '../../chapters/02-your-first-agent-ready-page/booking-walk.mjs';

// A structure-only agent (role and name locators, no CSS) tries the booking task.
// WebMCP testing is switched on for the whole file, so Chromium exposes
// document.modelContext. It changes nothing for the walk itself.
test.use({
  launchOptions: {
    args: ['--enable-features=WebMCPTesting'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  },
});

test.describe('the legacy baseline', () => {
  let server;
  test.beforeAll(async () => { server = await startServer({ variant: 'legacy', upto: 0 }); });
  test.afterAll(async () => server?.close());

  test('the agent cannot complete a single step', async ({ page }) => {
    const results = await walkBooking(page, server.url);
    expect(results.filter((r) => r.result === 'ok')).toHaveLength(0);
    expect(results.slice(0, 6).map((r) => r.result)).toEqual(Array(6).fill('failed'));
  });
});

test.describe('the clean front end after Chapter 2', () => {
  let server;
  test.beforeAll(async () => { server = await startServer({ upto: 2 }); });
  test.afterAll(async () => server?.close());

  test('the agent books a cabin end to end', async ({ page }) => {
    const results = await walkBooking(page, server.url);
    expect(results.map((r) => r.result)).toEqual(Array(13).fill('ok'));
    expect(results.at(-1).detail).toMatch(/^NC-[A-Z0-9]{6}$/);
  });

  test.describe('with WebMCP testing enabled in Chromium', () => {
    test('Chromium turns the form into a tool with a JSON Schema', async ({ page }) => {
      await page.goto(`${server.url}/cabins/fjellro`);
      const tools = await page.evaluate(async () =>
        (await document.modelContext.getTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      );
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('check_availability');
      expect(tools[0].inputSchema.required).toEqual(['checkIn', 'checkOut', 'guests']);
      expect(tools[0].inputSchema.properties.guests).toMatchObject({ type: 'number', minimum: 1, maximum: 6 });
    });

    test('an agent can call the tool instead of clicking', async ({ page }) => {
      await page.goto(`${server.url}/cabins/fjellro`);
      await page.evaluate(async () => {
        const [tool] = await document.modelContext.getTools();
        await document.modelContext.executeTool(tool, { checkIn: '2026-12-09', checkOut: '2026-12-12', guests: 3 });
      });
      await expect(page).toHaveURL(/checkIn=2026-12-09&checkOut=2026-12-12&guests=3/);
      await expect(page.getByRole('status')).toContainText('Fjellro is available');
      await expect(page.getByRole('status')).toContainText('NOK 7,900');
    });
  });
});
