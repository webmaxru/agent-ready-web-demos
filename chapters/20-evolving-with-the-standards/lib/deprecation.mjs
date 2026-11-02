// Deprecation (RFC 9745) and Sunset (RFC 8594) header fields: build them on the server,
// read them on the client. No dependencies.

const toEpoch = (date) => Math.floor(new Date(date).getTime() / 1000);

/**
 * Headers for a deprecated resource.
 *   deprecated: when it was (or will be) deprecated, any Date-parsable value
 *   sunset:     when it stops working (optional)
 *   policy:     a page that explains the change, linked with rel="deprecation"
 *   successor:  where to go instead, linked with rel="successor-version"
 */
export function deprecationHeaders({ deprecated, sunset, policy, successor }) {
  const headers = { deprecation: `@${toEpoch(deprecated)}` }; // RFC 9745: a Structured Field Date
  if (sunset) headers.sunset = new Date(sunset).toUTCString(); // RFC 8594: an HTTP-date
  const links = [];
  if (policy) links.push(`<${policy}>; rel="deprecation"; type="text/markdown"`);
  if (successor) links.push(`<${successor}>; rel="successor-version"`);
  if (links.length) headers.link = links.join(', ');
  return headers;
}

/** 'Deprecation: @1688169599' -> Date, or null when the value is not a Structured Field Date. */
export function parseDeprecation(value) {
  const m = /^@(-?\d{1,15})$/.exec(String(value ?? '').trim());
  return m ? new Date(Number(m[1]) * 1000) : null;
}

/** 'Sunset: Sat, 31 Dec 2018 23:59:59 GMT' -> Date, or null. */
export function parseSunset(value) {
  if (!value || !/GMT$/.test(value.trim())) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Links by relation from a Link header: { deprecation: 'https://...', ... } */
export function parseLinks(value) {
  const out = {};
  for (const part of String(value ?? '').split(/,(?=\s*<)/)) {
    const m = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    const rel = m && /rel="?([^";]+)"?/.exec(m[2]);
    if (rel) for (const r of rel[1].split(/\s+/)) out[r] = m[1];
  }
  return out;
}

/** What a careful client (or agent) does with a response: notice, and know the deadline. */
export function checkDeprecation(response, now = new Date()) {
  const deprecated = parseDeprecation(response.headers.get('deprecation'));
  const sunset = parseSunset(response.headers.get('sunset'));
  if (!deprecated && !sunset) return null;
  const links = parseLinks(response.headers.get('link'));
  return {
    deprecated: deprecated ? deprecated <= now : false,
    deprecatedSince: deprecated?.toISOString() ?? null,
    sunset: sunset?.toISOString() ?? null,
    daysLeft: sunset ? Math.ceil((sunset - now) / 86_400_000) : null,
    policy: links.deprecation ?? null,
    successor: links['successor-version'] ?? null,
  };
}
