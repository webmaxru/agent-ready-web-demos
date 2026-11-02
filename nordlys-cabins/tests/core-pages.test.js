import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, cookieJar, formBody } from './helpers/server.js';

const STAY = { checkIn: '2026-12-02', checkOut: '2026-12-05', guests: '2' };

test('every public page answers 200 with HTML and the base security headers', async () => {
  for (const variant of ['clean', 'legacy']) {
    const { app } = await buildApp({ variant });
    for (const path of ['/', '/cabins', '/cabins/fjellro', '/guide', '/guide/northern-lights-from-a-cabin', '/faq', '/contact', '/login', '/bookings']) {
      const r = await app.request(path);
      assert.equal(r.status, 200, `${variant} ${path}`);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
      assert.doesNotMatch(await r.text(), /lorem ipsum|\bT[O]DO\b/i);
    }
    assert.equal((await app.request('/cabins/no-such-cabin')).status, 404);
    assert.equal((await app.request('/nothing-here')).status, 404);
  }
});

test('clean: pages are semantic (landmarks, one h1, labelled controls)', async () => {
  const { app } = await buildApp();
  const html = await (await app.request('/cabins/fjellro')).text();
  assert.match(html, /<main id="main">/);
  assert.match(html, /<nav aria-label="Main">/);
  assert.equal(html.match(/<h1[ >]/g).length, 1);
  for (const id of ['availability-checkIn', 'availability-checkOut', 'availability-guests'])
    assert.match(html, new RegExp(`<label for="${id}">`));
  assert.match(html, /<button type="submit">Check availability<\/button>/);
  assert.match(html, /<img src="\/images\/fjellro.svg" alt="[^"]+"/);
});

test('legacy: the booking flow is a JavaScript shell with no form controls', async () => {
  const { app } = await buildApp({ variant: 'legacy' });
  const html = await (await app.request('/cabins/fjellro')).text();
  assert.doesNotMatch(html, /<main|<form|<button|<label/);
  assert.match(html, /<div id="app" data-view="detail"/);
  assert.doesNotMatch(html, /Fjellro means mountain calm/, 'the description arrives later, by JavaScript');
  assert.match(html, /<script src="\/js\/legacy.js" defer><\/script>/);
  const data = await (await app.request('/_app/cabins/fjellro')).json();
  assert.equal(data.slug, 'fjellro');
  assert.equal((await app.request('/book/fjellro')).status, 302);
});

test('clean: search filters by query string', async () => {
  const { app } = await buildApp();
  const html = await (await app.request('/cabins?region=Lofoten')).text();
  assert.match(html, /1 cabin matches/);
  assert.match(html, /href="\/cabins\/reine-rorbu"/);
  const pets = await (await app.request('/cabins?features=pets-allowed&guests=4')).text();
  assert.match(pets, /1 cabin matches/);
  assert.match(pets, /Hardanger Hytte/);
});

test('clean: availability check shows the price and a booking link', async () => {
  const { app } = await buildApp();
  const html = await (await app.request(`/cabins/fjellro?${new URLSearchParams(STAY)}`)).text();
  assert.match(html, /Fjellro is available/);
  assert.match(html, /NOK 7,900/);
  assert.match(html, /href="\/book\/fjellro\?checkIn=2026-12-02&amp;checkOut=2026-12-05&amp;guests=2"/);
  const bad = await (await app.request('/cabins/fjellro?checkIn=2026-12-05&checkOut=2026-12-03&guests=2')).text();
  assert.match(bad, /There is a problem/);
  assert.match(bad, /aria-invalid="true"/);
});

test('clean: book, view and cancel through HTML forms (no JavaScript)', async () => {
  const { app } = await buildApp();
  const missing = await app.request('/book/fjellro', formBody({ ...STAY, name: '', email: 'x' }));
  assert.equal(missing.status, 422);
  const missingHtml = await missing.text();
  assert.match(missingHtml, /href="#booking-name">Enter the name of the lead guest/);
  assert.match(missingHtml, /id="booking-email"[^>]*aria-invalid="true"/);

  const ok = await app.request('/book/fjellro', formBody({ ...STAY, name: 'Kari Nordmann', email: 'kari@example.com', acceptTerms: 'on' }));
  assert.equal(ok.status, 303);
  const location = ok.headers.get('location');
  const ref = /\/bookings\/(NC-[A-Z0-9]{6})\?token=([^&]+)&new=1/.exec(location);
  assert.ok(ref, location);
  const confirmed = await (await app.request(location)).text();
  assert.match(confirmed, /Booking confirmed/);
  assert.match(confirmed, new RegExp(ref[1]));

  // Without the token the booking is not visible.
  assert.equal((await app.request(`/bookings/${ref[1]}`)).status, 404);
  // Lookup by reference + email gives the link back.
  const found = await app.request('/bookings', formBody({ ref: ref[1].toLowerCase(), email: 'KARI@example.com' }));
  assert.equal(found.status, 303);
  assert.equal((await app.request('/bookings', formBody({ ref: ref[1], email: 'other@example.com' }))).status, 404);

  // The no-JS cancel path: confirmation page, then POST.
  assert.equal((await app.request(`/bookings/${ref[1]}/cancel?token=${ref[2]}`)).status, 200);
  const cancelled = await app.request(`/bookings/${ref[1]}/cancel`, formBody({ token: ref[2] }));
  assert.equal(cancelled.status, 303);
  const after = await (await app.request(cancelled.headers.get('location'))).text();
  assert.match(after, /is cancelled\. We refund NOK 7,900/);
  assert.equal((await app.request(`/bookings/${ref[1]}/cancel`, formBody({ token: 'wrong' }))).status, 404);
});

test('legacy: the internal JSON endpoints book and cancel', async () => {
  const { app } = await buildApp({ variant: 'legacy' });
  const quote = await (await app.request('/_app/quote?cabin=fjellro&checkIn=2026-12-02&checkOut=2026-12-05&guests=2')).json();
  assert.equal(quote.quote.total, 7900);
  const created = await app.request('/_app/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cabin: 'fjellro', ...STAY, guests: 2, name: 'Ola', email: 'o@example.com', acceptTerms: true }),
  });
  assert.equal(created.status, 201);
  const { booking, manageUrl } = await created.json();
  const token = new URL(manageUrl, 'http://x').searchParams.get('token');
  const page = await (await app.request(manageUrl)).text();
  assert.match(page, new RegExp(`data-ref="${booking.ref}"`));
  const cancel = await app.request(`/_app/bookings/${booking.ref}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal((await cancel.json()).booking.status, 'cancelled');
});

test('members: sign in, see my bookings, sign out', async () => {
  const { app } = await buildApp();
  const jar = cookieJar();
  assert.equal((await app.request('/account/bookings')).headers.get('location'), '/login?next=/account/bookings');
  const bad = await app.request('/login', formBody({ email: 'ingrid@nordlys.example', password: 'nope' }));
  assert.equal(bad.status, 401);
  const login = jar.store(await app.request('/login', formBody({ email: 'ingrid@nordlys.example', password: 'nordlys-demo', next: '/account/bookings' })));
  assert.equal(login.status, 303);
  assert.match(login.headers.get('set-cookie'), /nordlys_session=.*HttpOnly.*SameSite=Lax/i);
  const mine = await (await app.request('/account/bookings', { headers: jar.headers() })).text();
  assert.match(mine, /NC-7KQ2MD/);
  assert.match(mine, /NC-H4WX9P/);
  assert.doesNotMatch(mine, /NC-3TBR6F/, "Ola's booking is not Ingrid's");
  // A member sees their own booking without a token.
  assert.equal((await app.request('/bookings/NC-7KQ2MD', { headers: jar.headers() })).status, 200);
  assert.equal((await app.request('/bookings/NC-3TBR6F', { headers: jar.headers() })).status, 404);
  // Booking while signed in links the booking to the member.
  const booked = await app.request('/book/senja-sjobu', { ...formBody({ checkIn: '2026-12-07', checkOut: '2026-12-09', guests: '2', name: 'Ingrid Berg', email: 'ingrid@nordlys.example', acceptTerms: 'on' }), headers: jar.headers({ 'content-type': 'application/x-www-form-urlencoded' }) });
  assert.equal(booked.status, 303);
  assert.match(await (await app.request('/account/bookings', { headers: jar.headers() })).text(), /Senja Sjøbu/);
  jar.store(await app.request('/logout', { method: 'POST', headers: jar.headers() }));
  assert.equal((await app.request('/account/bookings', { headers: jar.headers() })).status, 302);
  // Open redirects are refused.
  const evil = await app.request('/login', formBody({ email: 'ola@nordlys.example', password: 'nordlys-demo', next: '//evil.example' }));
  assert.equal(evil.headers.get('location'), '/account/bookings');
});

test('contact: validation and thank-you page', async () => {
  const { app, store } = await buildApp();
  assert.equal((await app.request('/contact', formBody({ name: '', email: 'x', message: '' }))).status, 422);
  const ok = await app.request('/contact', formBody({ name: 'Hanne', email: 'hanne@example.com', topic: 'cabin', message: 'Is the sauna wood-fired?' }));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Thank you/);
  assert.equal(store.contactMessages().length, 1);
});

test('guide and FAQ: real content, FAQ anchors', async () => {
  const { app, store } = await buildApp();
  assert.ok(store.articles().length >= 4 && store.articles().length <= 6);
  const faq = await (await app.request('/faq')).text();
  assert.match(faq, /<h2 id="cancellation">Can I cancel a booking\?<\/h2>/);
  const article = await (await app.request('/guide/right-to-roam-and-cabin-manners')).text();
  assert.match(article, /allemannsretten/);
});
