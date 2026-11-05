import { homeGraph, cabinGraph, cabinListGraph, articleGraph, faqGraph, rating } from './graph.js';
import { ask } from './ask.js';

const ldJson = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

export default {
  chapter: 5,
  order: 1,
  name: 'Structured data',
  description: 'schema.org JSON-LD from the same data as the pages, and an NLWeb-shaped /ask endpoint',
  register(app, ctx) {
    const { store } = ctx;
    const { html } = ctx.html;

    // 1. One JSON-LD graph per page kind, injected into <head> by the core.
    //    The head hook writes <script type="application/ld+json">, a data block
    //    the CSP does not treat as script, with "<" escaped.
    ctx.head((page) => ({ jsonLd: homeGraph(page) }), { kinds: 'home' });
    ctx.head((page) => ({ jsonLd: cabinListGraph(page, page.data.results ?? store.cabins()) }), { kinds: 'cabin-list' });
    ctx.head((page) => (page.data.cabin ? { jsonLd: cabinGraph(page, store, page.data.cabin) } : null), { kinds: 'cabin' });
    ctx.head((page) => (page.data.article ? { jsonLd: articleGraph(page, page.data.article) } : null), { kinds: 'article' });
    ctx.head((page) => ({ jsonLd: faqGraph(page, store.faq()) }), { kinds: 'faq' });

    // 2. Markup must match the page: show what the markup says about rating and location.
    ctx.slot('cabin-detail-end', (page) => {
      const cabin = page.data.cabin;
      const stars = rating(store.reviewsFor(cabin.slug));
      return html`<p class="cabin-meta">${stars ? `Average guest rating ${stars.ratingValue} out of 5 from ${stars.reviewCount} ${stars.reviewCount === 1 ? 'review' : 'reviews'}. ` : ''}Location ${cabin.geo.latitude}° N, ${cabin.geo.longitude}° E.</p>`;
    });

    // 3. NLWeb-shaped questions over the same data: GET /ask?query=sauna+lofoten
    ctx.route('GET', '/ask', (c) => {
      const query = c.req.query('query') ?? '';
      if (!query.trim()) return c.json({ error: 'query is required' }, 400);
      const origin = new URL(ctx.absoluteUrl(c, '/')).origin;
      return c.json({ query_id: crypto.randomUUID(), results: ask(store, origin, query) });
    });

    // 4. Self-check: every page's JSON-LD parses and the cabin price matches the page.
    ctx.audit('structured-data', async ({ request }) => {
      const checks = [];
      for (const path of ['/', '/cabins', '/cabins/fjellro', '/guide/northern-lights-from-a-cabin', '/faq']) {
        const page = await (await request(path)).text();
        const blocks = [...page.matchAll(ldJson)].map((m) => m[1]);
        let ok = blocks.length > 0;
        for (const b of blocks) {
          try { ok &&= JSON.parse(b)['@context'] === 'https://schema.org'; } catch { ok = false; }
        }
        checks.push({ id: `jsonld ${path}`, ok });
      }
      const cabin = store.getCabin('fjellro');
      const page = await (await request('/cabins/fjellro')).text();
      const nodes = [...page.matchAll(ldJson)].flatMap((m) => JSON.parse(m[1])['@graph'] ?? []);
      const offer = nodes.find((n) => n['@type'] === 'VacationRental')?.makesOffer.priceSpecification[0];
      if (!offer) return [...checks, { id: 'price matches page', ok: false, message: 'no VacationRental on /cabins/fjellro' }];
      const shown = new Intl.NumberFormat('en-GB').format(offer.price);
      checks.push({ id: 'price matches page', ok: offer.price === cabin.nightlyRate && page.includes(`NOK ${shown}`) });
      return checks;
    });
  },
};
