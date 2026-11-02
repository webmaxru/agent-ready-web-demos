#!/usr/bin/env node
// scan-page.mjs: look at one page the ways agents do, and report text that
// talks to an AI or that people cannot see. Uses the Chromium that Playwright
// installed, and the same heuristics as the Nordlys security layer.
//
//   node scan-page.mjs fixtures/cabin-hostile.html
//   node scan-page.mjs http://127.0.0.1:3000/cabins/fjellro --json
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { injectionSignals } from '../../nordlys-cabins/layers/16-security/untrusted.js';

const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;
/** Show invisible characters as <U+200B> in the report, so they can be seen at all. */
const visible = (t) => t.replace(new RegExp(INVISIBLE.source, 'gu'), (ch) => `<U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}>`);

/** Collect every piece of text with where it lives and whether a person can see it. */
function collect() {
  const rgb = (s) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).join(',');
  const background = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return rgb(bg);
    }
    return '255,255,255';
  };
  const why = (el) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return 'not rendered (hidden, display:none or opacity 0)';
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= document.documentElement.scrollWidth) return 'positioned off-screen';
    if (parseFloat(s.fontSize) < 4) return 'tiny font';
    if (rgb(s.color) === background(el)) return 'same colour as the background';
    return null;
  };
  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.trim();
    if (!text) continue;
    if (n.nodeType === Node.COMMENT_NODE) items.push({ where: 'HTML comment', text, hidden: 'comment (raw HTML only)' });
    else items.push({ where: `<${n.parentElement.localName}> text`, text, hidden: why(n.parentElement) });
  }
  for (const img of document.querySelectorAll('img[alt]')) items.push({ where: 'image alt text', text: img.alt, hidden: 'not shown, read by screen readers and agents' });
  // JSON-LD: every string value a person wrote (not @context, @type or URLs).
  const strings = (v, key = '') =>
    typeof v === 'string' ? (key.startsWith('@') || /^https?:/.test(v) ? [] : [v])
      : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => strings(x, k)) : [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      for (const text of strings(JSON.parse(s.textContent))) items.push({ where: 'JSON-LD value', text, hidden: 'machine-readable only' });
    } catch { items.push({ where: 'JSON-LD (unparsable)', text: s.textContent.trim(), hidden: 'machine-readable only' }); }
  }
  return items;
}

export async function scanPage(target) {
  const url = /^https?:/.test(target) ? target : pathToFileURL(target).href;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load' });
    const items = await page.evaluate(collect);
    const letters = (t) => t.replace(/[^a-z]/gi, '').toLowerCase();
    const aria = letters(await page.locator('body').ariaSnapshot());
    const findings = [];
    for (const item of items) {
      const signals = injectionSignals(item.text);
      if (INVISIBLE.test(item.text) && !signals.includes('invisible-characters')) signals.unshift('invisible-characters');
      // Hidden text alone is normal (skip links, closed <details>). Hidden text that talks to an AI is not.
      if (signals.length) {
        findings.push({ ...item, signals, inAccessibilityTree: aria.includes(letters(item.text).slice(0, 30)) });
      }
    }
    return { url, findings };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scan-page.mjs <file-or-url> [--json]');
    process.exit(2);
  }
  const report = await scanPage(target);
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.findings.length} finding(s) on ${target}`);
    for (const f of report.findings) {
      console.log(`- ${f.where}${f.hidden ? ` [${f.hidden}]` : ''}${f.inAccessibilityTree ? ' [in the accessibility tree]' : ''}`);
      console.log(`  signals: ${f.signals.join(', ') || 'none'}`);
      console.log(`  text: ${visible(f.text.replace(/\s+/g, ' ')).slice(0, 90)}`);
    }
  }
  process.exitCode = report.findings.length ? 1 : 0;
}
