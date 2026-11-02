// Chapter 2: Your first agent-ready page.
// Three small changes on top of the clean front end: a robots.txt, a sitemap
// and one declarative WebMCP tool on the availability form of every cabin page.
// Later chapters replace robots.txt (Chapter 4) and add much more to all three.

export default {
  chapter: 2,
  name: 'First steps',
  description: 'robots.txt, sitemap.xml and a declarative WebMCP tool on the availability form',

  register(app, ctx) {
    const { store } = ctx;

    // robots.txt: everyone may crawl the public pages, nobody needs the private ones.
    ctx.staticFile('/robots.txt', (c) =>
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /account/',
        'Disallow: /bookings/',
        '',
        `Sitemap: ${ctx.absoluteUrl(c, '/sitemap.xml')}`,
        '',
      ].join('\n')
    );

    // sitemap.xml: every public page the site can render, with absolute URLs.
    ctx.staticFile(
      '/sitemap.xml',
      (c) => {
        const paths = [
          '/',
          '/cabins',
          ...store.cabins().map((cabin) => `/cabins/${cabin.slug}`),
          '/guide',
          ...store.articles().map((article) => `/guide/${article.slug}`),
          '/faq',
          '/contact',
        ];
        const urls = paths.map((path) => `  <url><loc>${ctx.absoluteUrl(c, path)}</loc></url>`);
        return [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls,
          '</urlset>',
          '',
        ].join('\n');
      },
      { contentType: 'application/xml; charset=utf-8' }
    );

    // One declarative WebMCP tool: the availability form becomes check_availability.
    // It only reads data, so the agent may submit it without asking (toolautosubmit).
    ctx.formAttributes('availability', (page) => ({
      toolname: 'check_availability',
      tooldescription: `Check whether the cabin ${page.data.cabin.name} is free for a stay and get the total price in NOK.`,
      toolautosubmit: true,
    }));
    ctx.fieldAttributes('availability', 'checkIn', { toolparamdescription: 'Arrival date' });
    ctx.fieldAttributes('availability', 'checkOut', { toolparamdescription: 'Departure date, after the arrival date' });
    ctx.fieldAttributes('availability', 'guests', { toolparamdescription: 'Number of guests, including children' });

    // The promises of this layer, checked by the tests and by GET /__audit.
    ctx.audit('first-steps', async ({ request }) => {
      const robots = await request('/robots.txt');
      const robotsText = await robots.text();
      const sitemap = await request('/sitemap.xml');
      const sitemapText = await sitemap.text();
      const cabin = await (await request(`/cabins/${store.cabins()[0].slug}`)).text();
      return [
        { id: 'robots-txt', ok: robots.status === 200 && /^User-agent: \*$/m.test(robotsText) },
        { id: 'robots-sitemap-line', ok: /^Sitemap: \S+\/sitemap\.xml$/m.test(robotsText) },
        { id: 'sitemap-lists-cabins', ok: store.cabins().every((x) => sitemapText.includes(`/cabins/${x.slug}</loc>`)) },
        { id: 'availability-tool', ok: /<form id="availability"[^>]*toolname="check_availability"/.test(cabin) },
      ];
    });
  },
};
