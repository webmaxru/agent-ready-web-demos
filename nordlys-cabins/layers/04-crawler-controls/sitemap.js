const escapeXml = (s) => s.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Every public page, with lastmod only where the data really knows the date. */
export function sitemapEntries(store) {
  const articles = store.articles();
  const newest = articles.map((a) => a.updated ?? a.published).sort().at(-1);
  return [
    { path: '/' },
    { path: '/cabins' },
    ...store.cabins().map((c) => ({ path: `/cabins/${c.slug}` })),
    { path: '/guide', lastmod: newest },
    ...articles.map((a) => ({ path: `/guide/${a.slug}`, lastmod: a.updated ?? a.published })),
    { path: '/faq' },
    { path: '/contact' },
  ];
}

export function buildSitemap(entries, absoluteUrl) {
  const urls = entries.map(({ path, lastmod }) =>
    `  <url>\n    <loc>${escapeXml(absoluteUrl(path))}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
