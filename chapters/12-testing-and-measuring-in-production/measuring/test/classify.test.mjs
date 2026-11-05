import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLine, isHtmlRequest } from '../lib/parse.mjs';
import { compileRanges, inRanges } from '../lib/ip.mjs';
import { loadRules, classify, referralPlatform } from '../lib/classify.mjs';
import { buildReport } from '../lib/report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const rules = loadRules({ agentsFile: join(root, 'agents.json'), rangesDir: join(root, 'ip-ranges', '2026-11-02') });
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

test('reads the combined log format and converts the time to UTC', () => {
  const r = parseLine(`132.196.86.1 - - [02/Nov/2026:10:15:32 +0100] "GET /cabins/fjellro HTTP/1.1" 200 5120 "-" "${GPTBOT}"`);
  assert.equal(r.ip, '132.196.86.1');
  assert.equal(r.time, '2026-11-02T09:15:32.000Z');
  assert.equal(r.path, '/cabins/fjellro');
  assert.equal(r.referer, '');
  assert.equal(isHtmlRequest(r), true);
  assert.equal(parseLine('# a comment'), null);
  assert.equal(parseLine('not a log line'), null);
});

test('reads the JSON variant, including a signature result', () => {
  const r = parseLine(JSON.stringify({ time: '2026-11-02T09:00:00Z', ip: '198.51.100.240', method: 'GET', path: '/css/site.css',
    status: 200, ua: CHROME, contentType: 'text/css', signature: 'verified', signatureAgent: 'https://chatgpt.com' }));
  assert.equal(r.signature, 'verified');
  assert.equal(isHtmlRequest(r), false);
});

test('matches IPv4 and IPv6 prefixes', () => {
  const ranges = compileRanges({ prefixes: [{ ipv4Prefix: '132.196.86.0/24' }, { ipv6Prefix: '2001:4860:4801:10::/64' }] });
  assert.equal(inRanges('132.196.86.200', ranges), true);
  assert.equal(inRanges('132.196.87.1', ranges), false);
  assert.equal(inRanges('2001:4860:4801:10::1', ranges), true);
  assert.equal(inRanges('2001:4860:4801:11::1', ranges), false);
  assert.equal(inRanges('::ffff:132.196.86.9', ranges), true);
  assert.equal(inRanges('not-an-ip', ranges), false);
});

test('a documented crawler from its published range is that crawler', () => {
  const who = classify({ userAgent: GPTBOT, ip: '132.196.86.1' }, rules);
  assert.deepEqual(who, { class: 'training', agent: 'GPTBot', operator: 'OpenAI', platform: 'openai', evidence: 'ip-range' });
});

test('the same user agent from another network is a spoofed claim', () => {
  const who = classify({ userAgent: GPTBOT, ip: '198.51.100.250' }, rules);
  assert.equal(who.class, 'other-bot');
  assert.equal(who.evidence, 'spoofed');
});

test('a verified signature wins over the user agent', () => {
  const who = classify({ userAgent: CHROME, ip: '198.51.100.240', signature: 'verified', signatureAgent: 'https://chatgpt.com' }, rules);
  assert.equal(who.class, 'signed-agent');
  assert.equal(who.platform, 'openai');
  assert.equal(classify({ userAgent: GPTBOT, ip: '132.196.86.1', signature: 'invalid' }, rules).evidence, 'invalid-signature');
});

test('browsers are unknown and self-declared tools are other bots', () => {
  assert.equal(classify({ userAgent: CHROME, ip: '198.51.100.7' }, rules).class, 'unknown');
  assert.equal(classify({ userAgent: 'python-requests/2.32.5', ip: '198.51.100.7' }, rules).class, 'other-bot');
  assert.equal(classify({ userAgent: '', ip: '198.51.100.7' }, rules).class, 'other-bot');
});

test('referrals come from the Referer host or a utm_source tag', () => {
  assert.deepEqual(referralPlatform({ path: '/cabins/fjellro?utm_source=chatgpt.com', referer: '' }, rules), { platform: 'openai', via: 'utm_source' });
  assert.deepEqual(referralPlatform({ path: '/', referer: 'https://www.perplexity.ai/search/abc' }, rules), { platform: 'perplexity', via: 'referer' });
  assert.equal(referralPlatform({ path: '/', referer: 'https://nordlys.example/cabins' }, rules), null);
});

test('the report on the synthetic week adds up', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch12-'));
  try {
    execFileSync(process.execPath, [join(root, 'make-synthetic-log.mjs'), dir]);
    const jsonl = buildReport(readFileSync(join(dir, 'synthetic-access.jsonl'), 'utf8').split('\n'), rules);
    const clf = buildReport(readFileSync(join(dir, 'synthetic-access.log'), 'utf8').split('\n'), rules);
    assert.equal(jsonl.total, 2000);
    assert.equal(jsonl.classes.reduce((s, c) => s + c.requests, 0), 2000);
    for (const p of jsonl.platforms) if (p.referrals) assert.equal(p.crawlToRefer, p.crawls / p.referrals);
    // The combined format has no field for a signature result, so signed agents look like browsers.
    assert.equal(clf.classes.find((c) => c.name === 'signed-agent').requests, 0);
    assert.ok(jsonl.classes.find((c) => c.name === 'signed-agent').requests > 0);
    assert.ok(jsonl.agents.some((a) => a.evidence === 'spoofed'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
