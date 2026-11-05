// /llms.txt (llmstxt.org, v2): an H1, a blockquote summary, then H2 sections of links.
// Generated from the store so it never lists a cabin or article that does not exist.
const money = (n) => `NOK ${new Intl.NumberFormat('en-GB').format(n)}`;

export function buildLlmsTxt(store, abs) {
  const lines = [
    '# Nordlys Cabins',
    '',
    '> Six holiday cabins in Norway that you can book directly, from a rorbu in Lofoten to a forest hut by lake Femunden. Prices are in NOK, and cancellation is free up to 14 days before check-in. (Nordlys Cabins is a fictional demo site.)',
    '',
    'Every public page is also available as Markdown: request it with `Accept: text/markdown`, or add `.md` to the path. A booking is always confirmed by a person in the booking form.',
    '',
    '## Cabins',
    '',
    ...store.cabins().map((c) => `- [${c.name}](${abs(`/cabins/${c.slug}.md`)}): ${c.region}, sleeps ${c.maxGuests}, from ${money(c.nightlyRate)} per night.`),
    '',
    '## Booking and policies',
    '',
    `- [Frequently asked questions](${abs('/faq.md')}): check-in and check-out times, what is included, cancellation, pets.`,
    `- [All cabins](${abs('/cabins.md')}): one list with capacity and prices.`,
    `- [Contact](${abs('/contact.md')}): how to reach us, answers within two working days.`,
    '',
    '## Guides',
    '',
    ...store.articles().map((a) => `- [${a.title}](${abs(`/guide/${a.slug}.md`)}): ${a.description}`),
    '',
    '## Optional',
    '',
    `- [Sitemap](${abs('/sitemap.xml')}): every public page with real modification dates for articles.`,
    `- [Guide feed](${abs('/guide/feed.xml')}): new articles as an Atom feed.`,
    `- [robots.txt](${abs('/robots.txt')}): crawler rules and content signals.`,
    '',
  ];
  return lines.join('\n');
}
