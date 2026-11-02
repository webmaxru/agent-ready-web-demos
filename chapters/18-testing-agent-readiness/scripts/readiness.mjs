#!/usr/bin/env node
// The isitagentready-style checks of Chapter 2, run against a local or staging
// server and compared with a committed baseline: the level must not drop, and
// no check that passed in the baseline may stop passing.
//
//   node scripts/readiness.mjs http://127.0.0.1:4318
import { readFile, writeFile } from 'node:fs/promises';
import { runChecks, LEVELS } from '../../02-your-first-agent-ready-page/agent-ready-check.mjs';
import { table } from './lib.mjs';

/** Flatten { category: { check: { status } } } into { check: status }. */
export const statuses = (scan) =>
  Object.fromEntries(Object.values(scan.checks).flatMap((group) => Object.entries(group).map(([id, r]) => [id, r.status])));

export function compareReadiness(scan, baseline) {
  const now = statuses(scan);
  const rows = Object.entries(baseline.checks).map(([id, was]) => ({
    id, was, now: now[id] ?? 'missing', ok: was !== 'pass' || now[id] === 'pass',
  }));
  rows.unshift({ id: '(level)', was: baseline.level, now: scan.level, ok: scan.level >= baseline.level });
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? 'http://127.0.0.1:4318';
  const baseline = JSON.parse(await readFile(new URL('../baselines/readiness.json', import.meta.url), 'utf8'));
  const scan = await runChecks(base);
  const rows = compareReadiness(scan, baseline);
  console.log(`Readiness level ${scan.level} (${LEVELS[scan.level]}), baseline ${baseline.level}`);
  console.log(table(rows.map((r) => ({ ...r, ok: r.ok ? 'ok' : 'REGRESSION' })), ['id', 'was', 'now', 'ok']));
  if (process.argv.includes('--write-baseline')) {
    await writeFile(new URL('../baselines/readiness.json', import.meta.url), JSON.stringify({ level: scan.level, checks: statuses(scan) }, null, 2) + '\n');
  }
  process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
}
