// request_booking: an agent asks for a booking, the guest confirms it on our site.
// It uses the 2026-07-28 multi round-trip pattern (MRTR): instead of a server-to-
// client request, the tool answers "input_required" and the client calls again
// with the answers. Two rounds of input:
//   1. form mode: the guest's name and email (fine to collect through the agent)
//   2. URL mode: the checkout page of Chapter 12, where the guest reviews the stay
//      and accepts the terms. Nothing is booked until the guest confirms there.
import * as z from 'zod/v4';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { inputRequired, acceptedContent } from '@modelcontextprotocol/server';

const SECRET = process.env.NORDLYS_STATE_SECRET ?? randomBytes(32).toString('hex'); // per process in the demo

// requestState travels through the client and comes back as attacker-controlled
// input. The spec says to integrity-protect it when it drives business logic: we sign it.
// Following the spec's replay advice, the state is bound to a short expiry, to this
// tool and its arguments, and to the signed-in member when there is one.
const mac = (body) => createHmac('sha256', SECRET).update(body).digest('base64url');
const bindingOf = (args, member) => mac(JSON.stringify(['request_booking', args, member ?? null]));

export function sealState(payload, { args, member = null, minutes = 15 }) {
  const body = Buffer.from(JSON.stringify({ ...payload, bind: bindingOf(args, member), exp: Date.now() + minutes * 60_000 }))
    .toString('base64url');
  return `${body}.${mac(body)}`;
}
export function openState(state, { args, member = null }) {
  const [body, sig] = String(state ?? '').split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp <= Date.now() || payload.bind !== bindingOf(args, member)) return null;
  return payload;
}

const Guest = z.object({
  name: z.string().min(2).describe('Full name of the main guest'),
  email: z.email().describe('Email address for the confirmation'),
});

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });
const done = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });

/** ucpOn(path, init, origin) calls the Chapter 12 booking-session API on this same app. */
export function requestBookingTool(ctx, registerMcpTool, ucpOn) {
  // Call the session API on the origin the MCP request came in on, so continue_url points where the user is.
  const using = (extra) => {
    const from = extra.request?.url ? new URL(extra.request.url).origin : undefined;
    const ucp = (path, init) => ucpOn(path, init, from);
    return { ucp, status: async (id) => (await ucp(`/ucp/v1/booking-sessions/${id}`)).json() };
  };

  registerMcpTool(
    ctx,
    'request_booking',
    {
      title: 'Request a booking (the guest confirms)',
      description:
        'Prepare a booking of one cabin for the user. Asks for the guest\'s name and email, then sends the user to ' +
        'nordlys.example to review and confirm. Nothing is booked until the user confirms there.',
      inputSchema: z.object({
        cabin: z.string().describe('Cabin slug, for example fjellro'),
        checkIn: z.iso.date().describe('Arrival date, YYYY-MM-DD'),
        checkOut: z.iso.date().describe('Departure date, YYYY-MM-DD'),
        guests: z.number().int().min(1).describe('Number of guests'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args, extra) => {
      const { sdk } = extra;
      const { ucp, status } = using(extra);
      const bound = { args, member: extra.auth?.member?.id ?? null };
      const raw = sdk.mcpReq?.requestState?.();
      const state = raw === undefined ? null : openState(raw, bound);
      if (raw !== undefined && !state) return fail('requestState: invalid or expired, start again. (invalid_state)');
      const responses = sdk.mcpReq?.inputResponses;

      // Round 1: open a booking session, then ask who the guest is.
      if (!state) {
        const client = sdk.mcpReq?.envelope?.['io.modelcontextprotocol/clientInfo']?.name ?? 'unknown';
        const res = await ucp('/ucp/v1/booking-sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'ucp-agent': `mcp:${client}` },
          body: JSON.stringify({
            property: { id: args.cabin },
            stays: [{ stay_dates: { start_date: args.checkIn, end_date: args.checkOut }, occupancy: { total: args.guests } }],
          }),
        });
        const session = await res.json();
        if (!session.id) return fail(session.messages.map((m) => m.content).join(' '));
        return inputRequired({
          inputRequests: {
            guest: inputRequired.elicit({
              message: `Who is staying at ${session.property.name}? Nordlys sends the confirmation to this email.`,
              requestedSchema: Guest,
            }),
          },
          requestState: sealState({ step: 'guest', session: session.id }, bound),
        });
      }

      // Round 2: store the guest, then send the user to our own page to confirm.
      if (state.step === 'guest') {
        const guest = acceptedContent(responses, 'guest', Guest);
        if (!guest) return done({ status: 'not_requested', reason: 'The user did not share their name and email.' });
        const [first, ...rest] = guest.name.trim().split(/\s+/);
        const res = await ucp(`/ucp/v1/booking-sessions/${state.session}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ booker: { first_name: first, last_name: rest.join(' ') || first, email: guest.email } }),
        });
        const session = await res.json();
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicitUrl({
              message: 'Review the stay and accept the terms on nordlys.example. Nothing is booked until you confirm there.',
              url: session.continue_url,
            }),
          },
          requestState: sealState({ step: 'confirm', session: state.session }, bound),
        });
      }

      // Round 3: the user saw the page (or declined). The booking exists only if they confirmed.
      const answer = responses?.confirm?.action;
      const session = await status(state.session);
      if (session.status === 'completed') {
        return done({ status: 'confirmed', ref: session.confirmation?.id ?? null, cabin: session.property.id });
      }
      if (answer !== 'accept') {
        await ucp(`/ucp/v1/booking-sessions/${state.session}/cancel`, { method: 'POST' });
        return done({ status: 'not_booked', reason: 'The user declined to open the confirmation page.' });
      }
      return done({
        status: 'awaiting_guest',
        checkout: state.session,
        continue_url: session.continue_url,
        next: 'The user has the confirmation page. Call check_booking_request with this checkout id later.',
      });
    },
    { owner: '17-consent' }
  );

  registerMcpTool(
    ctx,
    'check_booking_request',
    {
      title: 'Check a booking request',
      description: 'Status of a booking prepared with request_booking: awaiting_guest, confirmed (with the booking reference) or expired.',
      inputSchema: z.object({ checkout: z.string().describe('The checkout id that request_booking returned') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ checkout }, extra) => {
      const { status } = using(extra);
      if (!/^bks_[\w-]+$/.test(checkout)) return fail('checkout: Not a checkout id. (invalid_checkout)');
      const session = await status(checkout);
      if (!session.id) return fail('checkout: No booking request with that id. (not_found)');
      const map = { completed: 'confirmed', requires_escalation: 'awaiting_guest', canceled: 'expired' };
      return done({ status: map[session.status] ?? session.status, ref: session.confirmation?.id ?? null });
    },
    { owner: '17-consent' }
  );
}
