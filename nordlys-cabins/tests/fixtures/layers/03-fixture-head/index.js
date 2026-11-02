export default {
  chapter: 3,
  name: 'Fixture: head and headers',
  description: 'Test fixture',
  register(app, ctx) {
    ctx.head({ meta: { name: 'fixture-3', content: 'yes' } });
    ctx.headers('*', { 'x-fixture-3': 'yes' });
    ctx.staticFile('/robots.txt', 'User-agent: *\nAllow: /\n');
  },
};
