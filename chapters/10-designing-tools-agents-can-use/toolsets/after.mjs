// The "after" tool set: the Nordlys MCP tools from Chapter 8 plus find_booking
// from Chapter 10, written as plain JSON Schema so any model API can take them,
// with the chapter's fixes applied: every parameter described, errors that say
// what to do next, and an idempotency key on the one tool that books.

const REGIONS = ['Rondane', 'Lyngen', 'Senja', 'Lofoten', 'Hardanger', 'Femunden'];
const FEATURES = ['fireplace', 'ski-in', 'wifi', 'drying-room', 'sauna', 'hot-tub', 'aurora-view', 'boat', 'sea-view', 'pets-allowed', 'ev-charger', 'fjord-view', 'off-grid', 'lake-view'];
const date = (what) => ({ type: 'string', format: 'date', description: `${what} date as YYYY-MM-DD (Europe/Oslo)` });

const json = (value) => ({ text: JSON.stringify(value) });
/** An error the model can act on: what went wrong, per field, and what to do next. */
const problem = (errors, next) => ({ isError: true, text: JSON.stringify({ ok: false, errors, next }) });

const NEXT = {
  unknown_cabin: 'Use a cabin slug from search_cabins.',
  too_many_guests: 'Tell the user the limit, then offer search_cabins with the same dates and guests.',
  min_nights: 'Tell the user the minimum stay and offer a longer stay.',
  not_available: 'Tell the user the dates are taken. Offer search_cabins for the same dates, or other dates for this cabin.',
  date_in_past: 'Ask the user for dates from today on.',
  required: 'Ask the user for the missing information.',
  invalid_email: 'Ask the user for a valid email address.',
  not_found: 'Ask the user to check the reference and the email address.',
};

/** Match a cabin name ("Reine Rorbu") to its slug, for a friendlier unknown_cabin error. */
function suggestSlug(store, value) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/ø/g, 'o').normalize('NFD').replace(/[^a-z0-9]/g, '');
  return store.cabins().find((c) => norm(c.name) === norm(value) || norm(c.slug) === norm(value))?.slug;
}

/** For an empty search: the cabins that came closest, and what rules each one out. */
function nearMisses(store, { region, guests, checkIn, checkOut, features = [], maxNightlyRate }) {
  const overlaps = (r) => checkIn && checkOut && checkIn < r.to && r.from < checkOut;
  return store
    .cabins()
    .filter((c) => !region || c.region === region)
    .map((c) => {
      const reasons = [];
      if (guests && c.maxGuests < guests) reasons.push(`sleeps up to ${c.maxGuests}`);
      if (store.unavailableRanges(c.slug).some(overlaps)) reasons.push('not free on those dates');
      for (const f of features) if (!c.features.includes(f)) reasons.push(`no ${f}`);
      if (maxNightlyRate && c.nightlyRate > maxNightlyRate) reasons.push(`costs ${c.nightlyRate} NOK per night`);
      return { slug: c.slug, name: c.name, ruledOutBy: reasons };
    })
    .filter((m) => m.ruledOutBy.length)
    .slice(0, 3);
}

function explain(errors, store, input = {}) {
  const enriched = errors.map((e) => {
    if (e.code === 'unknown_cabin') {
      const slug = suggestSlug(store, input.cabin);
      return { ...e, message: slug ? `There is no cabin slug "${input.cabin}". Did you mean "${slug}"?` : `There is no cabin "${input.cabin}".`, validValues: store.cabins().map((c) => c.slug) };
    }
    return e;
  });
  return problem(enriched, NEXT[enriched[0].code] ?? 'Fix the fields listed and call the tool again.');
}

export const tools = [
  {
    name: 'search_cabins',
    intent: 'search',
    description:
      'Find Nordlys cabins that match what the user wants. All filters are optional. ' +
      'Give both checkIn and checkOut to get only cabins that are free for the whole stay. Prices are NOK per night. ' +
      'For the exact total of a stay (weekend rates and cleaning included), call check_availability.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', enum: REGIONS, description: 'Region in Norway' },
        guests: { type: 'integer', minimum: 1, maximum: 8, description: 'Number of guests, children included' },
        checkIn: date('Arrival'),
        checkOut: date('Departure'),
        features: { type: 'array', items: { type: 'string', enum: FEATURES }, description: 'Features the cabin must have' },
        maxNightlyRate: { type: 'integer', minimum: 1, description: 'Highest weekday nightly rate in NOK' },
      },
    },
    annotations: { readOnlyHint: true },
    run(args, { service, store }) {
      const cabins = service.searchCabins({ ...args, maxPrice: args.maxNightlyRate }).map(({ bedrooms, ...c }) => c);
      // With dates, give each cabin its real total, so nobody has to do the arithmetic.
      if (args.checkIn && args.checkOut)
        for (const c of cabins) {
          const q = service.checkAvailability({ cabin: c.slug, checkIn: args.checkIn, checkOut: args.checkOut, guests: args.guests ?? 1 });
          if (q.ok) c.stayTotal = q.value.quote.total;
        }
      // An empty list is an answer without a reason. Give the reason, per cabin.
      if (!cabins.length) return json({ count: 0, cabins, nearMisses: nearMisses(store, args) });
      return json({ count: cabins.length, cabins });
    },
  },
  {
    name: 'check_availability',
    intent: 'availability',
    description:
      'Check if one cabin is free for a stay and get the exact total price. ' +
      'Call this before create_booking and tell the user the total. available=false means the dates are taken.',
    inputSchema: {
      type: 'object',
      properties: {
        cabin: { type: 'string', description: 'Cabin slug from search_cabins, for example fjellro' },
        checkIn: date('Arrival'),
        checkOut: date('Departure'),
        guests: { type: 'integer', minimum: 1, description: 'Number of guests, children included' },
      },
      required: ['cabin', 'checkIn', 'checkOut', 'guests'],
    },
    annotations: { readOnlyHint: true },
    run(args, { service, store }) {
      const r = service.checkAvailability(args);
      if (!r.ok) return explain(r.errors, store, args);
      if (!r.value.available) return json({ ...r.value, next: NEXT.not_available });
      return json(r.value);
    },
  },
  {
    name: 'create_booking',
    intent: 'create',
    description:
      'Book a cabin for the lead guest. Only call this after the user confirmed the cabin, dates, guests and the total from check_availability, ' +
      'and accepted the booking terms. Use a new idempotencyKey (a UUID) per booking, and the same one again if you retry.',
    inputSchema: {
      type: 'object',
      properties: {
        cabin: { type: 'string', description: 'Cabin slug from search_cabins' },
        checkIn: date('Arrival'),
        checkOut: date('Departure'),
        guests: { type: 'integer', minimum: 1, description: 'Number of guests, children included' },
        name: { type: 'string', minLength: 1, description: 'Full name of the lead guest' },
        email: { type: 'string', format: 'email', description: 'Where the confirmation goes' },
        acceptTerms: { type: 'boolean', const: true, description: 'The user accepted the booking terms. Never set this without asking.' },
        idempotencyKey: { type: 'string', minLength: 8, description: 'A UUID that identifies this booking attempt' },
      },
      required: ['cabin', 'checkIn', 'checkOut', 'guests', 'name', 'email', 'acceptTerms', 'idempotencyKey'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run({ idempotencyKey, ...input }, backend) {
      const r = backend.service.createBooking(input, { idempotencyKey, via: 'eval' });
      if (!r.ok) return explain(r.errors, backend.store, input);
      if (backend.takeTimeout())
        return problem([{ code: 'timeout', message: 'The booking service did not answer in time. The booking may or may not exist.' }],
          'Call create_booking again with exactly the same arguments and the same idempotencyKey. A repeated key never books twice.');
      const { name, ...booking } = r.value;
      // Say what happened in words, and what the guest needs to hear, then the data.
      const replay = r.replayed ? ' (this is the booking from your earlier attempt, nothing was booked twice)' : '';
      return { text: `Booked ${booking.cabin} from ${booking.checkIn} to ${booking.checkOut}${replay}. Give the guest the reference ${booking.ref} and the total ${booking.total} NOK.\n${JSON.stringify(booking)}` };
    },
  },
  {
    name: 'find_booking',
    intent: 'lookup',
    description:
      'Look up a booking by its reference and the email address it was made with. ' +
      'Use it before cancel_booking, so you can tell the user what they are cancelling and how much they get back.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', pattern: '^NC-[0-9A-Z]{6}$', description: 'Booking reference, for example NC-4KX9TQ' },
        email: { type: 'string', format: 'email', description: 'The email address the booking was made with' },
      },
      required: ['ref', 'email'],
    },
    annotations: { readOnlyHint: true },
    run({ ref, email }, { store, service }) {
      const b = store.findBooking(ref, email);
      if (!b) return json({ found: false, next: NEXT.not_found });
      const { name, ...booking } = service.publicBooking(b);
      const policy = store.cancellationPolicy(b);
      const canCancelOnline = b.status === 'confirmed' && b.checkIn > store.today();
      return json({ found: true, booking, ifCancelledToday: { canCancelOnline, refund: canCancelOnline && policy.refundable ? b.total : 0 } });
    },
  },
  {
    name: 'cancel_booking',
    intent: 'cancel',
    description:
      'Cancel a booking. This cannot be undone, so ask the user to confirm first. ' +
      'Cancellation is free until 14 days before check-in, the result says how much is refunded.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', pattern: '^NC-[0-9A-Z]{6}$', description: 'Booking reference, for example NC-4KX9TQ' },
        email: { type: 'string', format: 'email', description: 'The email address the booking was made with' },
      },
      required: ['ref', 'email'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    run(args, { service, store }) {
      const r = service.cancelBooking(args, { via: 'eval' });
      if (!r.ok) return explain(r.errors, store, args);
      const { name, ...booking } = r.value;
      return json(booking);
    },
  },
];
