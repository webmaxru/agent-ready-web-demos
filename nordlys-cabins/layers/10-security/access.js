// Reading a booking through an agent. The tool answers only the guest who owns
// the booking, returns only what the task needs, and fails the same way for
// "not yours" and "does not exist", so it cannot be used to guess references.
import * as z from 'zod/v4';

/** Who may read this booking: the signed-in member who made it, or someone who knows ref + email. */
export function canReadBooking(booking, { member = null, email = null } = {}) {
  if (!booking) return false;
  if (member && booking.memberId && member.id === booking.memberId) return true;
  return typeof email === 'string' && email.trim().toLowerCase() === booking.email;
}

/** The agent's view of a booking: no email, no phone, no guest name, no free-text requests. */
export const bookingForAgent = (b, store) => ({
  ref: b.ref,
  status: b.status,
  cabin: b.cabin,
  checkIn: b.checkIn,
  checkOut: b.checkOut,
  guests: b.guests,
  total: b.total,
  currency: b.currency,
  freeCancellationUntil: store.cancellationPolicy(b).freeUntil,
});

export function bookingTool(ctx, registerMcpTool) {
  registerMcpTool(
    ctx,
    'get_booking',
    {
      title: 'Look up a booking',
      description:
        'Show the status, dates and total of one booking. Signed-in guests can omit email. ' +
        'Others must give the email address the booking was made with.',
      inputSchema: z.object({
        ref: z.string().regex(/^NC-[0-9A-Z]{6}$/).describe('Booking reference, for example NC-4KX9TQ'),
        email: z.email().optional().describe('The email address the booking was made with'),
      }),
      outputSchema: z.object({
        ref: z.string(), status: z.enum(['confirmed', 'cancelled']), cabin: z.string(),
        checkIn: z.string(), checkOut: z.string(), guests: z.number().int(),
        total: z.number().int(), currency: z.literal('NOK'), freeCancellationUntil: z.string(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ref, email }, extra) => {
      const booking = ctx.store.getBooking(ref);
      if (!canReadBooking(booking, { member: extra.auth?.member ?? null, email })) {
        return { isError: true, content: [{ type: 'text', text: 'ref: No booking matches that reference for you. (not_found)' }] };
      }
      const value = bookingForAgent(booking, ctx.store);
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
    },
    { owner: '10-security' }
  );
}
