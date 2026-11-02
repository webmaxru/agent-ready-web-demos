// Example layer: shows every hook in one place. It is off unless you set
// NORDLYS_EXAMPLE=1, so it never changes what the chapters measure.
// Copy this folder to start a new layer: layers/NN-your-slug/index.js

export default {
  chapter: 0,
  name: 'Example layer',
  description: 'Demonstrates every layer hook. Enabled only with NORDLYS_EXAMPLE=1.',
  enabled: (config) => config.env.NORDLYS_EXAMPLE === '1',

  register(app, ctx) {
    const { html } = ctx.html;

    // <head>: a meta tag on every page, JSON-LD only on cabin pages.
    ctx.head({ meta: { name: 'nordlys-example', content: 'on' } });
    ctx.head((page) => ({ jsonLd: { '@context': 'https://schema.org', '@type': 'Thing', name: page.data.cabin.name } }), { kinds: 'cabin' });

    // A page script, served from this layer's public/ folder at /layers/00-example/.
    ctx.pageScript('/layers/00-example/example.js', { kinds: 'home' });

    // Response headers for a path pattern.
    ctx.headers('/cabins/*', { 'x-nordlys-example': 'cabin page' });

    // A file at a root path.
    ctx.staticFile('/example.txt', 'Hello from the example layer.\n');
    ctx.staticFile('/.well-known/nordlys-example', (c) => JSON.stringify({ origin: ctx.absoluteUrl(c, '/') }));

    // An API route that reuses the store's business logic.
    ctx.route('GET', '/example/api/cabins', (c) => c.json(ctx.store.cabins().map((x) => ({ slug: x.slug, name: x.name }))));

    // An MCP endpoint at /mcp (a stub here; Chapter 8 mounts a real MCP server).
    ctx.mcp((c) => c.json({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'The example layer has no MCP server' } }, 404));

    // Middleware before auth (Chapter 15 verifies bot signatures here) and after auth.
    ctx.beforeAuth(async (c, next) => {
      if (c.req.header('x-example-block') === '1') return c.text('Blocked by the example layer', 403);
      await next();
    });
    ctx.middleware(async (c, next) => {
      await next();
      c.res.headers.set('x-nordlys-member', c.get('member') ? 'signed-in' : 'anonymous');
    });

    // HTML in a layout slot, and attributes on a core form and one of its fields.
    ctx.slot('footer', () => html`<p class="example-note">The example layer is on.</p>`);
    ctx.formAttributes('booking', { 'data-example': 'booking-form' });
    ctx.fieldAttributes('booking', 'email', { 'data-example': 'email-field' });

    // React to domain events.
    ctx.events.on('booking.created', (booking) => {
      if (ctx.config.env.NORDLYS_EXAMPLE_LOG === '1') console.log(`example layer saw booking ${booking.ref}`);
    });

    // An audit that tests and GET /__audit can run.
    ctx.audit('example: files and headers', async ({ request }) => {
      const file = await request('/example.txt');
      const cabin = await request('/cabins/fjellro');
      return [
        { id: 'example-file', ok: file.status === 200, message: '/example.txt is served' },
        { id: 'example-header', ok: cabin.headers.get('x-nordlys-example') === 'cabin page', message: 'cabin pages carry x-nordlys-example' },
      ];
    });
  },
};
