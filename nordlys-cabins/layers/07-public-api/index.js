// Chapter 7: APIs agents can use.
// Adds the Nordlys public API (/api/v1), its OpenAPI description (/openapi.json),
// an Arazzo workflow, problem-type pages, RateLimit headers, and an API catalog
// (RFC 9727) at /.well-known/api-catalog that the home page links to.
import { registerApi } from './api.js';
import { openApiDocument } from './openapi.js';
import { bookingWorkflow } from './arazzo.js';
import { rateLimiter } from './ratelimit.js';
import { problemPage, PROBLEM_TYPES } from './problems.js';
import { apiCatalog, CATALOG_PATH as CATALOG, LINKSET_TYPE as LINKSET } from './catalog.js';

export default {
  chapter: 7,
  name: 'Public API',
  description: 'REST API with OpenAPI 3.1, problem details, idempotent booking, RateLimit headers and an RFC 9727 API catalog',

  register(app, ctx) {
    const origin = (c) => ctx.absoluteUrl(c, '/').replace(/\/$/, '');
    const regions = ctx.store.regions().map((r) => r.name);
    const features = Object.keys(ctx.store.features());

    // 1. Rate limits on every API call (quota per client and minute).
    const quota = Number(ctx.config.env?.NORDLYS_API_QUOTA ?? 60);
    const limit = rateLimiter({ quota, windowSeconds: 60 });
    ctx.beforeAuth((c, next) => (c.req.path.startsWith('/api/') ? limit(c, next) : next()));

    // 2. The API itself.
    registerApi(ctx);

    // 3. Machine-readable descriptions.
    ctx.staticFile('/openapi.json', (c) => JSON.stringify(openApiDocument({ origin: origin(c), regions, features }), null, 2));
    ctx.staticFile('/api/v1/booking.arazzo.json', (c) => JSON.stringify(bookingWorkflow({ origin: origin(c) }), null, 2));
    ctx.staticFile('/developers.md', (c) =>
      [
        '# Nordlys Cabins API',
        '',
        'Search cabins, check availability and prices, and book or cancel stays over HTTPS and JSON.',
        '',
        `- OpenAPI 3.1 description: [${origin(c)}/openapi.json](${origin(c)}/openapi.json)`,
        `- Booking workflow (Arazzo 1.1): [${origin(c)}/api/v1/booking.arazzo.json](${origin(c)}/api/v1/booking.arazzo.json)`,
        `- API catalog (RFC 9727): [${origin(c)}${CATALOG}](${origin(c)}${CATALOG})`,
        '',
        'Errors are `application/problem+json` (RFC 9457). Bookings need an `Idempotency-Key` header.',
        `Every client gets ${quota} requests per minute. The \`RateLimit\` and \`RateLimit-Policy\` headers show what is left.`,
        '',
      ].join('\n')
    );

    // 4. Problem type URIs resolve to a short explanation.
    ctx.route('GET', '/problems/:type', (c) => {
      const page = problemPage(c.req.param('type'));
      return page ? c.body(page, 200, { 'content-type': 'text/markdown; charset=utf-8' }) : c.notFound();
    });

    // 5. The API catalog (RFC 9727): a Linkset that points at the API's description, docs and status.
    ctx.staticFile(CATALOG, (c) => JSON.stringify(apiCatalog(origin(c)), null, 2), { contentType: LINKSET });
    // RFC 9727: a HEAD request to the catalog answers with a Link header.
    ctx.headers(CATALOG, { link: `<${CATALOG}>; rel="api-catalog"` });

    // 6. The home page points at the catalog. Append, so Link values from earlier chapters survive.
    ctx.headers('/', (c) => {
      const earlier = c.res.headers.get('link');
      const ours = `<${CATALOG}>; rel="api-catalog"`;
      return { link: earlier ? `${earlier}, ${ours}` : ours };
    });

    // 7. What this layer promises, checked by tests and GET /__audit.
    ctx.audit('Public API and API catalog', async ({ request }) => {
      const doc = await request('/openapi.json');
      const catalog = await request(CATALOG);
      const home = await request('/');
      const linkset = catalog.ok ? await catalog.json() : null;
      return [
        { id: 'openapi', ok: doc.ok && (await doc.json()).openapi.startsWith('3.1') },
        { id: 'api-catalog-type', ok: (catalog.headers.get('content-type') ?? '').startsWith('application/linkset+json') },
        { id: 'api-catalog-linkset', ok: Array.isArray(linkset?.linkset) && linkset.linkset.length > 0 },
        { id: 'home-link-header', ok: (home.headers.get('link') ?? '').includes('rel="api-catalog"') },
        { id: 'problem-pages', ok: PROBLEM_TYPES.length > 0 },
      ];
    });
  },
};
