#!/usr/bin/env node
// Usage: node report.mjs <access.log> [--ranges=ip-ranges/2026-11-02] [--json]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules } from './lib/classify.mjs';
import { buildReport, formatReport } from './lib/report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node report.mjs <access.log> [--ranges=<dir>] [--json]');
  process.exit(2);
}

const rules = loadRules({
  agentsFile: join(here, 'agents.json'),
  rangesDir: resolve(flag('ranges', join(here, 'ip-ranges', '2026-11-02'))),
});
const report = buildReport(readFileSync(file, 'utf8').split('\n'), rules);
console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
