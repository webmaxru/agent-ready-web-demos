import { cabinGraph } from './graph.js';

// An NLWeb-shaped question endpoint without a model: it ranks cabins by the
// words of the query and answers with each cabin's own schema.org object.
// It shows the idea behind NLWeb (Chapter 5): clean structured data is
// already most of a query API.
const words = (s) => String(s ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function ask(store, origin, query) {
  const terms = new Set(words(query).filter((t) => t.length > 2));
  const features = store.features();
  const results = store.cabins().map((cabin) => {
    const text = new Set(words([cabin.name, cabin.region, cabin.county, cabin.summary, ...cabin.features.map((f) => features[f])].join(' ')));
    const score = [...terms].filter((t) => text.has(t)).length;
    const page = { url: `${origin}/cabins/${cabin.slug}` };
    const rental = cabinGraph(page, store, cabin)['@graph'][0];
    return { url: page.url, name: cabin.name, site: origin, score, description: cabin.summary, schema_object: rental };
  });
  return results.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}
