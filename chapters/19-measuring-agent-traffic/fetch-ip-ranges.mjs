#!/usr/bin/env node
// Download today's copy of every IP range file named in agents.json.
// Usage: node fetch-ip-ranges.mjs  ->  ip-ranges/YYYY-MM-DD/*.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES = {
  'openai-gptbot.json': 'https://openai.com/gptbot.json',
  'openai-searchbot.json': 'https://openai.com/searchbot.json',
  'openai-chatgpt-user.json': 'https://openai.com/chatgpt-user.json',
  'anthropic-bots.json': 'https://claude.com/crawling/bots.json',
  'perplexity-perplexitybot.json': 'https://www.perplexity.ai/perplexitybot.json',
  'perplexity-user.json': 'https://www.perplexity.ai/perplexity-user.json',
  'google-common-crawlers.json': 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
  'google-user-triggered-agents.json': 'https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json',
  'microsoft-bingbot.json': 'https://www.bing.com/toolbox/bingbot.json',
};

const needed = new Set(JSON.parse(readFileSync(join(here, 'agents.json'), 'utf8')).agents.map((a) => a.ipRanges));
const day = new Date().toISOString().slice(0, 10);
const dir = join(here, 'ip-ranges', day);
mkdirSync(dir, { recursive: true });

for (const [name, url] of Object.entries(SOURCES)) {
  if (!needed.has(name)) continue;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { console.error(`${name}: HTTP ${res.status} from ${url}`); process.exitCode = 1; continue; }
  const json = await res.json();
  writeFileSync(join(dir, name), JSON.stringify(json, null, 2) + '\n');
  console.log(`${name}: ${json.prefixes?.length ?? 0} prefixes, creationTime ${json.creationTime}`);
}
