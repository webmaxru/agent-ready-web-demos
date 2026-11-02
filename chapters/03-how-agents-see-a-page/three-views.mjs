// Chapter 3: the three views an agent can have of one page.
//   1. the HTML the server sends, read without running JavaScript
//   2. the accessibility tree after the page has rendered
//   3. a screenshot
// Usage: node three-views.mjs <url> [--out=dir]
// Prints sizes and counts for each view and saves the raw views to the out folder.
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const INTERACTIVE = new Set(['link', 'button', 'textbox', 'spinbutton', 'checkbox', 'radio', 'combobox', 'listbox', 'searchbox', 'slider', 'switch', 'tab', 'menuitem', 'option', 'Date']);
const LANDMARKS = new Set(['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search', 'form', 'region']);

/** Count the interactive nodes in a CDP accessibility tree, with and without a name. */
export function countTree(nodes) {
  const visible = nodes.filter((n) => !n.ignored);
  const interactive = visible.filter((n) => INTERACTIVE.has(n.role?.value));
  const unnamed = interactive.filter((n) => !String(n.name?.value ?? '').trim());
  const headings = visible.filter((n) => n.role?.value === 'heading').length;
  const landmarks = visible.filter((n) => LANDMARKS.has(n.role?.value)).length;
  return { total: nodes.length, visible: visible.length, interactive: interactive.length, unnamed: unnamed.length, headings, landmarks };
}

/** The interactive lines of a Playwright ARIA snapshot, such as `- button "Check availability"`. */
export function interactiveLines(snapshot) {
  return snapshot.split('\n').filter((line) => /^\s*- (link|button|textbox|spinbutton|checkbox|radio|combobox|searchbox)\b/.test(line));
}

/** Capture the three views of one URL. */
export async function threeViews(browser, url, { settle = 1000 } = {}) {
  // View 1: the server's HTML, as a fetch-only agent sees it (no JavaScript).
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const raw = await noJs.newPage();
  const response = await raw.goto(url, { waitUntil: 'load' });
  const html = await response.text();
  const htmlSnapshot = await raw.locator('body').ariaSnapshot();
  await noJs.close();

  // Views 2 and 3: the rendered page, as a browsing agent sees it.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(settle);
  const snapshot = await page.locator('body').ariaSnapshot();
  const cdp = await context.newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const domElements = await page.evaluate(() => document.querySelectorAll('*').length);
  const screenshot = await page.screenshot({ fullPage: false });
  await context.close();

  return {
    url,
    html: { bytes: Buffer.byteLength(html), interactive: interactiveLines(htmlSnapshot).length, snapshot: htmlSnapshot },
    tree: { domElements, ...countTree(nodes), snapshotBytes: Buffer.byteLength(snapshot), interactiveLines: interactiveLines(snapshot), snapshot, nodes },
    screenshot: { bytes: screenshot.length, width: 1280, height: 800, png: screenshot },
  };
}

async function main() {
  const url = process.argv[2];
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  if (!url) {
    console.error('usage: node three-views.mjs <url> [--out=dir]');
    process.exit(2);
  }
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const v = await threeViews(browser, url);
  await browser.close();

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(url);
  console.log('');
  console.log('1. Server HTML, no JavaScript');
  console.log(`   ${kb(v.html.bytes)} of HTML, ${v.html.interactive} interactive elements in the ARIA snapshot`);
  console.log('2. Rendered page, accessibility tree');
  console.log(`   ${v.tree.domElements} DOM elements, ${v.tree.total} accessibility nodes (${v.tree.visible} not ignored)`);
  console.log(`   ${v.tree.interactive} interactive nodes, ${v.tree.unnamed} of them without a name`);
  console.log(`   ${v.tree.headings} headings, ${v.tree.landmarks} landmarks`);
  console.log(`   ARIA snapshot: ${kb(v.tree.snapshotBytes)}, ${v.tree.interactiveLines.length} interactive lines`);
  console.log('3. Screenshot');
  console.log(`   ${v.screenshot.width}x${v.screenshot.height} PNG, ${kb(v.screenshot.bytes)}`);

  if (outArg) {
    const dir = outArg.slice('--out='.length);
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/1-server-html.yml`, v.html.snapshot + '\n');
    await writeFile(`${dir}/2-aria-snapshot.yml`, v.tree.snapshot + '\n');
    await writeFile(`${dir}/2-ax-tree.json`, JSON.stringify(v.tree.nodes, null, 1) + '\n');
    await writeFile(`${dir}/3-screenshot.png`, v.screenshot.png);
    console.log('');
    console.log(`Saved the three views to ${dir}/`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
