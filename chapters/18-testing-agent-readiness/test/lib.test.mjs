// Unit tests for the CI helpers: no server, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, checkBudget } from '../scripts/lib.mjs';
import { parseRobots, isAllowed, lintLlmsTxt } from '../scripts/robots-llms.mjs';
import { lintPage } from '../scripts/structured-data.mjs';
import { compareReadiness } from '../scripts/readiness.mjs';

test('median ignores not-applicable runs', () => {
  assert.equal(median([1, 0, 1]), 1);
  assert.equal(median([0.5, 1, 0.75, 1]), 0.875);
  assert.equal(median([null, null, null]), null);
});

test('a budget fails on a drop, on a missing audit, and when an N/A audit starts to count', () => {
  const rows = checkBudget(
    { 'agent-accessibility-tree': 0, 'webmcp-schema-validity': 0.5, 'webmcp-form-coverage': 1 },
    { 'agent-accessibility-tree': 1, 'webmcp-schema-validity': 0.5, 'webmcp-form-coverage': 'na', 'llms-txt': 1 }
  );
  assert.deepEqual(rows.map((r) => [r.id, r.ok]), [
    ['agent-accessibility-tree', false], ['webmcp-schema-validity', true], ['webmcp-form-coverage', false], ['llms-txt', false],
  ]);
});

test('robots.txt: the group that names the agent wins, then the longest rule', () => {
  const robots = parseRobots([
    'User-agent: *', 'Allow: /', 'Disallow: /book/',
    '', 'User-agent: Claude-User', 'User-agent: ChatGPT-User', 'Allow: /', 'Disallow: /account/',
    '', 'User-agent: GPTBot', 'Disallow: /', 'Sitemap: https://nordlys.example/sitemap.xml',
  ].join('\n'));
  assert.equal(isAllowed(robots, 'Claude-User', '/book/fjellro'), true);
  assert.equal(isAllowed(robots, 'Googlebot', '/book/fjellro'), false);
  assert.equal(isAllowed(robots, 'GPTBot', '/cabins'), false);
  assert.equal(isAllowed(robots, 'chatgpt-user', '/account/agent-activity'), false);
  assert.deepEqual(robots.sitemaps, ['https://nordlys.example/sitemap.xml']);
  assert.deepEqual(parseRobots('User-agent: *\nDisalow: /x').unknown, ['line 2: Disalow: /x']);
});

test('llms.txt needs a title, a summary and links', () => {
  assert.deepEqual(lintLlmsTxt('# Nordlys Cabins\n\n> Six cabins in Norway.\n\n- [Fjellro](/cabins/fjellro.md): sleeps 6'), []);
  assert.deepEqual(lintLlmsTxt('Nordlys Cabins, six cabins in Norway, book them directly on our website'), [
    'no H1 title', 'no blockquote summary under the title', 'no Markdown links',
  ]);
});

test('JSON-LD lint: parse errors, wrong context and missing properties', () => {
  const page = (json) => `<script type="application/ld+json">${json}</script>`;
  assert.deepEqual(lintPage('/x', page('{"@context":"https://schema.org","@type":"Review","author":{"@type":"Person","name":"Kari"},"datePublished":"2026-02-20","reviewRating":{"@type":"Rating","ratingValue":5},"reviewBody":"Lovely"}')), []);
  assert.match(lintPage('/x', page('{"@context":'))[0].problem, /does not parse/);
  assert.deepEqual(lintPage('/x', page('{"@context":"https://example.org","@type":"Review"}')).map((p) => p.problem), [
    '@context is not schema.org', 'missing author', 'missing datePublished', 'missing reviewRating', 'missing reviewBody',
  ]);
});

test('readiness: the level may not drop, and a passing check may not stop passing', () => {
  const scan = { level: 3, checks: { discovery: { mcpServerCard: { status: 'fail' }, authMd: { status: 'pass' } } } };
  const rows = compareReadiness(scan, { level: 4, checks: { mcpServerCard: 'pass', authMd: 'fail' } });
  assert.deepEqual(rows.map((r) => [r.id, r.ok]), [['(level)', false], ['mcpServerCard', false], ['authMd', true]]);
});
