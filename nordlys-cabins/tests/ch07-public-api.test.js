// Chapter 7: the public API, its OpenAPI description and the API catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers/server.js';

const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const stay = { cabin: 'fjellro', checkIn: '2026-12-02', checkOut: '2026-12-05', guests: 4 };
const guest = { name: 'Kari Nordmann', email: 'kari@example.com', acceptTerms: true };

test('searchCabins filters and paginates with an opaque cursor', async () => {
  const { app } = await buildApp({ upto: 7 });
  const first = await app.request('/api/v1/cabins?guests=2&limit=2');
  assert.equal(first.status, 200);
  const page = await first.json();
  assert.equal(page.data.length, 2);
  assert.ok(page.total > 2);
  assert.ok(page.links.next.includes('cursor='));
  const second = await (await app.request(page.links.next)).json();
  assert.notEqual(second.data[0].slug, page.data[0].slug);
  const sauna = await (await app.request('/api/v1/cabins?features=sauna')).json();
  assert.ok(sauna.data.every((c) => c.features.includes('sauna')));
});

test('availability returns a quote, field problems are RFC 9457 problem details', async () => {
  const { app } = await buildApp({ upto: 7 });
  const ok = await app.request('/api/v1/cabins/fjellro/availability?checkIn=2026-12-02&checkOut=2026-12-05&guests=4');
  assert.equal(ok.status, 200);
  const a = await ok.json();
  assert.equal(a.available, true);
  assert.equal(a.quote.currency, 'NOK');
  assert.equal(a.quote.total, a.quote.accommodation + a.quote.cleaningFee);

  const bad = await app.request('/api/v1/cabins/fjellro/availability?checkIn=2026-12-05&checkOut=2026-12-02&guests=9');
  assert.equal(bad.status, 422);
  assert.equal(bad.headers.get('content-type'), 'application/problem+json');
  const p = await bad.json();
  assert.match(p.type, /\/problems\/invalid-request$/);
  assert.ok(p.errors.some((e) => e.code === 'checkout_before_checkin'));
  const doc = await app.request(new URL(p.type).pathname);
  assert.equal(doc.status, 200);

  const missing = await app.request('/api/v1/cabins/nowhere');
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).type, /unknown-cabin$/);
});

test('createBooking needs an Idempotency-Key and replays a retry instead of booking twice', async () => {
  const { app, ctx } = await buildApp({ upto: 7 });
  const via = [];
  ctx.events.on('booking.created', (_b, meta) => via.push(meta.via));

  const noKey = await app.request('/api/v1/bookings', json({ ...stay, ...guest }));
  assert.equal(noKey.status, 400);
  assert.match((await noKey.json()).type, /idempotency-key-missing$/);

  const key = { 'idempotency-key': '"8e03978e-40d5-43e8-bc93-6894a57f9324"' };
  const created = await app.request('/api/v1/bookings', json({ ...stay, ...guest }, key));
  assert.equal(created.status, 201);
  const booking = await created.json();
  assert.match(booking.ref, /^NC-[0-9A-Z]{6}$/);

  const retry = await app.request('/api/v1/bookings', json({ ...stay, ...guest }, key));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).ref, booking.ref);

  const reused = await app.request('/api/v1/bookings', json({ ...stay, ...guest, guests: 2 }, key));
  assert.equal(reused.status, 422);
  assert.match((await reused.json()).type, /idempotency-key-reused$/);

  const taken = await app.request('/api/v1/bookings', json({ ...stay, ...guest }, { 'idempotency-key': 'second-attempt-0001' }));
  assert.equal(taken.status, 409);
  assert.match((await taken.json()).type, /not-available$/);
  assert.deepEqual(via, ['api']);
});

test('cancelBooking checks the email and reports the refund', async () => {
  const { app } = await buildApp({ upto: 7 });
  const b = await (await app.request('/api/v1/bookings', json({ ...stay, ...guest }, { 'idempotency-key': 'cancel-test-0001' }))).json();
  const wrong = await app.request(`/api/v1/bookings/${b.ref}/cancel`, json({ email: 'someone@example.com' }));
  assert.equal(wrong.status, 404);
  const done = await app.request(`/api/v1/bookings/${b.ref}/cancel`, json({ email: 'kari@example.com' }));
  assert.equal(done.status, 200);
  const cancelled = await done.json();
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.refund, b.total);
  const again = await app.request(`/api/v1/bookings/${b.ref}/cancel`, json({ email: 'kari@example.com' }));
  assert.equal(again.status, 409);
});

test('RateLimit headers on every call, 429 with Retry-After past the quota', async () => {
  const { app } = await buildApp({ upto: 7, env: { NORDLYS_API_QUOTA: '3' } });
  const headers = { 'x-forwarded-for': '203.0.113.7' };
  const first = await app.request('/api/v1/cabins', { headers });
  assert.equal(first.headers.get('ratelimit-policy'), '"default";q=3;w=60');
  assert.match(first.headers.get('ratelimit'), /^"default";r=2;t=\d+$/);
  await app.request('/api/v1/cabins', { headers });
  await app.request('/api/v1/cabins', { headers });
  const blocked = await app.request('/api/v1/cabins', { headers });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 0);
  assert.equal((await blocked.json()).type, 'https://iana.org/assignments/http-problem-types#quota-exceeded');
});

test('the OpenAPI document matches the routes the app serves', async () => {
  const { app } = await buildApp({ upto: 7, publicOrigin: 'https://nordlys.example' });
  const doc = await (await app.request('/openapi.json')).json();
  assert.equal(doc.openapi, '3.1.2');
  assert.equal(doc.servers[0].url, 'https://nordlys.example/api/v1');
  const ids = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      ids.push(op.operationId);
      assert.ok(op.summary && op.description, `${op.operationId} needs a summary and a description`);
      const concrete = '/api/v1' + path.replace('{slug}', 'fjellro').replace('{ref}', 'NC-AAAAAA');
      const res = await app.request(concrete, { method: method.toUpperCase(), headers: { 'content-type': 'application/json' }, body: method === 'post' ? '{}' : undefined });
      assert.notEqual(res.status, 405, `${method} ${path}`);
      assert.ok(res.status !== 404 || (await res.clone().json()).type, `${method} ${path} is not routed`);
    }
  }
  assert.deepEqual(ids, ['searchCabins', 'getCabin', 'checkAvailability', 'createBooking', 'cancelBooking']);
  // every $ref resolves
  const refs = JSON.stringify(doc).match(/"#\/components\/[^"]+"/g);
  for (const r of refs) {
    const target = JSON.parse(r).slice(2).split('/').reduce((o, k) => o?.[k], doc);
    assert.ok(target, `${r} resolves`);
  }
});

test('the OpenAPI document is valid (checked with @scalar/openapi-parser when it is installed)', async (t) => {
  let validate;
  try {
    ({ validate } = await import('@scalar/openapi-parser'));
  } catch {
    t.skip('npm install --no-save @scalar/openapi-parser to run this check');
    return;
  }
  const { app } = await buildApp({ upto: 7, publicOrigin: 'https://nordlys.example' });
  const doc = await (await app.request('/openapi.json')).json();
  const result = await validate(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('API catalog (RFC 9727): linkset JSON, HEAD with Link, and a Link header on the home page', async () => {
  const { app, ctx } = await buildApp({ upto: 7, publicOrigin: 'https://nordlys.example' });
  const res = await app.request('/.well-known/api-catalog');
  assert.equal(res.headers.get('content-type'), 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
  const { linkset } = await res.json();
  assert.equal(linkset[0].anchor, 'https://nordlys.example/api/v1');
  assert.equal(linkset[0]['service-desc'][0].href, 'https://nordlys.example/openapi.json');
  const head = await app.request('/.well-known/api-catalog', { method: 'HEAD' });
  assert.equal(head.headers.get('link'), '</.well-known/api-catalog>; rel="api-catalog"');
  const home = await app.request('/');
  assert.match(home.headers.get('link'), /<\/\.well-known\/api-catalog>; rel="api-catalog"/);
  const arazzo = await (await app.request('/api/v1/booking.arazzo.json')).json();
  assert.equal(arazzo.arazzo, '1.1.0');
  assert.equal((await ctx.runAudits()).ok, true);
});
