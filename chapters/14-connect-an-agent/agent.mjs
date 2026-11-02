// A command-line agent that connects to a Nordlys member account the way an MCP
// client does it: 401 -> Protected Resource Metadata -> authorization server
// metadata -> authorization code with PKCE -> token -> the tool call again.
// Run the site first (npm start -- --upto=14), then: node agent.mjs http://127.0.0.1:3000
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const CLIENT_ID = 'nordlys-demo-agent'; // pre-registered at Nordlys for loopback redirects

/** One stateless MCP request (protocol 2026-07-28): no initialize, no session. */
export async function callTool(mcpUrl, name, args = {}, accessToken) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': name,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {},
      'io.modelcontextprotocol/clientInfo': { name: 'nordlys-demo-agent', version: '1.0.0' } } } }),
  });
  if (!res.ok) return { status: res.status, challenge: res.headers.get('www-authenticate') };
  const text = await res.text();
  const json = res.headers.get('content-type')?.includes('event-stream')
    ? JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).at(-1).slice(5)) : JSON.parse(text);
  return { status: res.status, result: json.result };
}

/** Parse key="value" pairs from a Bearer challenge. */
const params = (header) => Object.fromEntries([...header.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

export async function connect(site, { openUrl = (u) => console.log(`Open this address and sign in:\n${u}\n`) } = {}) {
  const mcpUrl = new URL('/mcp', site).toString();

  // 1. Ask without a token. The challenge says where to read about this resource.
  const first = await callTool(mcpUrl, 'list_my_bookings');
  if (first.status !== 401) throw new Error(`expected 401, got ${first.status}`);
  const { resource_metadata, scope } = params(first.challenge);

  // 2. Protected Resource Metadata (RFC 9728) names the authorization server.
  const prm = await (await fetch(resource_metadata)).json();
  if (prm.resource !== mcpUrl) throw new Error('the metadata describes another resource'); // RFC 9728, section 3.3
  const issuer = prm.authorization_servers[0];

  // 3. Authorization server metadata (RFC 8414). Refuse it if it does not do PKCE S256.
  const as = await (await fetch(new URL('/.well-known/oauth-authorization-server', issuer))).json();
  if (as.issuer !== issuer) throw new Error('issuer mismatch in authorization server metadata');
  if (!as.code_challenge_methods_supported?.includes('S256')) throw new Error('no PKCE S256, refusing to continue');

  // 4. A loopback redirect: a one-shot web server on a free port.
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  let server;
  const callback = new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      res.end('You can close this window and return to the agent.');
      if (u.searchParams.get('state') !== state) return reject(new Error('state mismatch'));
      if (u.searchParams.get('iss') !== as.issuer) return reject(new Error('iss mismatch (RFC 9207)'));
      if (u.searchParams.get('error')) return reject(new Error(`authorization failed: ${u.searchParams.get('error')}`));
      resolve(u.searchParams.get('code'));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;

  try {
    const authorize = new URL(as.authorization_endpoint);
    authorize.search = new URLSearchParams({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, scope, state, resource: prm.resource,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    });
    await openUrl(authorize.toString());
    const code = await callback;

    // 5. Exchange the code. The verifier proves we are the client that started the flow.
    const res = await fetch(as.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: CLIENT_ID,
        code_verifier: verifier, resource: prm.resource }),
    });
    if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
    const tokens = await res.json();

    // 6. The same tool call, now with the token.
    const mine = await callTool(mcpUrl, 'list_my_bookings', {}, tokens.access_token);
    return { tokens, bookings: mine.result.structuredContent.bookings };
  } finally {
    server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { bookings } = await connect(process.argv[2] ?? 'http://127.0.0.1:3000');
  for (const b of bookings) console.log(`${b.ref}  ${b.cabin}  ${b.checkIn} to ${b.checkOut}  ${b.status}`);
}
