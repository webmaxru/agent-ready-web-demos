// An Atom feed (RFC 4287) of the guide articles, newest first.
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildAtomFeed(store, abs) {
  const articles = [...store.articles()].sort((a, b) => b.published.localeCompare(a.published));
  const stamp = (d) => `${d}T00:00:00Z`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>Nordlys Cabins guide</title>',
    `  <id>${x(abs('/guide'))}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${x(abs('/guide/feed.xml'))}"/>`,
    `  <link rel="alternate" type="text/html" href="${x(abs('/guide'))}"/>`,
    `  <updated>${stamp(articles[0].published)}</updated>`,
    '  <author><name>Nordlys Cabins</name></author>',
    ...articles.map((a) => [
      '  <entry>',
      `    <title>${x(a.title)}</title>`,
      `    <id>${x(abs(`/guide/${a.slug}`))}</id>`,
      `    <link rel="alternate" type="text/html" href="${x(abs(`/guide/${a.slug}`))}"/>`,
      `    <link rel="alternate" type="text/markdown" href="${x(abs(`/guide/${a.slug}.md`))}"/>`,
      `    <published>${stamp(a.published)}</published>`,
      `    <updated>${stamp(a.published)}</updated>`,
      `    <summary>${x(a.description)}</summary>`,
      '  </entry>',
    ].join('\n')),
    '</feed>',
    '',
  ].join('\n');
}
