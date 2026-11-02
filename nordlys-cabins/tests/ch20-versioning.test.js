import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers/server.js';
import { checkDeprecation } from '../../chapters/20-evolving-with-the-standards/lib/deprecation.mjs';

const ORIGIN = 'https://nordlys.example';
const build = (now) => buildApp({ upto: 20, publicOrigin: ORIGIN, ...(now ? { now } : {}) });

test('the retired /_app endpoints still answer, with Deprecation, Sunset and Link', async () => {
  const { app } = await build();
  const res = await app.request('/_app/cabins/fjellro');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('deprecation'), '@1793577600'); // 2026-11-02T00:00:00Z
  assert.equal(res.headers.get('sunset'), 'Mon, 03 May 2027 00:00:00 GMT');
  const seen = checkDeprecation(res, new Date('2026-11-10T00:00:00Z'));
  assert.equal(seen.deprecated, true);
  assert.equal(seen.daysLeft, 174);
  assert.equal(seen.policy, `${ORIGIN}/changes.md`);
  assert.equal(seen.successor, `${ORIGIN}/api/v1/cabins/fjellro`);
});

test('the successor really exists', async () => {
  const { app } = await build();
  const res = await app.request('/api/v1/cabins/fjellro');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('deprecation'), null);
});

test('pages and the public API carry no deprecation headers', async () => {
  const { app } = await build();
  for (const path of ['/', '/cabins/fjellro', '/api/v1/cabins']) {
    assert.equal((await app.request(path)).headers.get('deprecation'), null, path);
  }
});

test('the changelog is published and linked from llms.txt', async () => {
  const { app } = await build();
  const changes = await app.request('/changes.md');
  assert.equal(changes.status, 200);
  assert.match(changes.headers.get('content-type'), /^text\/markdown/);
  assert.match(await changes.text(), /They stop working on 2027-05-03/);
  const llms = await (await app.request('/llms.txt')).text();
  assert.match(llms, /\[Agent interface changes\]\(https:\/\/nordlys\.example\/changes\.md\)/);
});

test('after the sunset date the old endpoints answer 410 Gone, with the same headers', async () => {
  const { app } = await build('2027-05-03');
  const res = await app.request('/_app/cabins/fjellro');
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('sunset'), 'Mon, 03 May 2027 00:00:00 GMT');
  assert.equal((await app.request('/api/v1/cabins/fjellro')).status, 200);
});
