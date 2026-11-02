import { test } from 'node:test';
import assert from 'node:assert/strict';
import robotsParser from 'robots-parser';
import { buildApp } from './helpers/server.js';
import { buildRobotsTxt } from '../layers/04-crawler-controls/robots.js';
import { POLICY } from '../layers/04-crawler-controls/policy.js';

const ORIGIN = 'https://nordlys.example';
const at = (path) => `${ORIGIN}${path}`;

async function robots() {
  const { app } = await buildApp({ upto: 4, publicOrigin: ORIGIN });
  const res = await app.request('/robots.txt');
  return { res, text: await res.text(), app };
}

test('robots.txt is served as text/plain and names the sitemap', async () => {
  const { res, text } = await robots();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(text, /^Sitemap: https:\/\/nordlys\.example\/sitemap\.xml$/m);
  assert.match(text, /^Content-Signal: search=yes, ai-input=yes, ai-train=no$/m);
});

test('the policy holds for each kind of agent (robots-parser 3.0.1)', async () => {
  const { text } = await robots();
  const r = robotsParser(at('/robots.txt'), text);
  // Search engines and AI search crawlers: public pages yes, booking flow no
  for (const ua of ['Googlebot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot']) {
    assert.equal(r.isAllowed(at('/cabins/fjellro'), ua), true, ua);
    assert.equal(r.isAllowed(at('/book/fjellro'), ua), false, ua);
  }
  // Training crawlers and control tokens: nothing
  for (const ua of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']) {
    assert.equal(r.isAllowed(at('/'), ua), false, ua);
    assert.equal(r.isAllowed(at('/guide/northern-lights-from-a-cabin'), ua), false, ua);
  }
  // Assistants acting for a person: the booking flow is open, accounts are not
  for (const ua of ['ChatGPT-User', 'Claude-User', 'Perplexity-User']) {
    assert.equal(r.isAllowed(at('/book/fjellro'), ua), true, ua);
    assert.equal(r.isAllowed(at('/account/bookings'), ua), false, ua);
  }
  assert.deepEqual(r.getSitemaps(), [at('/sitemap.xml')]);
});

test('every group carries the content signals', async () => {
  const { text } = await robots();
  const groups = text.split(/\n\s*\n/).filter((g) => /^user-agent:/im.test(g));
  assert.ok(groups.length >= 3);
  for (const g of groups) assert.match(g, /^Content-Signal: /m);
});

test('the sitemap lists public pages with real lastmod dates only', async () => {
  const { app } = await robots();
  const res = await app.request('/sitemap.xml');
  const xml = await res.text();
  assert.match(res.headers.get('content-type'), /xml/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.includes(at('/cabins/fjellro')));
  assert.ok(locs.includes(at('/guide/northern-lights-from-a-cabin')));
  assert.ok(!locs.some((l) => l.includes('/book/') || l.includes('/account/')));
  assert.match(xml, /<loc>https:\/\/nordlys\.example\/guide\/northern-lights-from-a-cabin<\/loc>\n\s*<lastmod>2026-09-15<\/lastmod>/);
  assert.doesNotMatch(xml, /<loc>https:\/\/nordlys\.example\/cabins\/fjellro<\/loc>\n\s*<lastmod>/);
});

test('private and transactional pages send X-Robots-Tag: noindex', async () => {
  const { app } = await robots();
  assert.equal((await app.request('/book/fjellro')).headers.get('x-robots-tag'), 'noindex');
  assert.equal((await app.request('/login')).headers.get('x-robots-tag'), 'noindex');
  assert.equal((await app.request('/cabins/fjellro')).headers.get('x-robots-tag'), null);
});

test('the experimental aipref lines appear only when switched on', () => {
  const off = buildRobotsTxt(POLICY, { sitemapUrl: at('/sitemap.xml') });
  assert.doesNotMatch(off, /Content-Usage|__usage_ai-training/);
  const on = buildRobotsTxt({ ...POLICY, experimental: { contentUsage: true, trainingGroup: true } }, { sitemapUrl: at('/sitemap.xml') });
  assert.match(on, /^Content-Usage: train-ai=n, ai-use=y, search=y$/m);
  const r = robotsParser(at('/robots.txt'), on);
  assert.equal(r.isAllowed(at('/'), '__usage_ai-training'), false);
});

test('the layer audits mirror the isitagentready pass rules', async () => {
  const { ctx } = await buildApp({ upto: 4, publicOrigin: ORIGIN });
  const { results } = await ctx.runAudits();
  const mine = results.find((r) => r.name === 'crawler-controls');
  assert.ok(mine.ok, JSON.stringify(mine.checks));
});
