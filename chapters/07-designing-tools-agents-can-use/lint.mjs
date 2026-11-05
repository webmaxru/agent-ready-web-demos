#!/usr/bin/env node
// Lint the two tool sets (or a JSON file of tools) with the Chapter 7 rules.
//   node lint.mjs            both tool sets of this harness
//   node lint.mjs tools.json a tools/list answer or a getTools() dump
import { readFileSync } from 'node:fs';
import { lintTools } from '../../nordlys-cabins/layers/07-tool-design/lint.js';

const file = process.argv[2];
const sets = file
  ? { [file]: [].concat(JSON.parse(readFileSync(file, 'utf8')).tools ?? JSON.parse(readFileSync(file, 'utf8'))) }
  : { before: (await import('./toolsets/before.mjs')).tools, after: (await import('./toolsets/after.mjs')).tools };
for (const [name, tools] of Object.entries(sets)) {
  const findings = lintTools(tools);
  const errors = findings.filter((f) => f.level === 'error').length;
  console.log(`${name}: ${tools.length} tools, ${errors} errors, ${findings.length - errors} warnings`);
  for (const f of findings) console.log(`  ${f.level.padEnd(7)} ${f.tool}${f.param ? '.' + f.param : ''}  ${f.rule}: ${f.message}`);
}
