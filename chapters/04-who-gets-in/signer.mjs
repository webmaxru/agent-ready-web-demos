// A test agent that signs its requests with Web Bot Auth, the way a crawler or
// AI agent operator would. It also serves its own key directory.
// Nordlys itself never needs this: it only verifies. Use it to test your verifier.
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { serializeInput, signatureBase, signBase, thumbprint } from '../../nordlys-cabins/layers/04-bot-identity/httpsig.js';

export function createKey() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'jwk' });
}

/** Sign a Request: covers @authority, @method, @path and our Signature-Agent member. */
export function signRequest(request, { privateJwk, agentUrl, label = 'sig1', lifetime = 300, now = Math.floor(Date.now() / 1000) }) {
  const headers = new Headers(request.headers);
  headers.set('signature-agent', `${label}="${agentUrl}"`);
  const items = [
    { name: '@authority', params: {} }, { name: '@method', params: {} }, { name: '@path', params: {} },
    { name: 'signature-agent', params: { key: label } },
  ];
  const raw = serializeInput(items, {
    created: now, expires: now + lifetime, keyid: thumbprint(privateJwk), alg: 'ed25519',
    nonce: randomBytes(32).toString('base64'), tag: 'web-bot-auth',
  });
  const signed = new Request(request, { headers });
  const signature = signBase(signatureBase(signed, { items, raw }), privateJwk);
  headers.set('signature-input', `${label}=${raw}`);
  headers.set('signature', `${label}=:${signature}:`);
  return new Request(request, { headers });
}

/** Serve the public key as a directory (JWK Set) on a local port. */
export async function serveDirectory(privateJwk, port = 0) {
  const { d, ...pub } = privateJwk;
  const body = JSON.stringify({ keys: [{ ...pub, kid: thumbprint(pub), use: 'sig' }] });
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/http-message-signatures-directory') { res.statusCode = 404; return res.end(); }
    res.writeHead(200, { 'content-type': 'application/http-message-signatures-directory+json', 'cache-control': 'max-age=300' });
    res.end(body);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] ?? 'http://127.0.0.1:3000/';
  const key = createKey();
  const dir = await serveDirectory(key, Number(process.env.DIRECTORY_PORT ?? 8977));
  console.log(`Directory: ${dir.url}/.well-known/http-message-signatures-directory`);
  console.log(`keyid:     ${thumbprint(key)}`);
  const req = signRequest(new Request(target, { headers: { 'user-agent': 'NordlysTestAgent/1.0' } }), { privateJwk: key, agentUrl: dir.url });
  for (const h of ['signature-agent', 'signature-input', 'signature']) console.log(`${h}: ${req.headers.get(h)}`);
  const res = await fetch(req);
  console.log(`\n${res.status} ${res.statusText}  x-nordlys-bot-identity: ${res.headers.get('x-nordlys-bot-identity')}`);
  await dir.close();
}
