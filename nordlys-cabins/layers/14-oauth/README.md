# Layer 14: Delegated access (Chapter 14)

Lets a Nordlys member allow an agent to act on their account, with OAuth 2.1, and
take that permission back.

- `/.well-known/oauth-authorization-server`: authorization server metadata (RFC 8414):
  authorization code flow only, PKCE `S256` only, public clients
  (`token_endpoint_auth_method: none`), `client_id_metadata_document_supported: true`,
  `authorization_response_iss_parameter_supported: true` (RFC 9207). No
  `registration_endpoint`: Dynamic Client Registration is deprecated in MCP 2026-07-28.
- `/oauth/authorize`: sign-in, then a consent page that names the application, its
  client id, the redirect host and each permission in plain words. Codes live 60
  seconds, work once and are bound to client, redirect URI, PKCE challenge,
  resource and scopes.
- `/oauth/token`, `/oauth/revoke`, `/oauth/jwks.json`: Ed25519-signed JWT access
  tokens (RFC 9068 `at+jwt`, 10 minutes, audience = `<origin>/mcp`), rotating refresh
  tokens (reuse of a spent one withdraws the grant), revocation (RFC 7009).
- `/.well-known/oauth-protected-resource/mcp` (and the same document at the root):
  Protected Resource Metadata (RFC 9728) for the MCP server from Chapter 8.
- A middleware on `/mcp`: public tools stay public. `list_my_bookings` needs
  `bookings:read`, `cancel_my_booking` needs `bookings:write`; a call without a token
  gets `401` with `WWW-Authenticate: Bearer scope=..., resource_metadata=...`, a call
  with too little scope gets `403 insufficient_scope` (step-up).
- `/account/agents`: the member's connected agents, what each may do, when it was
  last used, and a Disconnect button that stops its tokens at once.

Clients: the pre-registered `nordlys-demo-agent` (loopback redirects, see
`demos/chapters/14-connect-an-agent`) and any client identified by a Client ID
Metadata Document (an https URL, fetched with a 5 second timeout, 5 KB limit, no IP
literals or localhost). Everything is kept in memory: a restart signs everyone's
agents out, which is fine for a demo and wrong for production.

Needs layer 08 (MCP server). No new dependencies (node:crypto only).
Test: `node --test tests/ch14-*.test.js`
