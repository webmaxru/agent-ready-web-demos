import { html, raw } from '../html.js';
import { money, longDate } from './layout.js';

/**
 * The "clean" pages: semantic HTML, native form controls with labels,
 * real links and buttons, landmarks, server-rendered content that works
 * without JavaScript. Pages that are not part of the booking flow
 * (guide, FAQ, contact, login) are the same in both variants.
 */

// ---------- small building blocks ----------

const fid = (formId, name) => `${formId}-${name}`;

/** A labelled form control. Errors are linked with aria-describedby. */
export function field(hooks, page, formId, f) {
  const id = fid(formId, f.name);
  const hintId = f.hint ? `${id}-hint` : null;
  const errId = f.error ? `${id}-error` : null;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || null;
  const common = html`id="${id}" name="${f.name}"${f.required ? raw(' required') : ''}${describedBy ? html` aria-describedby="${describedBy}"` : ''}${f.error ? raw(' aria-invalid="true"') : ''}${f.autocomplete ? html` autocomplete="${f.autocomplete}"` : ''}${hooks.fieldAttrs(formId, f.name, page)}`;
  let control;
  if (f.type === 'select') {
    control = html`<select ${common}>
        ${f.options.map(([value, label]) => html`<option value="${value}"${String(value) === String(f.value ?? '') ? raw(' selected') : ''}>${label}</option>`)}
      </select>`;
  } else if (f.type === 'textarea') {
    control = html`<textarea ${common} rows="${f.rows ?? 4}"${f.maxlength ? html` maxlength="${f.maxlength}"` : ''}>${f.value ?? ''}</textarea>`;
  } else {
    control = html`<input ${common} type="${f.type ?? 'text'}" value="${f.value ?? ''}"${f.min !== undefined ? html` min="${f.min}"` : ''}${f.max !== undefined ? html` max="${f.max}"` : ''}${f.inputmode ? html` inputmode="${f.inputmode}"` : ''}>`;
  }
  return html`<div class="field${f.error ? ' has-error' : ''}">
      <label for="${id}">${f.label}${f.optional ? html` <span class="optional">(optional)</span>` : ''}</label>
      ${f.hint ? html`<p class="hint" id="${hintId}">${f.hint}</p>` : ''}
      ${f.error ? html`<p class="error-message" id="${errId}">${f.error}</p>` : ''}
      ${control}
    </div>`;
}

/** Error summary at the top of a form, each item linking to its field. */
export function errorSummary(formId, errors) {
  if (!errors?.length) return '';
  return html`<div class="error-summary" role="alert" tabindex="-1" id="${formId}-errors">
      <h2>There is a problem</h2>
      <ul>
        ${errors.map((e) => html`<li><a href="#${fid(formId, e.field)}">${e.message}</a></li>`)}
      </ul>
    </div>`;
}

const errorFor = (errors, name) => errors?.find((e) => e.field === name)?.message;

function cabinFacts(cabin) {
  return html`<dl class="facts">
      <div><dt>Region</dt><dd>${cabin.region}, ${cabin.county}</dd></div>
      <div><dt>Sleeps</dt><dd>${cabin.maxGuests} guests</dd></div>
      <div><dt>Bedrooms</dt><dd>${cabin.bedrooms} (${cabin.beds})</dd></div>
      <div><dt>From</dt><dd>${money(cabin.nightlyRate, cabin.currency)} per night</dd></div>
      <div><dt>Minimum stay</dt><dd>${cabin.minNights} nights</dd></div>
    </dl>`;
}

export function cabinCard(cabin, features, query = '') {
  return html`<li>
      <article class="cabin-card">
        <img src="${cabin.image}" alt="${cabin.imageAlt}" width="480" height="300" loading="lazy">
        <h2><a href="/cabins/${cabin.slug}${query}">${cabin.name}</a></h2>
        <p>${cabin.summary}</p>
        <p class="price">From <strong>${money(cabin.nightlyRate, cabin.currency)}</strong> per night · sleeps ${cabin.maxGuests}</p>
        <ul class="tags" aria-label="Features">
          ${cabin.features.map((f) => html`<li>${features[f] ?? f}</li>`)}
        </ul>
      </article>
    </li>`;
}

export function quoteTable(quote) {
  return html`<table class="quote">
      <caption>Price for ${quote.nights} nights</caption>
      <tbody>
        ${quote.nightly.map(
          (n) => html`<tr><th scope="row">${longDate(n.date)}${n.weekend ? ' (weekend rate)' : ''}</th><td>${money(n.rate, quote.currency)}</td></tr>`
        )}
        <tr><th scope="row">Cleaning, bed linen and towels</th><td>${money(quote.cleaningFee, quote.currency)}</td></tr>
      </tbody>
      <tfoot>
        <tr><th scope="row">Total</th><td><strong>${money(quote.total, quote.currency)}</strong></td></tr>
      </tfoot>
    </table>`;
}

function blocks(list) {
  return list.map((b) => {
    if (b.type === 'h2') return html`<h2>${b.text}</h2>`;
    if (b.type === 'ul') return html`<ul>${b.items.map((i) => html`<li>${i}</li>`)}</ul>`;
    return html`<p>${b.text}</p>`;
  });
}

// ---------- pages ----------

export function homePage(hooks, page, { store }) {
  const featured = store.cabins().slice(0, 3);
  return html`<section class="hero" aria-labelledby="hero-title">
      <h1 id="hero-title">Cabins under the northern lights</h1>
      <p>Six hand-picked cabins in Norway, from a rorbu in Lofoten to a forest hut by lake Femunden. Book directly, cancel free up to 14 days before you arrive.</p>
      <p><a class="button" href="/cabins">Find a cabin</a></p>
    </section>
    <section aria-labelledby="featured-title">
      <h2 id="featured-title">Featured cabins</h2>
      <ul class="cabin-grid">
        ${featured.map((c) => cabinCard(c, store.features()))}
      </ul>
    </section>
    <section aria-labelledby="guide-title">
      <h2 id="guide-title">From the guide</h2>
      <ul class="article-list">
        ${store.articles().slice(0, 3).map((a) => html`<li><a href="/guide/${a.slug}">${a.title}</a> <span>${a.description}</span></li>`)}
      </ul>
    </section>`;
}

export function cabinListPage(hooks, page, { store, query, results }) {
  const features = store.features();
  const wanted = [].concat(query.features ?? []);
  const qs = query.checkIn && query.checkOut
    ? `?checkIn=${encodeURIComponent(query.checkIn)}&checkOut=${encodeURIComponent(query.checkOut)}${query.guests ? `&guests=${encodeURIComponent(query.guests)}` : ''}`
    : '';
  return html`<h1>Our cabins</h1>
    <form id="search" class="search" method="get" action="/cabins" role="search" aria-label="Search cabins"${hooks.formAttrs('search', page)}>
      ${field(hooks, page, 'search', {
        name: 'region', label: 'Region', type: 'select', value: query.region,
        options: [['', 'Any region'], ...store.regions().map((r) => [r.name, r.name])],
      })}
      ${field(hooks, page, 'search', { name: 'guests', label: 'Guests', type: 'number', min: 1, max: 8, value: query.guests, inputmode: 'numeric' })}
      ${field(hooks, page, 'search', { name: 'checkIn', label: 'Check-in', type: 'date', value: query.checkIn, min: store.today() })}
      ${field(hooks, page, 'search', { name: 'checkOut', label: 'Check-out', type: 'date', value: query.checkOut, min: store.today() })}
      ${field(hooks, page, 'search', { name: 'maxPrice', label: 'Max price per night (NOK)', type: 'number', min: 0, value: query.maxPrice, inputmode: 'numeric' })}
      <fieldset>
        <legend>Must have</legend>
        ${Object.entries(features).map(
          ([key, label]) =>
            html`<label class="check"><input type="checkbox" name="features" value="${key}"${wanted.includes(key) ? raw(' checked') : ''}${hooks.fieldAttrs('search', 'features', page)}> ${label}</label>`
        )}
      </fieldset>
      <button type="submit">Search cabins</button>
    </form>
    <p role="status" class="result-count">${results.length === 1 ? '1 cabin matches' : `${results.length} cabins match`}${query.checkIn && query.checkOut ? ` and ${results.length === 1 ? 'is' : 'are'} free from ${longDate(query.checkIn)} to ${longDate(query.checkOut)}` : ''}.</p>
    <ul class="cabin-grid">
      ${results.map((c) => cabinCard(c, features, qs))}
    </ul>`;
}

export function cabinDetailPage(hooks, page, { store, cabin, query, check }) {
  const features = store.features();
  const reviews = store.reviewsFor(cabin.slug);
  const unavailable = store.unavailableRanges(cabin.slug).filter((r) => r.to > store.today());
  const errors = check?.errors ?? [];
  const bookHref = check?.available
    ? `/book/${cabin.slug}?checkIn=${encodeURIComponent(query.checkIn)}&checkOut=${encodeURIComponent(query.checkOut)}&guests=${encodeURIComponent(query.guests)}`
    : null;
  return html`<article class="cabin-detail">
      <nav aria-label="Breadcrumb" class="breadcrumb"><ol><li><a href="/cabins">Cabins</a></li><li aria-current="page">${cabin.name}</li></ol></nav>
      <h1>${cabin.name}</h1>
      <p class="lead">${cabin.summary}</p>
      <img src="${cabin.image}" alt="${cabin.imageAlt}" width="960" height="600">
      ${cabin.description.map((p) => html`<p>${p}</p>`)}
      <h2>At a glance</h2>
      ${cabinFacts(cabin)}
      <h2>Features</h2>
      <ul class="tags">${cabin.features.map((f) => html`<li>${features[f] ?? f}</li>`)}</ul>
      <p>Check-in from ${cabin.checkInTime}, check-out by ${cabin.checkOutTime}. Friday and Saturday nights cost ${money(cabin.weekendRate, cabin.currency)}. Cleaning, bed linen and towels: ${money(cabin.cleaningFee, cabin.currency)} per stay.</p>

      <section aria-labelledby="availability-title" class="availability">
        <h2 id="availability-title">Check availability</h2>
        ${errorSummary('availability', errors)}
        <form id="availability" method="get" action="/cabins/${cabin.slug}#availability-title"${hooks.formAttrs('availability', page)}>
          ${field(hooks, page, 'availability', { name: 'checkIn', label: 'Check-in', type: 'date', required: true, value: query.checkIn, min: store.today(), error: errorFor(errors, 'checkIn') })}
          ${field(hooks, page, 'availability', { name: 'checkOut', label: 'Check-out', type: 'date', required: true, value: query.checkOut, min: store.today(), error: errorFor(errors, 'checkOut') })}
          ${field(hooks, page, 'availability', { name: 'guests', label: 'Guests', type: 'number', required: true, min: 1, max: cabin.maxGuests, value: query.guests ?? 2, inputmode: 'numeric', hint: `Up to ${cabin.maxGuests} guests.`, error: errorFor(errors, 'guests') })}
          <button type="submit">Check availability</button>
        </form>
        <div id="availability-result" role="status">
          ${check && !errors.length
            ? check.available
              ? html`<p class="ok">${cabin.name} is available from ${longDate(query.checkIn)} to ${longDate(query.checkOut)}.</p>
                  ${quoteTable(check.quote)}
                  <p><a class="button" href="${bookHref}">Book these dates</a></p>`
              : html`<p class="not-ok">${cabin.name} is not available for those dates. It is already taken ${check.conflicts.map((r, i) => html`${i ? ', ' : ''}from ${longDate(r.from)} to ${longDate(r.to)}`)}.</p>`
            : ''}
        </div>
        ${unavailable.length
          ? html`<details><summary>Dates that are already taken</summary><ul>${unavailable.map((r) => html`<li>${longDate(r.from)} to ${longDate(r.to)}</li>`)}</ul></details>`
          : ''}
      </section>

      <section aria-labelledby="reviews-title">
        <h2 id="reviews-title">Guest reviews</h2>
        ${reviews.length
          ? html`<ul class="reviews">${reviews.map(
              (r) => html`<li><blockquote><p>${r.text}</p></blockquote><p class="byline">${r.author}, <time datetime="${r.date}">${longDate(r.date)}</time>, rated ${r.rating} out of 5</p></li>`
            )}</ul>`
          : html`<p>No reviews yet.</p>`}
      </section>
      ${hooks.slot('cabin-detail-end', page)}
    </article>`;
}

export function bookingFormPage(hooks, page, { store, cabin, values, errors = [], check }) {
  return html`<h1>Book ${cabin.name}</h1>
    ${errorSummary('booking', errors)}
    <form id="booking" method="post" action="/book/${cabin.slug}" novalidate${hooks.formAttrs('booking', page)}>
      <fieldset>
        <legend>Your stay</legend>
        ${field(hooks, page, 'booking', { name: 'checkIn', label: 'Check-in', type: 'date', required: true, value: values.checkIn, min: store.today(), error: errorFor(errors, 'checkIn') })}
        ${field(hooks, page, 'booking', { name: 'checkOut', label: 'Check-out', type: 'date', required: true, value: values.checkOut, min: store.today(), error: errorFor(errors, 'checkOut') })}
        ${field(hooks, page, 'booking', { name: 'guests', label: 'Guests', type: 'number', required: true, min: 1, max: cabin.maxGuests, value: values.guests, inputmode: 'numeric', hint: `Up to ${cabin.maxGuests} guests.`, error: errorFor(errors, 'guests') })}
      </fieldset>
      <fieldset>
        <legend>Lead guest</legend>
        ${field(hooks, page, 'booking', { name: 'name', label: 'Full name', required: true, value: values.name, autocomplete: 'name', error: errorFor(errors, 'name') })}
        ${field(hooks, page, 'booking', { name: 'email', label: 'Email', type: 'email', required: true, value: values.email, autocomplete: 'email', hint: 'We send the booking confirmation here.', error: errorFor(errors, 'email') })}
        ${field(hooks, page, 'booking', { name: 'phone', label: 'Phone', type: 'tel', optional: true, value: values.phone, autocomplete: 'tel' })}
        ${field(hooks, page, 'booking', { name: 'requests', label: 'Special requests', type: 'textarea', optional: true, value: values.requests, maxlength: 1000 })}
      </fieldset>
      <div class="field check${errorFor(errors, 'acceptTerms') ? ' has-error' : ''}">
        ${errorFor(errors, 'acceptTerms') ? html`<p class="error-message" id="booking-acceptTerms-error">${errorFor(errors, 'acceptTerms')}</p>` : ''}
        <input type="checkbox" id="booking-acceptTerms" name="acceptTerms" value="on"${values.acceptTerms ? raw(' checked') : ''}${errorFor(errors, 'acceptTerms') ? raw(' aria-invalid="true" aria-describedby="booking-acceptTerms-error"') : ''}${hooks.fieldAttrs('booking', 'acceptTerms', page)}>
        <label for="booking-acceptTerms">I accept the <a href="/faq#cancellation">booking and cancellation terms</a></label>
      </div>
      ${check?.quote ? html`<section aria-labelledby="summary-title"><h2 id="summary-title">Price summary</h2>${quoteTable(check.quote)}</section>` : ''}
      <button type="submit">Confirm booking</button>
      ${hooks.slot('booking-form-end', page)}
    </form>`;
}

export function bookingPage(hooks, page, { store, booking, token, justBooked, justCancelled, errors = [] }) {
  const cabin = store.getCabin(booking.cabin);
  const policy = store.cancellationPolicy(booking);
  const cancelled = booking.status === 'cancelled';
  return html`${justBooked ? html`<div class="notice ok" role="status"><h1>Booking confirmed</h1><p>Your booking reference is <strong class="ref">${booking.ref}</strong>. Keep it to manage your booking.</p></div>` : html`<h1>Booking ${booking.ref}</h1>`}
    ${justCancelled ? html`<div class="notice" role="status"><p>Booking ${booking.ref} is cancelled. ${booking.refund ? `We refund ${money(booking.refund, booking.currency)}.` : 'This cancellation is not refundable.'}</p></div>` : ''}
    ${errorSummary('cancel', errors)}
    ${justBooked ? hooks.slot('booking-confirmed', page) : ''}
    <dl class="facts booking-details">
      <div><dt>Reference</dt><dd>${booking.ref}</dd></div>
      <div><dt>Status</dt><dd>${cancelled ? 'Cancelled' : 'Confirmed'}</dd></div>
      <div><dt>Cabin</dt><dd><a href="/cabins/${cabin.slug}">${cabin.name}</a></dd></div>
      <div><dt>Check-in</dt><dd><time datetime="${booking.checkIn}">${longDate(booking.checkIn)}</time> from ${cabin.checkInTime}</dd></div>
      <div><dt>Check-out</dt><dd><time datetime="${booking.checkOut}">${longDate(booking.checkOut)}</time> by ${cabin.checkOutTime}</dd></div>
      <div><dt>Guests</dt><dd>${booking.guests}</dd></div>
      <div><dt>Lead guest</dt><dd>${booking.name}</dd></div>
      <div><dt>Total</dt><dd>${money(booking.total, booking.currency)}</dd></div>
    </dl>
    ${cancelled
      ? ''
      : html`<p>${policy.refundable ? `Free cancellation until ${longDate(policy.freeUntil)}.` : 'The free cancellation period has passed, so a cancellation is not refunded.'}</p>
        <p><a class="button secondary" id="cancel-link" href="/bookings/${booking.ref}/cancel?token=${encodeURIComponent(token)}">Cancel this booking</a></p>
        <dialog id="cancel-dialog" aria-labelledby="cancel-dialog-title">
          ${cancelForm(hooks, page, booking, token, policy, 'cancel-dialog-title')}
        </dialog>`}`;
}

export function cancelForm(hooks, page, booking, token, policy, titleId = 'cancel-title') {
  return html`<form id="cancel" method="post" action="/bookings/${booking.ref}/cancel"${hooks.formAttrs('cancel', page)}>
      <h2 id="${titleId}">Cancel booking ${booking.ref}?</h2>
      <p>${policy.refundable ? `You get a full refund of ${money(booking.total, booking.currency)}.` : 'This cancellation is not refunded.'} This cannot be undone.</p>
      <input type="hidden" name="token" value="${token}">
      <button type="submit" class="danger">Yes, cancel booking</button>
      <a href="/bookings/${booking.ref}?token=${encodeURIComponent(token)}" data-close-dialog>Keep my booking</a>
    </form>`;
}

export function cancelConfirmPage(hooks, page, { store, booking, token }) {
  return html`<h1>Cancel your booking</h1>
    ${cancelForm(hooks, page, booking, token, store.cancellationPolicy(booking))}`;
}

export function lookupPage(hooks, page, { values = {}, errors = [] }) {
  return html`<h1>Find your booking</h1>
    <p>Enter the booking reference from your confirmation and the email address you booked with.</p>
    ${errorSummary('lookup', errors)}
    <form id="lookup" method="post" action="/bookings"${hooks.formAttrs('lookup', page)}>
      ${field(hooks, page, 'lookup', { name: 'ref', label: 'Booking reference', required: true, value: values.ref, hint: 'For example NC-7KQ2MD.', error: errorFor(errors, 'ref') })}
      ${field(hooks, page, 'lookup', { name: 'email', label: 'Email', type: 'email', required: true, value: values.email, autocomplete: 'email', error: errorFor(errors, 'email') })}
      <button type="submit">Find booking</button>
    </form>`;
}

export function loginPage(hooks, page, { values = {}, errors = [], next = '' }) {
  return html`<h1>Sign in</h1>
    <p>Demo accounts: <code>ingrid@nordlys.example</code> or <code>ola@nordlys.example</code>, password <code>nordlys-demo</code>.</p>
    ${errorSummary('login', errors)}
    <form id="login" method="post" action="/login"${hooks.formAttrs('login', page)}>
      <input type="hidden" name="next" value="${next}">
      ${field(hooks, page, 'login', { name: 'email', label: 'Email', type: 'email', required: true, value: values.email, autocomplete: 'username', error: errorFor(errors, 'email') })}
      ${field(hooks, page, 'login', { name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password', error: errorFor(errors, 'password') })}
      <button type="submit">Sign in</button>
    </form>`;
}

export function myBookingsPage(hooks, page, { store, member, bookings, tokenFor }) {
  return html`<h1>My bookings</h1>
    <p>Signed in as ${member.name} (${member.email}).</p>
    ${bookings.length
      ? html`<table class="bookings">
          <caption>Your bookings</caption>
          <thead><tr><th scope="col">Reference</th><th scope="col">Cabin</th><th scope="col">Dates</th><th scope="col">Guests</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead>
          <tbody>
            ${bookings.map(
              (b) => html`<tr>
                <th scope="row"><a href="/bookings/${b.ref}?token=${encodeURIComponent(tokenFor(b.ref))}">${b.ref}</a></th>
                <td>${store.getCabin(b.cabin).name}</td>
                <td>${longDate(b.checkIn)} to ${longDate(b.checkOut)}</td>
                <td>${b.guests}</td>
                <td>${b.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}</td>
                <td>${money(b.total, b.currency)}</td>
              </tr>`
            )}
          </tbody>
        </table>`
      : html`<p>You have no bookings yet. <a href="/cabins">Find a cabin</a>.</p>`}`;
}

export function guideIndexPage(hooks, page, { store }) {
  return html`<h1>Guide</h1>
    <p>Practical notes for a cabin trip in Norway, written by the people who look after our cabins.</p>
    <ul class="article-list">
      ${store.articles().map(
        (a) => html`<li><article><h2><a href="/guide/${a.slug}">${a.title}</a></h2><p>${a.description}</p><p class="byline"><time datetime="${a.published}">${longDate(a.published)}</time></p></article></li>`
      )}
    </ul>`;
}

export function articlePage(hooks, page, { article }) {
  return html`<article class="prose">
      <nav aria-label="Breadcrumb" class="breadcrumb"><ol><li><a href="/guide">Guide</a></li><li aria-current="page">${article.title}</li></ol></nav>
      <h1>${article.title}</h1>
      <p class="byline">By ${article.author}, <time datetime="${article.published}">${longDate(article.published)}</time></p>
      <p class="lead">${article.description}</p>
      ${blocks(article.blocks)}
    </article>`;
}

export function faqPage(hooks, page, { store }) {
  return html`<h1>Frequently asked questions</h1>
    ${store.faq().map((f) => html`<section class="faq-item" aria-labelledby="${f.id}"><h2 id="${f.id}">${f.q}</h2><p>${f.a}</p></section>`)}`;
}

export function contactPage(hooks, page, { values = {}, errors = [], sent = false }) {
  if (sent) return html`<h1>Thank you</h1><p role="status">We got your message and will answer within two working days.</p><p><a href="/">Back to the home page</a></p>`;
  return html`<h1>Contact us</h1>
    <p>Questions about a cabin or a booking? Write to us and we answer within two working days.</p>
    ${errorSummary('contact', errors)}
    <form id="contact" method="post" action="/contact"${hooks.formAttrs('contact', page)}>
      ${field(hooks, page, 'contact', { name: 'name', label: 'Your name', required: true, value: values.name, autocomplete: 'name', error: errorFor(errors, 'name') })}
      ${field(hooks, page, 'contact', { name: 'email', label: 'Email', type: 'email', required: true, value: values.email, autocomplete: 'email', error: errorFor(errors, 'email') })}
      ${field(hooks, page, 'contact', { name: 'topic', label: 'Topic', type: 'select', value: values.topic, options: [['booking', 'A booking'], ['cabin', 'A cabin'], ['other', 'Something else']] })}
      ${field(hooks, page, 'contact', { name: 'message', label: 'Message', type: 'textarea', required: true, value: values.message, rows: 6, maxlength: 4000, error: errorFor(errors, 'message') })}
      <button type="submit">Send message</button>
    </form>`;
}

export function notFoundPage() {
  return html`<h1>Page not found</h1><p>We could not find that page. Try the <a href="/cabins">cabin list</a> or the <a href="/">home page</a>.</p>`;
}
