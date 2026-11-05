// The Nordlys public API: five operations over the same booking service the
// MCP server uses. JSON in, JSON out, problem details for every error.
import { bookingService } from './service.js';
import { problem, problemFromErrors } from './problems.js';

const PAGE_MAX = 20;
const encodeCursor = (offset) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
const decodeCursor = (cursor) => {
  try {
    const { o } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
    return Number.isInteger(o) && o >= 0 ? o : null;
  } catch {
    return null;
  }
};

export function registerApi(ctx) {
  const service = bookingService(ctx);

  // GET /api/v1/cabins?region=&guests=&checkIn=&checkOut=&features=a,b&maxPrice=&limit=&cursor=
  ctx.route('GET', '/api/v1/cabins', (c) => {
    const q = c.req.query();
    const limit = q.limit === undefined ? 10 : Number(q.limit);
    const offset = q.cursor === undefined ? 0 : decodeCursor(q.cursor);
    const errors = [];
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX)
      errors.push({ field: 'limit', code: 'invalid_limit', message: `limit must be a whole number from 1 to ${PAGE_MAX}.` });
    if (offset === null) errors.push({ field: 'cursor', code: 'invalid_cursor', message: 'Use the cursor from links.next unchanged.' });
    if (errors.length) return problemFromErrors(c, ctx, errors);

    const all = service.searchCabins({
      region: q.region,
      guests: q.guests,
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      features: q.features ? q.features.split(',') : [],
      maxPrice: q.maxPrice,
    });
    const data = all.slice(offset, offset + limit);
    const next = offset + limit < all.length ? new URL(c.req.url) : null;
    next?.searchParams.set('cursor', encodeCursor(offset + limit));
    return c.json({ data, total: all.length, links: { self: c.req.path, ...(next ? { next: next.pathname + next.search } : {}) } });
  });

  // GET /api/v1/cabins/:slug
  ctx.route('GET', '/api/v1/cabins/:slug', (c) => {
    const r = service.getCabin(c.req.param('slug'));
    return r.ok ? c.json(r.value) : problemFromErrors(c, ctx, r.errors);
  });

  // GET /api/v1/cabins/:slug/availability?checkIn=&checkOut=&guests=
  ctx.route('GET', '/api/v1/cabins/:slug/availability', (c) => {
    const { checkIn, checkOut, guests } = c.req.query();
    const r = service.checkAvailability({ cabin: c.req.param('slug'), checkIn, checkOut, guests });
    return r.ok ? c.json(r.value) : problemFromErrors(c, ctx, r.errors);
  });

  // POST /api/v1/bookings  (requires an Idempotency-Key header)
  ctx.route('POST', '/api/v1/bookings', async (c) => {
    const input = await c.req.json().catch(() => null);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return problem(c, ctx, 'invalid-request', { detail: 'Send the booking as a JSON object.' });
    const key = c.req.header('idempotency-key')?.replace(/^"|"$/g, '');
    const r = service.createBooking(input, { idempotencyKey: key, via: 'api', member: c.get('member'), c });
    if (!r.ok) return problemFromErrors(c, ctx, r.errors);
    return c.json(r.value, r.replayed ? 200 : 201);
  });

  // POST /api/v1/bookings/:ref/cancel  { "email": "..." }
  ctx.route('POST', '/api/v1/bookings/:ref/cancel', async (c) => {
    const { email } = (await c.req.json().catch(() => null)) ?? {};
    const r = service.cancelBooking({ ref: c.req.param('ref'), email }, { via: 'api', c });
    return r.ok ? c.json(r.value) : problemFromErrors(c, ctx, r.errors);
  });

  // A health endpoint the API catalog links as "status".
  ctx.route('GET', '/api/v1/health', (c) => c.json({ status: 'ok', today: ctx.store.today() }));
}
