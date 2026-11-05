// Classify one request: who sent it, for what purpose, and how sure we are.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileRanges, inRanges } from './ip.mjs';

/** Load agents.json and the dated IP range files next to it. */
export function loadRules({ agentsFile, rangesDir }) {
  const rules = JSON.parse(readFileSync(agentsFile, 'utf8'));
  const ranges = new Map();
  for (const a of rules.agents) {
    const file = rangesDir && a.ipRanges ? join(rangesDir, a.ipRanges) : null;
    if (file && existsSync(file) && !ranges.has(a.ipRanges)) {
      ranges.set(a.ipRanges, compileRanges(JSON.parse(readFileSync(file, 'utf8'))));
    }
  }
  return { ...rules, ranges };
}

const BOT_HINT = /bot|crawl|spider|fetch|scrape|curl|wget|python-requests|httpclient|headless/i;

/**
 * Returns { class, agent, operator, platform, evidence }.
 *   class:    signed-agent | training | search | user-fetch | browsing-agent | other-bot | unknown
 *   evidence: signature | ip-range | ua-only (no range file to check) | spoofed (UA claims an
 *             agent, the IP is outside its published ranges) | invalid-signature | none
 */
export function classify(req, rules) {
  const ua = req.userAgent ?? '';
  const claimed = rules.agents.find((a) => ua.toLowerCase().includes(a.token.toLowerCase()));

  // 1. A verified Web Bot Auth signature beats everything a request says about itself.
  if (req.signature === 'verified' && req.signatureAgent) {
    const platform = rules.signatureAgents[req.signatureAgent] ?? null;
    return { class: 'signed-agent', agent: req.signatureAgent, operator: claimed?.operator ?? req.signatureAgent,
      platform, evidence: 'signature' };
  }

  if (claimed) {
    const compiled = rules.ranges.get(claimed.ipRanges);
    let evidence = 'ua-only';
    if (req.signature === 'invalid') evidence = 'invalid-signature';
    else if (compiled) evidence = inRanges(req.ip, compiled) ? 'ip-range' : 'spoofed';
    // 2. A user agent we can disprove is not that agent. Count it as an unknown bot.
    if (evidence === 'spoofed' || evidence === 'invalid-signature') {
      return { class: 'other-bot', agent: claimed.token, operator: null, platform: null, evidence };
    }
    // 3. A documented agent, confirmed by its IP range or (weaker) by its user agent alone.
    return { class: claimed.purpose, agent: claimed.token, operator: claimed.operator,
      platform: claimed.platform, evidence };
  }

  // 4. Self-declared automation we have no rule for, then everything else.
  if (BOT_HINT.test(ua) || !ua) return { class: 'other-bot', agent: null, operator: null, platform: null, evidence: 'none' };
  return { class: 'unknown', agent: null, operator: null, platform: null, evidence: 'none' };
}

/** Which AI or search platform sent this visitor, from the Referer or a utm_source tag. */
export function referralPlatform(req, rules) {
  const utm = /[?&]utm_source=([^&#]+)/.exec(req.path ?? '');
  if (utm) {
    const p = rules.utmSources[decodeURIComponent(utm[1]).toLowerCase()];
    if (p) return { platform: p, via: 'utm_source' };
  }
  let host = '';
  try { host = new URL(req.referer).hostname.toLowerCase(); } catch { return null; }
  for (const [platform, hosts] of Object.entries(rules.referrers)) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { platform, via: 'referer' };
  }
  return null;
}
