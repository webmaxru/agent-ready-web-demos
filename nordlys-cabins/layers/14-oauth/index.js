// Chapter 14: Agents acting for users. A small OAuth 2.1 authorization server for
// Nordlys members, Protected Resource Metadata for /mcp, two member-only MCP tools
// with scope challenges, and a page where members see and disconnect agents.
import { createSigner } from './jwt.js';
import { createGrants } from './grants.js';
import { authorizationServer } from './authorization-server.js';
import { resourceServer } from './resource-server.js';
import { registerMemberTools } from './tools.js';
import { connectedAgents } from './account.js';

export default {
  chapter: 14,
  name: 'Delegated access',
  description: 'OAuth 2.1 for agents: AS metadata, consent, PKCE, RFC 9728 metadata for /mcp, scoped member tools, connected agents page',

  register(app, ctx) {
    const grants = createGrants({ now: () => new Date() });
    const signer = createSigner();
    const issuerOf = (c) => ctx.absoluteUrl(c, '/').replace(/\/$/, '');
    const resourceOf = (c) => `${issuerOf(c)}/mcp`;
    const deps = { grants, signer, issuerOf, resourceOf };

    authorizationServer(ctx, deps);
    resourceServer(ctx, deps);
    registerMemberTools(ctx);
    connectedAgents(ctx, deps);

    ctx.audit('oauth: discovery', async ({ request }) => {
      const as = await request('/.well-known/oauth-authorization-server');
      const prm = await request('/.well-known/oauth-protected-resource');
      const a = as.status === 200 ? await as.json() : {};
      const p = prm.status === 200 ? await prm.json() : {};
      return [
        { id: 'oauth-as-metadata', ok: Boolean(a.issuer && a.authorization_endpoint && a.token_endpoint && a.grant_types_supported),
          message: 'RFC 8414 metadata with issuer, endpoints and grant types' },
        { id: 'oauth-pkce-s256', ok: (a.code_challenge_methods_supported ?? []).includes('S256'), message: 'PKCE S256 advertised' },
        { id: 'oauth-protected-resource', ok: Boolean(p.resource && p.authorization_servers?.length), message: 'RFC 9728 metadata with resource and authorization_servers' },
      ];
    });
  },
};
