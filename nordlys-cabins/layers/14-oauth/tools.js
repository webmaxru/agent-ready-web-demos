// Two MCP tools that act for a signed-in member. The middleware already demanded
// a token with the right scope; the handlers check again, so a tool can never run
// on someone else's account, whatever the HTTP layer let through.
import * as z from 'zod/v4';
import { registerMcpTool } from '../08-mcp-server/registry.js';
import { MEMBER_TOOLS } from './resource-server.js';

const OWNER = { owner: '14-oauth' };
const text = (t) => ({ content: [{ type: 'text', text: t }] });
const denied = (t) => ({ isError: true, ...text(t) });
const allowed = (auth, tool) => auth?.member && MEMBER_TOOLS[tool].every((s) => auth.scopes.includes(s));

const MyBooking = z.object({
  ref: z.string(), cabin: z.string(), checkIn: z.string(), checkOut: z.string(),
  guests: z.number().int(), status: z.string(), total: z.number().int(), currency: z.string(),
});
const view = (b) => ({ ref: b.ref, cabin: b.cabin, checkIn: b.checkIn, checkOut: b.checkOut,
  guests: b.guests, status: b.status, total: b.total, currency: b.currency });

export function registerMemberTools(ctx) {
  registerMcpTool(ctx, 'list_my_bookings', {
    title: 'List my bookings',
    description: 'List the signed-in member\'s Nordlys bookings. Needs the user to connect their Nordlys account (scope bookings:read).',
    inputSchema: z.object({}),
    outputSchema: z.object({ bookings: z.array(MyBooking) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (_args, { auth }) => {
    if (!allowed(auth, 'list_my_bookings')) return denied('Connect your Nordlys account first (scope bookings:read).');
    const bookings = ctx.store.bookingsForMember(auth.member.id).map(view);
    return { ...text(bookings.map((b) => `${b.ref}: ${b.cabin}, ${b.checkIn} to ${b.checkOut}, ${b.status}`).join('\n') || 'No bookings.'),
      structuredContent: { bookings } };
  }, OWNER);

  registerMcpTool(ctx, 'cancel_my_booking', {
    title: 'Cancel one of my bookings',
    description: 'Cancel a booking of the signed-in member. This cannot be undone: ask the user to confirm the booking reference first. ' +
      'Needs scope bookings:write.',
    inputSchema: z.object({ ref: z.string().regex(/^NC-[0-9A-Z]{6}$/).describe('Booking reference, for example NC-7KQ2MD') }),
    outputSchema: MyBooking.extend({ refund: z.number().int() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ ref }, { auth }) => {
    if (!allowed(auth, 'cancel_my_booking')) return denied('This needs permission to cancel bookings (scope bookings:write).');
    const booking = ctx.store.getBooking(ref);
    if (!booking || booking.memberId !== auth.member.id) return denied(`${ref} is not one of your bookings.`);
    const r = ctx.store.cancelBooking(ref);
    if (!r.ok) return denied(r.errors.map((e) => e.message).join(' '));
    ctx.events.emit('booking.cancelled', r.booking, { via: 'mcp', agent: auth.clientId });
    const out = { ...view(r.booking), refund: r.booking.refund };
    return { ...text(`Cancelled ${out.ref}. Refund: ${out.refund} NOK.`), structuredContent: out };
  }, OWNER);
}
