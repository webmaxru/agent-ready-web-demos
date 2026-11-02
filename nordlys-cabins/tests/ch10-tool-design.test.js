// Chapter 10: find_booking and the tool-design lint, over the real /mcp endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApp } from './helpers/server.js';
import { lintTool, lintTools } from '../layers/10-tool-design/lint.js';

async function connect(app) {
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1/mcp'), {
    fetch: (url, init) => app.fetch(new Request(url, init)),
  });
  const client = new Client({ name: 'nordlys-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

test('find_booking is listed after the Chapter 8 tools and is read-only', async () => {
  const { app } = await buildApp({ upto: 10 });
  const client = await connect(app);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('find_booking'));
  assert.ok(names.indexOf('find_booking') > names.indexOf('cancel_booking'));
  const tool = tools.find((t) => t.name === 'find_booking');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.ok(tool.outputSchema.properties.ifCancelledToday);
  await client.close();
});

test('find_booking shows the refund before anything is cancelled', async () => {
  const { app, ctx } = await buildApp({ upto: 10 });
  const client = await connect(app);
  const r = await client.callTool({ name: 'find_booking', arguments: { ref: 'NC-7KQ2MD', email: 'ingrid@nordlys.example' } });
  assert.equal(r.structuredContent.found, true);
  assert.equal(r.structuredContent.booking.cabin, 'lyngen-lysthus');
  assert.equal(r.structuredContent.ifCancelledToday.canCancelOnline, true);
  assert.equal(r.structuredContent.ifCancelledToday.refund, r.structuredContent.booking.total);
  assert.equal(ctx.store.getBooking('NC-7KQ2MD').status, 'confirmed');
  const wrong = await client.callTool({ name: 'find_booking', arguments: { ref: 'NC-7KQ2MD', email: 'someone@example.com' } });
  assert.equal(wrong.structuredContent.found, false);
  assert.equal(wrong.structuredContent.booking, undefined);
  await client.close();
});

test('the tool-design audit lints the live tools/list and finds no errors', async () => {
  const { ctx } = await buildApp({ upto: 10 });
  const { results } = await ctx.runAudits();
  const audit = results.find((r) => r.layer === '10-tool-design');
  const lint = audit.checks.find((c) => c.id === 'tool-lint-errors');
  assert.equal(lint.ok, true, lint.message);
  assert.match(lint.message, /^5 tools, 0 errors/);
  // The Chapter 8 tools leave a few parameters without a description: warnings, not errors.
  const warnings = audit.checks.find((c) => c.id === 'tool-lint-warnings').message;
  assert.match(warnings, /check_availability\.guests param-undescribed/);
});

test('the linter catches what a generated tool set gets wrong', () => {
  const generated = {
    name: 'postApiV1Bookings',
    description: 'Create booking',
    inputSchema: { type: 'object', properties: { body: { type: 'object' }, from: { type: 'string' } } },
    annotations: { readOnlyHint: false },
  };
  const rules = lintTool(generated).map((f) => f.rule);
  for (const rule of ['name-format', 'name-verb', 'description-short', 'param-undescribed', 'param-date-format', 'param-wrapped-body', 'consequential-unconfirmed'])
    assert.ok(rules.includes(rule), rule);
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `get_thing_${i}`, description: 'Get one thing by its id and return all of its fields.', inputSchema: {}, annotations: { readOnlyHint: true } }));
  assert.ok(lintTools(many).some((f) => f.rule === 'too-many-tools'));
});
