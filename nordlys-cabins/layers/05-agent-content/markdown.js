// Markdown views of the public pages, rendered from the same data as the HTML.
// No HTML-to-Markdown conversion: navigation, footer and forms never get in.

const money = (amount, currency = 'NOK') => `${currency} ${new Intl.NumberFormat('en-GB').format(amount)}`;
const esc = (s) => String(s ?? '').replace(/([\\`*_[\]<>])/g, '\\$1');
const link = (text, url) => `[${esc(text)}](${url})`;

function frontMatter(page, abs) {
  const quote = (s) => JSON.stringify(String(s ?? ''));
  return ['---', `title: ${quote(page.title || 'Nordlys Cabins')}`, `description: ${quote(page.description)}`, `url: ${abs(page.path)}`, '---', ''];
}

function cabinMd(page, store, abs) {
  const { cabin } = page.data;
  const features = store.features();
  const reviews = store.reviewsFor(cabin.slug);
  const taken = store.unavailableRanges(cabin.slug).filter((r) => r.to > store.today());
  const avg = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null;
  const out = [
    `# ${esc(cabin.name)}`, '', esc(cabin.summary), '',
    '## At a glance', '',
    `- Region: ${esc(cabin.region)}, ${esc(cabin.county)}`,
    `- Sleeps: ${cabin.maxGuests} guests`,
    `- Bedrooms: ${cabin.bedrooms} (${esc(cabin.beds)})`,
    `- Sunday to Thursday nights: ${money(cabin.nightlyRate, cabin.currency)} per night`,
    `- Friday and Saturday nights: ${money(cabin.weekendRate, cabin.currency)} per night`,
    `- Cleaning, bed linen and towels: ${money(cabin.cleaningFee, cabin.currency)} per stay`,
    `- Minimum stay: ${cabin.minNights} nights`,
    `- Check-in from ${cabin.checkInTime}, check-out by ${cabin.checkOutTime}`,
    `- Features: ${cabin.features.map((f) => esc(features[f] ?? f)).join(', ')}`,
  ];
  if (avg !== null) out.push(`- Average guest rating: ${avg} out of 5 from ${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`);
  out.push('', ...cabin.description.flatMap((p) => [esc(p), '']));
  out.push('## Availability and booking', '',
    `Check dates: ${abs(`/cabins/${cabin.slug}`)}?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=N`, '',
    `Book (a person confirms in the form): ${abs(`/book/${cabin.slug}`)}?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=N`, '');
  if (taken.length) out.push('Dates that are already taken (check-out day is free again):', '', ...taken.map((r) => `- ${r.from} to ${r.to}`), '');
  if (reviews.length) out.push('## Guest reviews', '', ...reviews.flatMap((r) => [`> ${esc(r.text)}`, '', `${esc(r.author)}, ${r.date}, rated ${r.rating} out of 5`, '']));
  return out;
}

function cabinListMd(page, store, abs) {
  const cabins = page.data.results ?? store.cabins();
  return ['# Our cabins', '', ...cabins.map((c) =>
    `- ${link(c.name, abs(`/cabins/${c.slug}.md`))}: ${esc(c.summary)} Sleeps ${c.maxGuests}, from ${money(c.nightlyRate, c.currency)} per night.`), ''];
}

function articleMd(page) {
  const a = page.data.article;
  const body = a.blocks.flatMap((b) => {
    if (b.type === 'h2') return [`## ${esc(b.text)}`, ''];
    if (b.type === 'ul') return [...b.items.map((i) => `- ${esc(i)}`), ''];
    return [esc(b.text), ''];
  });
  return [`# ${esc(a.title)}`, '', `By ${esc(a.author)}, ${a.published}`, '', esc(a.description), '', ...body];
}

const RENDERERS = {
  // The two home page sentences repeat the template's copy. Keep them in step.
  home: (page, store, abs) => ['# Nordlys Cabins', '',
    'Six hand-picked cabins in Norway, from a rorbu in Lofoten to a forest hut by lake Femunden. Book directly, cancel free up to 14 days before you arrive.', '',
    '## Cabins', '', ...cabinListMd(page, store, abs).slice(2),
    '## From the guide', '', ...store.articles().map((a) => `- ${link(a.title, abs(`/guide/${a.slug}.md`))}: ${esc(a.description)}`), ''],
  'cabin-list': cabinListMd,
  cabin: cabinMd,
  guide: (page, store, abs) => ['# Guide', '', ...store.articles().map((a) => `- ${link(a.title, abs(`/guide/${a.slug}.md`))} (${a.published}): ${esc(a.description)}`), ''],
  article: articleMd,
  faq: (page, store) => ['# Frequently asked questions', '', ...store.faq().flatMap((f) => [`## ${esc(f.q)}`, '', esc(f.a), ''])],
  contact: () => ['# Contact us', '', 'Questions about a cabin or a booking? Use the contact form on this page. We answer within two working days.', ''],
};

export const hasMarkdown = (page) => Boolean(page && RENDERERS[page.kind] && (page.kind !== 'cabin' || page.data?.cabin) && (page.kind !== 'article' || page.data?.article));

export function renderMarkdown(page, store, abs) {
  return [...frontMatter(page, abs), ...RENDERERS[page.kind](page, store, abs)].join('\n').replace(/\n{3,}/g, '\n\n');
}

/** The .md URL of a page: /cabins/fjellro -> /cabins/fjellro.md, / -> /index.md */
export const markdownPath = (path) => (path === '/' ? '/index.md' : `${path.replace(/\/$/, '')}.md`);
