// Chapter 17: privacy, consent and the human in the loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApp } from './helpers/server.js';
import { bookingRecords } from '../layers/17-consent/consent.js';
import { outbox } from '../layers/17-consent/outbox.js';
import { pruneAgentLog, hashIp } from '../layers/17-consent/retention.js';
import { agentActionLog } from '../layers/16-security/audit-log.js';
import { sealState, openState } from '../layers/17-consent/request-booking.js';

const STAY = { cabin: 'fjellro', checkIn: '2027-02-08', checkOut: '2027-02-12', guests: 3 };
const GUEST = { name: 'Astrid Holm', email: 'astrid@example.no' };

/** A guest who opens continue_url and confirms the stay on the checkout page. */
async function guestConfirms(app, url) {
  const { pathname } = new URL(url);
  assert.equal((await app.request(pathname)).status, 200);
  const res = await app.request(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...GUEST, acceptTerms: 'on' }).toString(),
  });
  assert.equal(res.status, 200);
}

/** An MCP client that answers elicitations the way its user would. */
async function connect(app, { onUrl }) {
  const asked = [];
  const client = new Client(
    { name: 'ch17-test', version: '1.0.0' },
    { capabilities: { elicitation: { form: {}, url: {} } }, versionNegotiation: { mode: 'auto' } }
  );
  client.setRequestHandler('elicitation/create', async (request) => {
    const params = request.params;
    asked.push(params);
    if (params.mode === 'url') return onUrl(params.url);
    return { action: 'accept', content: GUEST };
  });
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1/mcp'), {
    fetch: (url, init) => app.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return { client, asked };
}

test('request_booking: form for name and email, then the guest confirms on our page', async () => {
  const { app, ctx } = await buildApp({ upto: 17 });
  const { client, asked } = await connect(app, {
    onUrl: async (url) => { await guestConfirms(app, url); return { action: 'accept' }; },
  });
  const result = await client.callTool({ name: 'request_booking', arguments: STAY });
  assert.equal(result.structuredContent.status, 'confirmed', JSON.stringify(result));
  const ref = result.structuredContent.ref;
  assert.match(ref, /^NC-/);

  assert.deepEqual(asked.map((p) => p.mode ?? 'form'), ['form', 'url']);
  assert.deepEqual(Object.keys(asked[0].requestedSchema.properties), ['name', 'email'], 'no payment data in form mode');
  assert.match(asked[1].url, /^http:\/\/127\.0\.0\.1\/checkout\/bks_/);

  const record = bookingRecords(ctx).forRef(ref);
  assert.equal(record.channel, 'ucp-checkout');
  assert.equal(record.agent, 'mcp:ch17-test');
  assert.equal(record.confirmedBy, 'you, on nordlys.example');

  const [mail] = outbox(ctx).sent();
  assert.equal(mail.to, GUEST.email);
  assert.match(mail.subject, new RegExp(`${ref} was made with an AI assistant`));
  assert.match(mail.text, /cancel it free of charge until \d{4}-\d{2}-\d{2}/);
  await client.close();
});

test('request_booking: nothing is booked when the user declines, or before they confirm', async () => {
  const { app, ctx } = await buildApp({ upto: 17 });
  const before = ctx.store.bookings().length;

  const declines = await connect(app, { onUrl: async () => ({ action: 'decline' }) });
  const declined = await declines.client.callTool({ name: 'request_booking', arguments: STAY });
  assert.equal(declined.structuredContent.status, 'not_booked');

  let pending;
  const later = await connect(app, { onUrl: async (url) => { pending = url; return { action: 'accept' }; } });
  const waiting = await later.client.callTool({ name: 'request_booking', arguments: STAY });
  assert.equal(waiting.structuredContent.status, 'awaiting_guest');
  assert.equal(ctx.store.bookings().length, before, 'no booking without the guest');

  const { checkout } = waiting.structuredContent;
  const check = () => later.client.callTool({ name: 'check_booking_request', arguments: { checkout } });
  assert.equal((await check()).structuredContent.status, 'awaiting_guest');
  await guestConfirms(app, pending);
  const confirmed = (await check()).structuredContent;
  assert.equal(confirmed.status, 'confirmed');
  assert.match(confirmed.ref, /^NC-/);
  await declines.client.close();
  await later.client.close();
});

test('request_booking rejects a forged requestState', async () => {
  const { app } = await buildApp({ upto: 17 });
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'request_booking' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'request_booking', arguments: STAY,
        inputResponses: { confirm: { action: 'accept' } },
        requestState: 'eyJzdGVwIjoiY29uZmlybSJ9.forged',
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {}, url: {} } },
          'io.modelcontextprotocol/clientInfo': { name: 'forger', version: '1.0.0' },
        },
      },
    }),
  });
  const { result } = await res.json();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /invalid_state/);
});

test('requestState is bound to the same tool arguments and member', () => {
  const state = sealState({ step: 'confirm', session: 'bks_x' }, { args: STAY, member: 'm-ola' });
  assert.equal(openState(state, { args: STAY, member: 'm-ola' }).session, 'bks_x');
  assert.equal(openState(state, { args: { ...STAY, guests: 6 }, member: 'm-ola' }), null, 'other arguments');
  assert.equal(openState(state, { args: STAY, member: null }), null, 'other principal');
  assert.equal(openState(state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), { args: STAY, member: 'm-ola' }), null, 'tampered');
});

test('agent bookings get a record and an email, form bookings do not', async () => {
  const { app, ctx } = await buildApp({ upto: 17 });
  const page = await app.request('/book/lyngen-lysthus', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ checkIn: '2027-03-01', checkOut: '2027-03-04', guests: '2', ...GUEST, acceptTerms: 'on' }).toString(),
  });
  assert.ok(page.status < 400, `form booking answered ${page.status}`);
  assert.equal(bookingRecords(ctx).all().length, 0);
  assert.equal(outbox(ctx).sent().length, 0);
});

test('the agent-activity page shows and exports what agents did, to the owner only', async () => {
  const { app } = await buildApp({ upto: 17 });
  const { client } = await connect(app, { onUrl: async (url) => { await guestConfirms(app, url); return { action: 'accept' }; } });
  const { ref } = (await client.callTool({ name: 'request_booking', arguments: STAY })).structuredContent;
  await client.close();

  assert.equal((await app.request('/account/agent-activity')).status, 200);
  const form = (fields) => app.request('/account/agent-activity', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  assert.equal((await form({ ref, email: 'someone@example.no' })).status, 404);
  const html = await (await form({ ref, email: GUEST.email })).text();
  assert.match(html, new RegExp(`${ref}</strong>: An AI assistant prepared this booking`));

  const exported = await form({ ref, email: GUEST.email, format: 'json' });
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const data = await exported.json();
  assert.equal(data.bookings[0].ref, ref);
  assert.equal(data.bookings[0].agent, 'mcp:ch17-test');
  assert.equal('email' in data.bookings[0], false);
});

test('retention: raw agent-log entries expire after 30 days, IP hashes rotate daily', async () => {
  const { ctx } = await buildApp({ upto: 17 });
  const log = agentActionLog(ctx);
  const now = new Date('2026-11-02T12:00:00Z');
  log.add({ at: '2026-09-20T10:00:00Z', channel: 'mcp', name: 'search_cabins', outcome: 'ok' });
  log.add({ at: '2026-10-30T10:00:00Z', channel: 'mcp', name: 'search_cabins', outcome: 'ok' });
  assert.equal(pruneAgentLog(log, now), 1);
  assert.equal(log.entries().length, 1);

  const today = hashIp('203.0.113.7', 'secret', now);
  assert.equal(hashIp('203.0.113.7', 'secret', now), today);
  assert.notEqual(hashIp('203.0.113.7', 'secret', new Date('2026-11-03T12:00:00Z')), today);
  assert.doesNotMatch(today, /203/);
});
