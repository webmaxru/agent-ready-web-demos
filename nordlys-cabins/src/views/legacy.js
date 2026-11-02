import { html } from '../html.js';

/**
 * The "legacy" booking flow: the kind of front end many real booking sites
 * ship. It works for a sighted mouse user, and it is hostile to agents and
 * assistive technology on purpose:
 *
 * - clickable <div>s instead of links and buttons, no keyboard support
 * - a custom date picker with a read-only, placeholder-only input and no labels
 * - placeholder-only text inputs, a fake checkbox, icon buttons without names
 * - a "modal" that is a positioned <div> without dialog semantics or focus handling
 * - the content arrives late: JavaScript fetches it from /_app/* after a delay
 *
 * The server only sends a shell. public/js/legacy.js renders the rest.
 */

const shell = (view, data = {}) =>
  html`<div id="app" data-view="${view}" data-today="${data.today}" data-delay="${data.delay}"${data.slug ? html` data-slug="${data.slug}"` : ''}${data.ref ? html` data-ref="${data.ref}" data-token="${data.token}"` : ''}>
      <div class="spinner"></div>
    </div>`;

export function legacyHomePage(hooks, page, { store, config }) {
  return html`<div class="hero">
      <div class="hero-title">Cabins under the northern lights</div>
      <div class="hero-text">Six hand-picked cabins in Norway. Book directly.</div>
      <div class="btn btn-primary" data-href="/cabins">Find a cabin</div>
    </div>
    ${shell('featured', { today: store.today(), delay: config.legacyDelayMs })}`;
}

export function legacyCabinListPage(hooks, page, { store, config }) {
  return html`<div class="page-title">Our cabins</div>
    ${shell('list', { today: store.today(), delay: config.legacyDelayMs })}`;
}

export function legacyCabinDetailPage(hooks, page, { store, config, cabin }) {
  return html`<div class="page-title">${cabin.name}</div>
    <div class="cabin-hero" data-img="${cabin.image}"></div>
    ${shell('detail', { today: store.today(), delay: config.legacyDelayMs, slug: cabin.slug })}
    ${hooks.slot('cabin-detail-end', page)}`;
}

export function legacyBookingPage(hooks, page, { store, config, booking, token }) {
  return html`<div class="page-title">Your booking</div>
    ${shell('booking', { today: store.today(), delay: config.legacyDelayMs, ref: booking.ref, token })}`;
}
