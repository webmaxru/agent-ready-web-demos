import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, cookieJar, formBody } from './helpers/server.js';
import { prefersMarkdown } from '../layers/06-agent-content/negotiate.js';

const ORIGIN = 'https://nordlys.example';
const MD = { headers: { accept: 'text/markdown' } };
const CHROME = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

test('negotiation: only an explicit, equal or higher text/markdown wins', () => {
  assert.equal(prefersMarkdown(CHROME), false);
  assert.equal(prefersMarkdown('*/*'), false);
  assert.equal(prefersMarkdown(undefined), false);
  assert.equal(prefersMarkdown('text/markdown'), true);
  assert.equal(prefersMarkdown('text/markdown, text/html, */*'), true);
  assert.equal(prefersMarkdown('text/markdown, text/html;q=0.9'), true);
  assert.equal(prefersMarkdown('text/html, text/markdown;q=0.5'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0'), false);
});

test('the home page answers Markdown to agents and HTML to browsers (isitagentready markdownNegotiation)', async () => {
  const { app } = await buildApp({ upto: 6, publicOrigin: ORIGIN });
  const md = await app.request('/', MD);
  assert.equal(md.status, 200);
  assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(md.headers.get('vary'), /Accept/);
  assert.equal(md.headers.get('content-signal'), 'search=yes, ai-input=yes, ai-train=no');
  assert.match(await md.text(), /^---\ntitle: "Nordlys Cabins"/);

  const html = await app.request('/', { headers: { accept: CHROME } });
  assert.match(html.headers.get('content-type'), /^text\/html/);
  assert.match(html.headers.get('vary'), /Accept/);
  const link = html.headers.get('link');
  assert.match(link, /<https:\/\/nordlys\.example\/index\.md>; rel="alternate"; type="text\/markdown"/);
  assert.match(link, /<https:\/\/nordlys\.example\/llms\.txt>; rel="describedby"/);
  assert.match(await html.text(), /<link rel="alternate" type="text\/markdown" href="\/index\.md">/);
});

test('.md URLs return the same Markdown, and only for public pages', async () => {
  const { app } = await buildApp({ upto: 6, publicOrigin: ORIGIN });
  for (const path of ['/cabins/fjellro', '/cabins', '/guide', '/guide/sauna-and-winter-swimming', '/faq', '/contact']) {
    const negotiated = await (await app.request(path, MD)).text();
    const byUrl = await app.request(`${path}.md`);
    assert.equal(byUrl.status, 200, path);
    assert.equal(await byUrl.text(), negotiated, path);
  }
  assert.equal((await app.request('/index.md')).status, 200);
  assert.equal((await app.request('/nope.md')).status, 404);
  assert.equal((await app.request('/book/fjellro.md')).status, 404);

  // Signed in or not, a .md URL never shows private pages.
  const jar = cookieJar();
  jar.store(await app.request('/login', { ...formBody({ email: 'ingrid@nordlys.example', password: 'nordlys-demo', next: '/account/bookings' }) }));
  const mine = await app.request('/account/bookings', { headers: jar.headers({ accept: 'text/markdown' }) });
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get('content-type'), /^text\/html/); // signed-in pages stay HTML
  assert.equal((await app.request('/account/bookings.md', { headers: jar.headers() })).status, 404);
});

test('the Markdown says what the HTML and the JSON-LD say', async () => {
  const { app, store } = await buildApp({ upto: 6, publicOrigin: ORIGIN });
  const nok = (n) => `NOK ${new Intl.NumberFormat('en-GB').format(n)}`;
  for (const cabin of store.cabins()) {
    const md = await (await app.request(`/cabins/${cabin.slug}.md`)).text();
    const html = await (await app.request(`/cabins/${cabin.slug}`)).text();
    for (const price of [cabin.nightlyRate, cabin.weekendRate, cabin.cleaningFee]) {
      assert.ok(md.includes(nok(price)) && html.includes(nok(price)), `${cabin.slug} ${price}`);
    }
    assert.ok(md.includes(`Sleeps: ${cabin.maxGuests} guests`));
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
    const offer = ld['@graph'][0].makesOffer.priceSpecification;
    assert.deepEqual(offer.map((p) => p.price), [cabin.nightlyRate, cabin.weekendRate, cabin.cleaningFee]);
    assert.ok(!/<nav|<form|<script/.test(md), 'no navigation, forms or scripts in Markdown');
    assert.ok(md.length < html.length / 2, `${cabin.slug}: Markdown is less than half the size`);
  }
});

test('llms.txt passes the Lighthouse llms-txt rules and every link works', async () => {
  const { app } = await buildApp({ upto: 6, publicOrigin: ORIGIN });
  const res = await app.request('/llms.txt');
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /^# Nordlys Cabins$/m); // an H1
  assert.ok(body.length >= 50); // at least 50 characters
  const links = [...body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 10); // at least one Markdown link (we have many)
  for (const url of links) {
    const r = await app.request(new URL(url).pathname);
    assert.equal(r.status, 200, url);
  }
});

test('the guide has an Atom feed with one entry per article', async () => {
  const { app, store } = await buildApp({ upto: 6, publicOrigin: ORIGIN });
  const res = await app.request('/guide/feed.xml');
  const xml = await res.text();
  assert.match(res.headers.get('content-type'), /^application\/atom\+xml/);
  assert.equal((xml.match(/<entry>/g) ?? []).length, store.articles().length);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/nordlys\.example\/guide\/feed\.xml"\/>/);
  assert.match(await (await app.request('/guide')).text(), /<link rel="alternate" type="application\/atom\+xml"/);
});

test('the layer audit passes', async () => {
  const { ctx } = await buildApp({ upto: 6, publicOrigin: ORIGIN });
  const { results } = await ctx.runAudits();
  const mine = results.find((r) => r.name === 'agent-content');
  assert.ok(mine.ok, JSON.stringify(mine.checks));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
});
