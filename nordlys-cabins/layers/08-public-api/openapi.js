// The OpenAPI 3.1 description of the Nordlys public API, served at /openapi.json.
// Every summary and description is written for two readers: a developer, and a
// model that has to pick the right operation and fill in its parameters.

const problemRef = (description) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});
const rateHeaders = {
  RateLimit: { $ref: '#/components/headers/RateLimit' },
  'RateLimit-Policy': { $ref: '#/components/headers/RateLimitPolicy' },
};
const tooMany = { $ref: '#/components/responses/TooManyRequests' };

export function openApiDocument({ origin, regions, features }) {
  return {
    openapi: '3.1.2',
    info: {
      title: 'Nordlys Cabins public API',
      version: '1.0.0',
      summary: 'Search Norwegian holiday cabins, check availability and prices, and book or cancel a stay.',
      description:
        'All prices are whole Norwegian kroner (NOK) and include no taxes beyond what the total says. ' +
        'Dates are calendar dates in Europe/Oslo, written YYYY-MM-DD. A stay runs from check-in (16:00) to check-out (11:00). ' +
        'Typical flow: searchCabins, then checkAvailability for the chosen cabin and dates, then createBooking with the same values. ' +
        'Every error is application/problem+json (RFC 9457) with a stable type URI and, for field problems, an errors array.',
      contact: { name: 'Nordlys Cabins', url: `${origin}/contact` },
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: `${origin}/api/v1`, description: 'Production' }],
    tags: [
      { name: 'cabins', description: 'Find cabins and read their details.' },
      { name: 'bookings', description: 'Create and cancel bookings.' },
    ],
    paths: {
      '/cabins': {
        get: {
          operationId: 'searchCabins',
          tags: ['cabins'],
          summary: 'Search cabins by region, group size, dates, features and price',
          description:
            'Use this first when the user describes the kind of stay they want. Every filter is optional. ' +
            'With both checkIn and checkOut, only cabins free for the whole stay are returned. Results are paginated: follow links.next until it is absent.',
          parameters: [
            { name: 'region', in: 'query', schema: { type: 'string', enum: regions }, description: 'Region name, for example Lofoten.' },
            { name: 'guests', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 8 }, description: 'Number of guests, including children.' },
            { $ref: '#/components/parameters/checkIn' },
            { $ref: '#/components/parameters/checkOut' },
            {
              name: 'features', in: 'query', style: 'form', explode: false,
              schema: { type: 'array', items: { type: 'string', enum: features } },
              description: 'Comma-separated features the cabin must have, for example sauna,wifi.',
            },
            { name: 'maxPrice', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Highest weekday nightly rate in NOK.' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Opaque cursor from links.next. Do not build it yourself.' },
          ],
          responses: {
            200: {
              description: 'Matching cabins, cheapest first is not guaranteed.',
              headers: rateHeaders,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/CabinPage' } } },
            },
            422: problemRef('A filter value is invalid.'),
            429: tooMany,
          },
        },
      },
      '/cabins/{slug}': {
        get: {
          operationId: 'getCabin',
          tags: ['cabins'],
          summary: 'Get the full description of one cabin',
          description: 'Use this to answer detailed questions about a cabin: beds, check-in times, location and the date ranges when it is already taken.',
          parameters: [{ $ref: '#/components/parameters/slug' }],
          responses: {
            200: { description: 'The cabin.', headers: rateHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/Cabin' } } } },
            404: problemRef('There is no cabin with that slug.'),
            429: tooMany,
          },
        },
      },
      '/cabins/{slug}/availability': {
        get: {
          operationId: 'checkAvailability',
          tags: ['cabins'],
          summary: 'Check whether a cabin is free for a stay and get the exact price',
          description:
            'Call this before createBooking and show the user the quote.total. ' +
            'available=false with conflicts means the dates are taken. Field problems (too many guests, minimum stay) come back as a 422 problem.',
          parameters: [
            { $ref: '#/components/parameters/slug' },
            { name: 'checkIn', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'Arrival date, YYYY-MM-DD.' },
            { name: 'checkOut', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'Departure date, YYYY-MM-DD, after checkIn.' },
            { name: 'guests', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } },
          ],
          responses: {
            200: { description: 'Availability and price.', headers: rateHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/Availability' } } } },
            404: problemRef('There is no cabin with that slug.'),
            422: problemRef('The stay is invalid, for example check-out before check-in or more guests than beds.'),
            429: tooMany,
          },
        },
      },
      '/bookings': {
        post: {
          operationId: 'createBooking',
          tags: ['bookings'],
          summary: 'Book a cabin for the lead guest',
          description:
            'Only call this after the user has confirmed the cabin, the dates and the price from checkAvailability. ' +
            'Send a new Idempotency-Key (a UUID) for every new booking, and the same key again if you retry after a timeout: ' +
            'a retry with the same key and body returns the original booking with status 200 instead of booking twice.',
          parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BookingRequest' } } },
          },
          responses: {
            201: { description: 'The booking was created.', headers: rateHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/Booking' } } } },
            200: { description: 'A retry of an earlier request with the same Idempotency-Key. The body is the original booking.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Booking' } } } },
            400: problemRef('The Idempotency-Key header is missing.'),
            409: problemRef('The cabin was taken for those dates, or a request with this Idempotency-Key is still running.'),
            422: problemRef('A field is invalid, or the Idempotency-Key was already used for a different request.'),
            429: tooMany,
          },
        },
      },
      '/bookings/{ref}/cancel': {
        post: {
          operationId: 'cancelBooking',
          tags: ['bookings'],
          summary: 'Cancel a booking',
          description:
            'Cancelling cannot be undone. Ask the user to confirm first. ' +
            'Cancellation is free until 14 days before check-in, the refund field says what is paid back.',
          parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string', pattern: '^NC-[0-9A-Z]{6}$' }, description: 'Booking reference, for example NC-4KX9TQ.' }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email', description: 'The email address the booking was made with.' } } } } },
          },
          responses: {
            200: { description: 'The cancelled booking.', headers: rateHeaders, content: { 'application/json': { schema: { $ref: '#/components/schemas/Booking' } } } },
            404: problemRef('No booking matches that reference and email address.'),
            409: problemRef('The booking is already cancelled, or the stay has started.'),
            429: tooMany,
          },
        },
      },
    },
    components: {
      parameters: {
        slug: { name: 'slug', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z0-9-]+$' }, description: 'Cabin slug from searchCabins, for example fjellro.' },
        checkIn: { name: 'checkIn', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Arrival date, YYYY-MM-DD.' },
        checkOut: { name: 'checkOut', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Departure date, YYYY-MM-DD, after checkIn.' },
        IdempotencyKey: {
          name: 'Idempotency-Key', in: 'header', required: true,
          schema: { type: 'string', minLength: 8, maxLength: 255 },
          description: 'A unique value per booking attempt, for example a UUID (draft-ietf-httpapi-idempotency-key-header). Kept for 24 hours.',
        },
      },
      headers: {
        RateLimit: { description: 'Remaining quota (draft-ietf-httpapi-ratelimit-headers), for example "default";r=57;t=41.', schema: { type: 'string' } },
        RateLimitPolicy: { description: 'The quota policy, for example "default";q=60;w=60.', schema: { type: 'string' } },
      },
      responses: {
        TooManyRequests: {
          description: 'The client used its quota. Wait for the number of seconds in Retry-After.',
          headers: { 'Retry-After': { schema: { type: 'integer' } }, ...rateHeaders },
          content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
      },
      schemas: {
        CabinSummary: {
          type: 'object',
          required: ['slug', 'name', 'region', 'maxGuests', 'nightlyRate', 'currency'],
          properties: {
            slug: { type: 'string', examples: ['fjellro'] },
            name: { type: 'string', examples: ['Fjellro'] },
            region: { type: 'string', enum: regions },
            summary: { type: 'string' },
            maxGuests: { type: 'integer' },
            bedrooms: { type: 'integer' },
            features: { type: 'array', items: { type: 'string', enum: features } },
            nightlyRate: { type: 'integer', description: 'Sunday to Thursday nights, NOK.' },
            weekendRate: { type: 'integer', description: 'Friday and Saturday nights, NOK.' },
            cleaningFee: { type: 'integer', description: 'Added once per stay, NOK.' },
            currency: { type: 'string', const: 'NOK' },
            minNights: { type: 'integer' },
            page: { type: 'string', description: 'Path of the cabin page for people.' },
          },
        },
        Cabin: {
          allOf: [
            { $ref: '#/components/schemas/CabinSummary' },
            {
              type: 'object',
              properties: {
                description: { type: 'string' },
                beds: { type: 'string' },
                checkInTime: { type: 'string', examples: ['16:00'] },
                checkOutTime: { type: 'string', examples: ['11:00'] },
                geo: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } },
                unavailable: { type: 'array', items: { $ref: '#/components/schemas/DateRange' } },
              },
            },
          ],
        },
        CabinPage: {
          type: 'object',
          required: ['data', 'total', 'links'],
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/CabinSummary' } },
            total: { type: 'integer' },
            links: { type: 'object', properties: { self: { type: 'string' }, next: { type: 'string' } } },
          },
        },
        DateRange: {
          type: 'object',
          properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date', description: 'Exclusive.' } },
        },
        Quote: {
          type: 'object',
          properties: {
            currency: { type: 'string', const: 'NOK' },
            nights: { type: 'integer' },
            accommodation: { type: 'integer' },
            cleaningFee: { type: 'integer' },
            total: { type: 'integer', description: 'What the guest pays, NOK.' },
          },
        },
        Availability: {
          type: 'object',
          required: ['cabin', 'available', 'quote'],
          properties: {
            cabin: { type: 'string' },
            checkIn: { type: 'string', format: 'date' },
            checkOut: { type: 'string', format: 'date' },
            guests: { type: 'integer' },
            available: { type: 'boolean' },
            conflicts: { type: 'array', items: { $ref: '#/components/schemas/DateRange' } },
            quote: { $ref: '#/components/schemas/Quote' },
          },
        },
        BookingRequest: {
          type: 'object',
          required: ['cabin', 'checkIn', 'checkOut', 'guests', 'name', 'email', 'acceptTerms'],
          properties: {
            cabin: { type: 'string', description: 'Cabin slug.' },
            checkIn: { type: 'string', format: 'date' },
            checkOut: { type: 'string', format: 'date' },
            guests: { type: 'integer', minimum: 1 },
            name: { type: 'string', description: 'Full name of the lead guest.' },
            email: { type: 'string', format: 'email', description: 'Where the confirmation goes.' },
            phone: { type: 'string' },
            requests: { type: 'string', maxLength: 1000, description: 'Free-text wishes for the host.' },
            acceptTerms: { type: 'boolean', const: true, description: 'The user accepted the booking terms at /faq. Never set this without asking.' },
          },
        },
        Booking: {
          type: 'object',
          required: ['ref', 'status', 'cabin', 'checkIn', 'checkOut', 'total', 'currency'],
          properties: {
            ref: { type: 'string', examples: ['NC-4KX9TQ'] },
            status: { type: 'string', enum: ['confirmed', 'cancelled'] },
            cabin: { type: 'string' },
            checkIn: { type: 'string', format: 'date' },
            checkOut: { type: 'string', format: 'date' },
            guests: { type: 'integer' },
            name: { type: 'string' },
            total: { type: 'integer' },
            currency: { type: 'string', const: 'NOK' },
            freeCancellationUntil: { type: 'string', format: 'date' },
            refund: { type: 'integer', description: 'Present on cancelled bookings.' },
            page: { type: 'string' },
          },
        },
        Problem: {
          type: 'object',
          description: 'RFC 9457 problem details.',
          properties: {
            type: { type: 'string', format: 'uri' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            instance: { type: 'string' },
            errors: {
              type: 'array',
              items: { type: 'object', properties: { field: { type: 'string' }, code: { type: 'string' }, detail: { type: 'string' } } },
            },
          },
        },
      },
    },
  };
}
