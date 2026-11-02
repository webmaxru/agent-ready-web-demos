import { test, expect } from '@playwright/test';
import { startServer } from './helpers/server.js';

// The clean front end: every step uses role and label locators, the same
// handles an agent reading the accessibility tree gets.
let server;
test.beforeAll(async () => {
  server = await startServer({ variant: 'clean' });
});
test.afterAll(async () => server?.close());

test('find, book and cancel a cabin with labels and roles only', async ({ page }) => {
  await page.goto(server.url);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Cabins' }).click();
  await page.getByLabel('Region').selectOption('Rondane');
  await page.getByRole('button', { name: 'Search cabins' }).click();
  await expect(page.getByRole('status')).toHaveText(/1 cabin matches/);
  await page.getByRole('link', { name: 'Fjellro' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fjellro');

  await page.getByLabel('Check-in').fill('2026-12-02');
  await page.getByLabel('Check-out').fill('2026-12-05');
  await page.getByLabel('Guests').fill('3');
  await page.getByRole('button', { name: 'Check availability' }).click();
  await expect(page.locator('#availability-result')).toContainText('Fjellro is available');
  await expect(page.getByRole('table', { name: 'Price for 3 nights' })).toContainText('NOK 7,900');

  await page.getByRole('link', { name: 'Book these dates' }).click();
  await page.getByLabel('Full name').fill('Kari Nordmann');
  await page.getByLabel('Email').fill('kari@example.com');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  // Server-side validation: the terms box was not ticked.
  await expect(page.getByRole('alert')).toContainText('Accept the booking terms to continue.');
  await page.getByLabel('I accept the booking and cancellation terms').check();
  await page.getByRole('button', { name: 'Confirm booking' }).click();

  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
  const ref = await page.locator('.ref').textContent();
  expect(ref).toMatch(/^NC-[A-Z0-9]{6}$/);

  await page.getByRole('link', { name: 'Cancel this booking' }).click();
  const dialog = page.getByRole('dialog', { name: `Cancel booking ${ref}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Yes, cancel booking' }).click();
  await expect(page.getByRole('status')).toContainText(`Booking ${ref} is cancelled`);
});

test('sign in and see my bookings', async ({ page }) => {
  await page.goto(`${server.url}/login`);
  await page.getByLabel('Email').fill('ingrid@nordlys.example');
  await page.getByLabel('Password').fill('nordlys-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'My bookings' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Your bookings' }).getByRole('row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('the page has no CSP violations and no console errors', async ({ page }) => {
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  for (const path of ['/', '/cabins', '/cabins/lyngen-lysthus', '/guide', '/faq', '/contact']) await page.goto(server.url + path);
  expect(problems).toEqual([]);
});
