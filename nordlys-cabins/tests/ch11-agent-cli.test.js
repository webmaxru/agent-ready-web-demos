// Chapter 11: the command-line agent in demos/chapters/11-agents-acting-for-users runs the
// whole discovery and authorization flow against a real server. The test plays the
// person: it signs in and presses Allow on the consent page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieJar, formBody } from './helpers/server.js';
import { connect } from '../../chapters/11-agents-acting-for-users/agent.mjs';

test('the agent discovers the authorization server, gets consent and lists the member\'s bookings', async () => {
  const server = await startServer({ upto: 11 });
  try {
    const jar = cookieJar();
    const person = async (authorizeUrl) => {
      const login = await fetch(`${server.url}/login`, { ...formBody({ email: 'ola@nordlys.example', password: 'nordlys-demo' }), redirect: 'manual' });
      jar.store(login);
      const consent = await fetch(authorizeUrl, { headers: jar.headers(), redirect: 'manual' });
      const nonce = /name="request" value="([^"]+)"/.exec(await consent.text())[1];
      const allow = await fetch(`${server.url}/oauth/authorize`, {
        ...formBody({ request: nonce, decision: 'allow' }), headers: jar.headers(formBody({}).headers), redirect: 'manual' });
      await fetch(allow.headers.get('location')); // the browser follows the redirect to the agent's loopback server
    };
    const { tokens, bookings } = await connect(server.url, { openUrl: person });
    assert.equal(tokens.scope, 'bookings:read');
    assert.deepEqual(bookings.map((b) => b.ref), ['NC-3TBR6F']);
  } finally {
    await server.close();
  }
});
