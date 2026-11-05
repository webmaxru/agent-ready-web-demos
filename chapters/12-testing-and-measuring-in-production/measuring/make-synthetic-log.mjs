#!/usr/bin/env node
// Writes a SYNTHETIC access log for Nordlys Cabins: one week, every kind of visitor.
// The mix of visitors is invented for the demo. It is not traffic data from any real site.
// Usage: node make-synthetic-log.mjs [outDir]  ->  synthetic-access.log and .jsonl (default outDir: fixtures/)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ranges = join(here, 'ip-ranges', '2026-11-02');
const outDir = process.argv[2] ?? join(here, 'fixtures');

// A small seeded random generator, so every run writes the same file.
let seed = 20261102;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

/** An address inside the first IPv4 prefix of a published range file. */
function ipFrom(file) {
  const { prefixes } = JSON.parse(readFileSync(join(ranges, file), 'utf8'));
  const [addr, len] = prefixes.find((p) => p.ipv4Prefix).ipv4Prefix.split('/');
  return Number(len) < 32 ? addr.replace(/\.\d+$/, (m) => `.${Number(m.slice(1)) + 1}`) : addr;
}

const CABINS = ['fjellro', 'lyngen-lysthus', 'senja-sjobu', 'reine-rorbu', 'hardanger-hytte', 'femund-skogkoie'];
const ARTICLES = ['northern-lights-from-a-cabin', 'packing-for-a-winter-cabin', 'getting-there-without-a-car'];
const PAGES = ['/', '/cabins', '/faq', '/guide', ...CABINS.map((c) => `/cabins/${c}`), ...ARTICLES.map((a) => `/guide/${a}`)];
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const doc = (n) => `198.51.100.${n}`; // documentation range (RFC 5737), never a real visitor

// [weight, visitor] — weights are made up for the demo
const VISITORS = [
  [30, { ua: CHROME, ip: () => doc(1 + Math.floor(rand() * 200)), human: true }],
  [14, { ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot', ip: () => ipFrom('openai-gptbot.json') }],
  [12, { ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com', ip: () => ipFrom('anthropic-bots.json') }],
  [8, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', ip: () => ipFrom('google-common-crawlers.json') }],
  [5, { ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot', ip: () => ipFrom('openai-searchbot.json') }],
  [3, { ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', ip: () => ipFrom('perplexity-perplexitybot.json') }],
  [3, { ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', ip: () => ipFrom('microsoft-bingbot.json') }],
  [4, { ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', ip: () => ipFrom('openai-chatgpt-user.json') }],
  [2, { ua: 'Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)', ip: () => ipFrom('perplexity-user.json') }],
  [2, { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent) Chrome/156.0.0.0 Safari/537.36', ip: () => ipFrom('google-user-triggered-agents.json') }],
  [2, { ua: CHROME, ip: () => doc(240), signed: 'https://chatgpt.com' }],
  [3, { ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot', ip: () => doc(250) }], // claims GPTBot, wrong network
  [3, { ua: 'python-requests/2.32.5', ip: () => doc(251) }],
];
const TOTAL_WEIGHT = VISITORS.reduce((s, [w]) => s + w, 0);
const visitor = () => { let r = rand() * TOTAL_WEIGHT; for (const [w, v] of VISITORS) if ((r -= w) < 0) return v; return VISITORS[0][1]; };

const REFERRERS = [
  [40, ''], [30, 'https://www.google.com/'], [4, 'https://chatgpt.com/'], [2, 'utm:chatgpt.com'],
  [2, 'https://www.perplexity.ai/'], [1, 'https://claude.ai/'], [3, 'https://www.bing.com/'], [18, 'https://nordlys.example/cabins'],
];
const RW = REFERRERS.reduce((s, [w]) => s + w, 0);
const referrer = () => { let r = rand() * RW; for (const [w, v] of REFERRERS) if ((r -= w) < 0) return v; return ''; };

const start = Date.UTC(2026, 9, 26, 0, 0, 0); // Mon 26 Oct 2026, 00:00 UTC
const WEEK = 7 * 24 * 3600 * 1000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clf = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${MON[d.getUTCMonth()]}/${d.getUTCFullYear()}:${d.toISOString().slice(11, 19)} +0000`;

const rows = [];
for (let i = 0; i < 2000; i++) {
  const v = visitor();
  const ip = v.ip();
  const t = new Date(start + Math.floor(rand() * WEEK));
  let path = pick(PAGES), referer = '', status = 200, method = 'GET', contentType = 'text/html; charset=utf-8';
  if (v.human) {
    const ref = referrer();
    if (ref === 'utm:chatgpt.com') path += '?utm_source=chatgpt.com'; else referer = ref;
    if (rand() < 0.35) { path = pick(['/css/site.css', '/js/app.js', '/images/fjellro.jpg']); contentType = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'image/jpeg'; }
    else if (rand() < 0.04) { method = 'POST'; path = `/book/${pick(CABINS)}`; status = 303; contentType = 'text/html'; }
  }
  if (v.signed && rand() < 0.3) { method = 'POST'; path = `/book/${pick(CABINS)}`; status = 303; }
  if (path.startsWith('/cabins/') && !v.human && rand() < 0.05) status = 404;
  if (ip === doc(251) && rand() < 0.5) status = 429;
  rows.push({ t, ip, method, path, status, referer, ua: v.ua, contentType,
    signature: v.signed ? 'verified' : null, signatureAgent: v.signed ?? null });
}
rows.sort((a, b) => a.t - b.t);

const header = '# SYNTHETIC LOG for the Chapter 12 demo, written by make-synthetic-log.mjs. Not real traffic.';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'synthetic-access.log'), [header, ...rows.map((r) =>
  `${r.ip} - - [${clf(r.t)}] "${r.method} ${r.path} HTTP/1.1" ${r.status} ${r.method === 'POST' ? 0 : 5120} "${r.referer || '-'}" "${r.ua}"`)].join('\n') + '\n');
writeFileSync(join(outDir, 'synthetic-access.jsonl'), [header, ...rows.map((r) => JSON.stringify({
  time: r.t.toISOString(), ip: r.ip, method: r.method, path: r.path, status: r.status, referer: r.referer,
  ua: r.ua, contentType: r.contentType, signature: r.signature, signatureAgent: r.signatureAgent }))].join('\n') + '\n');
console.log(`Wrote ${rows.length} synthetic requests to ${outDir}`);
