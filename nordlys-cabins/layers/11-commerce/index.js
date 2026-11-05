// Chapter 11: Agents that buy. A UCP-style business profile, booking sessions
// shaped after the UCP Lodging draft, and a human checkout handoff.
import { createSessions } from './sessions.js';
import { businessProfile, bookingSession } from './ucp.js';
import { checkoutRoutes } from './checkout.js';
import { x402Demo } from './x402-demo.js';

export default {
  chapter: 11,
  order: 1,
  name: 'Agent commerce',
  description: 'UCP-style profile, lodging booking sessions, human checkout handoff (draft implementation)',

  register(app, ctx) {
    const now = () => new Date(Date.now()); // sessions expire in real time
    const sessions = createSessions({ store: ctx.store, now });
    const origin = (c) => ctx.absoluteUrl(c, '/').replace(/\/$/, '');
    const show = (c, s, status = 200) => c.json(bookingSession(s, {
      origin: origin(c), minor: sessions.minor,
      policy: ctx.store.cancellationPolicy({ checkIn: s.input.checkIn }),
    }), status);
    const notFound = (c) => c.json({
      ucp: { version: '2026-08-25', status: 'error' },
      messages: [{ type: 'error', code: 'not_found', content: 'No booking session with that id.', severity: 'unrecoverable' }],
    }, 404);

    ctx.staticFile('/.well-known/ucp', (c) => JSON.stringify(businessProfile(origin(c)), null, 2));

    const base = '/ucp/v1/booking-sessions';
    ctx.route('POST', base, async (c) => {
      const body = await c.req.json().catch(() => null);
      const result = sessions.open(body, { agent: c.req.header('ucp-agent') ?? null });
      if (!result.ok) return c.json({ ucp: { version: '2026-08-25', status: 'error' }, messages: result.messages }, 200);
      return show(c, result.session, 201);
    });
    ctx.route('GET', `${base}/:id`, (c) => {
      const s = sessions.get(c.req.param('id'));
      return s ? show(c, s) : notFound(c);
    });
    ctx.route('PUT', `${base}/:id`, async (c) => {
      const s = sessions.update(c.req.param('id'), await c.req.json().catch(() => null));
      return s ? show(c, s) : notFound(c);
    });
    // Complete never finalises: without AP2 mandates the guest confirms on our site.
    ctx.route('POST', `${base}/:id/complete`, (c) => {
      const s = sessions.get(c.req.param('id'));
      return s ? show(c, s) : notFound(c);
    });
    ctx.route('POST', `${base}/:id/cancel`, (c) => {
      const s = sessions.cancel(c.req.param('id'));
      return s ? show(c, s) : notFound(c);
    });

    checkoutRoutes(ctx, sessions);
    if (ctx.config.env?.NORDLYS_X402_DEMO === '1') x402Demo(ctx);

    ctx.audit('commerce: UCP profile', async ({ request }) => {
      const res = await request('/.well-known/ucp');
      const profile = res.status === 200 ? await res.json() : null;
      return [
        { id: 'ucp-profile', ok: Boolean(profile?.ucp?.version && profile.ucp.services), message: '/.well-known/ucp has ucp.version and ucp.services' },
        { id: 'ucp-no-agent-payments', ok: Boolean(profile) && Object.keys(profile.ucp.payment_handlers).length === 0, message: 'no payment handlers: guests pay on the site' },
      ];
    });
  },
};
