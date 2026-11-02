import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers/server.js';
import { AGENT_RULES, runAxe } from '../../chapters/03-how-agents-see-a-page/agent-axe.mjs';
import { threeViews } from '../../chapters/03-how-agents-see-a-page/three-views.mjs';

const fixture = new URL('../../chapters/03-how-agents-see-a-page/fixtures/broken-booking.html', import.meta.url);

// The site sends a Content Security Policy, so axe can only be injected with bypassCSP.
test.use({ bypassCSP: true });

test.describe('the three views and the agent rules', () => {
  let legacy;
  let clean;
  test.beforeAll(async () => {
    legacy = await startServer({ variant: 'legacy', upto: 3 });
    clean = await startServer({ upto: 3 });
  });
  test.afterAll(async () => {
    await legacy?.close();
    await clean?.close();
  });

  test('Lighthouse uses 33 axe rules for agents', () => {
    expect(AGENT_RULES).toHaveLength(33);
    expect(AGENT_RULES).not.toContain('color-contrast');
    expect(AGENT_RULES).not.toContain('landmark-one-main');
  });

  test('both front ends pass the 33 agent rules', async ({ page }) => {
    for (const server of [legacy, clean]) {
      await page.goto(`${server.url}/cabins/fjellro`);
      await page.waitForTimeout(500);
      const result = await runAxe(page);
      expect(result.violations.map((v) => v.id), server.url).toEqual([]);
    }
  });

  test('the full rule set finds what the agent rules skip on the legacy page', async ({ page }) => {
    await page.goto(`${legacy.url}/cabins/fjellro`);
    await page.waitForTimeout(500);
    const ids = (await runAxe(page, null)).violations.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(['landmark-one-main', 'page-has-heading-one', 'region']));
  });

  test('the broken fixture fails ten of the agent rules', async ({ page }) => {
    await page.goto(fixture.href);
    const result = await runAxe(page);
    expect(result.violations.map((v) => v.id).sort()).toEqual([
      'aria-dialog-name', 'aria-required-attr', 'aria-roles', 'aria-toggle-field-name', 'aria-valid-attr-value',
      'autocomplete-valid', 'button-name', 'label', 'link-name', 'tabindex',
    ]);
    expect(result.incomplete.map((v) => v.id)).toContain('aria-hidden-focus');
  });

  test('without JavaScript the legacy page has no controls, the clean page has all of them', async ({ browser }) => {
    const old = await threeViews(browser, `${legacy.url}/cabins/fjellro`, { settle: 500 });
    const now = await threeViews(browser, `${clean.url}/cabins/fjellro`, { settle: 0 });
    expect(old.html.interactive).toBe(0);
    expect(now.html.snapshot).toContain('button "Check availability"');
    expect(now.tree.unnamed).toBe(0);
    expect(old.tree.headings).toBe(0);
    expect(now.tree.headings).toBeGreaterThan(0);
  });
});
