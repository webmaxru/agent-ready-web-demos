#!/usr/bin/env node
// robots.txt and llms.txt checks for CI: the files parse, the sitemap resolves,
// each AI crawler gets the access the policy says (Chapter 4), and llms.txt has
// the shape Lighthouse's llms-txt audit and the llms.txt proposal expect (Chapter 5).
//
//   node scripts/robots-llms.mjs http://127.0.0.1:4318
import { readFile } from 'node:fs/promises';
import { table } from './lib.mjs';

const DIRECTIVES = /^(user-agent|allow|disallow|sitemap|crawl-delay|content-signal|host)$/i;

/** Parse robots.txt into groups: [{ agents: [...], rules: [{ allow, path }] }], plus sitemaps and unknown lines. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  const unknown = [];
  let current = null;
  let lastWasAgent = false;
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m || !DIRECTIVES.test(m[1].trim())) { unknown.push(`line ${n + 1}: ${raw}`); continue; }
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') sitemaps.push(value);
    else if ((key === 'allow' || key === 'disallow') && current) current.rules.push({ allow: key === 'allow', path: value });
  }
  return { groups, sitemaps, unknown };
}

/** RFC 9309: the group that names the agent (or *), then the longest matching rule wins, allow on a tie. */
export function isAllowed(robots, agent, path) {
  const name = agent.toLowerCase();
  const group = robots.groups.find((g) => g.agents.includes(name)) ?? robots.groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  const toRegex = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  const hits = group.rules.filter((r) => r.path && toRegex(r.path).test(path));
  if (!hits.length) return true;
  hits.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return hits[0].allow;
}

/** The checks Lighthouse 13.6.0's llms-txt audit makes, plus the proposal's blockquote summary. */
export function lintLlmsTxt(text) {
  const problems = [];
  if (!/^\s*#\s+.+/m.test(text)) problems.push('no H1 title');
  if (!/^>\s+.+/m.test(text)) problems.push('no blockquote summary under the title');
  if (!/\[.+\]\(.+\)/.test(text)) problems.push('no Markdown links');
  if (text.trim().length < 50) problems.push('shorter than 50 characters');
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? 'http://127.0.0.1:4318';
  const get = (path) => fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
  const expect = JSON.parse(await readFile(new URL('../baselines/robots-expectations.json', import.meta.url), 'utf8'));
  const rows = [];

  const robotsRes = await get('/robots.txt');
  const robots = parseRobots(await robotsRes.text());
  rows.push({ check: 'robots.txt', ok: robotsRes.ok && robots.unknown.length === 0, detail: robots.unknown.join('; ') || `${robots.groups.length} groups` });
  for (const sitemap of robots.sitemaps) {
    const res = await fetch(sitemap.replace(/^https?:\/\/[^/]+/, base), { signal: AbortSignal.timeout(10_000) });
    rows.push({ check: `sitemap ${new URL(sitemap).pathname}`, ok: res.ok, detail: `HTTP ${res.status}` });
  }
  for (const { agent, path, allowed } of expect.access) {
    const got = isAllowed(robots, agent, path);
    rows.push({ check: `${agent} ${path}`, ok: got === allowed, detail: got ? 'allowed' : 'disallowed' });
  }

  const llmsRes = await get('/llms.txt');
  const llms = await llmsRes.text();
  const llmsProblems = llmsRes.ok ? lintLlmsTxt(llms) : [`HTTP ${llmsRes.status}`];
  rows.push({ check: 'llms.txt', ok: llmsProblems.length === 0, detail: llmsProblems.join('; ') || 'H1, summary, links' });
  // Links to our own site, relative or absolute, must resolve. External links are not checked here.
  const own = new URL(base).host;
  const links = [...llms.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => new URL(m[1], base))
    .filter((u) => u.host === own)
    .map((u) => u.pathname + u.search);
  for (const link of links) {
    const res = await get(link);
    if (!res.ok) rows.push({ check: `llms.txt link ${link}`, ok: false, detail: `HTTP ${res.status}` });
  }
  rows.push({ check: 'llms.txt links', ok: true, detail: `${links.length} site links checked` });

  console.log(table(rows.map((r) => ({ ...r, ok: r.ok ? 'ok' : 'FAIL' })), ['check', 'ok', 'detail']));
  process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
}
