// Chapter 9: the WebMCP layer in Chromium with WebMCP turned on.
// --enable-features=WebMCPTesting is the switch behind chrome://flags/#enable-webmcp-testing.
// The agent side is played two ways: document.modelContext.getTools()/executeTool()
// for imperative tools, and the DevTools Protocol's experimental WebMCP domain
// (WebMCP.invokeTool), which is how a browser agent reaches declarative form tools.
import { test, expect } from '@playwright/test';
import { startServer } from './helpers/server.js';

test.use({ launchOptions: { args: ['--enable-features=WebMCPTesting'] } });

let server;
test.beforeAll(async () => { server = await startServer({ upto: 9 }); });
test.afterAll(async () => server?.close());

const toolsOn = (page) =>
  page.evaluate(async () => (await document.modelContext.getTools()).map((t) => ({ name: t.name, schema: t.inputSchema, annotations: t.annotations })));

async function waitForTools(page, count) {
  await page.waitForFunction(async (n) => (await document.modelContext.getTools()).length >= n, count);
}

const call = (page, name, input) =>
  page.evaluate(async ([n, i]) => {
    const tool = (await document.modelContext.getTools()).find((t) => t.name === n);
    return JSON.parse(await document.modelContext.executeTool(tool, i));
  }, [name, input]);

async function agentFor(page) {
  const cdp = await page.context().newCDPSession(page);
  const responses = new Map();
  cdp.on('WebMCP.toolResponded', (r) => responses.set(r.invocationId, r));
  await cdp.send('WebMCP.enable');
  const { frameTree } = await cdp.send('Page.getFrameTree');
  return {
    invoke: async (toolName, input) => (await cdp.send('WebMCP.invokeTool', { frameId: frameTree.frame.id, toolName, input })).invocationId,
    response: async (id, ms = 5000) => {
      for (let t = 0; t < ms; t += 50) {
        if (responses.has(id)) return responses.get(id);
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    },
  };
}

test('the home page registers four imperative tools, with annotations', async ({ page }) => {
  await page.goto(`${server.url}/`);
  await waitForTools(page, 4);
  const tools = await toolsOn(page);
  expect(tools.map((t) => t.name)).toEqual(['check_availability', 'get_cabin_details', 'search_cabins', 'start_booking']);
  expect(tools.find((t) => t.name === 'get_cabin_details').annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: true });
  expect(tools.find((t) => t.name === 'start_booking').annotations?.readOnlyHint).toBeFalsy();
  expect(tools.find((t) => t.name === 'check_availability').schema.required).toEqual(['cabin', 'checkIn', 'checkOut', 'guests']);
});

test('on a cabin page, the Chapter 2 form is check_availability and the script skips its own', async ({ page }) => {
  const messages = [];
  page.on('console', (m) => messages.push(m.text()));
  await page.goto(`${server.url}/cabins/fjellro`);
  await waitForTools(page, 4);
  const tools = await toolsOn(page);
  expect(tools.map((t) => t.name)).toEqual(['check_availability', 'get_cabin_details', 'search_cabins', 'start_booking']);
  expect(Object.keys(tools[0].schema.properties)).toEqual(['checkIn', 'checkOut', 'guests']);
  expect(messages.join('\n')).not.toContain('not registered');
});

test('on the cabin list, search_cabins is the search form', async ({ page }) => {
  await page.goto(`${server.url}/cabins`);
  await waitForTools(page, 4);
  const search = (await toolsOn(page)).find((t) => t.name === 'search_cabins');
  expect(search.schema.properties.region.enum).toContain('Lofoten');
  expect(search.schema.properties.checkIn.format).toBe('date');
});

test('search_cabins and check_availability answer with data, errors included', async ({ page }) => {
  await page.goto(`${server.url}/`);
  await waitForTools(page, 4);
  const found = await call(page, 'search_cabins', { features: ['sauna'], guests: 4, checkIn: '2026-12-04', checkOut: '2026-12-07' });
  expect(found.count).toBeGreaterThan(0);
  for (const cabin of found.cabins) expect(cabin.features).toContain('sauna');
  const tooShort = await call(page, 'check_availability', { cabin: 'fjellro', checkIn: '2026-12-01', checkOut: '2026-12-02', guests: 2 });
  expect(tooShort.available).toBe(false);
  expect(tooShort.errors.map((e) => e.code)).toContain('min_nights');
  const unknown = await call(page, 'get_cabin_details', { cabin: 'atlantis' });
  expect(unknown.error.code).toBe('unknown_cabin');
});

test('start_booking answers the agent, shows the guest a link, and books nothing', async ({ page }) => {
  const before = server.store.bookings().length;
  await page.goto(`${server.url}/cabins/senja-sjobu`);
  await waitForTools(page, 4);
  const agent = await agentFor(page);
  const id = await agent.invoke('start_booking', { cabin: 'fjellro', checkIn: '2026-12-08', checkOut: '2026-12-11', guests: 3 });
  const response = await agent.response(id);
  expect(response.status).toBe('Completed');
  expect(response.output.status).toBe('awaiting_guest');
  expect(response.output.totalNok).toBeGreaterThan(0);
  await page.getByRole('status').getByRole('link', { name: /Open the booking form/ }).click(); // the guest
  await page.waitForURL(/\/book\/fjellro\?/);
  await expect(page.locator('#booking-checkIn')).toHaveValue('2026-12-08');
  await expect(page.locator('#booking-guests')).toHaveValue('3');
  expect(server.store.bookings().length).toBe(before);
});

test('book_cabin: the agent fills the form, the person confirms', async ({ page }) => {
  const before = server.store.bookings().length;
  await page.goto(`${server.url}/book/hardanger-hytte`);
  const agent = await agentFor(page);
  const id = await agent.invoke('book_cabin', {
    checkIn: '2026-12-14', checkOut: '2026-12-17', guests: 2, name: 'Kari Nordmann', email: 'kari@example.com',
  });
  await expect(page.locator('#booking-name')).toHaveValue('Kari Nordmann');
  expect(await page.$eval('#booking', (f) => f.matches(':tool-form-active'))).toBe(true);
  await expect(page.locator('.agent-note')).toBeVisible();
  await expect(page.locator('#booking-acceptTerms')).not.toBeChecked();
  expect(await agent.response(id, 500)).toBeNull(); // nothing happens until the person acts
  expect(server.store.bookings().length).toBe(before);
  await page.check('#booking-acceptTerms');
  await page.click('#booking button[type=submit]');
  await page.waitForURL(/\/bookings\/NC-/);
  expect(server.store.bookings().length).toBe(before + 1);
});

test('search_cabins on the form answers the agent with JSON, then shows the person the results', async ({ page }) => {
  await page.goto(`${server.url}/cabins`);
  const agent = await agentFor(page);
  const id = await agent.invoke('search_cabins', { region: 'Lofoten', guests: 2 });
  const response = await agent.response(id);
  expect(response.status).toBe('Completed');
  const output = typeof response.output === 'string' ? JSON.parse(response.output) : response.output;
  expect(output.cabins.map((c) => c.region)).toEqual(Array(output.count).fill('Lofoten'));
  await page.waitForURL(/\/cabins\?region=Lofoten/);
  await expect(page.locator('.cabin-grid > li')).toHaveCount(output.count);
});

test('registration is all or nothing', async ({ page }) => {
  await page.goto(`${server.url}/guide`);
  await waitForTools(page, 4);
  const left = await page.evaluate(async () => {
    const { registerAll } = await import('/layers/09-webmcp/tools.js');
    const good = { name: 'good_tool', description: 'Works', execute: async () => 'ok' };
    const bad = { name: '', description: 'Has no name', execute: async () => 'never' };
    const error = await registerAll(document.modelContext, [good, bad]).catch((e) => e.name);
    const names = (await document.modelContext.getTools()).map((t) => t.name);
    return { error, hasGood: names.includes('good_tool') };
  });
  expect(left).toEqual({ error: 'InvalidStateError', hasGood: false });
});

// What this Chromium build does today. If one of these starts failing after a
// browser update, the behaviour changed and Chapter 9 needs a second look.
test('Chromium 156 accepts outputSchema but does not report it to agents yet', async ({ page }) => {
  await page.goto(`${server.url}/`);
  await waitForTools(page, 4);
  const keys = await page.evaluate(async () =>
    Object.keys((await document.modelContext.getTools()).find((t) => t.name === 'search_cabins')).sort());
  expect(keys).toEqual(['annotations', 'description', 'inputSchema', 'name', 'origin', 'title', 'window']);
});

test('a declarative tool that navigates answers with the next page\'s JSON-LD', async ({ page }) => {
  await page.goto(`${server.url}/cabins/fjellro`);
  const agent = await agentFor(page);
  const id = await agent.invoke('check_availability', { checkIn: '2026-12-01', checkOut: '2026-12-04', guests: 2 });
  const response = await agent.response(id);
  expect(response.status).toBe('Completed');
  expect(Array.isArray(response.output)).toBe(true);
  expect(response.output[0]['@context']).toBe('https://schema.org');
  await page.waitForURL(/checkIn=2026-12-01/);
});
