#!/usr/bin/env node
// agent-ready-check.mjs
// A local, dependency-free re-implementation of the checks that isitagentready.com
// documents in https://isitagentready.com/llms-full.txt (read 2 November 2026).
// It runs against any origin, including http://localhost, which the real scanner
// cannot reach. It is not Cloudflare's code: where its results differ from the
// real scanner, the real scanner wins.
//
//   node agent-ready-check.mjs http://127.0.0.1:3000          # table
//   node agent-ready-check.mjs https://example.com --json      # JSON, same shape as /api/scan
//   node agent-ready-check.mjs <url> --opt-in --commerce       # add the opt-in and commerce checks
//
// Node 20 or later (global fetch). No dependencies.

const TIMEOUT_MS = 10_000;

const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'anthropic-ai', 'Google-Extended', 'Google-Agent', 'PerplexityBot', 'Perplexity-User', 'CCBot',
  'Applebot-Extended', 'Meta-ExternalAgent', 'Amazonbot', 'Bytespider', 'MistralAI-User',
];
const AGENT_LINK_RELS = ['api-catalog', 'service-desc', 'service-doc', 'service-meta', 'describedby', 'alternate', 'sitemap', 'ard'];

// Category and check ids exactly as isitagentready.com names them.
export const CHECKS = {
  discoverability: ['robotsTxt', 'sitemap', 'linkHeaders', 'dnsAid'],
  contentAccessibility: ['markdownNegotiation'],
  botAccessControl: ['robotsTxtAiRules', 'contentSignals', 'webBotAuth'],
  discovery: ['mcpServerCard', 'a2aAgentCard', 'agentSkills', 'webMcp', 'apiCatalog', 'oauthDiscovery',
    'oauthProtectedResource', 'authMd', 'ard', 'personalAgentProtocol'],
  commerce: ['x402', 'mpp', 'ucp', 'acp', 'ap2'],
};
const OPT_IN = new Set(['a2aAgentCard', 'ap2']);

export const LEVELS = ['Not Ready', 'Basic Web Presence', 'Bot-Aware', 'Agent-Readable', 'Agent-Integrated', 'Agent-Native'];

async function get(url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
    const text = await res.text();
    return { ok: res.ok, status: res.status, type: res.headers.get('content-type') ?? '', headers: res.headers, text };
  } catch (error) {
    return { ok: false, status: 0, type: '', headers: new Headers(), text: '', error: error.message };
  }
}

function json(text) {
  try { return JSON.parse(text); } catch { return null; }
}

const pass = (message) => ({ status: 'pass', message });
const fail = (message) => ({ status: 'fail', message });
const neutral = (message) => ({ status: 'neutral', message });
const unable = (message) => ({ status: 'unableToCheck', message });

/** Run every check against `target` and compute the level. */
export async function runChecks(target, { optIn = false, commerce = false } = {}) {
  const page = new URL(target);
  const origin = page.origin;
  const at = (path) => new URL(path, origin).href;

  const [robots, home, homeMd, pageRes] = await Promise.all([
    get(at('/robots.txt')),
    get(at('/')),
    get(at('/'), { headers: { accept: 'text/markdown' } }),
    page.pathname === '/' ? null : get(page.href),
  ]);
  const robotsText = robots.ok ? robots.text : '';
  const r = {};

  // Discoverability
  r.robotsTxt = robots.ok && robots.type.startsWith('text/plain') && /^\s*user-agent\s*:/im.test(robots.text)
    ? pass('robots.txt returns 200 text/plain with a User-agent line')
    : fail(`robots.txt: HTTP ${robots.status} ${robots.type || ''}`.trim());

  const sitemapRes = await get(at('/sitemap.xml'));
  const sitemapXml = sitemapRes.ok && /<(urlset|sitemapindex)[\s>]/.test(sitemapRes.text);
  const sitemapLine = /^\s*sitemap\s*:\s*\S+/im.test(robotsText);
  r.sitemap = sitemapXml || sitemapLine
    ? pass(sitemapXml ? '/sitemap.xml is valid XML' : 'Sitemap directive in robots.txt')
    : fail('no /sitemap.xml and no Sitemap line in robots.txt');

  const link = home.headers.get('link') ?? '';
  const rels = [...link.matchAll(/rel="?([^";,]+)"?/g)].flatMap((m) => m[1].trim().split(/\s+/));
  const useful = rels.filter((rel) => AGENT_LINK_RELS.includes(rel));
  r.linkHeaders = useful.length ? pass(`Link rels on /: ${useful.join(', ')}`) : fail('no agent-useful Link header on /');

  r.dnsAid = await checkDnsAid(page.hostname);

  // Content accessibility
  r.markdownNegotiation = homeMd.type.startsWith('text/markdown')
    ? pass('Accept: text/markdown on / returns text/markdown')
    : fail(`Accept: text/markdown on / returns ${homeMd.type || `HTTP ${homeMd.status}`}`);

  // Bot access control
  const agents = [...robotsText.matchAll(/^\s*user-agent\s*:\s*(\S+)/gim)].map((m) => m[1]);
  const named = agents.filter((ua) => AI_BOTS.some((bot) => bot.toLowerCase() === ua.toLowerCase()));
  r.robotsTxtAiRules = named.length
    ? pass(`robots.txt names ${named.join(', ')}`)
    : agents.includes('*') ? pass('robots.txt has wildcard rules that apply to all crawlers') : fail('no AI bot rules in robots.txt');

  const signal = robotsText.match(/^\s*content-signal\s*:\s*(.+)$/im);
  r.contentSignals = signal && /(ai-train|search|ai-input)\s*=/.test(signal[1])
    ? pass(`Content-Signal: ${signal[1].trim()}`)
    : fail('no Content-Signal line in robots.txt');

  const wba = await get(at('/.well-known/http-message-signatures-directory'));
  r.webBotAuth = Array.isArray(json(wba.text)?.keys)
    ? pass('key directory with a JWKS')
    : neutral('no key directory (informational, does not affect the level)');

  // Discovery
  r.mcpServerCard = await firstValid(
    ['/.well-known/mcp/server-card.json', '/.well-known/mcp/server-cards.json', '/.well-known/mcp.json'].map(at),
    (j) => j?.serverInfo?.name || j?.name || (Array.isArray(j) && j[0]?.serverInfo?.name),
    'MCP Server Card',
  );
  r.a2aAgentCard = await firstValid([at('/.well-known/agent-card.json')],
    (j) => j?.name && j?.version && j?.supportedInterfaces, 'A2A Agent Card');
  r.agentSkills = await firstValid(
    [at('/.well-known/agent-skills/index.json'), at('/.well-known/skills/index.json')],
    (j) => Array.isArray(j?.skills), 'Agent Skills index',
  );
  r.webMcp = await checkWebMcp(pageRes ?? home, origin);

  const catalog = await get(at('/.well-known/api-catalog'));
  r.apiCatalog = catalog.ok && Array.isArray(json(catalog.text)?.linkset)
    ? pass(`/.well-known/api-catalog is a linkset (${catalog.type || 'no Content-Type'})`)
    : fail(`/.well-known/api-catalog: HTTP ${catalog.status}`);

  const asMeta = await firstJson([at('/.well-known/oauth-authorization-server'), at('/.well-known/openid-configuration')]);
  r.oauthDiscovery = asMeta?.issuer ? pass(`OAuth metadata, issuer ${asMeta.issuer}`) : fail('no OAuth/OIDC discovery metadata');
  const prm = json((await get(at('/.well-known/oauth-protected-resource'))).text);
  r.oauthProtectedResource = prm?.resource && Array.isArray(prm?.authorization_servers)
    ? pass(`protected resource ${prm.resource}`)
    : fail('no OAuth Protected Resource Metadata');
  const authMd = await get(at('/auth.md'));
  r.authMd = authMd.ok && prm?.resource && asMeta?.agent_auth ? pass('/auth.md with agent_auth metadata') : fail('no /auth.md setup');

  r.ard = await checkArd(robotsText, home, at);
  const poppy = json((await get(at('/.well-known/poppy.json'))).text);
  r.personalAgentProtocol = poppy ? pass('poppy.json found (informational)') : fail('no poppy.json (informational, does not affect the level)');

  // Commerce (scored only for shops; pass --commerce to score them here)
  const score = (ok, yes, no) => (ok ? pass(yes) : commerce ? fail(no) : neutral(`${no} (not scored)`));
  const ucp = json((await get(at('/.well-known/ucp'))).text);
  const acp = json((await get(at('/.well-known/acp.json'))).text);
  const openapi = await get(at('/openapi.json'));
  r.ucp = score(ucp?.protocol_version && ucp?.services, 'UCP profile', 'no /.well-known/ucp');
  r.acp = score(acp?.protocol?.name && acp?.api_base_url && acp?.capabilities?.services, 'ACP discovery document', 'no /.well-known/acp.json');
  r.mpp = score(openapi.ok && openapi.text.includes('x-payment-info'), 'OpenAPI with x-payment-info', 'no x-payment-info in /openapi.json');
  r.x402 = score(home.status === 402 && home.headers.has('payment-required'), 'HTTP 402 with x402 headers', 'no x402 response');
  r.ap2 = neutral('AP2 lives in the A2A Agent Card (opt-in)');

  if (!optIn) for (const id of OPT_IN) r[id] = neutral('opt-in check, skipped');

  const checks = {};
  for (const [category, ids] of Object.entries(CHECKS)) {
    checks[category] = Object.fromEntries(ids.map((id) => [id, r[id]]));
  }
  const { level, next } = computeLevel(r);
  return { url: page.href, scanned_at: new Date().toISOString(), level, level_name: LEVELS[level], checks, next_level: next };
}

/** The level rules, as isitagentready.com documents them. `next` names the failing checks. */
export function computeLevel(r) {
  const ok = (id) => r[id]?.status === 'pass';
  const failing = (ids) => ids.filter((id) => !ok(id));
  const integration = ['mcpServerCard', 'a2aAgentCard', 'agentSkills', 'apiCatalog'];
  const auth = ['oauthDiscovery', 'oauthProtectedResource', 'authMd'];
  const basics = ['robotsTxt', 'sitemap', 'linkHeaders'];
  const steps = [
    { target: 1, met: basics.filter(ok).length >= 2, needs: failing(basics) },          // 2 of 3
    { target: 2, met: ok('robotsTxtAiRules') && ok('contentSignals'), needs: failing(['robotsTxtAiRules', 'contentSignals']) },
    { target: 3, met: ok('markdownNegotiation'), needs: ['markdownNegotiation'] },
    { target: 4, met: integration.some(ok), needs: integration },                          // 1 of 4
    {
      target: 5,                                                                           // 2 of 3
      met: [ok('webBotAuth'), integration.every(ok), auth.some(ok)].filter(Boolean).length >= 2,
      needs: ['webBotAuth', ...failing(integration), ...(auth.some(ok) ? [] : auth)],
    },
  ];
  let level = 0;
  for (const step of steps) {
    if (!step.met) return { level, next: { target: step.target, name: LEVELS[step.target], requirements: step.needs } };
    level = step.target;
  }
  return { level, next: null };
}

async function firstJson(urls) {
  for (const url of urls) {
    const j = json((await get(url)).text);
    if (j) return j;
  }
  return null;
}

async function firstValid(urls, valid, label) {
  for (const url of urls) {
    const j = json((await get(url)).text);
    if (j && valid(j)) return pass(`${label} at ${new URL(url).pathname}`);
  }
  return fail(`no valid ${label}`);
}

async function checkDnsAid(hostname) {
  if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return unable('DNS-AID needs a public hostname');
  }
  for (const name of [`_index._agents.${hostname}`, `_a2a._agents.${hostname}`, `_mcp._agents.${hostname}`]) {
    for (const type of ['SVCB', 'HTTPS']) {
      const res = await get(`https://cloudflare-dns.com/dns-query?name=${name}&type=${type}`, { headers: { accept: 'application/dns-json' } });
      const answer = json(res.text);
      const serviceMode = answer?.Answer?.some((a) => (a.type === 64 || a.type === 65) && !/^0\s/.test(a.data));
      if (answer?.AD && serviceMode) return pass(`DNSSEC-validated ${type} record at ${name}`);
    }
  }
  return fail('no DNSSEC-validated SVCB/HTTPS records under _agents');
}

async function checkWebMcp(pageRes, origin) {
  const html = pageRes.text ?? '';
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)].map((m) => m[0]);
  const declared = forms.filter((f) => /\btoolname\s*=/.test(f) && /\btooldescription\s*=/.test(f));
  if (declared.length) return pass(`${declared.length} declarative form tool(s)`);
  // The real scanner loads the page in a headless browser. Without a browser,
  // the best we can do is look for registerTool() in the page's own scripts.
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => new URL(m[1], origin));
  for (const src of scripts.filter((u) => u.origin === origin).slice(0, 10)) {
    const js = await get(src.href);
    if (/modelContext/.test(js.text) && /registerTool\s*\(/.test(js.text)) return pass(`registerTool() in ${src.pathname} (static guess)`);
  }
  return fail('no WebMCP tools found without a browser (Lighthouse checks in a real browser)');
}

async function checkArd(robotsText, home, at) {
  const fromRobots = robotsText.match(/^\s*agentmap\s*:\s*(\S+)/im)?.[1];
  const fromLink = (home.headers.get('link') ?? '').match(/<([^>]+)>\s*;[^,]*rel="?ard"?/)?.[1];
  const fromHtml = home.text.match(/<link\b[^>]*rel="ard"[^>]*href="([^"]+)"/i)?.[1];
  const candidates = [fromRobots, fromHtml, fromLink, '/.well-known/ard.json', '/.well-known/ai-catalog.json'].filter(Boolean);
  for (const href of candidates) {
    const j = json((await get(at(href))).text);
    const entries = Array.isArray(j?.entries) ? j.entries.filter((e) => e?.type && (e.url || e.data)) : [];
    if (j?.specVersion && entries.length) return pass(`ARD manifest at ${href} with ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
  }
  return fail('no ARD manifest');
}

function printTable(report) {
  const rows = [];
  for (const [category, checks] of Object.entries(report.checks)) {
    for (const [id, result] of Object.entries(checks)) rows.push([category, id, result.status, result.message]);
  }
  const width = [0, 1, 2].map((i) => Math.max(...rows.map((row) => row[i].length)));
  console.log(`\n${report.url}\n`);
  for (const row of rows) console.log(row.map((cell, i) => (i < 3 ? cell.padEnd(width[i]) : cell)).join('  '));
  console.log(`\nLevel ${report.level}: ${report.level_name}`);
  if (report.next_level) console.log(`Next: Level ${report.next_level.target} (${report.next_level.name}), work on: ${report.next_level.requirements.join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('Usage: node agent-ready-check.mjs <url> [--json] [--opt-in] [--commerce]');
    process.exit(2);
  }
  const report = await runChecks(target, { optIn: args.includes('--opt-in'), commerce: args.includes('--commerce') });
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printTable(report);
}
