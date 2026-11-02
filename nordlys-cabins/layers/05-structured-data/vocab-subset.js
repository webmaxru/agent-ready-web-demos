// Regenerate schemaorg-subset.json: node layers/05-structured-data/vocab-subset.js
// It renders the pages that carry JSON-LD, collects every type and property
// they use, and copies their definitions from the official vocabulary file.
import { writeFile } from 'node:fs/promises';
import { createApp } from '../../src/app.js';
import { walk } from './schema-check.js';

const VOCAB = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const PAGES = ['/', '/cabins', ...['fjellro', 'reine-rorbu'].map((s) => `/cabins/${s}`), '/guide/northern-lights-from-a-cabin', '/faq'];

const { app } = await createApp({ overrides: { upto: 5, now: '2026-11-10' } });
const used = { types: new Set(), props: new Set() };
for (const path of PAGES) {
  const html = await (await app.request(path)).text();
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    walk(JSON.parse(m[1]), (t, p) => (used.types.add(t), p && used.props.add(p)));
  }
}

const graph = (await (await fetch(VOCAB)).json())['@graph'];
const byId = new Map(graph.map((n) => [n['@id'], n]));
const ids = (v) => [].concat(v ?? []).map((x) => x['@id'].replace(/^schema:/, ''));
const supers = (t, seen = new Set()) => {
  for (const s of ids(byId.get(`schema:${t}`)?.['rdfs:subClassOf'])) if (!seen.has(s)) seen.add(s), supers(s, seen);
  return [...seen];
};
const classes = Object.fromEntries([...used.types].sort().map((t) => [t, supers(t)]));
const properties = Object.fromEntries([...used.props].sort().map((p) => [p, ids(byId.get(`schema:${p}`)?.['schema:domainIncludes'])]));
const out = { source: VOCAB, generated: new Date().toISOString().slice(0, 10), classes, properties };
await writeFile(new URL('./schemaorg-subset.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`${Object.keys(classes).length} types, ${Object.keys(properties).length} properties`);
