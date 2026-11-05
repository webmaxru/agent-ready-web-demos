// Chapter 8: the MCP server, driven by a real MCP client from the TypeScript SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as z from 'zod/v4';
import { buildApp } from './helpers/server.js';
import { registerMcpTool } from '../layers/08-mcp-server/registry.js';

/** Connect an SDK client to the app in-process: the transport's fetch goes straight to app.fetch. */
async function connect(app, mode = 'auto') {
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1/mcp'), {
    fetch: (url, init) => app.fetch(new Request(url, init)),
  });
  const client = new Client({ name: 'nordlys-test', version: '1.0.0' }, mode ? { versionNegotiation: { mode } } : {});
  await client.connect(transport);
  return client;
}

test('a 2026-07-28 client discovers the four Chapter 8 tools, then find_booking from Chapter 7, with honest annotations, in a stable order', async () => {
  const { app } = await buildApp({ upto: 8 });
  const client = await connect(app);
  assert.equal(client.getProtocolEra(), 'modern');
  const { tools } = await client.listTools();
  // The server's own four tools come first. Chapter 7's layer (on for every --upto >= 7) adds find_booking.
  assert.deepEqual(tools.map((t) => t.name), ['search_cabins', 'check_availability', 'create_booking', 'cancel_booking', 'find_booking']);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(byName.search_cabins.annotations.readOnlyHint, true);
  assert.equal(byName.cancel_booking.annotations.destructiveHint, true);
  assert.ok(byName.check_availability.outputSchema.properties.quote);
  assert.match(client.getInstructions(), /Nordlys Cabins/);
  await client.close();
});

test('search and availability return structuredContent next to text', async () => {
  const { app } = await buildApp({ upto: 8 });
  const client = await connect(app);
  const found = await client.callTool({ name: 'search_cabins', arguments: { region: 'Lofoten', guests: 2 } });
  assert.equal(found.structuredContent.count, 1);
  assert.equal(found.structuredContent.cabins[0].slug, 'reine-rorbu');
  const quote = await client.callTool({ name: 'check_availability', arguments: { cabin: 'fjellro', checkIn: '2026-12-02', checkOut: '2026-12-05', guests: 4 } });
  assert.equal(quote.structuredContent.available, true);
  assert.equal(quote.content[0].type, 'text');
  const bad = await client.callTool({ name: 'check_availability', arguments: { cabin: 'fjellro', checkIn: '2026-12-02', checkOut: '2026-12-03', guests: 4 } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /min_nights/);
  const invalid = await client.callTool({ name: 'search_cabins', arguments: { region: 'Atlantis' } });
  assert.equal(invalid.isError, true);
  await client.close();
});

test('create_booking is idempotent per key and books through the same service as the API', async () => {
  const { app, ctx } = await buildApp({ upto: 8 });
  const via = [];
  ctx.events.on('booking.created', (_b, meta) => via.push(meta.via));
  const client = await connect(app);
  const args = {
    cabin: 'senja-sjobu', checkIn: '2026-12-10', checkOut: '2026-12-13', guests: 2,
    name: 'Ola Nordmann', email: 'ola@example.com', acceptTerms: true, idempotencyKey: 'b3c1f7e0-6a43-4b8e-9d1c-2f6f0f3d9a11',
  };
  const first = await client.callTool({ name: 'create_booking', arguments: args });
  const again = await client.callTool({ name: 'create_booking', arguments: args });
  assert.equal(first.structuredContent.ref, again.structuredContent.ref);
  assert.equal(first.structuredContent.name, undefined, 'the result does not echo personal data');
  // The API sees the booking the MCP server made: the dates are now taken.
  const api = await app.request('/api/v1/cabins/senja-sjobu/availability?checkIn=2026-12-10&checkOut=2026-12-13&guests=2');
  assert.equal((await api.json()).available, false);
  const cancelled = await client.callTool({ name: 'cancel_booking', arguments: { ref: first.structuredContent.ref, email: 'ola@example.com' } });
  assert.equal(cancelled.structuredContent.status, 'cancelled');
  assert.deepEqual(via, ['mcp']);
  await client.close();
});

test('resources and the prompt', async () => {
  const { app } = await buildApp({ upto: 8 });
  const client = await connect(app);
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === 'nordlys://guide/northern-lights-from-a-cabin'));
  assert.ok(resources.some((r) => r.uri === 'nordlys://policies/cancellation'));
  const { contents } = await client.readResource({ uri: 'nordlys://guide/northern-lights-from-a-cabin' });
  assert.match(contents[0].text, /^# How to watch the northern lights/);
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name), ['plan_cabin_trip']);
  const p = await client.getPrompt({ name: 'plan_cabin_trip', arguments: { when: 'a weekend in February', guests: '4' } });
  assert.match(p.messages[0].content.text, /Do not book anything until I confirm/);
  await client.close();
});

test('a 2025-11-25 client (initialize handshake) is served from the same endpoint', async () => {
  const { app } = await buildApp({ upto: 8 });
  const client = await connect(app, null);
  assert.equal(client.getProtocolEra(), 'legacy');
  const { tools } = await client.listTools();
  assert.equal(tools.length, 5); // the four Chapter 8 tools and find_booking (Chapter 7)
  await client.close();
});

test('a later layer can add a tool without editing Chapter 8', async () => {
  const { app, ctx } = await buildApp({ upto: 8 });
  registerMcpTool(ctx, 'echo_auth', { description: 'test tool', inputSchema: z.object({}) }, async (_args, extra) => ({
    content: [{ type: 'text', text: extra.auth ? 'authenticated' : 'anonymous' }],
  }));
  const client = await connect(app);
  const { tools } = await client.listTools();
  assert.equal(tools.at(-1).name, 'echo_auth');
  const r = await client.callTool({ name: 'echo_auth', arguments: {} });
  assert.equal(r.content[0].text, 'anonymous');
  await client.close();
});

test('a browser page from another origin cannot call /mcp', async () => {
  const { app, ctx } = await buildApp({ upto: 8 });
  const res = await app.request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: { origin: 'https://evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 403);
  assert.equal((await ctx.runAudits()).ok, true);
});
