// Turn classified requests into the numbers Chapter 12 talks about.
import { parseLine, isHtmlRequest } from './parse.mjs';
import { classify, referralPlatform } from './classify.mjs';

const CLASSES = ['signed-agent', 'training', 'search', 'user-fetch', 'browsing-agent', 'other-bot', 'unknown'];

const bump = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const top = (map, n) => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

export function buildReport(lines, rules) {
  const byClass = new Map(CLASSES.map((c) => [c, { requests: 0, html: 0, status: new Map(), paths: new Map() }]));
  const byAgent = new Map();      // 'GPTBot|ip-range' -> count
  const platforms = new Map();    // platform -> { crawls, userFetches, agentVisits, referrals, viaUtm }
  const plat = (p) => platforms.get(p) ?? platforms.set(p, { crawls: 0, userFetches: 0, agentVisits: 0, referrals: 0, viaUtm: 0 }).get(p);
  let first = null, last = null, total = 0, skipped = 0;

  for (const line of lines) {
    const req = parseLine(line);
    if (!req) { if (line.trim() && !line.trim().startsWith('#')) skipped++; continue; }
    total++;
    if (req.time && (!first || req.time < first)) first = req.time;
    if (req.time && (!last || req.time > last)) last = req.time;

    const who = classify(req, rules);
    const html = isHtmlRequest(req);
    const c = byClass.get(who.class);
    c.requests++;
    if (html) c.html++;
    bump(c.status, req.status);
    bump(c.paths, req.path.split('?')[0]);
    if (who.agent) bump(byAgent, `${who.agent}|${who.class}|${who.evidence}`);

    if (!html) continue;
    if (who.platform && (who.class === 'training' || who.class === 'search')) plat(who.platform).crawls++;
    if (who.platform && who.class === 'user-fetch') plat(who.platform).userFetches++;
    if (who.platform && (who.class === 'browsing-agent' || who.class === 'signed-agent')) plat(who.platform).agentVisits++;
    if (who.class === 'unknown') {
      const ref = referralPlatform(req, rules);
      if (ref) { plat(ref.platform).referrals++; if (ref.via === 'utm_source') plat(ref.platform).viaUtm++; }
    }
  }

  return {
    period: { first, last },
    total,
    skipped,
    classes: CLASSES.map((name) => {
      const c = byClass.get(name);
      return { name, requests: c.requests, html: c.html, share: total ? c.requests / total : 0,
        status: Object.fromEntries(top(c.status, 6)), topPaths: top(c.paths, 5) };
    }),
    agents: top(byAgent, 50).map(([k, n]) => { const [agent, cls, evidence] = k.split('|'); return { agent, class: cls, evidence, requests: n }; }),
    platforms: [...platforms].sort().map(([name, p]) => ({
      name, ...p, crawlToRefer: p.referrals ? p.crawls / p.referrals : null,
    })),
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function formatReport(r) {
  const out = [];
  out.push(`Requests: ${r.total} (${r.period.first} to ${r.period.last})${r.skipped ? `, ${r.skipped} unreadable lines skipped` : ''}`);
  out.push('', 'By class                requests   share   HTML   403  429');
  for (const c of r.classes) {
    out.push(`  ${c.name.padEnd(20)} ${String(c.requests).padStart(9)} ${pct(c.share).padStart(7)} ${String(c.html).padStart(6)} ${String(c.status[403] ?? 0).padStart(5)} ${String(c.status[429] ?? 0).padStart(4)}`);
  }
  out.push('', 'Agents by evidence');
  for (const a of r.agents) out.push(`  ${a.agent.padEnd(22)} ${a.class.padEnd(15)} ${a.evidence.padEnd(18)} ${String(a.requests).padStart(6)}`);
  out.push('', 'Platforms (HTML pages)  crawls  user fetches  agent visits  referrals  crawl-to-refer');
  for (const p of r.platforms) {
    const ratio = p.crawlToRefer === null ? 'no referrals' : `${p.crawlToRefer.toFixed(1)} : 1`;
    out.push(`  ${p.name.padEnd(20)} ${String(p.crawls).padStart(7)} ${String(p.userFetches).padStart(13)} ${String(p.agentVisits).padStart(13)} ${String(p.referrals).padStart(10)}  ${ratio}`);
  }
  return out.join('\n');
}
