import { html, raw, toString } from '../html.js';

export const SITE_NAME = 'Nordlys Cabins';

export const money = (amount, currency = 'NOK') => `${currency} ${new Intl.NumberFormat('en-GB').format(amount)}`;
export const longDate = (iso) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`)
  );

/** The page frame. `page` describes the page for hooks; `body` is the main content. */
export function layout(hooks, page, body) {
  const legacy = page.variant === 'legacy';
  const title = page.title ? `${page.title} | ${SITE_NAME}` : SITE_NAME;
  return toString(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${legacy && page.legacyTitle !== undefined ? page.legacyTitle : title}</title>
    ${page.description && !legacy ? html`<meta name="description" content="${page.description}">` : ''}
    <link rel="stylesheet" href="/css/site.css">
    <link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
    ${legacy ? html`<script src="/js/legacy.js" defer></script>` : html`<script src="/js/enhance.js" type="module"></script>`}
    ${hooks.headTags(page)}
    ${hooks.slot('head-end', page)}
  </head>
  <body class="variant-${page.variant} page-${page.kind}">
    ${legacy ? legacyHeader(page) : cleanHeader(page)}
    ${hooks.slot('header-end', page)}
    ${legacy ? html`<div class="main" id="content">` : html`<main id="main">`}
      ${hooks.slot('main-start', page)}
      ${body}
      ${hooks.slot('main-end', page)}
    ${legacy ? raw('</div>') : raw('</main>')}
    ${legacy ? legacyFooter(page, hooks) : cleanFooter(page, hooks)}
    ${hooks.slot('body-end', page)}
  </body>
</html>
`);
}

const NAV = [
  ['/cabins', 'Cabins'],
  ['/guide', 'Guide'],
  ['/faq', 'FAQ'],
  ['/contact', 'Contact'],
];

function cleanHeader(page) {
  return html`<a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <a class="brand" href="/">${SITE_NAME}</a>
      <nav aria-label="Main">
        <ul>
          ${NAV.map(
            ([href, label]) =>
              html`<li><a href="${href}"${page.path.startsWith(href) ? raw(' aria-current="page"') : ''}>${label}</a></li>`
          )}
        </ul>
      </nav>
      <div class="account">
        ${page.member
          ? html`<a href="/account/bookings">My bookings</a>
              <form id="logout" method="post" action="/logout"><button type="submit" class="link-button">Sign out</button></form>`
          : html`<a href="/login">Sign in</a>`}
      </div>
    </header>`;
}

function cleanFooter(page, hooks) {
  return html`<footer class="site-footer">
      <p>${SITE_NAME} is a fictional company: the running example in Maxim Salnikov's book about building agent-ready websites.</p>
      <nav aria-label="Footer">
        <ul>
          <li><a href="/bookings">Find a booking</a></li>
          <li><a href="/faq#cancellation">Cancellation terms</a></li>
          <li><a href="/contact">Contact us</a></li>
        </ul>
      </nav>
      ${hooks.slot('footer', page)}
    </footer>`;
}

// The legacy header is what many real sites ship: clickable divs, icon-only controls
// without accessible names, no landmarks and no skip link.
const ICON_SEARCH = raw('<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="2"/></svg>');
const ICON_USER = raw('<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>');
const ICON_MENU = raw('<svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2"/></svg>');

function legacyHeader(page) {
  return html`<div class="site-header">
      <div class="brand" data-href="/"><span class="logo-text">NORDLYS</span></div>
      <div class="nav">
        ${NAV.map(([href, label]) => html`<div class="nav-item" data-href="${href}">${label}</div>`)}
      </div>
      <div class="icons">
        <div class="icon-btn" data-href="/cabins">${ICON_SEARCH}</div>
        <div class="icon-btn" data-href="${page.member ? '/account/bookings' : '/login'}">${ICON_USER}</div>
        <div class="icon-btn menu">${ICON_MENU}</div>
      </div>
    </div>`;
}

function legacyFooter(page, hooks) {
  return html`<div class="site-footer">
      <div>© Nordlys Cabins (fictional)</div>
      <div class="footer-links">
        <span data-href="/bookings">Find a booking</span> · <span data-href="/faq">Terms</span> · <span data-href="/contact">Contact</span>
      </div>
      ${hooks.slot('footer', page)}
    </div>`;
}
