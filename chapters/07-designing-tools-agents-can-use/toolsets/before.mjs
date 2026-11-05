// The "before" tool set: what you get when every operation of the public API
// becomes a tool with no editing. Names follow the URL and the method, the
// descriptions are the one-line OpenAPI summaries, parameters are plain
// strings, and errors are HTTP status lines. (A simulation written for this
// chapter, modelled on naive OpenAPI-to-tool generation, not the output of a
// specific product.)

const status = (code, text) => ({ isError: true, text: `${code} ${text}` });
const json = (value) => ({ text: JSON.stringify(value) });

export const tools = [
  {
    name: 'get_api_v1_cabins',
    intent: 'search',
    description: 'List cabins',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string' },
        guests: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        features: { type: 'string' },
        max_price: { type: 'string' },
      },
    },
    run(args, { service }) {
      const features = args.features ? String(args.features).split(',').map((s) => s.trim()) : [];
      const list = service.searchCabins({ region: args.region, guests: args.guests, checkIn: args.from, checkOut: args.to, features, maxPrice: args.max_price });
      return json(list.map(({ bedrooms, ...c }) => c));
    },
  },
  {
    name: 'get_api_v1_cabins_id_availability',
    intent: 'availability',
    description: 'Get availability',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, guests: { type: 'string' } },
      required: ['id', 'from', 'to'],
    },
    run(args, { service }) {
      const r = service.checkAvailability({ cabin: args.id, checkIn: args.from, checkOut: args.to, guests: args.guests ?? 1 });
      if (!r.ok) return r.errors.some((e) => e.code === 'unknown_cabin') ? status(404, 'Not Found') : status(400, 'Bad Request');
      return json(r.value);
    },
  },
  {
    name: 'post_api_v1_bookings',
    intent: 'create',
    description: 'Create booking',
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          properties: {
            cabin: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            guests: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            terms: { type: 'boolean' },
          },
        },
      },
      required: ['body'],
    },
    run(args, backend) {
      const b = args.body ?? {};
      const input = { cabin: b.cabin, checkIn: b.from, checkOut: b.to, guests: b.guests, name: b.name, email: b.email, acceptTerms: b.terms === true };
      // No idempotency key in this API: every call is a new attempt.
      const r = backend.service.createBooking(input, { idempotencyKey: crypto.randomUUID(), via: 'eval' });
      if (!r.ok) return status(422, 'Unprocessable Entity');
      if (backend.takeTimeout()) return status(504, 'Gateway Timeout');
      return json(r.value);
    },
  },
  {
    name: 'delete_api_v1_bookings_ref',
    intent: 'cancel',
    description: 'Delete booking',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' }, email: { type: 'string' } }, required: ['ref'] },
    run(args, { service }) {
      const r = service.cancelBooking({ ref: args.ref, email: args.email }, { via: 'eval' });
      if (!r.ok) return r.errors.some((e) => e.code === 'not_found') ? status(404, 'Not Found') : status(409, 'Conflict');
      return json(r.value);
    },
  },
];
