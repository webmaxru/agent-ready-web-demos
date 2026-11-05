// The human side of the handoff: continue_url opens this page on Nordlys's own
// site, where the guest reviews the stay and confirms it. No agent completes it.
import { layout, money, longDate } from '../../src/views/layout.js';

const frame = { headTags: () => '', slot: () => '', formAttrs: () => '', fieldAttrs: () => '' };

export function checkoutRoutes(ctx, sessions) {
  const { html } = ctx.html;
  const { store } = ctx;
  const page = (c, title, body, status = 200) =>
    c.html(layout(frame, { kind: 'ucp-checkout', path: c.req.path, variant: 'clean', member: c.get('member'), title }, body), status);

  const review = (s, values = {}, errors = []) => {
    const q = s.quote;
    const who = s.booker ?? {};
    const name = values.name ?? [who.first_name, who.last_name].filter(Boolean).join(' ');
    return html`<h1>Review your stay at ${s.cabin.name}</h1>
      <p>An assistant prepared this booking for you. Nothing is booked until you confirm it here.</p>
      ${errors.length ? html`<div class="notice" role="alert"><ul>${errors.map((e) => html`<li>${e.message}</li>`)}</ul></div>` : ''}
      <dl>
        <dt>Dates</dt><dd>${longDate(s.input.checkIn)} to ${longDate(s.input.checkOut)} (${q.nights} nights)</dd>
        <dt>Guests</dt><dd>${s.input.guests}</dd>
        <dt>Total</dt><dd>${money(q.total, q.currency)}, cleaning fee included</dd>
        <dt>Offer valid until</dt><dd>${s.expiresAt.toISOString().slice(11, 16)} UTC</dd>
      </dl>
      <form id="ucp-checkout" method="post" action="/checkout/${s.id}">
        <label for="ucp-checkout-name">Full name</label>
        <input id="ucp-checkout-name" name="name" autocomplete="name" required value="${name}">
        <label for="ucp-checkout-email">Email</label>
        <input id="ucp-checkout-email" name="email" type="email" autocomplete="email" required value="${values.email ?? who.email ?? ''}">
        <input type="checkbox" id="ucp-checkout-acceptTerms" name="acceptTerms" value="on">
        <label for="ucp-checkout-acceptTerms">I accept the <a href="/faq#cancellation">booking and cancellation terms</a></label>
        <button type="submit">Confirm and book</button>
      </form>`;
  };

  const gone = (c) => page(c, 'Offer expired', html`<h1>This offer has expired</h1>
    <p>The prepared booking is no longer valid. <a href="/cabins">Search the cabins again</a>.</p>`, 410);

  ctx.route('GET', '/checkout/:id', (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s || s.status !== 'requires_escalation') return gone(c);
    return page(c, 'Review your stay', review(s));
  });

  ctx.route('POST', '/checkout/:id', async (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s || s.status !== 'requires_escalation') return gone(c);
    // The form adds who is booking. What is booked comes only from the session.
    const { name, email, acceptTerms } = await c.req.parseBody();
    const result = store.createBooking({ ...s.input, name, email, acceptTerms }, { member: c.get('member') });
    if (!result.ok) return page(c, 'Review your stay', review(s, { name, email }, result.errors), 422);
    sessions.complete(s.id, result.booking);
    ctx.events.emit('booking.created', result.booking, { via: 'ucp-checkout', agent: s.agent, c });
    return page(c, 'Booking confirmed', html`<h1>Booking confirmed</h1>
      <p>Your booking reference is <strong>${result.booking.ref}</strong>.
      You can <a href="/bookings">find your booking</a> with this reference and your email.</p>`);
  });
}
