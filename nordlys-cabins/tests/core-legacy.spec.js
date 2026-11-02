import { test, expect } from '@playwright/test';
import { startServer } from './helpers/server.js';

// The legacy front end: the same booking works for a mouse user, but the
// role and label locators an agent depends on find nothing, so this test
// has to know the page's private CSS classes.
let server;
test.beforeAll(async () => {
  server = await startServer({ variant: 'legacy', upto: 0 });
});
test.afterAll(async () => server?.close());

test('the booking controls have no roles or labels', async ({ page }) => {
  await page.goto(`${server.url}/cabins/fjellro`);
  await expect(page.locator('.widget')).toBeVisible(); // content arrives late
  await expect(page.getByRole('main')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByLabel('Check-in')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cabins' })).toHaveCount(0);
  await expect(page.getByPlaceholder('Check-in')).toHaveCount(1); // a placeholder is all there is
});

test('a booking still works with CSS selectors and clicks', async ({ page }) => {
  await page.goto(`${server.url}/cabins/fjellro`);
  const pick = async (placeholder, iso) => {
    await page.getByPlaceholder(placeholder).click();
    const cal = page.locator('.cal');
    while (!(await cal.locator(`[data-date="${iso}"]`).count())) await cal.locator('.cal-next').click();
    await cal.locator(`[data-date="${iso}"]`).click();
  };
  await pick('Check-in', '2026-12-02');
  await pick('Check-out', '2026-12-05');
  await page.locator('.stepper .plus').click(); // 3 guests
  await page.locator('.widget .btn', { hasText: 'Check' }).click();
  await expect(page.locator('.result')).toHaveText('Total NOK 7,900 for 3 nights');
  await page.locator('.btn-book').click();
  const modal = page.locator('.modal');
  await modal.getByPlaceholder('Name').fill('Ola Nordmann');
  await modal.getByPlaceholder('Email').fill('ola@example.com');
  await modal.locator('.fake-check').click();
  await modal.locator('.btn', { hasText: 'Confirm' }).click();
  await page.waitForURL(/\/bookings\/NC-[A-Z0-9]{6}\?token=/);
  await expect(page.locator('.status')).toHaveText('CONFIRMED');

  await page.locator('.link.danger').click();
  await page.locator('.modal .btn-danger').click();
  await expect(page.locator('.status')).toHaveText('CANCELLED');
});
