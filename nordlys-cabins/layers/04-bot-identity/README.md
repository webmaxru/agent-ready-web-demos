# Layer 04-bot-identity (Chapter 4)

Nordlys Cabins verifies who an automated client is. It never signs anything itself.

What the layer does, in order, for every request (in `ctx.beforeAuth`):

1. **Web Bot Auth** (`verify.js`, `httpsig.js`, `directory.js`): if the request carries
   `Signature-Input`, `Signature` and `Signature-Agent`, verify the HTTP Message Signature
   (RFC 9421, Ed25519) against the key directory of the agent named in `Signature-Agent`,
   following draft-ietf-webbotauth-httpsig-protocol-01. Only allowlisted agents are fetched
   (`https://chatgpt.com` and `https://agent.bot.goog` by default, more with `NORDLYS_WBA_TRUST`).
   No dependencies: `node:crypto` only.
2. **DNS confirmation** (`rdns.js`, off unless `NORDLYS_RDNS=1`): for unsigned requests that
   claim to be Googlebot or Google-Agent, reverse DNS, a Google domain check and a forward
   lookup back to the same address, as Google documents.
3. **A label** (`identity.js`): `verified-agent`, `invalid-signature`, `verified-network`,
   `claimed-agent` or `unidentified`, stored as `c.get('botIdentity')` and emitted as the
   `bot.identified` event (layer 12-agent-analytics uses it).
4. **Rate limits per class** (`ratelimit.js`) on `/mcp` and `/ucp/*`: 300 requests a minute per
   verified agent, 120 per DNS-confirmed crawler, 60 per address for everyone else, announced
   with `RateLimit-Policy` and `RateLimit` (draft-ietf-httpapi-ratelimit-headers-11) and
   `Retry-After` on `429`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NORDLYS_WBA_TRUST` | (empty) | extra agent URLs whose directories may be fetched, comma-separated |
| `NORDLYS_WBA_ALLOW_HTTP` | off | allow `http://` directories (local tests with the signing agent only) |
| `NORDLYS_WBA_DEBUG` | off | add `x-nordlys-bot-identity` to responses |
| `NORDLYS_RDNS` | off | confirm Google crawler claims with reverse and forward DNS |

Test: `node --test nordlys-cabins/tests/ch04-bot-identity.test.js` (12 tests, including the
RFC 9421 B.2.6 and draft E.2 test vectors). A signing test agent lives in
`chapters/04-who-gets-in/`.
