// The booking service behind every machine interface of Nordlys Cabins.
// The public API (Chapter 8) and the MCP server (Chapter 8) both call it, so
// an agent gets the same answers whichever door it uses. It wraps ctx.store,
// the same business logic the booking form uses, and adds the two things a
// machine client needs on top: stable output shapes and idempotent booking.
import { createHash } from 'node:crypto';

const services = new WeakMap();

/** One booking service per app (per ctx), shared by every layer that imports it. */
export function bookingService(ctx) {
  let service = services.get(ctx);
  if (!service) {
    service = createBookingService(ctx);
    services.set(ctx, service);
  }
  return service;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // keys are remembered for 24 hours

function createBookingService(ctx) {
  const { store } = ctx;
  const keys = new Map(); // idempotency key -> { fingerprint, done, result, expires }

  const summary = (cabin) => ({
    slug: cabin.slug,
    name: cabin.name,
    region: cabin.region,
    summary: cabin.summary,
    maxGuests: cabin.maxGuests,
    bedrooms: cabin.bedrooms,
    features: cabin.features,
    nightlyRate: cabin.nightlyRate,
    weekendRate: cabin.weekendRate,
    cleaningFee: cabin.cleaningFee,
    currency: cabin.currency,
    minNights: cabin.minNights,
    page: `/cabins/${cabin.slug}`,
  });

  const details = (cabin) => ({
    ...summary(cabin),
    description: cabin.description.join('\n\n'),
    beds: cabin.beds,
    checkInTime: cabin.checkInTime,
    checkOutTime: cabin.checkOutTime,
    geo: cabin.geo,
    unavailable: store.unavailableRanges(cabin.slug).map(({ from, to }) => ({ from, to })),
  });

  const publicBooking = (b) => ({
    ref: b.ref,
    status: b.status,
    cabin: b.cabin,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    guests: b.guests,
    name: b.name,
    total: b.total,
    currency: b.currency,
    freeCancellationUntil: store.cancellationPolicy(b).freeUntil,
    ...(b.status === 'cancelled' ? { refund: b.refund } : {}),
    page: `/bookings/${b.ref}`,
  });

  const fail = (code, field, message) => ({ ok: false, errors: [{ field, code, message }] });

  function searchCabins(filters = {}) {
    return store.searchCabins(filters).map(summary);
  }

  function getCabin(slug) {
    const cabin = store.getCabin(slug);
    return cabin ? { ok: true, value: details(cabin) } : fail('unknown_cabin', 'cabin', `There is no cabin "${slug}".`);
  }

  function checkAvailability({ cabin, checkIn, checkOut, guests }) {
    const r = store.checkAvailability({ cabin, checkIn, checkOut, guests });
    if (r.errors.length) return { ok: false, errors: r.errors };
    const { currency, nights, accommodation, cleaningFee, total } = r.quote;
    return {
      ok: true,
      value: {
        cabin: r.cabin.slug,
        checkIn,
        checkOut,
        guests: Number(guests),
        available: r.available,
        conflicts: r.conflicts,
        quote: { currency, nights, accommodation, cleaningFee, total },
      },
    };
  }

  /**
   * Create a booking. The same idempotency key with the same input returns the
   * first result again instead of booking twice. The same key with different
   * input is refused.
   */
  function createBooking(input, { idempotencyKey, via, member = null, c = null } = {}) {
    if (!idempotencyKey) return fail('idempotency_key_missing', 'idempotencyKey', 'Send an idempotency key (a fresh UUID) with every booking request.');
    const now = Date.now();
    for (const [k, v] of keys) if (v.expires < now) keys.delete(k);
    const fingerprint = fingerprintOf(input);
    const seen = keys.get(idempotencyKey);
    if (seen) {
      if (seen.fingerprint !== fingerprint)
        return fail('idempotency_key_reused', 'idempotencyKey', 'This idempotency key was already used for a different booking request. Use a new key.');
      if (!seen.done) return fail('idempotency_key_in_flight', 'idempotencyKey', 'A request with this idempotency key is still being processed. Retry in a moment.');
      return { ...seen.result, replayed: true };
    }
    keys.set(idempotencyKey, { fingerprint, done: false, expires: now + IDEMPOTENCY_TTL_MS });
    const r = store.createBooking({ ...input, acceptTerms: input.acceptTerms === true }, { member });
    const result = r.ok ? { ok: true, value: publicBooking(r.booking) } : { ok: false, errors: r.errors };
    if (r.ok) {
      keys.set(idempotencyKey, { fingerprint, done: true, result, expires: now + IDEMPOTENCY_TTL_MS });
      ctx.events.emit('booking.created', r.booking, { via, c });
    } else {
      keys.delete(idempotencyKey); // a rejected request may be corrected and sent again with the same key
    }
    return result;
  }

  /** Cancel a booking. The guest proves it is theirs with the email it was made with. */
  function cancelBooking({ ref, email }, { via, c = null } = {}) {
    const booking = store.findBooking(ref, email);
    if (!booking) return fail('not_found', 'ref', 'No booking matches that reference and email address.');
    const r = store.cancelBooking(booking.ref);
    if (!r.ok) return { ok: false, errors: r.errors };
    ctx.events.emit('booking.cancelled', r.booking, { via, c });
    return { ok: true, value: publicBooking(r.booking) };
  }

  return { searchCabins, getCabin, checkAvailability, createBooking, cancelBooking, publicBooking };
}

/** A stable hash of the booking input, so a retried request can be recognised. */
function fingerprintOf(input) {
  const fields = ['cabin', 'checkIn', 'checkOut', 'guests', 'name', 'email', 'phone', 'requests', 'acceptTerms'];
  const canonical = fields.map((f) => [f, input[f] === undefined ? null : String(input[f]).trim()]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
