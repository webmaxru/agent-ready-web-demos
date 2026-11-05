// Who is asking? OAuth clients for agents come in three kinds (MCP 2026-07-28):
// a Client ID Metadata Document (the client_id is an https URL), a pre-registered
// client, or Dynamic Client Registration (deprecated in MCP, not offered here).
import { isIP } from 'node:net';

// One pre-registered client for local experiments: a command-line agent that
// listens on a loopback port (RFC 8252 lets the port vary).
const PREREGISTERED = new Map([
  ['nordlys-demo-agent', {
    client_id: 'nordlys-demo-agent',
    client_name: 'Nordlys demo agent (command line)',
    redirect_uris: ['http://127.0.0.1/callback'],
    loopback: true,
  }],
]);

const MAX_BYTES = 5120;
const cache = new Map(); // client_id URL -> { doc, until }

/** Is this a client_id the Client ID Metadata Document draft allows us to fetch? */
export function isMetadataUrl(clientId) {
  let u;
  try { u = new URL(clientId); } catch { return false; }
  if (u.protocol !== 'https:' || u.pathname === '/' || u.hash || u.username || u.password) return false;
  // A server-side fetch of a URL the caller chose: refuse obvious internal targets.
  // (A production server also checks the resolved IP addresses, see the chapter.)
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return !(isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'));
}

async function fetchMetadata(clientId) {
  const hit = cache.get(clientId);
  if (hit && hit.until > Date.now()) return hit.doc;
  const res = await fetch(clientId, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`metadata document answered ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('metadata document is too large');
  const doc = JSON.parse(text);
  if (doc.client_id !== clientId) throw new Error('client_id in the document does not match its URL');
  if (typeof doc.client_name !== 'string' || !Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0)
    throw new Error('document needs client_name and redirect_uris');
  if (doc.token_endpoint_auth_method && doc.token_endpoint_auth_method !== 'none')
    throw new Error('only public clients (token_endpoint_auth_method "none") are supported here');
  cache.set(clientId, { doc, until: Date.now() + 10 * 60 * 1000 });
  return doc;
}

/** Resolve a client_id to { client_id, client_name, redirect_uris, kind } or throw. */
export async function resolveClient(clientId) {
  if (PREREGISTERED.has(clientId)) return { ...PREREGISTERED.get(clientId), kind: 'pre-registered' };
  if (isMetadataUrl(clientId)) return { ...(await fetchMetadata(clientId)), kind: 'metadata-document' };
  throw new Error('unknown client_id');
}

/** Exact match, except that a loopback client may use any port (RFC 8252, section 7.3). */
export function redirectAllowed(client, redirectUri) {
  if (client.redirect_uris.includes(redirectUri)) return true;
  if (!client.loopback) return false;
  try {
    const u = new URL(redirectUri);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' &&
      client.redirect_uris.some((r) => { const p = new URL(r); return p.pathname === u.pathname && !u.search; });
  } catch {
    return false;
  }
}
