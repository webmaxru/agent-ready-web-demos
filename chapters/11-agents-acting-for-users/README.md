# Chapter 11: connect an agent to a Nordlys account

`agent.mjs` is a small command-line agent with no dependencies. It does what an MCP
client such as Claude or ChatGPT does when a tool needs a signed-in user:

1. calls `list_my_bookings` without a token and reads the `401` challenge,
2. reads the Protected Resource Metadata (RFC 9728) and the authorization server
   metadata (RFC 8414), and refuses a server without PKCE S256,
3. starts a one-shot web server on a free loopback port for the redirect,
4. prints the authorization address: open it, sign in as a demo member
   (`ingrid@nordlys.example`, password `nordlys-demo`) and press **Allow**,
5. exchanges the code (with the PKCE verifier and the `resource` parameter) for a
   token and calls the tool again.

```bash
npm start -w nordlys-cabins -- --upto=11 --port=3000    # in one terminal
node demos/chapters/11-agents-acting-for-users/agent.mjs http://127.0.0.1:3000
```

The client id `nordlys-demo-agent` is pre-registered in
`nordlys-cabins/layers/11-oauth/clients.js` for loopback redirects (any port, as
RFC 8252 allows). A hosted agent would use a Client ID Metadata Document instead.
The test `nordlys-cabins/tests/ch11-agent-cli.test.js` drives the same function and
plays the person in the browser.
