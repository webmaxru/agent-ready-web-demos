// Chapter 9: In-page tools with WebMCP.
// Chapter 2 turned the availability form into one declarative tool. This layer
// finishes the job: declarative tools on the other forms where an agent may help,
// imperative tools for what no single form does, and the small JSON endpoints the
// page tools call. Everything goes through ctx.store, the same logic the forms use.

export default {
  chapter: 9,
  name: 'WebMCP',
  description: 'Declarative tools on the forms, imperative tools in the page, JSON endpoints for them',
  enabled: (config) => config.variant === 'clean',

  register(app, ctx) {
    const { store } = ctx;

    // 1. JSON endpoints for the imperative tools (same-origin, read-only).
    ctx.route('GET', '/_tools/cabins', (c) => {
      const { region, guests, checkIn, checkOut, maxPrice } = c.req.query();
      const features = c.req.queries('features') ?? [];
      const input = { region, guests, checkIn, checkOut, maxPrice, features };
      const nights = checkIn && checkOut;
      const cabins = store.searchCabins(input).map((cabin) => ({
        slug: cabin.slug,
        name: cabin.name,
        region: cabin.region,
        maxGuests: cabin.maxGuests,
        nightlyRateNok: cabin.nightlyRate,
        features: cabin.features,
        url: ctx.absoluteUrl(c, `/cabins/${cabin.slug}`),
        totalNok: nights ? store.quotePrice(cabin, checkIn, checkOut).total : undefined,
      }));
      return c.json({ count: cabins.length, cabins });
    });

    ctx.route('GET', '/_tools/cabins/:slug', (c) => {
      const cabin = store.getCabin(c.req.param('slug'));
      if (!cabin) return c.json({ error: { code: 'unknown_cabin', message: 'No cabin with that slug. Call search_cabins to list valid slugs.' } }, 404);
      return c.json({
        slug: cabin.slug,
        name: cabin.name,
        region: cabin.region,
        summary: cabin.summary,
        maxGuests: cabin.maxGuests,
        bedrooms: cabin.bedrooms,
        minNights: cabin.minNights,
        nightlyRateNok: cabin.nightlyRate,
        weekendRateNok: cabin.weekendRate,
        cleaningFeeNok: cabin.cleaningFee,
        features: cabin.features,
        checkInTime: cabin.checkInTime,
        checkOutTime: cabin.checkOutTime,
        guestReviews: store.reviewsFor(cabin.slug).map((r) => ({ rating: r.rating, text: r.text })),
      });
    });

    ctx.route('GET', '/_tools/availability', (c) => {
      const { cabin, checkIn, checkOut, guests } = c.req.query();
      const result = store.checkAvailability({ cabin, checkIn, checkOut, guests });
      return c.json({
        available: result.available,
        errors: result.errors,
        quote: result.quote ?? null,
      });
    });

    // 2. Declarative tools: forms an agent may fill. Read-only forms may submit themselves.
    ctx.formAttributes('search', {
      toolname: 'search_cabins',
      tooldescription: 'Find Nordlys cabins in Norway by region, number of guests, dates, price and features. Shows only cabins that are free when dates are given.',
      toolautosubmit: true,
    });
    ctx.fieldAttributes('search', 'checkIn', { toolparamdescription: 'Arrival date. Give checkOut too, or dates are ignored.' });
    ctx.fieldAttributes('search', 'maxPrice', { toolparamdescription: 'Highest weekday price per night in Norwegian kroner (NOK)' });
    ctx.fieldAttributes('search', 'features', { toolparamdescription: 'Features the cabin must have. Pick any number.' });

    ctx.formAttributes('booking', (page) => ({
      toolname: 'book_cabin',
      tooldescription: `Fill in the booking form for ${page.data.cabin.name}. The guest reviews the details and presses Confirm booking. Nothing is booked until they do.`,
    }));
    ctx.fieldAttributes('booking', 'guests', { toolparamdescription: 'Number of guests, including children' });
    ctx.fieldAttributes('booking', 'name', { toolparamdescription: 'Full name of the lead guest' });
    ctx.fieldAttributes('booking', 'requests', { toolparamdescription: 'Optional wishes for the host, in plain words' });
    ctx.fieldAttributes('booking', 'acceptTerms', { toolparamdescription: 'Leave unchecked. The guest accepts the terms themselves.' });

    ctx.formAttributes('lookup', {
      toolname: 'find_booking',
      tooldescription: 'Open an existing booking with its reference (NC-XXXXXX) and the email address used to book.',
      toolautosubmit: true,
    });

    ctx.formAttributes('cancel', {
      toolname: 'cancel_booking',
      tooldescription: 'Prepare to cancel this booking. The guest confirms the cancellation themselves.',
    });

    ctx.formAttributes('contact', {
      toolname: 'contact_host',
      tooldescription: 'Fill in a message to the Nordlys hosts. The guest reviews it and presses Send.',
    });

    // The login form is not a tool on purpose: agents never handle the guest's password.

    // 3. The imperative tools, the form helpers and their styles.
    ctx.pageScript('/layers/09-webmcp/tools.js');
    ctx.pageScript('/layers/09-webmcp/forms.js');
    ctx.head({ link: { rel: 'stylesheet', href: '/layers/09-webmcp/webmcp.css' } });
    ctx.slot(
      'booking-form-end',
      () => ctx.html.html`<p class="agent-note" role="note">An assistant filled in this form for you. Check every detail before you press Confirm booking.</p>`,
      { kinds: 'booking-form' }
    );

    // 4. The promises of this layer, checked by tests and GET /__audit.
    ctx.audit('webmcp', async ({ request }) => {
      const slug = store.cabins()[0].slug;
      const list = await (await request('/cabins')).text();
      const book = await (await request(`/book/${slug}`)).text();
      const api = await (await request(`/_tools/cabins?guests=2`)).json();
      return [
        { id: 'search-form-tool', ok: /<form id="search"[^>]*toolname="search_cabins"/.test(list) },
        { id: 'booking-form-tool', ok: /<form id="booking"[^>]*toolname="book_cabin"/.test(book) },
        { id: 'booking-not-autosubmit', ok: !/<form id="booking"[^>]*toolautosubmit/.test(book) },
        { id: 'tools-script', ok: list.includes('src="/layers/09-webmcp/tools.js"') },
        { id: 'tools-endpoint', ok: Array.isArray(api.cabins) && api.cabins.length > 0 },
      ];
    });
  },
};
