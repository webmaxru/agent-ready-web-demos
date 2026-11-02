import { POLICY } from './policy.js';
import { buildRobotsTxt, contentUsage } from './robots.js';
import { sitemapEntries, buildSitemap } from './sitemap.js';
import { tokensFor } from './agents.js';

export default {
  chapter: 4,
  name: 'Crawler controls',
  description: 'robots.txt with AI crawler groups and content signals, a sitemap with lastmod, noindex on private pages',
  register(app, ctx, policy = POLICY) {
    // 1. robots.txt and sitemap.xml (they replace the minimal ones from Chapter 2)
    ctx.staticFile('/robots.txt', (c) => buildRobotsTxt(policy, { sitemapUrl: ctx.absoluteUrl(c, '/sitemap.xml') }), { replace: true });
    ctx.staticFile('/sitemap.xml', (c) => buildSitemap(sitemapEntries(ctx.store), (p) => ctx.absoluteUrl(c, p)), { replace: true });

    // 2. Private and transactional pages stay out of every index, even for
    //    crawlers that skip robots.txt
    const noindex = [...policy.privatePaths, ...policy.transactionalPaths].map((p) => (p.endsWith('/') ? `${p}*` : p));
    ctx.headers(noindex, { 'x-robots-tag': 'noindex' });

    // 3. Optional: the IETF aipref header on every response (a draft in November 2026)
    if (policy.experimental?.contentUsage) ctx.headers('*', { 'content-usage': contentUsage(policy) });

    // 4. Checks that mirror the documented isitagentready.com pass rules
    ctx.audit('crawler-controls', async ({ request }) => {
      const res = await request('/robots.txt');
      const text = await res.text();
      const sitemap = await (await request('/sitemap.xml')).text();
      return [
        { id: 'robotsTxt', ok: res.status === 200 && /^text\/plain/.test(res.headers.get('content-type')) && /^user-agent:/im.test(text) },
        { id: 'sitemap', ok: /<urlset[\s>]/.test(sitemap) && /^sitemap:/im.test(text) },
        { id: 'robotsTxtAiRules', ok: tokensFor('training').every((t) => text.includes(`User-agent: ${t}`)) },
        { id: 'contentSignals', ok: /^content-signal:\s*\S/im.test(text) },
      ];
    });
  },
};
