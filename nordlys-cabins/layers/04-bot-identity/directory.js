// Resolving a Signature-Agent URL to keys. Only allowlisted agents are fetched:
// every fetch is a request your server makes to a URL a stranger sent you.
const WELL_KNOWN = '/.well-known/http-message-signatures-directory';
const MEDIA_TYPE = 'application/http-message-signatures-directory+json';

/**
 * Where the keys live. draft-ietf-webbotauth-httpsig-protocol-01 fetches the
 * member value as it is. Deployments that send only an origin (the legacy string
 * form, and Google's g="https://agent.bot.goog") mean the well-known directory.
 */
export function directoryUrl(agentUrl) {
  const u = new URL(agentUrl);
  return u.pathname === '/' && !u.search ? `${u.origin}${WELL_KNOWN}` : u.href;
}

export function createDirectory({ trusted, allowHttp = false, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  const cache = new Map(); // agent URL -> { keys, until }

  return {
    isTrusted: (agentUrl) => trusted.has(new URL(agentUrl).href.replace(/\/$/, '')),

    async keys(agentUrl) {
      const id = new URL(agentUrl).href.replace(/\/$/, '');
      if (!trusted.has(id)) throw new Error('agent is not on the allowlist');
      if (new URL(id).protocol !== 'https:' && !allowHttp) throw new Error('directory must use https');
      const hit = cache.get(id);
      if (hit && hit.until > now()) {
        if (hit.error) throw new Error(hit.error); // a recent failure: don't hammer the operator
        return hit.keys;
      }
      try {
        const { keys, maxAge } = await fetchDirectory(directoryUrl(agentUrl));
        // At least 5 minutes, even for no-store: one fetch per request is what the draft warns against.
        cache.set(id, { keys, until: now() + Math.min(Math.max(maxAge, 300), 86400) * 1000 });
        return keys;
      } catch (e) {
        cache.set(id, { error: e.message, until: now() + 60_000 }); // negative cache, short on purpose
        throw e;
      }
    },
  };

  async function fetchDirectory(target) {
    const res = await fetchImpl(target, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept: MEDIA_TYPE } });
    if (res.status !== 200) throw new Error(`directory answered ${res.status}`);
    if (target.endsWith(WELL_KNOWN) && !res.headers.get('content-type')?.startsWith(MEDIA_TYPE))
      throw new Error('directory has the wrong media type');
    const text = await res.text();
    if (text.length > 65536) throw new Error('directory is too large');
    const keys = JSON.parse(text).keys;
    if (!Array.isArray(keys)) throw new Error('directory has no keys array');
    if (keys.length > 16) throw new Error('directory has too many keys');
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    return { keys, maxAge };
  }
}
