// Transparency: when an agent books, the guest hears it from us, not only from
// the agent. The demo keeps sent mail in memory, a real site hands it to its mailer.
import { longDate } from '../../src/views/layout.js';

const boxes = new WeakMap();

export function outbox(ctx) {
  let box = boxes.get(ctx);
  if (!box) {
    const sent = [];
    box = { send(mail) { sent.push({ ...mail, at: new Date().toISOString() }); }, sent: () => [...sent] };
    boxes.set(ctx, box);
  }
  return box;
}

/** The notice a guest receives when an agent made or prepared their booking. */
export function agentBookingNotice(record, booking, { origin, freeUntil, cabinName = booking.cabin }) {
  return {
    to: booking.email,
    subject: `Your Nordlys booking ${booking.ref} was made with an AI assistant`,
    text: [
      `Hello ${booking.name.split(' ')[0]},`,
      '',
      `${record.what}.`,
      ...(record.agent ? [`The assistant identified itself as "${record.agent}".`] : []),
      `${cabinName}, ${longDate(booking.checkIn)} to ${longDate(booking.checkOut)}, ${booking.guests} guests.`,
      `We received: ${record.dataReceived.join(', ')}.`,
      '',
      `If you did not ask for this booking, cancel it free of charge until ${freeUntil}:`,
      `${origin}/bookings`,
      `See everything agents did with your bookings: ${origin}/account/agent-activity`,
    ].join('\n'),
  };
}
