#!/usr/bin/env node
// Print an adoption plan for a site.
//   node decide.mjs --type booking --platform custom
//   node decide.mjs --type ecommerce --platform shopify
import { parseArgs } from 'node:util';
import { plan } from './plan.mjs';

const { values } = parseArgs({ options: { type: { type: 'string', default: 'booking' }, platform: { type: 'string', default: 'custom' }, 'has-api': { type: 'boolean', default: false } } });
const p = plan({ type: values.type, platform: values.platform, hasApi: values['has-api'] });
const out = [`${p.site} on ${values.platform}`, ''];
if (p.platformGives.length) out.push(`Your platform already gives you (${p.platformNote}):`, ...p.platformGives.map((g) => `  - ${g}`), '');
if (p.configure.length) out.push('Configure on the platform instead of building:', ...p.configure.map((c) => `  - ${c}`), '');
out.push('Build, in this order:', ...p.build.map((b, i) => `  ${i + 1}. ${b}`), '');
if (p.consider.length) out.push('Consider later:', ...p.consider.map((c) => `  - ${c}`), '');
if (p.skip.length) out.push('Skip for now:', ...p.skip.map((s) => `  - ${s}`), '');
if (p.also.length) out.push('Also do:', ...p.also.map((a) => `  - ${a}`), '');
out.push('Stages and what the graders see:');
for (const s of p.stages) {
  out.push(`  ${s.title}`, `    isitagentready: ${s.graders.isitagentready}`);
  if (s.graders.lighthouse.length) out.push(`    Lighthouse: ${s.graders.lighthouse.join(', ')}`);
}
console.log(out.join('\n'));
