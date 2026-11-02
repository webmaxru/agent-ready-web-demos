// A small schema.org vocabulary check: is every type known, and is every
// property allowed on the type it is used with (domainIncludes, with
// inheritance)? It reads a subset of the official vocabulary that
// vocab-subset.js extracts from https://schema.org/version/latest/.

/** Walk a JSON-LD value and call visit(type, property) for every typed node. */
export function walk(value, visit) {
  if (Array.isArray(value)) return value.forEach((v) => walk(v, visit));
  if (!value || typeof value !== 'object') return;
  const types = [].concat(value['@type'] ?? []);
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('@')) {
      if (key === '@graph') walk(child, visit);
      continue;
    }
    for (const t of types) visit(t, key);
    walk(child, visit);
  }
  for (const t of types) visit(t, null);
}

export function checkVocabulary(jsonld, vocab) {
  const problems = [];
  const ancestors = (t) => [t, ...(vocab.classes[t] ?? [])];
  walk(jsonld, (type, prop) => {
    if (!vocab.classes[type]) return problems.push(`unknown type ${type}`);
    if (prop === null) return;
    const domains = vocab.properties[prop];
    if (!domains) return problems.push(`unknown property ${prop}`);
    if (!ancestors(type).some((t) => domains.includes(t))) problems.push(`${prop} is not a property of ${type}`);
  });
  return [...new Set(problems)];
}
