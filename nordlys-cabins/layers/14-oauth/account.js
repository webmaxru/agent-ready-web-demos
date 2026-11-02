// "Connected agents": every member can see which agents may act for them, what
// they may do, when they last did it, and switch any of them off.
import { layout, longDate } from '../../src/views/layout.js';
import { SCOPES } from './grants.js';

const frame = { headTags: () => '', slot: () => '', formAttrs: () => '', fieldAttrs: () => '' };

export function connectedAgents(ctx, { grants }) {
  const { html } = ctx.html;
  const page = (c, body) =>
    c.html(layout(frame, { kind: 'connected-agents', path: c.req.path, variant: 'clean', member: c.get('member'), title: 'Connected agents' }, body));

  ctx.route('GET', '/account/agents', (c) => {
    const member = c.get('member');
    if (!member) return c.redirect('/login?next=/account/agents', 302);
    const list = grants.forMember(member.id);
    return page(c, html`<h1>Connected agents</h1>
      <p>These applications may act for you on Nordlys Cabins. They never see your password.</p>
      ${list.length === 0 ? html`<p>No agents are connected.</p>` : html`<ul class="agents">${list.map((g) => html`<li>
        <h2>${g.clientName}</h2>
        <p><code>${g.clientId}</code></p>
        <p>May: ${g.scopes.map((s) => SCOPES[s]).join(', ')}.</p>
        <p>Connected ${longDate(g.createdAt.slice(0, 10))}. ${g.lastUsedAt ? `Last used ${longDate(g.lastUsedAt.slice(0, 10))}.` : 'Not used yet.'}</p>
        <form method="post" action="/account/agents/${g.id}/revoke"><button type="submit">Disconnect</button></form>
      </li>`)}</ul>`}`);
  });

  ctx.route('POST', '/account/agents/:id/revoke', (c) => {
    const member = c.get('member');
    const g = grants.get(c.req.param('id'));
    if (!member || !g || g.memberId !== member.id) return c.redirect('/account/agents', 303);
    grants.revoke(g.id);
    ctx.events.emit('agent.disconnected', g, { c });
    return c.redirect('/account/agents', 303);
  });
}
