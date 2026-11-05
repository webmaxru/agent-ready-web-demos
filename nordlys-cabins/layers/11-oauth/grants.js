// What a member has allowed which agent to do. One grant per member and client:
// the consent, its scopes, and the refresh tokens that keep it alive.
import { randomBytes, createHash } from 'node:crypto';

export const SCOPES = {
  'bookings:read': 'See your Nordlys bookings',
  'bookings:write': 'Cancel your Nordlys bookings',
};

const token = () => randomBytes(32).toString('base64url');
const hash = (t) => createHash('sha256').update(t).digest('base64url');

export function createGrants({ now }) {
  const grants = new Map(); // grant id -> grant
  const codes = new Map(); // code hash -> pending authorization code
  const refresh = new Map(); // refresh token hash -> { grantId, used }

  function upsert({ memberId, client, scopes }) {
    let g = [...grants.values()].find((x) => x.memberId === memberId && x.clientId === client.client_id && !x.revokedAt);
    if (!g) {
      g = { id: `g_${randomBytes(9).toString('base64url')}`, memberId, clientId: client.client_id, clientName: client.client_name,
        clientKind: client.kind, scopes: [], createdAt: now().toISOString(), lastUsedAt: null, revokedAt: null };
      grants.set(g.id, g);
    }
    g.scopes = [...new Set([...g.scopes, ...scopes])]; // step-up adds scopes, it never drops them
    return g;
  }

  return {
    /** Authorization codes: single use, 60 seconds, bound to everything the request said. */
    issueCode(binding) {
      const code = token();
      codes.set(hash(code), { ...binding, expires: now().getTime() + 60_000 });
      return code;
    },
    redeemCode(code) {
      const key = hash(String(code ?? ''));
      const c = codes.get(key);
      codes.delete(key);
      return c && c.expires > now().getTime() ? c : null;
    },

    upsert,
    get: (id) => grants.get(id) ?? null,
    active: (id) => { const g = grants.get(id); return g && !g.revokedAt ? g : null; },
    forMember: (memberId) => [...grants.values()].filter((g) => g.memberId === memberId && !g.revokedAt),
    touch(id) { const g = grants.get(id); if (g) g.lastUsedAt = now().toISOString(); },

    revoke(id) {
      const g = grants.get(id);
      if (g && !g.revokedAt) g.revokedAt = now().toISOString();
      for (const [k, r] of refresh) if (r.grantId === id) refresh.delete(k);
      return g ?? null;
    },

    /** Refresh tokens rotate: each one works once. Reuse of a spent token revokes the grant. */
    issueRefresh(grantId) {
      const t = token();
      refresh.set(hash(t), { grantId, used: false });
      return t;
    },
    useRefresh(t) {
      const r = refresh.get(hash(String(t ?? '')));
      if (!r) return null;
      if (r.used) { this.revoke(r.grantId); return null; }
      r.used = true;
      return this.active(r.grantId);
    },
  };
}
