// Agent paths as tests: what an agent needs from Nordlys, checked on every change.
// Role and label locators are a proxy for how agents perceive the page (Chapter 3):
// if this test cannot find "Full name" by its label, neither can an agent.
import { test, expect } from '@playwright/test';
import { toolFingerprints, readPins, diffPins } from '../../../nordlys-cabins/layers/16-security/pins.js';

const STAY = 'checkIn=2026-12-02&checkOut=2026-12-05&guests=3';

test('a guest books Fjellro using only roles and labels', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Cabins' }).click();
  await page.getByRole('link', { name: 'Fjellro' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Fjellro/);

  await page.goto(`/book/fjellro?${STAY}`);
  await page.getByLabel('Full name').fill('Astrid Holm');
  await page.getByLabel('Email').fill('astrid@example.no');
  await page.getByRole('checkbox', { name: 'I accept the booking and cancellation terms' }).check();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/confirmed/i);
  await expect(page.getByText(/NC-[0-9A-Z]{6}/).first()).toBeVisible();
});

test('the booking form keeps the structure agents rely on', async ({ page }) => {
  await page.goto(`/book/fjellro?${STAY}`);
  // A partial snapshot: these nodes must exist with these roles and names, in this order.
  await expect(page.locator('form[toolname="book_cabin"]')).toMatchAriaSnapshot(`
    - group "Your stay":
      - textbox "Check-in"
      - textbox "Check-out"
      - spinbutton "Guests"
    - group "Lead guest":
      - textbox "Full name"
      - textbox "Email"
    - checkbox "I accept the booking and cancellation terms"
    - region "Price summary":
      - table "Price for 3 nights"
    - button "Confirm booking"
  `);
});

test('WebMCP: the home page registers the tools Chapter 9 promises', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(async () => (await document.modelContext?.getTools())?.length >= 4);
  const names = await page.evaluate(async () => (await document.modelContext.getTools()).map((t) => t.name).sort());
  expect(names).toEqual(['check_availability', 'get_cabin_details', 'search_cabins', 'start_booking']);
});

test('MCP contract: tools/list matches the pinned definitions, and a read tool answers', async ({ request }) => {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'nordlys-ci', version: '1.0.0' },
  };
  const rpc = async (method, params = {}, name) => {
    const res = await request.post('/mcp', {
      headers: { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method,
        ...(name ? { 'mcp-name': name } : {}) },
      data: { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } },
    });
    expect(res.status()).toBe(200);
    return (await res.json()).result;
  };
  const { tools } = await rpc('tools/list');
  expect(diffPins(toolFingerprints(tools), await readPins())).toEqual([]);

  const result = await rpc('tools/call', { name: 'search_cabins', arguments: { guests: 4 } }, 'search_cabins');
  expect(result.isError ?? false).toBe(false);
  expect(JSON.stringify(result.structuredContent ?? result.content)).toContain('fjellro');
});
