#!/usr/bin/env node
// JSON-LD checks for CI: every block parses, uses schema.org, and each type we
// rely on carries the properties agents and search engines read (Chapter 5).
// This is a local lint, not Google's Rich Results Test or the Schema Markup
// Validator: run those by hand on staging when the markup changes.
//
//   node scripts/structured-data.mjs http://127.0.0.1:4318
import { table } from './lib.mjs';

// The properties Nordlys promises per type (what Chapter 5 publishes and agents use).
// Extend it when a page starts using a new type, and keep it in review with the markup.
export const RULES = {
  Organization: ['name', 'url'],
  ItemList: ['itemListElement'],
  VacationRental: ['name', 'identifier', 'address', 'image', 'containsPlace'],
  Accommodation: ['occupancy'],
  Offer: ['priceSpecification'],
  UnitPriceSpecification: ['price', 'priceCurrency'],
  AggregateRating: ['ratingValue', 'reviewCount'],
  Review: ['author', 'datePublished', 'reviewRating', 'reviewBody'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  Question: ['name', 'acceptedAnswer'],
};

/** Every JSON-LD block in an HTML string, parsed (or the parse error). */
export function jsonLdBlocks(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return blocks.map(([, text]) => {
    try { return { ok: true, data: JSON.parse(text) }; } catch (error) { return { ok: false, error: error.message }; }
  });
}

/** Walk a JSON-LD value and yield every node with an @type. */
export function* typedNodes(value) {
  if (Array.isArray(value)) for (const v of value) yield* typedNodes(v);
  else if (value && typeof value === 'object') {
    if (value['@type']) yield value;
    for (const [k, v] of Object.entries(value)) if (k !== '@context') yield* typedNodes(v);
  }
}

export function lintPage(path, html) {
  const problems = [];
  const blocks = jsonLdBlocks(html);
  if (!blocks.length) problems.push({ path, type: '-', problem: 'no JSON-LD on the page' });
  for (const b of blocks) {
    if (!b.ok) { problems.push({ path, type: '-', problem: `does not parse: ${b.error}` }); continue; }
    const context = JSON.stringify(b.data['@context'] ?? (b.data['@graph'] ? b.data['@context'] : null));
    if (!/schema\.org/.test(context)) problems.push({ path, type: '-', problem: '@context is not schema.org' });
    for (const node of typedNodes(b.data)) {
      for (const type of [].concat(node['@type'])) {
        for (const prop of RULES[type] ?? []) {
          if (node[prop] === undefined || node[prop] === '') problems.push({ path, type, problem: `missing ${prop}` });
        }
      }
    }
  }
  return problems;
}

export const PAGES = ['/', '/cabins', '/cabins/fjellro', '/cabins/lyngen-lysthus', '/faq'];

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] ?? 'http://127.0.0.1:4318';
  const problems = [];
  for (const path of PAGES) {
    const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
    problems.push(...(res.ok ? lintPage(path, await res.text()) : [{ path, type: '-', problem: `HTTP ${res.status}` }]));
  }
  console.log(problems.length ? table(problems, ['path', 'type', 'problem']) : `JSON-LD: ${PAGES.length} pages, no problems`);
  process.exitCode = problems.length ? 1 : 0;
}
