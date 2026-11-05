// Chapter 11: delegated access. A member connects an agent with OAuth 2.1
// (authorization code + PKCE), the agent calls member-only MCP tools, and the
// member can see and withdraw that access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApp, cookieJar, formBody } from './helpers/server.js';

const ORIGIN = 'http://localhost'; // app.request() uses this origin
const RESOURCE = `${ORIGIN}/mcp`;
const CLIENT = 'nordlys-demo-agent';
const REDIRECT = 'http://127.0.0.1:8976/callback';

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function signIn(app, jar, email = 'ingrid@nordlys.example') {
  const res = jar.store(await app.request('/login', formBody({ email, password: 'nordlys-demo', next: '/account/bookings' })));
  assert.equal(res.status, 303);
}

/** Walk the whole flow: authorize, consent, code, token. Returns the token response. */
async function connectAgent(app, jar, { scope = 'bookings:read', clientId = CLIENT, redirect = REDIRECT } = {}) {
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope, state: 'xyz',
    code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
  const consent = await app.request(`/oauth/authorize?${q}`, { headers: jar.headers() });
  assert.equal(consent.status, 200);
  const html = await consent.text();
  const nonce = /name="request" value="([^"]+)"/.exec(html)[1];
  const allow = await app.request('/oauth/authorize', { ...formBody({ request: nonce, decision: 'allow' }), headers: jar.headers(formBody({}).headers) });
  assert.equal(allow.status, 302);
  const back = new URL(allow.headers.get('location'));
  assert.equal(back.searchParams.get('state'), 'xyz');
  assert.equal(back.searchParams.get('iss'), ORIGIN);
  const token = await app.request('/oauth/token', formBody({ grant_type: 'authorization_code', code: back.searchParams.get('code'),
    redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: RESOURCE }));
  assert.equal(token.status, 200);
  return { ...(await token.json()), html };
}

async function mcp(app, accessToken) {
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
      return app.fetch(new Request(url, { ...init, headers }));
    },
  });
  const client = new Client({ name: 'nordlys-test-agent', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const rawCall = (app, name, args = {}, token) => app.request('/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28',
    'mcp-method': 'tools/call', 'mcp-name': name, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args,
    _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '1.0.0' } } } }),
});

test('discovery: protected resource metadata points at the authorization server', async () => {
  const { app } = await buildApp({ upto: 11 });
  const prm = await (await app.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(prm.resource, RESOURCE);
  assert.deepEqual(prm.authorization_servers, [ORIGIN]);
  assert.deepEqual(prm.scopes_supported, ['bookings:read', 'bookings:write']);
  const root = await (await app.request('/.well-known/oauth-protected-resource')).json();
  assert.deepEqual(root, prm);
  const as = await (await app.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(as.issuer, ORIGIN);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.equal(as.authorization_response_iss_parameter_supported, true);
  assert.equal(as.registration_endpoint, undefined);
});

test('public tools need no token, member tools answer 401 with a scope hint', async () => {
  const { app } = await buildApp({ upto: 11 });
  const client = await mcp(app);
  const found = await client.callTool({ name: 'search_cabins', arguments: { region: 'Lofoten' } });
  assert.equal(found.structuredContent.count, 1);
  await client.close();
  const res = await rawCall(app, 'list_my_bookings');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'),
    `Bearer scope="bookings:read", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
});

test('a member connects an agent and the agent lists only that member\'s bookings', async () => {
  const { app } = await buildApp({ upto: 11 });
  const jar = cookieJar();
  await signIn(app, jar);
  const tokens = await connectAgent(app, jar);
  assert.match(tokens.html, /Nordlys demo agent \(command line\) wants to use your Nordlys account/);
  assert.match(tokens.html, /See your Nordlys bookings/);
  assert.match(tokens.html, /127\.0\.0\.1:8976/);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.scope, 'bookings:read');
  const client = await mcp(app, tokens.access_token);
  const mine = await client.callTool({ name: 'list_my_bookings', arguments: {} });
  assert.deepEqual(mine.structuredContent.bookings.map((b) => b.ref), ['NC-7KQ2MD', 'NC-H4WX9P']);
  await client.close();
});

test('cancelling needs bookings:write: 403 insufficient_scope, then step-up', async () => {
  const { app, ctx } = await buildApp({ upto: 11 });
  const jar = cookieJar();
  await signIn(app, jar);
  const read = await connectAgent(app, jar);
  const res = await rawCall(app, 'cancel_my_booking', { ref: 'NC-7KQ2MD' }, read.access_token);
  assert.equal(res.status, 403);
  assert.match(res.headers.get('www-authenticate'), /^Bearer error="insufficient_scope", scope="bookings:write"/);

  const write = await connectAgent(app, jar, { scope: 'bookings:read bookings:write' });
  assert.match(write.html, /Already allowed/);
  let cancelled;
  ctx.events.on('booking.cancelled', (b, meta) => { cancelled = { ref: b.ref, ...meta }; });
  const client = await mcp(app, write.access_token);
  const other = await client.callTool({ name: 'cancel_my_booking', arguments: { ref: 'NC-3TBR6F' } });
  assert.equal(other.isError, true, 'Ola\'s booking is not Ingrid\'s to cancel');
  const done = await client.callTool({ name: 'cancel_my_booking', arguments: { ref: 'NC-7KQ2MD' } });
  assert.equal(done.structuredContent.status, 'cancelled');
  assert.deepEqual(cancelled, { ref: 'NC-7KQ2MD', via: 'mcp', agent: CLIENT });
  await client.close();
});

test('tokens cannot be edited, and a lying Mcp-Name header changes nothing', async () => {
  const { app } = await buildApp({ upto: 11 });
  const jar = cookieJar();
  await signIn(app, jar);
  const { access_token } = await connectAgent(app, jar);
  const [h, p, s] = access_token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  // Changing a claim (here the audience) breaks the Ed25519 signature.
  const otherAudience = `${h}.${Buffer.from(JSON.stringify({ ...claims, aud: 'https://api.other.example' })).toString('base64url')}.${s}`;
  const r1 = await rawCall(app, 'list_my_bookings', {}, otherAudience);
  assert.equal(r1.status, 401);
  assert.match(r1.headers.get('www-authenticate'), /error="invalid_token"/);
  // The header says a public tool, the body asks for a member tool: the body decides.
  const lying = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'search_cabins' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_my_bookings', arguments: {} } }),
  });
  assert.equal(lying.status, 401);
});

test('the authorization server refuses requests without PKCE, for other resources or unknown redirects', async () => {
  const { app } = await buildApp({ upto: 11 });
  const jar = cookieJar();
  await signIn(app, jar);
  const base = { response_type: 'code', client_id: CLIENT, redirect_uri: REDIRECT, scope: 'bookings:read', state: 's', resource: RESOURCE };
  const noPkce = await app.request(`/oauth/authorize?${new URLSearchParams(base)}`, { headers: jar.headers() });
  assert.equal(new URL(noPkce.headers.get('location')).searchParams.get('error'), 'invalid_request');
  const { challenge } = pkce();
  const pk = { code_challenge: challenge, code_challenge_method: 'S256' };
  const other = await app.request(`/oauth/authorize?${new URLSearchParams({ ...base, ...pk, resource: 'https://api.other.example' })}`, { headers: jar.headers() });
  assert.equal(new URL(other.headers.get('location')).searchParams.get('error'), 'invalid_target');
  const evil = await app.request(`/oauth/authorize?${new URLSearchParams({ ...base, ...pk, redirect_uri: 'https://evil.example/cb' })}`, { headers: jar.headers() });
  assert.equal(evil.status, 400, 'never redirect to an unregistered address');
  const signedOut = await app.request(`/oauth/authorize?${new URLSearchParams({ ...base, ...pk })}`);
  assert.equal(signedOut.status, 302);
  assert.match(signedOut.headers.get('location'), /^\/login\?next=%2Foauth%2Fauthorize/);
});

test('codes work once, refresh tokens rotate, and reuse ends the grant', async () => {
  const { app } = await buildApp({ upto: 11 });
  const jar = cookieJar();
  await signIn(app, jar);
  const first = await connectAgent(app, jar);
  const refresh = (t) => app.request('/oauth/token', formBody({ grant_type: 'refresh_token', refresh_token: t, client_id: CLIENT }));
  const second = await refresh(first.refresh_token);
  assert.equal(second.status, 200);
  const next = await second.json();
  const reuse = await refresh(first.refresh_token);
  assert.equal(reuse.status, 400);
  assert.equal((await refresh(next.refresh_token)).status, 400, 'reuse of a spent token withdrew the whole grant');
  assert.equal((await rawCall(app, 'list_my_bookings', {}, next.access_token)).status, 401);
});

test('a client identified by its metadata document (CIMD)', async (t) => {
  const { app } = await buildApp({ upto: 11 });
  const clientId = 'https://agent.example.com/oauth/client.json';
  const doc = { client_id: clientId, client_name: 'Example Travel Agent', redirect_uris: ['https://agent.example.com/callback'],
    grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) =>
    String(url) === clientId ? new Response(JSON.stringify(doc), { headers: { 'content-type': 'application/json' } }) : realFetch(url, init));
  const jar = cookieJar();
  await signIn(app, jar);
  const tokens = await connectAgent(app, jar, { clientId, redirect: 'https://agent.example.com/callback' });
  assert.match(tokens.html, /Example Travel Agent wants to use your Nordlys account/);
  assert.match(tokens.html, /identified by its own web address/);
  const local = await app.request(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'https://127.0.0.1/client.json',
    redirect_uri: 'https://127.0.0.1/cb', scope: 'bookings:read', resource: RESOURCE, code_challenge: 'x', code_challenge_method: 'S256' })}`, { headers: jar.headers() });
  assert.equal(local.status, 400, 'no server-side fetch of an IP address');
});

test('members see connected agents and can disconnect them', async () => {
  const { app } = await buildApp({ upto: 11 });
  const jar = cookieJar();
  await signIn(app, jar);
  const { access_token } = await connectAgent(app, jar);
  const page = await (await app.request('/account/agents', { headers: jar.headers() })).text();
  assert.match(page, /Nordlys demo agent \(command line\)/);
  const id = /action="\/account\/agents\/([^/]+)\/revoke"/.exec(page)[1];
  const off = await app.request(`/account/agents/${id}/revoke`, { ...formBody({}), headers: jar.headers(formBody({}).headers) });
  assert.equal(off.status, 303);
  assert.equal((await rawCall(app, 'list_my_bookings', {}, access_token)).status, 401, 'the access token stops working at once');
  assert.match(await (await app.request('/account/agents', { headers: jar.headers() })).text(), /No agents are connected/);
});

test('the layer audits pass', async () => {
  const { ctx } = await buildApp({ upto: 11 });
  const { ok, results } = await ctx.runAudits();
  assert.ok(ok, JSON.stringify(results));
  assert.equal(results.find((r) => r.layer === '11-oauth').checks.length, 3);
});
