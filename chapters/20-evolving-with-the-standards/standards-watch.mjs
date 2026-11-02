#!/usr/bin/env node
// Check the standards this book depends on for new versions.
// Usage: node standards-watch.mjs [--update]
//   Prints one line per entry in watchlist.json: same, CHANGED or ERROR.
//   Exits with 1 when something changed, so a scheduled CI job can open an issue.
//   --update stores today's values in watch-state.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Visible text of an HTML page, good enough for a version line. */
export const textOf = (html) =>
  html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

/** Read the version string of one entry from a fetched body. */
export function extract(entry, body) {
  if (entry.type === 'json') {
    const json = JSON.parse(body);
    const values = entry.fields.map((f) => json[f]);
    if (values.some((v) => v === undefined)) throw new Error(`missing field in ${entry.url}`);
    return values.join(' / ');
  }
  // 'html' patterns run on the markup (for dates kept in attributes), 'text' on the visible text
  const m = new RegExp(entry.pattern).exec(entry.type === 'html' ? body : textOf(body));
  if (!m) throw new Error(`pattern not found in ${entry.url}`);
  return m.slice(1).join(' / ');
}

export async function check(entries, state, fetchImpl = fetch) {
  const results = [];
  for (const entry of entries) {
    try {
      const res = await fetchImpl(entry.url, {
        headers: { 'user-agent': 'standards-watch/1.0 (+https://github.com/webmaxru/agent-ready-web-demos)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${entry.url}`);
      const value = extract(entry, await res.text());
      const before = state[entry.id]?.value ?? null;
      results.push({ id: entry.id, name: entry.name, value, before, status: before === value ? 'same' : 'CHANGED' });
    } catch (err) {
      results.push({ id: entry.id, name: entry.name, value: null, before: state[entry.id]?.value ?? null, status: 'ERROR', error: err.message });
    }
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { entries } = JSON.parse(readFileSync(join(here, 'watchlist.json'), 'utf8'));
  const stateFile = join(here, 'watch-state.json');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const results = await check(entries, state);
  for (const r of results) {
    const detail = r.status === 'ERROR' ? r.error : r.status === 'CHANGED' ? `${r.before ?? 'new'} -> ${r.value}` : r.value;
    console.log(`${r.status.padEnd(8)} ${r.name}: ${detail}`);
  }
  if (process.argv.includes('--update')) {
    const today = new Date().toISOString().slice(0, 10);
    for (const r of results) if (r.value) state[r.id] = { value: r.value, checked: today };
    writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  }
  if (results.some((r) => r.status === 'CHANGED')) process.exitCode = 1;
}
