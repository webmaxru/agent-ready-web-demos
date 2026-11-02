import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, startServer } from './helpers/server.js';
import { runChecks } from '../../chapters/02-your-first-agent-ready-page/agent-ready-check.mjs';

test('robots.txt allows the public site and points to the sitemap', async () => {
  const { app } = await buildApp({ upto: 2, publicOrigin: 'https://nordlys.example' });
  const res = await app.request('/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const body = await res.text();
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Disallow: \/account\/$/m);
  assert.match(body, /^Sitemap: https:\/\/nordlys\.example\/sitemap\.xml$/m);
});

test('sitemap.xml lists every cabin and guide article', async () => {
  const { app, store } = await buildApp({ upto: 2, publicOrigin: 'https://nordlys.example' });
  const res = await app.request('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  const xml = await res.text();
  for (const cabin of store.cabins()) assert.ok(xml.includes(`<loc>https://nordlys.example/cabins/${cabin.slug}</loc>`));
  for (const article of store.articles()) assert.ok(xml.includes(`<loc>https://nordlys.example/guide/${article.slug}</loc>`));
});

test('the availability form declares the check_availability tool', async () => {
  const { app } = await buildApp({ upto: 2 });
  const html = await (await app.request('/cabins/fjellro')).text();
  assert.match(html, /<form id="availability"[^>]* toolname="check_availability" tooldescription="[^"]+" toolautosubmit>/);
  assert.match(html, /id="availability-checkIn"[^>]* toolparamdescription="Arrival date"/);
});

test('before Chapter 2 there is no robots.txt, sitemap or tool', async () => {
  const { app } = await buildApp({ upto: 1 });
  assert.equal((await app.request('/robots.txt')).status, 404);
  assert.equal((await app.request('/sitemap.xml')).status, 404);
  assert.doesNotMatch(await (await app.request('/cabins/fjellro')).text(), /toolname=/);
});

test('the layer audits pass', async () => {
  const { ctx } = await buildApp({ upto: 2 });
  const { ok, results } = await ctx.runAudits();
  assert.ok(ok, JSON.stringify(results));
});

test('agent-ready-check: the legacy baseline is level 0', async () => {
  const server = await startServer({ variant: 'legacy', upto: 0 });
  try {
    const report = await runChecks(`${server.url}/cabins/fjellro`);
    assert.equal(report.level, 0);
    assert.equal(report.checks.discoverability.robotsTxt.status, 'fail');
    assert.equal(report.checks.discovery.webMcp.status, 'fail');
    assert.equal(report.checks.discoverability.dnsAid.status, 'unableToCheck');
  } finally {
    await server.close();
  }
});

test('agent-ready-check: after Chapter 2 the site is level 1 with one tool', async () => {
  const server = await startServer({ upto: 2 });
  try {
    const report = await runChecks(`${server.url}/cabins/fjellro`);
    assert.equal(report.level, 1);
    assert.equal(report.level_name, 'Basic Web Presence');
    const { discoverability, botAccessControl, discovery } = report.checks;
    assert.equal(discoverability.robotsTxt.status, 'pass');
    assert.equal(discoverability.sitemap.status, 'pass');
    assert.equal(discoverability.linkHeaders.status, 'fail');
    assert.equal(botAccessControl.robotsTxtAiRules.status, 'pass'); // the wildcard group counts
    assert.equal(botAccessControl.contentSignals.status, 'fail');
    assert.equal(discovery.webMcp.status, 'pass');
    assert.deepEqual(report.next_level.requirements, ['contentSignals']);
  } finally {
    await server.close();
  }
});
