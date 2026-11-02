// The authorization server: metadata (RFC 8414), the consent page, the token
// endpoint and revocation (RFC 7009). OAuth 2.1 rules: authorization code flow
// only, PKCE with S256 always, exact redirect URIs, short-lived codes.
import { randomBytes, createHash } from 'node:crypto';
import { layout } from '../../src/views/layout.js';
import { resolveClient, redirectAllowed } from './clients.js';
import { SCOPES } from './grants.js';

const frame = { headTags: () => '', slot: () => '', formAttrs: () => '', fieldAttrs: () => '' };
const ACCESS_TOKEN_SECONDS = 600;

export function authorizationServer(ctx, { grants, signer, issuerOf, resourceOf }) {
  const { html } = ctx.html;
  const pending = new Map(); // consent nonce -> the validated request
  const page = (c, title, body, status = 200) =>
    c.html(layout(frame, { kind: 'oauth', path: c.req.path, variant: 'clean', member: c.get('member'), title }, body), status);

  ctx.staticFile('/.well-known/oauth-authorization-server', (c) => {
    const iss = issuerOf(c);
    return JSON.stringify({
      issuer: iss,
      authorization_endpoint: `${iss}/oauth/authorize`,
      token_endpoint: `${iss}/oauth/token`,
      revocation_endpoint: `${iss}/oauth/revoke`,
      jwks_uri: `${iss}/oauth/jwks.json`,
      scopes_supported: Object.keys(SCOPES),
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    }, null, 2);
  }, { contentType: 'application/json; charset=utf-8' });

  ctx.staticFile('/oauth/jwks.json', () => JSON.stringify(signer.jwks(), null, 2), { contentType: 'application/json; charset=utf-8' });

  // Send the user back to the client with an error, but only to a redirect URI we verified.
  const back = (c, redirectUri, params) => {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries({ ...params, iss: issuerOf(c) })) if (v !== undefined) u.searchParams.set(k, v);
    return c.redirect(u.toString(), 302);
  };

  async function validate(c, q) {
    let client;
    try {
      client = await resolveClient(q.client_id);
    } catch (e) {
      return { stop: page(c, 'Unknown application', html`<h1>We could not identify this application</h1><p>${e.message}.</p>`, 400) };
    }
    if (!q.redirect_uri || !redirectAllowed(client, q.redirect_uri))
      return { stop: page(c, 'Unknown application', html`<h1>This redirect address is not registered for ${client.client_name}</h1>`, 400) };
    const fail = (error, description) => ({ stop: back(c, q.redirect_uri, { error, error_description: description, state: q.state }) });
    if (q.response_type !== 'code') return fail('unsupported_response_type', 'Only the authorization code flow is supported.');
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return fail('invalid_request', 'PKCE with S256 is required.');
    if (q.resource !== resourceOf(c)) return fail('invalid_target', `Tokens are only issued for ${resourceOf(c)}.`);
    const scopes = String(q.scope ?? '').split(' ').filter(Boolean);
    if (!scopes.length || scopes.some((s) => !SCOPES[s])) return fail('invalid_scope', `Ask for one or more of: ${Object.keys(SCOPES).join(' ')}.`);
    return { client, scopes };
  }

  ctx.route('GET', '/oauth/authorize', async (c) => {
    const q = c.req.query();
    const v = await validate(c, q);
    if (v.stop) return v.stop;
    const member = c.get('member');
    if (!member) return c.redirect(`/login?next=${encodeURIComponent(c.req.url.slice(new URL(c.req.url).origin.length))}`, 302);

    const nonce = randomBytes(18).toString('base64url');
    pending.set(nonce, { ...q, memberId: member.id, client: v.client, scopes: v.scopes, expires: Date.now() + 10 * 60_000 });
    const known = grants.forMember(member.id).find((g) => g.clientId === v.client.client_id);
    return page(c, 'Allow access', html`<h1>${v.client.client_name} wants to use your Nordlys account</h1>
      <p>It will be able to:</p>
      <ul>${v.scopes.map((s) => html`<li>${SCOPES[s]}</li>`)}</ul>
      <p>It cannot see your password or pay for anything. You can disconnect it at any time on
      <a href="/account/agents">Connected agents</a>.</p>
      <dl>
        <dt>Application</dt><dd><code>${v.client.client_id}</code> (${v.client.kind === 'metadata-document' ? 'identified by its own web address' : 'registered with Nordlys'})</dd>
        <dt>Sends you back to</dt><dd><code>${new URL(q.redirect_uri).host}</code></dd>
        ${known ? html`<dt>Already allowed</dt><dd>${known.scopes.map((s) => SCOPES[s]).join(', ')}</dd>` : ''}
      </dl>
      <form method="post" action="/oauth/authorize">
        <input type="hidden" name="request" value="${nonce}">
        <button type="submit" name="decision" value="allow">Allow</button>
        <button type="submit" name="decision" value="deny">Deny</button>
      </form>`);
  });

  ctx.route('POST', '/oauth/authorize', async (c) => {
    const { request, decision } = await c.req.parseBody();
    const p = pending.get(request);
    pending.delete(request);
    const member = c.get('member');
    if (!p || p.expires < Date.now() || !member || member.id !== p.memberId)
      return page(c, 'Request expired', html`<h1>This request has expired</h1><p>Go back to the application and try again.</p>`, 400);
    if (decision !== 'allow') return back(c, p.redirect_uri, { error: 'access_denied', state: p.state });

    const grant = grants.upsert({ memberId: member.id, client: p.client, scopes: p.scopes });
    const code = grants.issueCode({ grantId: grant.id, clientId: p.client.client_id, redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge, resource: p.resource, scopes: p.scopes });
    ctx.events.emit('agent.connected', grant, { c });
    return back(c, p.redirect_uri, { code, state: p.state });
  });

  const tokenError = (c, error, description, status = 400) =>
    c.json({ error, error_description: description }, status, { 'cache-control': 'no-store' });

  function issueTokens(c, grant, scopes, resource) {
    const now = Math.floor(Date.now() / 1000);
    const access = signer.sign({
      iss: issuerOf(c), sub: grant.memberId, aud: resource, client_id: grant.clientId,
      scope: scopes.join(' '), gid: grant.id, iat: now, exp: now + ACCESS_TOKEN_SECONDS, jti: randomBytes(9).toString('base64url'),
    });
    return c.json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS,
      scope: scopes.join(' '), refresh_token: grants.issueRefresh(grant.id) }, 200, { 'cache-control': 'no-store' });
  }

  ctx.route('POST', '/oauth/token', async (c) => {
    const f = await c.req.parseBody();
    if (f.grant_type === 'authorization_code') {
      const code = grants.redeemCode(f.code);
      if (!code) return tokenError(c, 'invalid_grant', 'The code is unknown, used or expired.');
      if (code.clientId !== f.client_id || code.redirectUri !== f.redirect_uri)
        return tokenError(c, 'invalid_grant', 'client_id or redirect_uri does not match the authorization request.');
      const challenge = createHash('sha256').update(String(f.code_verifier ?? '')).digest('base64url');
      if (challenge !== code.codeChallenge) return tokenError(c, 'invalid_grant', 'PKCE verification failed.');
      if (f.resource && f.resource !== code.resource) return tokenError(c, 'invalid_target', 'resource does not match the authorization request.');
      const grant = grants.active(code.grantId);
      if (!grant) return tokenError(c, 'invalid_grant', 'Access was withdrawn.');
      return issueTokens(c, grant, code.scopes, code.resource);
    }
    if (f.grant_type === 'refresh_token') {
      const grant = grants.useRefresh(f.refresh_token);
      if (!grant || grant.clientId !== f.client_id) return tokenError(c, 'invalid_grant', 'The refresh token is not valid.');
      const asked = String(f.scope ?? '').split(' ').filter(Boolean);
      const scopes = asked.length ? asked.filter((s) => grant.scopes.includes(s)) : grant.scopes;
      return issueTokens(c, grant, scopes, resourceOf(c));
    }
    return tokenError(c, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  });

  // RFC 7009: revoking a refresh token ends the whole grant. Always answers 200.
  ctx.route('POST', '/oauth/revoke', async (c) => {
    const { token } = await c.req.parseBody();
    const grant = grants.useRefresh(token);
    if (grant) grants.revoke(grant.id);
    return c.body(null, 200);
  });
}
