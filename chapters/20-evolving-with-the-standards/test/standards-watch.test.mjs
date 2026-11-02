import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, check } from '../standards-watch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, '..', 'fixtures', name), 'utf8');
const { entries } = JSON.parse(readFileSync(join(here, '..', 'watchlist.json'), 'utf8'));
const entry = (id) => entries.find((e) => e.id === id);

// Excerpts of the real pages as fetched on 2 November 2026
const PAGES = {
  mcp: 'mcp-versioning.html', webmcp: 'webmcp-spec.html', webbotauth: 'webbotauth-doc.json',
  'schema-org': 'schema-releases.html', 'llms-txt': 'llmstxt.html', lighthouse: 'lighthouse-latest.json',
};

test('reads each version string from the pages as they looked on 2 November 2026', () => {
  assert.equal(extract(entry('mcp'), fixture(PAGES.mcp)), '2026-07-28');
  assert.equal(extract(entry('webmcp'), fixture(PAGES.webmcp)), '2026-11-02');
  assert.equal(extract(entry('webbotauth'), fixture(PAGES.webbotauth)), '01 / 2026-10-29 10:32:27');
  assert.equal(extract(entry('schema-org'), fixture(PAGES['schema-org'])), '30.1 / 2026-09-16');
  assert.equal(extract(entry('llms-txt'), fixture(PAGES['llms-txt'])), 'August 10, 2026');
  assert.equal(extract(entry('lighthouse'), fixture(PAGES.lighthouse)), '13.6.0');
});

test('reports same, CHANGED and ERROR', async () => {
  const fake = async (url) => {
    if (url.includes('lighthouse')) return new Response(JSON.stringify({ version: '13.7.0' }));
    if (url.includes('modelcontextprotocol')) return new Response(fixture(PAGES.mcp));
    return new Response('gone', { status: 404 });
  };
  const state = { mcp: { value: '2026-07-28' }, lighthouse: { value: '13.6.0' } };
  const results = await check([entry('mcp'), entry('lighthouse'), entry('llms-txt')], state, fake);
  assert.deepEqual(results.map((r) => r.status), ['same', 'CHANGED', 'ERROR']);
  assert.equal(results[1].value, '13.7.0');
  assert.match(results[2].error, /HTTP 404/);
});

test('a page that no longer matches is an error, not a silent pass', () => {
  assert.throws(() => extract(entry('mcp'), '<p>The protocol has moved.</p>'), /pattern not found/);
  assert.throws(() => extract(entry('lighthouse'), '{}'), /missing field/);
});
