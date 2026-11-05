import { prefersMarkdown } from './negotiate.js';
import { hasMarkdown, renderMarkdown, markdownPath } from './markdown.js';
import { buildLlmsTxt } from './llms.js';
import { buildAtomFeed } from './feed.js';
import { POLICY } from '../04-crawler-controls/policy.js';
import { contentSignal } from '../04-crawler-controls/robots.js';

export default {
  chapter: 5,
  order: 2,
  name: 'Agent content',
  description: 'Markdown by content negotiation and .md URLs, llms.txt, an Atom feed and Link headers',
  register(app, ctx) {
    const { store } = ctx;

    // 1. Markdown negotiation on every page that has a Markdown view.
    ctx.middleware(async (c, next) => {
      await next();
      const page = c.get('page');
      if (!hasMarkdown(page) || c.res.status !== 200) return;
      const abs = (path) => ctx.absoluteUrl(c, path);
      const links = [`<${abs(markdownPath(page.path))}>; rel="alternate"; type="text/markdown"`, `<${abs('/llms.txt')}>; rel="describedby"`];
      if (prefersMarkdown(c.req.header('accept'))) {
        c.res = new Response(renderMarkdown(page, store, abs), {
          status: 200,
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            vary: 'Accept',
            'content-signal': contentSignal(POLICY), // our policy, not a CDN default
            link: [`<${abs(page.path)}>; rel="canonical"`, `<${abs('/llms.txt')}>; rel="describedby"`].join(', '),
          },
        });
        return;
      }
      c.res.headers.append('vary', 'Accept'); // caches must keep HTML and Markdown apart
      c.res.headers.append('link', links.join(', '));
    });

    // 2. The same Markdown at a .md URL: /cabins/fjellro.md, /index.md
    ctx.beforeAuth(async (c, next) => {
      const path = c.req.path;
      if (!['GET', 'HEAD'].includes(c.req.method) || !path.endsWith('.md') || (await ctx.getStaticFile(path, c)) !== null) return next();
      const target = path === '/index.md' ? '/' : path.slice(0, -3);
      // A fresh internal request without cookies: a .md URL only ever shows the public page.
      const res = await app.request(new URL(target, c.req.url).href, { method: c.req.method, headers: { accept: 'text/markdown' } });
      if (!(res.headers.get('content-type') ?? '').startsWith('text/markdown')) return c.notFound();
      return res;
    });

    // 3. A <link> to the Markdown view in the HTML head, for agents that read the DOM.
    ctx.head((page) => (hasMarkdown(page) ? { link: { rel: 'alternate', type: 'text/markdown', href: markdownPath(page.path) } } : null));
    ctx.head({ link: { rel: 'alternate', type: 'application/atom+xml', title: 'Nordlys Cabins guide', href: '/guide/feed.xml' } }, { kinds: ['home', 'guide', 'article'] });

    // 4. llms.txt and the guide feed, generated from the store.
    ctx.staticFile('/llms.txt', (c) => buildLlmsTxt(store, (p) => ctx.absoluteUrl(c, p)), { contentType: 'text/plain; charset=utf-8' });
    ctx.staticFile('/guide/feed.xml', (c) => buildAtomFeed(store, (p) => ctx.absoluteUrl(c, p)), { contentType: 'application/atom+xml; charset=utf-8' });

    // 5. Self-check, mirroring isitagentready's markdownNegotiation and linkHeaders
    //    checks and Lighthouse's llms-txt audit.
    ctx.audit('agent-content', async ({ request }) => {
      const md = await request('/', { headers: { accept: 'text/markdown' } });
      const html = await request('/', { headers: { accept: 'text/html' } });
      const llms = await (await request('/llms.txt')).text();
      return [
        { id: 'markdownNegotiation', ok: (md.headers.get('content-type') ?? '').startsWith('text/markdown') },
        { id: 'htmlStaysDefault', ok: (html.headers.get('content-type') ?? '').startsWith('text/html') },
        { id: 'linkHeaders', ok: /rel="(describedby|alternate|service-desc|api-catalog)"/.test(html.headers.get('link') ?? '') },
        { id: 'llms-txt', ok: /^# \S/m.test(llms) && /\[[^\]]+\]\([^)]+\)/.test(llms) && llms.length >= 50 },
      ];
    });
  },
};
