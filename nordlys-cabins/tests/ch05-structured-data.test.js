import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import jsonld from 'jsonld';
import { buildApp } from './helpers/server.js';
import { checkVocabulary } from '../layers/05-structured-data/schema-check.js';

const ORIGIN = 'https://nordlys.example';
const PAGES = ['/', '/cabins', '/cabins/fjellro', '/cabins/senja-sjobu', '/guide/northern-lights-from-a-cabin', '/faq'];
const vocab = JSON.parse(await readFile(new URL('../layers/05-structured-data/schemaorg-subset.json', import.meta.url)));

// Offline JSON-LD: resolve the schema.org context to a minimal local stand-in.
const documentLoader = async (url) => {
  if (url.replace(/\/$/, '') === 'https://schema.org') return { documentUrl: url, document: { '@context': { '@vocab': 'https://schema.org/' } } };
  throw new Error(`no network in tests: ${url}`);
};

async function blocks(path, app) {
  const html = await (await app.request(path)).text();
  return { html, data: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])) };
}

test('every content page carries JSON-LD that expands (jsonld 9.0.0)', async () => {
  const { app } = await buildApp({ upto: 5, publicOrigin: ORIGIN });
  for (const path of PAGES) {
    const { data } = await blocks(path, app);
    assert.equal(data.length, 1, path);
    const expanded = await jsonld.expand(data[0], { documentLoader, safe: true });
    assert.ok(expanded.length > 0, path);
  }
});

test('every type and property exists in schema.org and fits its type', async () => {
  const { app } = await buildApp({ upto: 5, publicOrigin: ORIGIN });
  for (const path of PAGES) {
    const { data } = await blocks(path, app);
    assert.deepEqual(checkVocabulary(data[0], vocab), [], path);
  }
  // and it catches a typical mistake: a property of the accommodation put on the rental
  assert.deepEqual(checkVocabulary({ '@type': 'VacationRental', bed: '2 double beds' }, vocab), ['bed is not a property of VacationRental']);
});

test('the markup says what the page says', async () => {
  const { app, store } = await buildApp({ upto: 5, publicOrigin: ORIGIN });
  const cabin = store.getCabin('fjellro');
  const { html, data } = await blocks('/cabins/fjellro', app);
  const rental = data[0]['@graph'].find((n) => n['@type'] === 'VacationRental');
  const [weekday, weekend, cleaning] = rental.makesOffer.priceSpecification;
  for (const amount of [weekday.price, weekend.price, cleaning.price]) {
    assert.ok(html.includes(`NOK ${new Intl.NumberFormat('en-GB').format(amount)}`), `price ${amount} is visible`);
  }
  assert.equal(weekday.price, cabin.nightlyRate);
  const reviews = store.reviewsFor('fjellro');
  assert.equal(rental.review.length, reviews.length);
  assert.ok(html.includes(`Average guest rating ${rental.aggregateRating.ratingValue} out of 5`));
  assert.ok(html.includes(`${cabin.geo.latitude}° N`));
  assert.equal(rental.potentialAction.target.urlTemplate,
    `${ORIGIN}/book/fjellro?checkIn={checkIn}&checkOut={checkOut}&guests={guests}`);
});

test('the ReserveAction URL template is a working deep link', async () => {
  const { app, store } = await buildApp({ upto: 5 });
  const { data } = await blocks('/cabins/fjellro', app);
  const template = data[0]['@graph'][0].potentialAction.target.urlTemplate;
  const url = new URL(template.replace('{checkIn}', '2026-12-01').replace('{checkOut}', '2026-12-04').replace('{guests}', '2'));
  const res = await app.request(url.pathname + url.search);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /value="2026-12-01"/);
  assert.ok(store.checkAvailability({ cabin: 'fjellro', checkIn: '2026-12-01', checkOut: '2026-12-04', guests: 2 }).available);
});

test('/ask answers with schema.org objects (NLWeb-shaped)', async () => {
  const { app } = await buildApp({ upto: 5, publicOrigin: ORIGIN });
  const res = await app.request('/ask?query=cabin%20with%20a%20sauna%20and%20hot%20tub');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.results.length > 0);
  const top = body.results[0];
  assert.deepEqual(Object.keys(top), ['url', 'name', 'site', 'score', 'description', 'schema_object']);
  assert.equal(top.schema_object['@type'], 'VacationRental');
  const { data } = await blocks(new URL(top.url).pathname, app);
  assert.deepEqual(top.schema_object, data[0]['@graph'][0]);
  assert.equal((await app.request('/ask')).status, 400);
});

test('the layer audit passes', async () => {
  const { ctx } = await buildApp({ upto: 5, publicOrigin: ORIGIN });
  const { results } = await ctx.runAudits();
  const mine = results.find((r) => r.name === 'structured-data');
  assert.ok(mine.ok, JSON.stringify(mine.checks));
});
