import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { discoverLayers, selectLayers } from '../src/layers.js';
import { loadConfig } from '../src/config.js';
import { buildApp, formBody } from './helpers/server.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/layers/', import.meta.url));
const BROKEN = fileURLToPath(new URL('./fixtures/broken-layers/', import.meta.url));
const ORDERED = fileURLToPath(new URL('./fixtures/ordered-layers/', import.meta.url));
const SAME_ORDER = fileURLToPath(new URL('./fixtures/same-order-layers/', import.meta.url));

test('config: UPTO and VARIANT from flags and env, flags win', () => {
  assert.equal(loadConfig({ argv: [], env: {} }).upto, Infinity);
  assert.equal(loadConfig({ argv: [], env: { UPTO: '6' } }).upto, 6);
  assert.equal(loadConfig({ argv: ['--upto=3'], env: { UPTO: '6' } }).upto, 3);
  assert.equal(loadConfig({ argv: ['--upto=all'], env: {} }).upto, Infinity);
  assert.equal(loadConfig({ argv: ['--variant=legacy'], env: {} }).variant, 'legacy');
  assert.equal(loadConfig({ argv: [], env: { PORT: '8081' } }).port, 8081);
  assert.throws(() => loadConfig({ argv: ['--variant=fancy'], env: {} }), /VARIANT/);
  assert.throws(() => loadConfig({ argv: ['--upto=x'], env: {} }), /UPTO/);
});

test('discovery: layers are found, sorted and filtered by UPTO', async () => {
  const layers = await discoverLayers(FIXTURES);
  assert.deepEqual(layers.map((l) => l.id), ['03-fixture-head', '07-fixture-extend']);
  assert.deepEqual(selectLayers(layers, { upto: 5 }).map((l) => l.id), ['03-fixture-head']);
  assert.deepEqual(selectLayers(layers, { upto: 2 }), []);
  assert.equal(selectLayers(layers, { upto: Infinity }).length, 2);
});

test('discovery: a layer whose chapter does not match its folder is rejected', async () => {
  await assert.rejects(discoverLayers(BROKEN), /says chapter 4, but its folder starts with 05/);
});

test('discovery: inside a chapter, layers run by their explicit order, not by folder name', async () => {
  const layers = await discoverLayers(ORDERED);
  assert.deepEqual(layers.map((l) => [l.id, l.chapter, l.order]), [['03-gamma', 3, 1], ['04-zeta', 4, 1], ['04-alpha', 4, 2]]);
  assert.deepEqual(selectLayers(layers, { upto: 3 }).map((l) => l.id), ['03-gamma']);
});

test('discovery: two layers of one chapter with the same order are rejected', async () => {
  await assert.rejects(discoverLayers(SAME_ORDER), /06-one and 06-two are both chapter 6, order 1/);
});

test('discovery: the real layers run in chapter, then order', async () => {
  const layers = await discoverLayers();
  const keys = layers.map((l) => [l.chapter, l.order]);
  const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(keys, sorted);
  assert.deepEqual(
    layers.filter((l) => l.chapter === 8).map((l) => l.id),
    ['08-public-api', '08-mcp-server', '08-discovery']
  );
  assert.deepEqual(
    layers.filter((l) => l.chapter === 11).map((l) => l.id),
    ['11-commerce', '11-oauth', '11-consent']
  );
});

for (let upto = 0; upto <= 12; upto++) {
  test(`--upto=${upto} starts, enables only chapters 0..${upto}, and every audit passes`, async () => {
    const { app, ctx, layers } = await buildApp({ upto });
    assert.ok(layers.every((l) => l.chapter <= upto));
    assert.equal((await app.request('/')).status, 200);
    const audit = await ctx.runAudits();
    assert.equal(audit.ok, true, JSON.stringify(audit.results.filter((r) => !r.ok)));
  });
}

test('discovery: the real layers folder loads, and the example layer is off by default', async () => {
  const { layers } = await buildApp();
  assert.equal(layers.some((l) => l.id === '00-example'), false);
  const on = await buildApp({ upto: 0, env: { NORDLYS_EXAMPLE: '1' } });
  assert.equal(on.layers.some((l) => l.id === '00-example'), true);
});

test('hooks: head, headers, static files, routes and precedence across layers', async () => {
  const { app } = await buildApp({ layersDir: FIXTURES });
  const home = await app.request('/');
  assert.equal(home.headers.get('x-fixture-3'), 'yes');
  assert.match(await home.text(), /<meta name="fixture-3" content="yes">/);
  const robots = await app.request('/robots.txt');
  assert.equal(robots.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await robots.text(), 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n');
  const api = await app.request('/api/ping');
  assert.deepEqual(await api.json(), { pong: true, layers: ['03-fixture-head', '07-fixture-extend'] });
  assert.equal(api.headers.get('x-fixture-3'), null, 'a later layer can delete a header');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('hooks: UPTO=3 leaves out the chapter 7 layer', async () => {
  const { app } = await buildApp({ layersDir: FIXTURES, upto: 3 });
  assert.equal(await (await app.request('/robots.txt')).text(), 'User-agent: *\nAllow: /\n');
  assert.equal((await app.request('/api/ping')).status, 404);
});

test('hooks: a second layer cannot silently take over a static path', async () => {
  const layers = [
    { id: '01-a', chapter: 1, name: 'a', description: '', enabled: true, register: (app, ctx) => ctx.staticFile('/llms.txt', 'a') },
    { id: '02-b', chapter: 2, name: 'b', description: '', enabled: true, register: (app, ctx) => ctx.staticFile('/llms.txt', 'b') },
  ];
  const { createApp } = await import('../src/app.js');
  await assert.rejects(createApp({ overrides: { now: '2026-11-10' }, layers }), /already served by layer 01-a/);
});

test('example layer: every hook works', async () => {
  const { app, ctx, tokenFor } = await buildApp({ upto: 0, env: { NORDLYS_EXAMPLE: '1' } });
  const home = await app.request('/');
  const homeHtml = await home.text();
  assert.match(homeHtml, /<meta name="nordlys-example" content="on">/);
  assert.match(homeHtml, /<script type="module" src="\/layers\/00-example\/example.js"><\/script>/);
  assert.match(homeHtml, /The example layer is on\./);
  assert.equal(home.headers.get('x-nordlys-member'), 'anonymous');
  const cabin = await app.request('/cabins/fjellro');
  assert.equal(cabin.headers.get('x-nordlys-example'), 'cabin page');
  assert.match(await cabin.text(), /<script type="application\/ld\+json">[\s\S]*"name": "Fjellro"/);
  assert.equal((await app.request('/layers/00-example/example.js')).status, 200);
  assert.equal(await (await app.request('/example.txt')).text(), 'Hello from the example layer.\n');
  const wk = await app.request('http://nordlys.test/.well-known/nordlys-example');
  assert.equal(wk.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await wk.json(), { origin: 'http://nordlys.test/' });
  assert.equal((await (await app.request('/example/api/cabins')).json()).length, 6);
  assert.equal((await app.request('/mcp', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await app.request('/', { headers: { 'x-example-block': '1' } })).status, 403);
  const form = await (await app.request('/book/fjellro?checkIn=2026-12-02&checkOut=2026-12-05&guests=2')).text();
  assert.match(form, /<form id="booking"[^>]* data-example="booking-form"/);
  assert.match(form, /id="booking-email"[^>]* data-example="email-field"/);
  const seen = [];
  ctx.events.on('booking.created', (b) => seen.push(b.ref));
  const res = await app.request('/book/fjellro', formBody({ checkIn: '2026-12-02', checkOut: '2026-12-05', guests: '2', name: 'Ev Ent', email: 'ev@example.com', acceptTerms: 'on' }));
  assert.equal(res.status, 303);
  assert.equal(seen.length, 1);
  assert.ok(tokenFor(seen[0]));
  const audit = await ctx.runAudits();
  assert.equal(audit.ok, true, JSON.stringify(audit));
  const viaHttp = await app.request('/__audit');
  assert.equal(viaHttp.status, 200);
  const described = await (await app.request('/__layers')).json();
  assert.equal(described.mcp.path, '/mcp');
  assert.ok(described.staticFiles.some((f) => f.path === '/example.txt' && f.layer === '00-example'));
});

test('audit: a failing check makes /__audit answer 500', async () => {
  const layers = [{ id: '01-a', chapter: 1, name: 'a', description: '', enabled: true, register: (app, ctx) => ctx.audit('always fails', () => [{ id: 'x', ok: false }]) }];
  const { createApp } = await import('../src/app.js');
  const { app } = await createApp({ overrides: { now: '2026-11-10' }, layers });
  const r = await app.request('/__audit');
  assert.equal(r.status, 500);
  assert.equal((await r.json()).results[0].name, 'always fails');
});
