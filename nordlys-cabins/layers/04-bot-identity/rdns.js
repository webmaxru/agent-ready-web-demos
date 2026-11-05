// Reverse-then-forward DNS, the check Google documents for its crawlers and fetchers.
// A name proves nothing on its own: the forward lookup must lead back to the same address.
import { promises as dns } from 'node:dns';

// Domains from https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests
export const DNS_RULES = [
  { token: 'Googlebot', domains: ['googlebot.com', 'google.com', 'googleusercontent.com'] },
  { token: 'Google-Agent', domains: ['googlebot.com', 'google.com', 'googleusercontent.com'] },
];

export function createDnsCheck({ resolver = dns, ttl = 3_600_000, now = () => Date.now() } = {}) {
  const cache = new Map(); // "token ip" -> { result, until }

  return async function checkDns(ip, userAgent = '') {
    const rule = DNS_RULES.find((r) => userAgent.includes(r.token));
    if (!rule || !ip) return null; // nothing to confirm
    const key = `${rule.token} ${ip}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.result;

    let result = { status: 'mismatch', token: rule.token };
    try {
      for (const raw of await resolver.reverse(ip)) {
        const host = raw.toLowerCase().replace(/\.$/, '');
        if (!rule.domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
        const addresses = ip.includes(':') ? await resolver.resolve6(host) : await resolver.resolve4(host);
        if (addresses.includes(ip)) { result = { status: 'confirmed', token: rule.token, host }; break; }
      }
    } catch {
      result = { status: 'unresolved', token: rule.token }; // DNS failed: no evidence either way
    }
    cache.set(key, { result, until: now() + ttl });
    return result;
  };
}
