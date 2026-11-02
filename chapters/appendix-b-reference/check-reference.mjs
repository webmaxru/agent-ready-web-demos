// Appendix B: check the files, robots.txt lines and headers from the reference
// tables against a running site. Read-only: it sends GET and HEAD requests only.
//
//   node check-reference.mjs https://nordlys.example
//   node check-reference.mjs http://127.0.0.1:3000 --json
//
// Node.js 24 or later, no dependencies.

export const PATHS = [
  // [table, path, what it is]
  ['B.2', '/robots.txt', 'Robots Exclusion Protocol (RFC 9309)'],
  ['B.2', '/sitemap.xml', 'Sitemap (sitemaps.org 0.9)'],
  ['B.2', '/llms.txt', 'llms.txt (proposal v2)'],
  ['B.2', '/llms-full.txt', 'llms-full.txt (convention)'],
  ['B.2', '/openapi.json', 'OpenAPI description'],
  ['B.2', '/auth.md', 'auth.md (vendor proposal)'],
  ['B.1', '/.well-known/api-catalog', 'API catalog (RFC 9727)'],
  ['B.1', '/.well-known/oauth-protected-resource', 'Protected Resource Metadata (RFC 9728)'],
  ['B.1', '/.well-known/oauth-protected-resource/mcp', 'PRM for the /mcp resource (RFC 9728)'],
  ['B.1', '/.well-known/oauth-authorization-server', 'Authorization server metadata (RFC 8414)'],
  ['B.1', '/.well-known/openid-configuration', 'OpenID Connect Discovery'],
  ['B.1', '/.well-known/http-message-signatures-directory', 'Web Bot Auth key directory'],
  ['B.1', '/.well-known/mcp/server-card.json', 'MCP server card (SEP-1649 path)'],
  ['B.1', '/.well-known/mcp.json', 'MCP server card (de facto path)'],
  ['B.2', '/mcp/server-card', 'MCP server card (SEP-2127 path)'],
  ['B.1', '/.well-known/ai-catalog.json', 'AI Catalog (legacy ARD location)'],
  ['B.1', '/.well-known/ard.json', 'ARD manifest (v0.91)'],
  ['B.1', '/.well-known/agent-skills/index.json', 'Agent Skills index (v0.2.0)'],
  ['B.1', '/.well-known/agent-card.json', 'A2A Agent Card'],
  ['B.1', '/.well-known/ucp', 'UCP business profile'],
  ['B.1', '/.well-known/acp.json', 'ACP discovery document'],
  ['B.1', '/.well-known/tdmrep.json', 'TDMRep'],
];

export const ROBOTS_LINES = ['User-agent', 'Sitemap', 'Content-Signal', 'Content-Usage', 'License', 'Agentmap'];

async function get(base, path, headers = {}, body = undefined) {
  const url = new URL(path, base);
  try {
    const res = await fetch(url, { method: body ? 'POST' : 'GET', headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    return { status: res.status, headers: res.headers, body: await res.text() };
  } catch (error) {
    return { status: 0, headers: new Headers(), body: '', error: String(error.message || error) };
  }
}

async function post(base, path, json, headers = {}) {
  return get(base, path, { 'content-type': 'application/json', ...headers }, JSON.stringify(json));
}

export async function checkSite(base) {
  const rows = [];
  for (const [table, path, what] of PATHS) {
    const r = await get(base, path);
    rows.push({
      table, item: path, what,
      ok: r.status === 200,
      detail: r.status === 200 ? (r.headers.get('content-type') || '').split(';')[0] : `HTTP ${r.status || r.error}`,
    });
  }

  const robots = await get(base, '/robots.txt');
  for (const line of ROBOTS_LINES) {
    const re = new RegExp(`^\\s*${line}\\s*:`, 'im');
    rows.push({ table: 'B.3', item: `robots.txt ${line}:`, what: 'robots.txt line', ok: robots.status === 200 && re.test(robots.body), detail: '' });
  }

  const home = await get(base, '/');
  const link = home.headers.get('link') || '';
  const rels = [...link.matchAll(/rel="?([^";,]+)"?/g)].map((m) => m[1]);
  rows.push({ table: 'B.4', item: 'Link (homepage)', what: 'RFC 8288', ok: rels.length > 0, detail: rels.join(' ') });

  const md = await get(base, '/', { accept: 'text/markdown' });
  const mdType = (md.headers.get('content-type') || '').split(';')[0];
  rows.push({ table: 'B.4', item: 'Accept: text/markdown -> Content-Type', what: 'Markdown negotiation', ok: mdType === 'text/markdown', detail: mdType });
  const vary = (md.headers.get('vary') || '') + ' ' + (home.headers.get('vary') || '');
  rows.push({ table: 'B.4', item: 'Vary: Accept', what: 'cache key includes Accept', ok: /accept/i.test(vary), detail: vary.trim() });

  const mcp = await post(base, '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, {
    accept: 'application/json, text/event-stream', 'mcp-method': 'tools/list',
  });
  rows.push({ table: 'B.4', item: 'POST /mcp tools/list with Mcp-Method', what: 'MCP 2026-07-28', ok: mcp.status === 200, detail: mcp.status ? `HTTP ${mcp.status}` : mcp.error });

  const problem = await get(base, '/api/v1/cabins/no-such-cabin');
  const problemType = (problem.headers.get('content-type') || '').split(';')[0];
  rows.push({ table: 'B.4', item: 'application/problem+json (API 404)', what: 'RFC 9457', ok: problemType === 'application/problem+json', detail: problemType });

  const api = await get(base, '/api/v1/cabins');
  for (const h of ['ratelimit-policy', 'ratelimit']) {
    rows.push({ table: 'B.4', item: `${h} (/api/v1/cabins)`, what: 'RateLimit draft', ok: api.headers.has(h), detail: api.headers.get(h) || '' });
  }
  return rows;
}

function print(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  for (const r of rows) {
    console.log(`${r.ok ? 'yes' : ' - '}  ${pad(r.table, 4)} ${pad(r.item, 48)} ${r.detail}`);
  }
  console.log(`\n${rows.filter((r) => r.ok).length} of ${rows.length} items present`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  if (!base) {
    console.error('usage: node check-reference.mjs <base-url> [--json]');
    process.exit(2);
  }
  const rows = await checkSite(base);
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else print(rows);
}
