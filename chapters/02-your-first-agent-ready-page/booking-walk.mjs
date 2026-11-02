#!/usr/bin/env node
// booking-walk.mjs
// Watch a structure-only agent try to book a cabin. Like the browsing agents that
// read the accessibility tree, it finds every control by its role and accessible
// name (getByRole, getByLabel) and never by CSS classes or pixel positions.
// When a step fails and the agent knows the URL of the next page, it goes there
// directly, the way an agent with a search result would, and carries on.
//
//   npm run start:baseline            # terminal 1: the legacy site on port 3000
//   node booking-walk.mjs http://127.0.0.1:3000
//   npm start -- --upto=2             # then the clean site after Chapter 2
//   node booking-walk.mjs http://127.0.0.1:3000

import { chromium } from '@playwright/test';

export const TASK = {
  cabin: 'Fjellro',
  slug: 'fjellro',
  checkIn: '2026-12-02',
  checkOut: '2026-12-05',
  guests: '3',
  name: 'Ola Nordmann',
  email: 'ola@example.com',
};

const STEP_TIMEOUT_MS = 2_000;

export function bookingSteps(page, base, task = TASK) {
  return [
    { name: 'Open "Cabins" from the home page', recover: `${base}/cabins`,
      run: () => page.getByRole('link', { name: 'Cabins', exact: true }).first().click() },
    { name: `Open the ${task.cabin} cabin page`, recover: `${base}/cabins/${task.slug}`,
      run: () => page.getByRole('link', { name: task.cabin, exact: true }).first().click() },
    { name: 'Fill in "Check-in"', run: () => page.getByLabel('Check-in', { exact: true }).fill(task.checkIn) },
    { name: 'Fill in "Check-out"', run: () => page.getByLabel('Check-out', { exact: true }).fill(task.checkOut) },
    { name: 'Fill in "Guests"', run: () => page.getByLabel('Guests', { exact: true }).fill(task.guests) },
    { name: 'Press "Check availability"', blocks: true, run: () => page.getByRole('button', { name: 'Check availability' }).click() },
    { name: 'Read the availability result',
      run: async () => {
        const status = page.getByRole('status').filter({ hasText: 'available' });
        await status.waitFor({ timeout: STEP_TIMEOUT_MS });
        return (await status.innerText()).split('\n')[0];
      } },
    { name: 'Open "Book these dates"', blocks: true, run: () => page.getByRole('link', { name: 'Book these dates' }).click() },
    { name: 'Fill in "Full name"', run: () => page.getByLabel('Full name').fill(task.name) },
    { name: 'Fill in "Email"', run: () => page.getByLabel('Email').fill(task.email) },
    { name: 'Accept the terms', run: () => page.getByRole('checkbox', { name: /accept/i }).check() },
    { name: 'Press "Confirm booking"', blocks: true, run: () => page.getByRole('button', { name: 'Confirm booking' }).click() },
    { name: 'Read the booking reference',
      run: async () => {
        await page.getByRole('heading', { name: 'Booking confirmed' }).waitFor({ timeout: STEP_TIMEOUT_MS });
        return page.getByRole('status').locator('.ref').innerText();
      } },
  ];
}

/** Walk the booking task. Returns one row per step: ok, skipped or failed. */
export async function walkBooking(page, base, task = TASK) {
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  await page.goto(base);
  const results = [];
  let blocked = false;
  for (const step of bookingSteps(page, base, task)) {
    if (blocked) {
      results.push({ step: step.name, result: 'skipped' });
      continue;
    }
    try {
      const value = await step.run();
      results.push({ step: step.name, result: 'ok', detail: typeof value === 'string' ? value : '' });
    } catch (error) {
      const timedOut = /Timeout \d+ms exceeded/.test(error.message);
      results.push({ step: step.name, result: 'failed', detail: timedOut ? 'nothing with that role and name' : error.message.split('\n')[0] });
      if (step.recover) await page.goto(step.recover);
      else if (step.blocks) blocked = true; // the steps after it need the page this step leads to
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = await walkBooking(page, base);
  await browser.close();
  for (const [i, r] of results.entries()) {
    const mark = { ok: 'ok     ', failed: 'FAILED ', skipped: 'skipped' }[r.result];
    console.log(`${String(i + 1).padStart(2)}. ${mark} ${r.step}${r.detail ? `  (${r.detail})` : ''}`);
  }
  const done = results.filter((r) => r.result === 'ok').length;
  console.log(`\n${done} of ${results.length} steps completed`);
  process.exitCode = done === results.length ? 0 : 1;
}
