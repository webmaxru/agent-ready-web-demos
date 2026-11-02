// Chapter 11: discovery documents for the API (Chapter 7) and the MCP server (Chapter 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildApp, startServer } from './helpers/server.js';
import { runChecks } from '../../chapters/02-your-first-agent-ready-page/agent-ready-check.mjs';

const ORIGIN = 'https://nordlys.example';

test('MCP Server Card at /mcp/server-card, mirrored where scanners look, matches server/discover', async () => {
  const { app } = await buildApp({ upto: 11, publicOrigin: ORIGIN });
  const res = await app.request('/mcp/server-card');
  assert.equal(res.headers.get('content-type'), 'application/mcp-server-card+json');
  const card = await res.json();
  assert.equal(card.$schema, 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
  assert.match(card.name, /^[^/]+\/[^/]+$/);
  assert.equal(card.name, 'example.nordlys/booking');
  assert.equal(card.remotes[0].url, `${ORIGIN}/mcp`);
  const mirror = await (await app.request('/.well-known/mcp/server-card.json')).json();
  assert.deepEqual(mirror, card);

  // A card is advisory: it must not contradict what the live server says about itself.
  const discover = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'server/discover' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' } } } }),
  });
  const { result } = await discover.json();
  for (const v of result.supportedVersions) assert.ok(card.remotes[0].supportedProtocolVersions.includes(v));
  assert.equal(result._meta['io.modelcontextprotocol/serverInfo'].version, card.version);
});

test('Agent Skills index: the digest is the SHA-256 of the SKILL.md it points to', async () => {
  const { app } = await buildApp({ upto: 11, publicOrigin: ORIGIN });
  const index = await (await app.request('/.well-known/agent-skills/index.json')).json();
  assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  const [skill] = index.skills;
  assert.deepEqual(Object.keys(skill), ['name', 'type', 'description', 'url', 'digest']);
  const text = await (await app.request(skill.url)).text();
  assert.equal(skill.digest, 'sha256:' + createHash('sha256').update(text).digest('hex'));
  assert.match(text, /^---\nname: book-a-nordlys-cabin\n/);
  assert.ok(text.includes(`${ORIGIN}/mcp`));
});

test('ARD manifest: required terms, 2 to 5 representative queries, linked from the home page', async () => {
  const { app } = await buildApp({ upto: 11, publicOrigin: ORIGIN });
  const { entries } = await (await app.request('/.well-known/ard.json')).json();
  assert.ok(entries.length >= 2);
  for (const e of entries) {
    assert.match(e.identifier, /^urn:air:nordlys\.example:/);
    assert.ok(e.displayName && e.type && e.url && !e.data);
    assert.ok(e.representativeQueries.length >= 2 && e.representativeQueries.length <= 5);
  }
  const home = await app.request('/');
  const link = home.headers.get('link');
  assert.match(link, /<\/\.well-known\/ard\.json>; rel="ard"/);
  assert.match(link, /rel="api-catalog"/, 'the Chapter 7 Link value survives');
});

test('the API catalog now lists the MCP endpoint next to the REST API', async () => {
  const { app, ctx } = await buildApp({ upto: 11, publicOrigin: ORIGIN });
  const { linkset } = await (await app.request('/.well-known/api-catalog')).json();
  assert.deepEqual(linkset.map((l) => l.anchor), [`${ORIGIN}/api/v1`, `${ORIGIN}/mcp`]);
  assert.equal(linkset[1]['service-desc'][0].href, `${ORIGIN}/mcp/server-card`);
  assert.equal((await ctx.runAudits()).ok, true);
});

test('the local agent-readiness checker sees every discovery check this chapter owns', async () => {
  const server = await startServer({ upto: 11 });
  try {
    const { checks, level } = await runChecks(server.url);
    for (const id of ['apiCatalog', 'mcpServerCard', 'agentSkills', 'ard']) assert.equal(checks.discovery[id].status, 'pass', id);
    // An A2A card and auth metadata are what Level 5 would still ask for (see the chapter).
    assert.ok(level >= 0 && level <= 5);
  } finally {
    await server.close();
  }
});
