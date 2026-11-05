// The protected resource: /mcp. Publishes Protected Resource Metadata (RFC 9728),
// checks bearer tokens, and challenges with WWW-Authenticate when a tool needs
// a member's permission. Public tools stay public.
import { SCOPES } from './grants.js';

/** Tools that act on a member's account, and the scopes each one needs. */
export const MEMBER_TOOLS = {
  list_my_bookings: ['bookings:read'],
  cancel_my_booking: ['bookings:write'],
};

export function resourceServer(ctx, { grants, signer, issuerOf, resourceOf }) {
  const metadataUrl = (c) => `${issuerOf(c)}/.well-known/oauth-protected-resource/mcp`;
  const metadata = (c) => JSON.stringify({
    resource: resourceOf(c),
    authorization_servers: [issuerOf(c)],
    scopes_supported: Object.keys(SCOPES),
    bearer_methods_supported: ['header'],
    resource_name: 'Nordlys Cabins MCP server',
  }, null, 2);
  const json = { contentType: 'application/json; charset=utf-8' };
  // RFC 9728 inserts the well-known segment before the resource path (/mcp).
  // MCP clients fall back to the root, and that is where scanners look.
  ctx.staticFile('/.well-known/oauth-protected-resource/mcp', metadata, json);
  ctx.staticFile('/.well-known/oauth-protected-resource', metadata, json);

  const challenge = (c, status, params) => {
    const attrs = Object.entries({ ...params, resource_metadata: metadataUrl(c) }).map(([k, v]) => `${k}="${v}"`).join(', ');
    return c.json({ error: params.error ?? 'unauthorized', error_description: params.error_description },
      status, { 'www-authenticate': `Bearer ${attrs}` });
  };

  /** A valid token for this resource, from this issuer, not expired, grant not withdrawn. */
  function verifyBearer(c, header) {
    const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
    const claims = m && signer.verify(m[1]);
    if (!claims) return null;
    if (claims.iss !== issuerOf(c) || claims.aud !== resourceOf(c) || claims.exp <= Date.now() / 1000) return null;
    const grant = grants.active(claims.gid);
    if (!grant || grant.memberId !== claims.sub) return null;
    grants.touch(grant.id);
    return {
      token: m[1], clientId: claims.client_id, scopes: claims.scope.split(' '), expiresAt: claims.exp,
      resource: new URL(claims.aud), member: ctx.store.getMember(claims.sub), extra: { grantId: grant.id },
    };
  }

  ctx.middleware(async (c, next) => {
    if (c.req.path !== '/mcp' || c.req.method !== 'POST') return next();
    const header = c.req.header('authorization');
    if (header) {
      const auth = verifyBearer(c, header);
      if (!auth) return challenge(c, 401, { error: 'invalid_token', error_description: 'The access token is invalid, expired or withdrawn.' });
      c.set('mcpAuth', auth);
    }
    // Gateways can route on the Mcp-Name header. We read the body, because the body
    // is what the MCP handler executes.
    const body = await c.req.raw.clone().json().catch(() => null);
    const needs = body?.method === 'tools/call' ? MEMBER_TOOLS[body.params?.name] : undefined;
    if (needs) {
      const auth = c.get('mcpAuth');
      if (!auth) return challenge(c, 401, { scope: needs.join(' ') });
      if (!needs.every((s) => auth.scopes.includes(s)))
        return challenge(c, 403, { error: 'insufficient_scope', scope: needs.join(' '),
          error_description: `This tool needs: ${needs.map((s) => SCOPES[s]).join(', ')}.` });
    }
    return next();
  });
}
