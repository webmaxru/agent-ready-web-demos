export default {
  chapter: 7,
  name: 'Fixture: extends an earlier layer',
  description: 'Test fixture',
  async register(app, ctx) {
    const before = (await ctx.getStaticFile('/robots.txt')) ?? '';
    ctx.staticFile('/robots.txt', `${before}Sitemap: /sitemap.xml\n`, { replace: true });
    ctx.route('GET', '/api/ping', (c) => c.json({ pong: true, layers: ctx.layers.map((l) => l.id) }));
    ctx.headers('/api/*', { 'x-fixture-3': null, 'cache-control': 'no-store' });
  },
};
