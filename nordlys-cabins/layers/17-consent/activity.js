// /account/agent-activity: what agents did with a guest's bookings, in words a
// guest understands, and the same data as a JSON export (GDPR Art. 15 and 20).
import { layout, longDate } from '../../src/views/layout.js';
import { bookingRecords } from './consent.js';
import { agentActionLog } from '../16-security/audit-log.js';

const frame = { headTags: () => '', slot: () => '', formAttrs: () => '', fieldAttrs: () => '' };

/** Everything we hold about agent activity for one guest. */
export function activityFor(ctx, { email = null, member = null }) {
  const records = member ? bookingRecords(ctx).forMember(member.id) : bookingRecords(ctx).forEmail(email);
  const actions = member ? agentActionLog(ctx).entries().filter((e) => e.member === member.id) : [];
  return {
    generatedAt: new Date().toISOString(),
    bookings: records.map(({ email: _email, memberId: _m, ...r }) => r),
    toolCalls: actions.map(({ at, channel, name, client, outcome }) => ({ at, channel, tool: name, client, outcome })),
  };
}

export function activityRoutes(ctx) {
  const { html } = ctx.html;
  const { store } = ctx;
  const page = (c, body, status = 200) =>
    c.html(layout(frame, { kind: 'agent-activity', path: c.req.path, variant: 'clean', member: c.get('member'), title: 'Agent activity' }, body), status);

  const ask = (error = '') => html`<h1>What agents did with your bookings</h1>
    <p>When an AI assistant books or looks up a stay for you, we keep a record. Enter a booking reference
    and its email address to see it, or <a href="/login">sign in</a>.</p>
    ${error ? html`<div class="notice" role="alert"><p>${error}</p></div>` : ''}
    <form id="agent-activity" method="post" action="/account/agent-activity">
      <label for="agent-activity-ref">Booking reference</label>
      <input id="agent-activity-ref" name="ref" required autocomplete="off">
      <label for="agent-activity-email">Email</label>
      <input id="agent-activity-email" name="email" type="email" autocomplete="email" required>
      <button type="submit">Show activity</button>
    </form>`;

  const show = (data) => html`<h1>What agents did with your bookings</h1>
    ${data.bookings.length ? '' : html`<p>No agent has booked for you.</p>`}
    <ul>${data.bookings.map((r) => html`<li><strong>${r.ref}</strong>: ${r.what}${r.agent ? ` (${r.agent})` : ''},
      ${longDate(r.at.slice(0, 10))}. Confirmed by: ${r.confirmedBy}. We received: ${r.dataReceived.join(', ')}.</li>`)}</ul>
    ${data.toolCalls.length ? html`<h2>Tool calls with your account</h2>
      <ul>${data.toolCalls.map((t) => html`<li>${t.at.slice(0, 16).replace('T', ' ')} UTC: ${t.client} called ${t.tool} (${t.outcome})</li>`)}</ul>` : ''}
    <p>Download this as data: send the same form with "Download JSON", or <a href="/contact">ask us to delete it</a>.</p>`;

  // A signed-in member sees their own activity directly.
  ctx.route('GET', '/account/agent-activity', (c) => {
    const member = c.get('member');
    return page(c, member ? show(activityFor(ctx, { member })) : ask());
  });

  // Everyone else proves the booking is theirs, the same way as on /bookings.
  ctx.route('POST', '/account/agent-activity', async (c) => {
    const { ref, email, format } = await c.req.parseBody();
    const booking = store.findBooking(String(ref ?? ''), String(email ?? ''));
    if (!booking) return page(c, ask('No booking matches that reference and email address.'), 404);
    const data = activityFor(ctx, { email: booking.email });
    if (format === 'json') {
      c.header('content-disposition', 'attachment; filename="nordlys-agent-activity.json"');
      c.header('cache-control', 'no-store');
      return c.json(data);
    }
    return page(c, show(data));
  });
}
