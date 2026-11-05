#!/usr/bin/env node
// Lighthouse Agentic Browsing in CI: run each page several times, take the
// median score per audit, and compare with the budget in baselines/lighthouse.json.
//
//   CHROME_PATH=/path/to/chrome node scripts/lighthouse-agentic.mjs http://127.0.0.1:4318
//
// Lighthouse is pinned in package.json (13.6.0): the category changes in every
// minor release, so a version bump is a deliberate change with a new baseline.
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { median, checkBudget, table } from './lib.mjs';

const require = createRequire(import.meta.url);
const LIGHTHOUSE = process.env.LIGHTHOUSE_BIN ?? require.resolve('lighthouse/cli/index.js');
const RUNS = Number(process.env.LH_RUNS ?? 3);
const CHROME_FLAGS = '--headless=new --no-sandbox --enable-features=WebMCPTesting';

function runOnce(url, out) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [LIGHTHOUSE, url, '--only-categories=agentic-browsing', '--output=json',
      `--output-path=${out}`, '--quiet', `--chrome-flags=${CHROME_FLAGS}`],
    { timeout: 120_000, killSignal: 'SIGKILL' }, (error) => (error ? reject(error) : resolve(out)));
  });
}

export async function measure(url, runs = RUNS) {
  const dir = await mkdtemp(join(tmpdir(), 'lh-agentic-'));
  const reports = [];
  for (let i = 0; i < runs; i++) {
    const file = await runOnce(url, join(dir, `run-${i}.json`));
    reports.push(JSON.parse(await readFile(file, 'utf8')));
  }
  const category = reports[0].categories['agentic-browsing'];
  const audits = Object.fromEntries(category.auditRefs.map(({ id }) => [id, median(reports.map((r) => r.audits[id].score))]));
  return {
    url,
    lighthouse: reports[0].lighthouseVersion,
    chrome: reports[0].environment.hostUserAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? null,
    category: median(reports.map((r) => r.categories['agentic-browsing'].score)),
    audits,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? 'http://127.0.0.1:4318';
  const budgets = JSON.parse(await readFile(new URL('../baselines/lighthouse.json', import.meta.url), 'utf8'));
  let failed = 0;
  const results = [];
  const only = process.argv.find((a) => a.startsWith('--page='))?.slice(7); // run one page while debugging
  for (const page of budgets.pages.filter((p) => !only || p.path === only)) {
    const result = await measure(new URL(page.path, base).href);
    const rows = checkBudget(result.audits, page.audits);
    rows.push({ id: '(category)', min: page.category, got: result.category, ok: result.category >= page.category });
    failed += rows.filter((r) => !r.ok).length;
    results.push({ ...result, rows });
    console.log(`\n${page.path} (Lighthouse ${result.lighthouse}, Chrome ${result.chrome}, median of ${RUNS})`);
    console.log(table(rows.map((r) => ({ ...r, got: r.got ?? 'n/a', ok: r.ok ? 'ok' : 'REGRESSION' })), ['id', 'min', 'got', 'ok']));
  }
  await writeFile('lighthouse-agentic-report.json', JSON.stringify(results, null, 2));
  process.exitCode = failed ? 1 : 0;
}
