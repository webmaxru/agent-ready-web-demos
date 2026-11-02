// Booking sessions shaped after the UCP Lodging draft (dev.ucp.lodging.booking).
// DRAFT IMPLEMENTATION: written against the UCP draft at commit 58c7ab9
// (31 Oct 2026). Field names follow that draft and may change before release.
import { randomBytes } from 'node:crypto';

export const SESSION_MINUTES = 15;
const minor = (nok) => nok * 100; // UCP amounts are integers in minor units

const fieldPath = {
  cabin: '$.property.id',
  checkIn: '$.stays[0].stay_dates.start_date',
  checkOut: '$.stays[0].stay_dates.end_date',
  guests: '$.stays[0].occupancy.total',
};

export function createSessions({ store, now }) {
  const sessions = new Map();

  /** Turn a UCP create request into a Nordlys availability check. */
  function open(body, { agent } = {}) {
    const stay = body?.stays?.[0] ?? {};
    const input = {
      cabin: body?.property?.id,
      checkIn: stay.stay_dates?.start_date,
      checkOut: stay.stay_dates?.end_date,
      guests: stay.occupancy?.total,
    };
    const check = store.checkAvailability(input);
    if (check.errors.length || !check.available) {
      const messages = check.errors.map((e) => ({
        type: 'error', code: e.code, path: fieldPath[e.field], content: e.message, severity: 'recoverable',
      }));
      if (!messages.length) messages.push({
        type: 'error', code: 'inventory_exhausted', content: `${check.cabin.name} is not available for those dates.`, severity: 'unrecoverable',
      });
      return { ok: false, messages };
    }
    const session = {
      id: 'bks_' + randomBytes(12).toString('base64url'),
      input, quote: check.quote, cabin: check.cabin, agent,
      booker: body.booker ?? null,
      status: 'requires_escalation',
      expiresAt: new Date(now().getTime() + SESSION_MINUTES * 60_000),
    };
    sessions.set(session.id, session);
    return { ok: true, session };
  }

  /** A session that is unknown or past its expiry is gone (UCP: canceled). */
  function get(id) {
    const s = sessions.get(id);
    if (s && s.status !== 'completed' && s.expiresAt <= now()) s.status = 'canceled';
    return s ?? null;
  }

  function update(id, body) {
    const s = get(id);
    if (s && s.status === 'requires_escalation' && body?.booker) s.booker = body.booker;
    return s;
  }

  function cancel(id) {
    const s = get(id);
    if (s && s.status !== 'completed') s.status = 'canceled';
    return s;
  }

  /** Called by the human checkout page once the guest has confirmed. */
  function complete(id, booking) {
    const s = get(id);
    if (!s || s.status !== 'requires_escalation') return null;
    const [first, ...rest] = booking.name.split(' ');
    s.status = 'completed';
    s.booking = booking;
    s.booker = { first_name: first, last_name: rest.join(' ') || first, email: booking.email };
    return s;
  }

  return { open, get, update, cancel, complete, minor };
}
