// Chapter 11: UCP-style profile, booking sessions and the human checkout handoff.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, formBody } from './helpers/server.js';

const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const stay = (overrides = {}) => ({
  property: { id: 'fjellro' },
  stays: [{
    accommodation_type: { id: 'whole-cabin' },
    rate_plan: { id: 'flex' },
    occupancy: { adults: 2, total: 2 },
    stay_dates: { start_date: '2026-12-07', end_date: '2026-12-10' },
    ...overrides,
  }],
});

test('the business profile is served at /.well-known/ucp', async () => {
  const { app } = await buildApp({ upto: 11, publicOrigin: 'https://nordlys.example' });
  const res = await app.request('/.well-known/ucp');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const { ucp } = await res.json();
  assert.equal(ucp.version, '2026-08-25');
  assert.equal(ucp.services['dev.ucp.lodging'][0].endpoint, 'https://nordlys.example/ucp/v1');
  assert.ok(ucp.capabilities['dev.ucp.lodging.booking']);
  assert.deepEqual(ucp.payment_handlers, {});
});

test('a booking session quotes in minor units and hands off to the guest', async () => {
  const { app, store } = await buildApp({ upto: 11, publicOrigin: 'https://nordlys.example' });
  const res = await app.request('/ucp/v1/booking-sessions', json(stay()));
  assert.equal(res.status, 201);
  const s = await res.json();
  const quote = store.quotePrice(store.getCabin('fjellro'), '2026-12-07', '2026-12-10');
  assert.equal(s.status, 'requires_escalation');
  assert.equal(s.currency, 'NOK');
  assert.equal(s.totals.at(-1).type, 'total');
  assert.equal(s.totals.at(-1).amount, quote.total * 100);
  assert.equal(s.messages[0].severity, 'requires_buyer_review');
  assert.equal(s.continue_url, `https://nordlys.example/checkout/${s.id}`);
  assert.equal(s.policies[0].refundability, 'refundable');
});

test('invalid input comes back as recoverable messages with a JSONPath', async () => {
  const { app } = await buildApp({ upto: 11 });
  const res = await app.request('/ucp/v1/booking-sessions', json(stay({ occupancy: { total: 9 } })));
  const body = await res.json();
  assert.equal(body.ucp.status, 'error');
  assert.equal(body.messages[0].code, 'too_many_guests');
  assert.equal(body.messages[0].path, '$.stays[0].occupancy.total');
  assert.equal(body.messages[0].severity, 'recoverable');
});

test('booked dates are inventory_exhausted', async () => {
  const { app, store } = await buildApp({ upto: 11 });
  const taken = store.unavailableRanges('fjellro').find((r) => r.from > store.today());
  const res = await app.request('/ucp/v1/booking-sessions', json(stay({ stay_dates: { start_date: taken.from, end_date: taken.to } })));
  const body = await res.json();
  assert.equal(body.messages[0].code, 'inventory_exhausted');
});

test('complete never finalises: the guest confirms on the site', async () => {
  const { app, ctx } = await buildApp({ upto: 11 });
  const created = await (await app.request('/ucp/v1/booking-sessions', json(stay()))).json();
  const completed = await (await app.request(`/ucp/v1/booking-sessions/${created.id}/complete`, json({}))).json();
  assert.equal(completed.status, 'requires_escalation');

  const path = `/checkout/${created.id}`;
  const page = await app.request(path);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Nothing is booked until you confirm it here/);

  const noTerms = await app.request(path, formBody({ name: 'Kari Nordmann', email: 'kari@example.com' }));
  assert.equal(noTerms.status, 422);

  const seen = [];
  ctx.events.on('booking.created', (b, { via }) => seen.push({ ref: b.ref, via }));
  const ok = await app.request(path, formBody({ name: 'Kari Nordmann', email: 'kari@example.com', acceptTerms: 'on' }));
  assert.equal(ok.status, 200);
  assert.equal(seen[0].via, 'ucp-checkout');

  const after = await (await app.request(`/ucp/v1/booking-sessions/${created.id}`)).json();
  assert.equal(after.status, 'completed');
  assert.equal(after.confirmation.id, seen[0].ref);
  assert.equal(after.continue_url, undefined);
});

test('the checkout form cannot change what is booked', async () => {
  const { app, ctx } = await buildApp({ upto: 11 });
  const created = await (await app.request('/ucp/v1/booking-sessions', json(stay()))).json();
  let booked;
  ctx.events.on('booking.created', (b) => { booked = b; });
  await app.request(`/checkout/${created.id}`, formBody({
    name: 'Kari Nordmann', email: 'kari@example.com', acceptTerms: 'on', cabin: 'reine-rorbu', checkOut: '2026-12-20',
  }));
  assert.equal(booked.cabin, 'fjellro');
  assert.equal(booked.checkOut, '2026-12-10');
});

test('a session expires after 15 minutes', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-10T12:00:00Z') });
  t.after(() => mock.timers.reset());
  const { app } = await buildApp({ upto: 11 });
  const created = await (await app.request('/ucp/v1/booking-sessions', json(stay()))).json();
  mock.timers.tick(16 * 60_000);
  const after = await (await app.request(`/ucp/v1/booking-sessions/${created.id}`)).json();
  assert.equal(after.status, 'canceled');
  assert.equal((await app.request(`/checkout/${created.id}`)).status, 410);
});

test('the x402 teaching route is off unless NORDLYS_X402_DEMO=1', async () => {
  const off = await buildApp({ upto: 11 });
  assert.equal((await off.app.request('/guide/premium/winter-routes')).status, 404);
  const on = await buildApp({ upto: 11, env: { NORDLYS_X402_DEMO: '1' } });
  const res = await on.app.request('/guide/premium/winter-routes');
  assert.equal(res.status, 402);
  const required = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString());
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts[0].network, 'eip155:84532');
});

test('the layer audits pass', async () => {
  const { ctx } = await buildApp({ upto: 11 });
  const { ok, results } = await ctx.runAudits();
  assert.ok(ok, JSON.stringify(results));
});
