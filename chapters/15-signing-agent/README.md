# Chapter 15: a signing test agent

`signer.mjs` plays an agent operator. It makes a fresh Ed25519 key, serves the public
key as a Web Bot Auth key directory on a local port, signs one request with HTTP
Message Signatures (RFC 9421, `tag="web-bot-auth"`), sends it, and prints how
Nordlys labelled it.

```bash
# terminal 1: Nordlys trusts the local test agent and shows its label in a header
NORDLYS_WBA_TRUST=http://127.0.0.1:8977 NORDLYS_WBA_ALLOW_HTTP=1 NORDLYS_WBA_DEBUG=1 \
  npm start -w nordlys-cabins -- --upto=15 --port=3000
# terminal 2
node demos/chapters/15-signing-agent/signer.mjs http://127.0.0.1:3000/
```

`NORDLYS_WBA_ALLOW_HTTP=1` exists only for this local test: real directories must be
served over HTTPS. The key is created at start and never written to disk. Nordlys
itself does not sign anything; this is the other side of the conversation.
