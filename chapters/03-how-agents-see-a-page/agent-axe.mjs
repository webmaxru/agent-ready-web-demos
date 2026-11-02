// The 33 axe-core rules behind Lighthouse's agent-accessibility-tree audit.
// Copied from Lighthouse 13.6.0, core/audits/agentic/agent-accessibility-tree.js (TARGET_RULES).
// Lighthouse may change the list in any release, so compare it when you upgrade.
export const AGENT_RULES = [
  'button-name',
  'input-button-name',
  'input-image-alt',
  'label',
  'link-name',
  'select-name',
  'document-title',
  'aria-allowed-attr',
  'aria-allowed-role',
  'aria-command-name',
  'aria-conditional-attr',
  'aria-dialog-name',
  'aria-hidden-body',
  'aria-hidden-focus',
  'aria-input-field-name',
  'aria-prohibited-attr',
  'aria-required-attr',
  'aria-required-children',
  'aria-required-parent',
  'aria-roles',
  'aria-text',
  'aria-toggle-field-name',
  'aria-tooltip-name',
  'aria-treeitem-name',
  'aria-valid-attr',
  'aria-valid-attr-value',
  'duplicate-id-aria',
  'definition-list',
  'table-duplicate-name',
  'tabindex',
  'autocomplete-valid',
  'presentation-role-conflict',
  'svg-img-alt',
];

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Inject axe-core into the page and run it. `rules` limits the run to those rule ids.
 * A site with a Content Security Policy blocks the injected script, so open the page
 * in a browser context created with { bypassCSP: true }, as main() below does.
 */
export async function runAxe(page, rules = AGENT_RULES) {
  const source = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({ content: source });
  return page.evaluate(async (ids) => {
    const options = ids ? { runOnly: { type: 'rule', values: ids } } : { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } };
    const result = await window.axe.run(document, options);
    return {
      version: window.axe.version,
      violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) })),
      incomplete: result.incomplete.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) })),
      passes: result.passes.length,
      inapplicable: result.inapplicable.length,
    };
  }, rules);
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const targets = args.filter((a) => !a.startsWith('--')).map((a) => (/^https?:/.test(a) ? a : pathToFileURL(a).href));
  if (!targets.length) {
    console.error('usage: node agent-axe.mjs [--all] <url or file> [...]');
    process.exit(2);
  }
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ bypassCSP: true });
  let failed = 0;
  for (const url of targets) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1000); // give late scripts time to render, like a patient agent
    const result = await runAxe(page, all ? null : AGENT_RULES);
    console.log(`${url}  (axe-core ${result.version}, ${all ? 'WCAG 2.x A/AA and best practices' : `${AGENT_RULES.length} agent rules`})`);
    if (!result.violations.length) console.log('  no violations');
    for (const v of result.violations) {
      failed += 1;
      console.log(`  ${v.id.padEnd(24)} ${v.impact.padEnd(9)} ${v.help}`);
      for (const node of v.nodes.slice(0, 3)) console.log(`      ${node}`);
      if (v.nodes.length > 3) console.log(`      ... and ${v.nodes.length - 3} more`);
    }
    for (const v of result.incomplete) console.log(`  needs review: ${v.id} (${v.nodes.length} ${v.nodes.length === 1 ? 'element' : 'elements'})`);
    await page.close();
  }
  await browser.close();
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
