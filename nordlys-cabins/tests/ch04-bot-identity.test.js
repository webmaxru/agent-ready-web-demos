// Chapter 4: Web Bot Auth verification, checked against the published test
// vectors (RFC 9421 appendix B.2.6 and draft-ietf-webbotauth-httpsig-protocol-01
// appendix E.2), then wired into the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers/server.js';
import { parseSignatureInput, signatureBase, signBase, verifyBase, thumbprint, parseDictionary } from '../layers/04-bot-identity/httpsig.js';
import { createVerifier } from '../layers/04-bot-identity/verify.js';
import { directoryUrl, createDirectory } from '../layers/04-bot-identity/directory.js';
import { createDnsCheck } from '../layers/04-bot-identity/rdns.js';
import { identify } from '../layers/04-bot-identity/identity.js';
import { createKey, signRequest } from '../../chapters/04-who-gets-in/signer.mjs';

// RFC 9421 appendix B.1.4 "test-key-ed25519". A published test key: never trust it in production.
const TEST_KEY = { kty: 'OKP', crv: 'Ed25519', d: 'n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU', x: 'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs' };
const { d, ...TEST_PUBLIC } = TEST_KEY;

const vectorRequest = (headers) => new Request('https://example.com/foo?param=Value&Pet=dog', {
  method: 'POST', body: '{"hello": "world"}',
  headers: { host: 'example.com', date: 'Tue, 20 Apr 2021 02:07:55 GMT', 'content-type': 'application/json', 'content-length': '18', ...headers },
});

test('RFC 9421 B.2.6: same signature base, same Ed25519 signature', () => {
  const raw = '("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"';
  const base = signatureBase(vectorRequest(), parseSignatureInput(raw));
  assert.equal(base, [
    '"date": Tue, 20 Apr 2021 02:07:55 GMT', '"@method": POST', '"@path": /foo', '"@authority": example.com',
    '"content-type": application/json', '"content-length": 18', `"@signature-params": ${raw}`].join('\n'));
  const expected = 'wqcAqbmYJ2ji2glfAMaRy4gruYYnx2nEFN2HN6jrnDnQCK1u02Gb04v9EDgwUPiu4A0w6vuQv5lIp5WPpBKRCw==';
  assert.equal(signBase(base, TEST_KEY), expected);
  assert.ok(verifyBase(base, expected, TEST_PUBLIC));
});

// draft-ietf-webbotauth-httpsig-protocol-01, appendix E.2.1 (dictionary) and E.2.2 (legacy string).
const E21 = {
  'signature-agent': 'sig2="https://signature-agent.test"',
  'signature-input': 'sig2=("@authority" "signature-agent";key="sig2");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=4889289600;nonce="n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA==";tag="web-bot-auth"',
  signature: 'sig2=:CGokAoY/FrPpyuzTe1Fb2kLTAH9Idw6qSFd1+D77r1firsMRCxeuLu5e6O+ek3zQgDMAzjiXtLVfqE00xnABCQ==:',
};
const E22 = {
  'signature-agent': '"https://signature-agent.test"',
  'signature-input': 'sig2=("@authority" "signature-agent");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=1735693200;nonce="e8N7S2MFd/qrd6T2R3tdfAuuANngKI7LFtKYI/vowzk4lAZYadIX6wW25MwG7DCT9RUKAJ0qVkU0mEeLElW1qg==";tag="web-bot-auth"',
  signature: 'sig2=:jdq0SqOwHdyHr9+r5jw3iYZH6aNGKijYp/EstF4RQTQdi5N5YYKrD+mCT1HA1nZDsi6nJKuHxUi/5Syp3rLWBA==:',
};
const stubDirectory = (keys = [TEST_PUBLIC]) => ({ keys: async (agent) => {
  if (agent !== 'https://signature-agent.test') throw new Error('agent is not on the allowlist');
  return keys;
} });
const verifier = (extra = {}) => createVerifier({ directory: stubDirectory(), now: () => 1735689600 + 30, maxLifetime: Infinity, ...extra });

test('the test key\'s JWK thumbprint is the keyid in the draft\'s vectors', () => {
  assert.equal(thumbprint(TEST_PUBLIC), 'poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U');
});

test('draft E.2.1 (dictionary Signature-Agent) verifies, and our signer reproduces it', async () => {
  const result = await verifier()(vectorRequest(E21));
  assert.deepEqual(result, { status: 'verified', agent: 'https://signature-agent.test', keyid: 'poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U', label: 'sig2' });
  const input = parseSignatureInput(parseDictionary(E21['signature-input']).get('sig2'));
  assert.equal(signBase(signatureBase(vectorRequest(E21), input), TEST_KEY), E21.signature.slice(6, -1));
});

test('draft E.2.2 (legacy string Signature-Agent) verifies too', async () => {
  const result = await verifier()(vectorRequest(E22));
  assert.equal(result.status, 'verified');
});

test('tampering, expiry, unknown keys and untrusted agents are all "invalid", never "verified"', async () => {
  const other = new Request('https://evil.example/foo', { headers: E21 });
  assert.match((await verifier()(other)).reason, /does not verify/);
  assert.match((await verifier({ now: () => 4889289600 + 3600 })(vectorRequest(E21))).reason, /expired/);
  assert.match((await verifier({ maxLifetime: 86400 })(vectorRequest(E21))).reason, /lives too long/);
  const wrongKey = createVerifier({ directory: stubDirectory([{ ...TEST_PUBLIC, x: 'P_1c4SX6fCavDcq6FRegWcVvaOKsp_aXHPEN1FcKDIA' }]), now: () => 1735689630, maxLifetime: Infinity });
  assert.match((await wrongKey(vectorRequest(E21))).reason, /keyid/);
  const spoofed = { ...E21, 'signature-agent': 'sig2="https://chatgpt.com"' };
  assert.equal((await verifier()(vectorRequest(spoofed))).status, 'invalid');
  assert.equal((await verifier()(vectorRequest())).status, 'unsigned');
});

test('directory address: the member value as sent, or the well-known path for a bare origin', () => {
  assert.equal(directoryUrl('https://agent.bot.goog'), 'https://agent.bot.goog/.well-known/http-message-signatures-directory');
  assert.equal(directoryUrl('https://signature-agent.test/jwks.json'), 'https://signature-agent.test/jwks.json');
});

test('in the app: signed, claimed and unidentified requests get different labels', async (t) => {
  const agentUrl = 'https://agent.example';
  const key = createKey();
  const { d: _, ...pub } = key;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => String(url) === `${agentUrl}/.well-known/http-message-signatures-directory`
    ? new Response(JSON.stringify({ keys: [pub] }), { headers: { 'content-type': 'application/http-message-signatures-directory+json' } })
    : realFetch(url, init));
  const { app } = await buildApp({ upto: 4, env: { NORDLYS_WBA_TRUST: agentUrl, NORDLYS_WBA_DEBUG: '1' } });
  const label = async (req) => (await app.fetch(req)).headers.get('x-nordlys-bot-identity');

  assert.equal(await label(signRequest(new Request('http://localhost/cabins'), { privateJwk: key, agentUrl })), `verified-agent ${agentUrl}`);
  assert.equal(await label(new Request('http://localhost/cabins', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)' } })), 'claimed-agent');
  assert.equal(await label(new Request('http://localhost/cabins')), 'unidentified');
  const replayedElsewhere = signRequest(new Request('http://localhost/cabins'), { privateJwk: key, agentUrl });
  assert.equal(await label(new Request('http://localhost/account/bookings', { headers: replayedElsewhere.headers })), 'invalid-signature', 'the signature covers @path');
  const unknown = signRequest(new Request('http://localhost/cabins'), { privateJwk: key, agentUrl: 'https://not-trusted.example' });
  assert.equal(await label(unknown), 'invalid-signature');
});

test('verified agents get their own rate-limit bucket on agent endpoints', async (t) => {
  const agentUrl = 'https://agent.example';
  const key = createKey();
  const { d: _, ...pub } = key;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ keys: [pub] }), { headers: { 'content-type': 'application/http-message-signatures-directory+json' } }));
  const { app } = await buildApp({ upto: 4, env: { NORDLYS_WBA_TRUST: agentUrl } });
  const path = 'http://localhost/ucp/v1/booking-sessions/bks_missing';
  let last;
  for (let i = 0; i < 61; i++) last = await app.fetch(new Request(path));
  assert.equal(last.status, 429, 'the 61st anonymous request in a minute is refused');
  const signed = await app.fetch(signRequest(new Request(path), { privateJwk: key, agentUrl }));
  assert.equal(signed.status, 404, 'a verified agent counts against its own bucket');
});

test('agent endpoints say where the client stands with RateLimit headers', async () => {
  const { app } = await buildApp({ upto: 4 });
  const path = 'http://localhost/ucp/v1/booking-sessions/bks_missing';
  const first = await app.fetch(new Request(path, { headers: { 'x-forwarded-for': '203.0.113.7' } }));
  assert.equal(first.headers.get('ratelimit-policy'), '"anonymous";q=60;w=60');
  assert.match(first.headers.get('ratelimit'), /^"anonymous";r=59;t=\d+$/);
  let last;
  for (let i = 0; i < 60; i++) last = await app.fetch(new Request(path, { headers: { 'x-forwarded-for': '203.0.113.7' } }));
  assert.equal(last.status, 429);
  assert.match(last.headers.get('ratelimit'), /^"anonymous";r=0;t=\d+$/);
  assert.ok(Number(last.headers.get('retry-after')) >= 1);
  const other = await app.fetch(new Request(path, { headers: { 'x-forwarded-for': '198.51.100.9' } }));
  assert.equal(other.status, 404, 'another address has its own bucket');
});

test('reverse-then-forward DNS confirms a crawler only when both lookups agree', async () => {
  const zone = {
    reverse: { '66.249.66.1': ['crawl-66-249-66-1.googlebot.com.'], '203.0.113.5': ['googlebot.com.evil.example'], '198.51.100.2': ['crawl-198-51-100-2.googlebot.com'] },
    a: { 'crawl-66-249-66-1.googlebot.com': ['66.249.66.1'], 'crawl-198-51-100-2.googlebot.com': ['66.249.66.99'] },
  };
  const resolver = {
    reverse: async (ip) => zone.reverse[ip] ?? Promise.reject(new Error('ENOTFOUND')),
    resolve4: async (host) => zone.a[host] ?? [],
    resolve6: async () => [],
  };
  const check = createDnsCheck({ resolver });
  const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  assert.deepEqual(await check('66.249.66.1', ua), { status: 'confirmed', token: 'Googlebot', host: 'crawl-66-249-66-1.googlebot.com' });
  assert.equal((await check('203.0.113.5', ua)).status, 'mismatch', 'a look-alike name is not a Google name');
  assert.equal((await check('198.51.100.2', ua)).status, 'mismatch', 'the forward lookup must lead back to the same address');
  assert.equal((await check('192.0.2.1', ua)).status, 'unresolved');
  assert.equal(await check('66.249.66.1', 'curl/8.0'), null, 'no claim, nothing to confirm');
  assert.equal(identify({ status: 'unsigned' }, ua, await check('66.249.66.1', ua)).kind, 'verified-network');
  assert.equal(identify({ status: 'unsigned' }, ua, await check('203.0.113.5', ua)).network, 'mismatch');
});

test('a Signature-Agent member with parameters is ignored, and huge directories are refused', async () => {
  const agentUrl = 'https://agent.example';
  const key = createKey();
  const { d: _, ...pub } = key;
  const directory = { keys: async () => [pub] };
  const verifyRequest = createVerifier({ directory });
  const signed = signRequest(new Request('https://nordlys.example/cabins'), { privateJwk: key, agentUrl });
  assert.equal((await verifyRequest(signed)).status, 'verified');
  const headers = new Headers(signed.headers);
  headers.set('signature-agent', `sig1="${agentUrl}";x=1`);
  assert.equal((await verifyRequest(new Request(signed.url, { headers }))).status, 'invalid');

  const many = { keys: Array.from({ length: 17 }, () => pub) };
  const dir = createDirectory({ trusted: new Set([agentUrl]), fetchImpl: async () => new Response(JSON.stringify(many), { headers: { 'content-type': 'application/http-message-signatures-directory+json' } }) });
  await assert.rejects(dir.keys(agentUrl), /too many keys/);
});

test('a failing directory is not fetched again for a minute, and expired keys do not verify', async () => {
  const agentUrl = 'https://agent.example';
  let fetches = 0;
  const dir = createDirectory({ trusted: new Set([agentUrl]), fetchImpl: async () => { fetches++; return new Response('nope', { status: 503 }); } });
  await assert.rejects(dir.keys(agentUrl), /503/);
  await assert.rejects(dir.keys(agentUrl), /503/);
  assert.equal(fetches, 1);

  const key = createKey();
  const { d: _, ...pub } = key;
  const verifyRequest = createVerifier({ directory: { keys: async () => [{ ...pub, exp: 1_000_000 }] } });
  const result = await verifyRequest(signRequest(new Request('https://nordlys.example/cabins'), { privateJwk: key, agentUrl }));
  assert.deepEqual(result, { status: 'invalid', reason: 'key is outside its validity period' });
});

test('the layer audits pass', async () => {
  const { ctx } = await buildApp({ upto: 4 });
  const { ok, results } = await ctx.runAudits();
  assert.ok(ok, JSON.stringify(results));
});
