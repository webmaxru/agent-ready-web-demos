// Chapter 9: the WebMCP layer without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers/server.js';

test('the layer audits pass', async () => {
  const { ctx } = await buildApp({ upto: 9 });
  const { ok, results } = await ctx.runAudits();
  assert.ok(ok, JSON.stringify(results.filter((r) => !r.ok)));
});

test('forms carry declarative tool attributes, the login form does not', async () => {
  const { app } = await buildApp({ upto: 9 });
  const list = await (await app.request('/cabins')).text();
  assert.match(list, /<form id="search"[^>]*toolname="search_cabins"[^>]*toolautosubmit/);
  const book = await (await app.request('/book/fjellro?checkIn=2026-12-01&checkOut=2026-12-04&guests=2')).text();
  assert.match(book, /<form id="booking"[^>]*toolname="book_cabin"/);
  assert.doesNotMatch(book, /<form id="booking"[^>]*toolautosubmit/);
  assert.match(book, /id="booking-acceptTerms"[^>]*toolparamdescription="Leave unchecked/);
  const login = await (await app.request('/login')).text();
  assert.doesNotMatch(login, /<form id="login"[^>]*toolname=/);
});

test('every page of the clean front end loads the tools and their styles', async () => {
  const { app } = await buildApp({ upto: 9 });
  for (const path of ['/', '/cabins', '/cabins/fjellro', '/guide', '/faq']) {
    const page = await (await app.request(path)).text();
    assert.ok(page.includes('<script type="module" src="/layers/09-webmcp/tools.js"'), path);
    assert.ok(page.includes('href="/layers/09-webmcp/webmcp.css"'), path);
  }
});

test('the legacy front end gets nothing from this layer', async () => {
  const { app } = await buildApp({ upto: 9, variant: 'legacy' });
  const page = await (await app.request('/cabins/fjellro')).text();
  assert.ok(!page.includes('/layers/09-webmcp/'));
});

test('/_tools/cabins filters with the store and adds totals for dates', async () => {
  const { app, store } = await buildApp({ upto: 9 });
  const all = await (await app.request('/_tools/cabins')).json();
  assert.equal(all.count, store.cabins().length);
  const sauna = await (await app.request('/_tools/cabins?features=sauna&guests=4')).json();
  assert.deepEqual(sauna.cabins.map((c) => c.slug), store.searchCabins({ features: ['sauna'], guests: 4 }).map((c) => c.slug));
  const dated = await (await app.request('/_tools/cabins?checkIn=2026-12-01&checkOut=2026-12-04')).json();
  for (const cabin of dated.cabins) assert.equal(typeof cabin.totalNok, 'number');
});

test('/_tools/availability returns stable error codes as data', async () => {
  const { app } = await buildApp({ upto: 9 });
  const res = await app.request('/_tools/availability?cabin=fjellro&checkIn=2026-12-01&checkOut=2026-12-02&guests=2');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, false);
  assert.ok(body.errors.some((e) => e.code === 'min_nights'));
});

test('/_tools/cabins/:slug explains an unknown slug', async () => {
  const { app } = await buildApp({ upto: 9 });
  const res = await app.request('/_tools/cabins/no-such-cabin');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'unknown_cabin');
});
