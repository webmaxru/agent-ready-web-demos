import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers/server.js';
import { signatureFrom } from '../layers/19-agent-analytics/index.js';

const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot';
const CHATGPT_USER = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

// Requests arrive through app.request(), so the client address comes from X-Forwarded-For.
const build = (env = {}) => buildApp({ upto: 19, env: { NORDLYS_TRUST_PROXY: '1', ...env } });
const visit = (app, path, ua, ip, extra = {}) =>
  app.request(path, { ...extra, headers: { 'user-agent': ua, 'x-forwarded-for': ip, ...(extra.headers ?? {}) } });
const stats = async (app) => (await app.request('/__agents.json')).json();

test('a crawler from its published range is counted by purpose, with its evidence', async () => {
  const { app } = await build();
  await visit(app, '/cabins/fjellro', GPTBOT, '132.196.86.1'); // inside openai.com/gptbot.json (2 Nov 2026)
  const s = await stats(app);
  assert.equal(s.classes.find((c) => c.name === 'training').requests, 1);
  assert.deepEqual(s.agents[0], { agent: 'GPTBot', class: 'training', evidence: 'ip-range', requests: 1 });
});

test('the same user agent from another network is labelled spoofed', async () => {
  const { app } = await build();
  await visit(app, '/cabins/fjellro', GPTBOT, '198.51.100.250');
  const s = await stats(app);
  assert.equal(s.classes.find((c) => c.name === 'training').requests, 0);
  assert.equal(s.agents[0].evidence, 'spoofed');
});

test('a referral from ChatGPT is counted against OpenAI crawling', async () => {
  const { app } = await build();
  await visit(app, '/cabins/fjellro', GPTBOT, '132.196.86.1');
  await visit(app, '/cabins/senja-sjobu', GPTBOT, '132.196.86.1');
  await visit(app, '/cabins/fjellro', CHROME, '198.51.100.7', { headers: { referer: 'https://chatgpt.com/' } });
  const openai = (await stats(app)).platforms.find((p) => p.name === 'openai');
  assert.equal(openai.crawls, 2);
  assert.equal(openai.referrals, 1);
  assert.equal(openai.crawlToRefer, 2);
});

test('a booking is attributed to the kind of visitor that made it', async () => {
  const { app } = await build();
  const body = new URLSearchParams({ checkIn: '2026-12-02', checkOut: '2026-12-05', guests: '2', name: 'Kari Nordmann',
    email: 'kari@example.com', phone: '+47 400 00 000', acceptTerms: 'on' });
  const res = await visit(app, '/book/fjellro', CHATGPT_USER, '104.208.184.193', {
    method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 303);
  const s = await stats(app);
  assert.equal(s.bookings.total, 1);
  assert.deepEqual(s.bookings.byClass, { 'user-fetch': 1 });
  assert.equal(s.bookings.recent[0].agent, 'ChatGPT-User');
});

test('the dashboard is a plain page that is not indexed, and can require a token', async () => {
  const { app } = await build();
  const res = await app.request('/__agents');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  const page = await res.text();
  assert.match(page, /<caption>Requests by kind of visitor<\/caption>/);
  assert.doesNotMatch(page, /<script/);

  const locked = (await build({ NORDLYS_ANALYTICS_TOKEN: 'demo-token' })).app;
  assert.equal((await locked.request('/__agents.json')).status, 401);
  assert.equal((await locked.request('/__agents.json', { headers: { authorization: 'Bearer demo-token' } })).status, 200);
});

test("layer 15's labels map to signature results", () => {
  assert.deepEqual(signatureFrom({ kind: 'verified-agent', agent: 'https://chatgpt.com' }), { signature: 'verified', signatureAgent: 'https://chatgpt.com' });
  assert.deepEqual(signatureFrom({ kind: 'invalid-signature', reason: 'expired' }), { signature: 'invalid', signatureAgent: null });
  assert.deepEqual(signatureFrom({ kind: 'claimed-agent' }), { signature: null, signatureAgent: null });
  assert.deepEqual(signatureFrom(undefined), { signature: null, signatureAgent: null });
});

test('the layer audit passes', async () => {
  const { ctx } = await build();
  const { results } = await ctx.runAudits();
  const checks = results.flatMap((r) => r.checks ?? []);
  assert.ok(checks.some((ch) => ch.id === 'agents-spoofed-gptbot' && ch.ok));
});
