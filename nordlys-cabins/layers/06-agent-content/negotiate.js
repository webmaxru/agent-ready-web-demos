// Content negotiation for Markdown (RFC 9110, section 12.5.1).
// A client gets Markdown only when it asks for text/markdown explicitly and
// ranks it at least as high as HTML. Browsers never do, so they keep HTML.

/** Parse an Accept header into [{ type, q }]. */
export function parseAccept(header = '') {
  return header
    .split(',')
    .map((part) => {
      const [range, ...params] = part.trim().split(';').map((s) => s.trim());
      const q = params.find((p) => p.toLowerCase().startsWith('q='));
      return { type: range.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((r) => r.type && !Number.isNaN(r.q));
}

/** The q value the header gives a media type, using the most specific range. */
function qualityOf(ranges, type, { wildcards = true } = {}) {
  const [major] = type.split('/');
  const exact = ranges.find((r) => r.type === type);
  if (exact) return exact.q;
  if (!wildcards) return 0;
  const partial = ranges.find((r) => r.type === `${major}/*`);
  if (partial) return partial.q;
  const any = ranges.find((r) => r.type === '*/*');
  return any ? any.q : 0;
}

export function prefersMarkdown(accept) {
  const ranges = parseAccept(accept);
  const md = qualityOf(ranges, 'text/markdown', { wildcards: false });
  const html = qualityOf(ranges, 'text/html');
  return md > 0 && md >= html;
}
