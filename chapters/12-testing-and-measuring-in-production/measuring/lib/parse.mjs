// Read access logs: the Apache/nginx "combined" format and a JSON-lines variant.

const COMBINED =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\S+) "([^"]*)" "([^"]*)"/;

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** '02/Nov/2026:10:15:32 +0100' -> ISO string in UTC */
function combinedTime(t) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const [, d, mon, y, hh, mm, ss, sign, oh, om] = m;
  const offset = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  return new Date(Date.UTC(+y, MONTHS[mon], +d, +hh, +mm, +ss) - offset * 60_000).toISOString();
}

/** One log line -> a request record, or null for comments, blanks and junk. */
export function parseLine(line) {
  const s = line.trim();
  if (!s || s.startsWith('#')) return null;
  if (s.startsWith('{')) {
    let j;
    try { j = JSON.parse(s); } catch { return null; }
    return {
      time: j.time ?? j.ts ?? null,
      ip: j.ip ?? j.clientIP ?? null,
      method: j.method ?? 'GET',
      path: j.path ?? j.url ?? '/',
      status: Number(j.status ?? 0),
      referer: j.referer ?? j.referrer ?? '',
      userAgent: j.ua ?? j.userAgent ?? '',
      contentType: j.contentType ?? null,
      signature: j.signature ?? null, // 'verified' | 'invalid' | null, from your Web Bot Auth check
      signatureAgent: j.signatureAgent ?? null,
    };
  }
  const m = COMBINED.exec(s);
  if (!m) return null;
  const [, ip, time, method, path, status, , referer, userAgent] = m;
  return {
    time: combinedTime(time), ip, method, path, status: Number(status),
    referer: referer === '-' ? '' : referer, userAgent: userAgent === '-' ? '' : userAgent,
    contentType: null, signature: null, signatureAgent: null,
  };
}

/** HTML page requests, the unit both Cloudflare's crawl-to-refer ratio and this tool count. */
export function isHtmlRequest(r) {
  if (r.method !== 'GET' || r.status < 200 || r.status >= 300) return false;
  if (r.contentType) return r.contentType.startsWith('text/html');
  const path = r.path.split('?')[0];
  if (/^\/(api|mcp)(\/|$)/.test(path)) return false; // machine endpoints: adjust for your site
  return path.endsWith('/') || path.endsWith('.html') || !/\.[a-z0-9]{1,8}$/i.test(path);
}
