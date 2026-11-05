// Chapter 3: How agents see a page.
// The clean front end already uses semantic HTML, so this layer adds no markup.
// It adds the checks that keep it that way: a perception contract for every
// public page, read from the HTML the server sends, before any JavaScript runs.
// The 33 axe rules of Lighthouse's agent audit check the quality of what a page
// exposes. These checks cover what they skip: landmarks, headings, the language,
// and whether the controls are in the server's HTML at all.

/** Every opening tag of one element type in an HTML string. */
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1];

/** Check one page's HTML. Returns the ids of the rules it breaks. */
export function perceptionProblems(html) {
  const problems = [];
  if (!/<html\b[^>]*\slang="[a-z]{2}/i.test(html)) problems.push('html-lang');
  if (!/<title>[^<]+<\/title>/i.test(html)) problems.push('title');
  if (tags(html, 'main').length !== 1) problems.push('one-main');
  if (tags(html, 'h1').length !== 1) problems.push('one-h1');
  if (/\sdata-href="/i.test(html)) problems.push('no-click-divs');

  // A control is labelled by <label for>, by aria-label(ledby), or by sitting inside a <label>.
  const labelled = new Set(tags(html, 'label').map((t) => attr(t, 'for')).filter(Boolean));
  const outside = html.replace(/<label\b[^>]*>[\s\S]*?<\/label>/gi, '');
  const controls = [...tags(outside, 'input'), ...tags(outside, 'select'), ...tags(outside, 'textarea')]
    .filter((t) => !/\stype="(hidden|submit|button)"/i.test(t));
  const unlabelled = controls.filter((t) => !labelled.has(attr(t, 'id')) && !attr(t, 'aria-label') && !attr(t, 'aria-labelledby'));
  if (unlabelled.length) problems.push('labelled-controls');

  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  if (buttons.some(([, attrs, inner]) => !inner.replace(/<[^>]+>/g, '').trim() && !/\saria-label="[^"]+"/i.test(attrs))) problems.push('named-buttons');

  const images = tags(html, 'img');
  if (images.some((t) => attr(t, 'alt') === undefined || !attr(t, 'width') || !attr(t, 'height'))) problems.push('image-alt-and-size');
  return problems;
}

export const PERCEPTION_RULES = ['html-lang', 'title', 'one-main', 'one-h1', 'no-click-divs', 'labelled-controls', 'named-buttons', 'image-alt-and-size'];

export default {
  chapter: 3,
  order: 1,
  name: 'Perception',
  description: 'a perception contract for every public page: landmarks, headings, labels and names in the server HTML',

  register(app, ctx) {
    const { store } = ctx;

    ctx.audit('perception', async ({ request }) => {
      const cabin = store.cabins()[0];
      const paths = [
        '/',
        '/cabins',
        ...store.cabins().map((c) => `/cabins/${c.slug}`),
        '/guide',
        '/faq',
        '/contact',
        '/login',
        `/book/${cabin.slug}?checkIn=2026-12-02&checkOut=2026-12-05&guests=2`,
      ];
      const failures = Object.fromEntries(PERCEPTION_RULES.map((id) => [id, []]));
      let checked = 0;
      for (const path of paths) {
        const res = await request(path);
        if (res.status !== 200) continue; // the legacy front end has no booking page, only an overlay
        checked += 1;
        for (const id of perceptionProblems(await res.text())) failures[id].push(path);
      }
      return PERCEPTION_RULES.map((id) => ({
        id,
        ok: failures[id].length === 0,
        message: failures[id].length ? `fails on ${failures[id].length} of ${checked} pages: ${failures[id].join(', ')}` : `passes on all ${checked} pages`,
      }));
    });
  },
};
