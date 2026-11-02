import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, nightsBetween, addDays, parseDate } from '../src/store.js';

const store = () => createStore({ now: () => new Date('2026-11-10T12:00:00Z') });

test('dates: parse, add and count nights', () => {
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('2026-12-02') !== null, true);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(nightsBetween('2026-12-02', '2026-12-05'), 3);
});

test('price: weekend nights use the weekend rate, cleaning is added once', () => {
  const s = store();
  const q = s.quotePrice(s.getCabin('fjellro'), '2026-12-02', '2026-12-05'); // Wed, Thu, Fri nights
  assert.equal(q.nights, 3);
  assert.deepEqual(q.nightly.map((n) => n.rate), [2200, 2200, 2600]);
  assert.equal(q.total, 2200 + 2200 + 2600 + 900);
  assert.equal(q.currency, 'NOK');
});

test('availability: free dates, blocked dates and existing bookings', () => {
  const s = store();
  assert.equal(s.checkAvailability({ cabin: 'fjellro', checkIn: '2026-12-02', checkOut: '2026-12-05', guests: 2 }).available, true);
  const owner = s.checkAvailability({ cabin: 'fjellro', checkIn: '2026-12-20', checkOut: '2026-12-23', guests: 2 });
  assert.equal(owner.available, false);
  assert.deepEqual(owner.conflicts, [{ from: '2026-12-21', to: '2026-12-28' }]);
  const booked = s.checkAvailability({ cabin: 'fjellro', checkIn: '2027-03-06', checkOut: '2027-03-09', guests: 2 });
  assert.equal(booked.available, false);
  // Check-out day of one stay can be the check-in day of the next.
  assert.equal(s.checkAvailability({ cabin: 'fjellro', checkIn: '2027-03-08', checkOut: '2027-03-10', guests: 2 }).available, true);
});

test('validation: past dates, order, guests and minimum nights', () => {
  const s = store();
  const codes = (input) => s.checkAvailability({ cabin: 'lyngen-lysthus', ...input }).errors.map((e) => e.code);
  assert.deepEqual(codes({ checkIn: '2026-11-01', checkOut: '2026-11-05', guests: 2 }), ['date_in_past']);
  assert.deepEqual(codes({ checkIn: '2026-12-05', checkOut: '2026-12-03', guests: 2 }), ['checkout_before_checkin']);
  assert.deepEqual(codes({ checkIn: '2026-12-02', checkOut: '2026-12-06', guests: 9 }), ['too_many_guests']);
  assert.deepEqual(codes({ checkIn: '2026-12-02', checkOut: '2026-12-04', guests: 2 }), ['min_nights']);
  assert.deepEqual(codes({ checkIn: 'tomorrow', checkOut: '2026-12-04', guests: 0 }), ['invalid_date', 'invalid_guests']);
  assert.deepEqual(s.checkAvailability({ cabin: 'nope', checkIn: '2026-12-02', checkOut: '2026-12-04', guests: 1 }).errors.map((e) => e.code), ['unknown_cabin']);
});

test('search: region, guests, features, price and dates', () => {
  const s = store();
  const slugs = (q) => s.searchCabins(q).map((c) => c.slug);
  assert.deepEqual(slugs({ region: 'lofoten' }), ['reine-rorbu']);
  assert.deepEqual(slugs({ guests: 7 }), ['hardanger-hytte']);
  assert.deepEqual(slugs({ features: ['pets-allowed'] }), ['hardanger-hytte', 'femund-skogkoie']);
  assert.deepEqual(slugs({ features: ['sauna', 'hot-tub'] }), ['lyngen-lysthus']);
  assert.deepEqual(slugs({ maxPrice: 1700 }), ['reine-rorbu', 'femund-skogkoie']);
  assert.equal(slugs({ checkIn: '2026-12-22', checkOut: '2026-12-24' }).includes('fjellro'), false);
  assert.equal(slugs({}).length, 6);
});

test('booking: create, reference format, double booking refused', () => {
  const s = store();
  const input = { cabin: 'senja-sjobu', checkIn: '2026-12-07', checkOut: '2026-12-09', guests: 2, name: 'Test Guest', email: 'Guest@Example.com', acceptTerms: true };
  const r = s.createBooking(input);
  assert.equal(r.ok, true);
  assert.match(r.booking.ref, /^NC-[2-9A-HJKMNP-Z]{6}$/);
  assert.equal(r.booking.email, 'guest@example.com');
  assert.equal(r.booking.total, 2400 + 2400 + 900);
  const again = s.createBooking(input);
  assert.equal(again.ok, false);
  assert.deepEqual(again.errors.map((e) => e.code), ['not_available']);
  assert.equal(s.findBooking(r.booking.ref, 'guest@example.com').ref, r.booking.ref);
  assert.equal(s.findBooking(r.booking.ref, 'someone@else.com'), null);
});

test('booking: missing guest details are field errors', () => {
  const s = store();
  const r = s.createBooking({ cabin: 'senja-sjobu', checkIn: '2026-12-07', checkOut: '2026-12-09', guests: 2, name: ' ', email: 'not-an-email' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field), ['name', 'email', 'acceptTerms']);
});

test('cancel: refund inside the free period, none after, never twice', () => {
  const s = store();
  const early = s.createBooking({ cabin: 'reine-rorbu', checkIn: '2027-01-10', checkOut: '2027-01-12', guests: 1, name: 'A', email: 'a@example.com', acceptTerms: 'on' }).booking;
  const late = s.createBooking({ cabin: 'femund-skogkoie', checkIn: '2026-11-20', checkOut: '2026-11-22', guests: 1, name: 'B', email: 'b@example.com', acceptTerms: 'on' }).booking;
  assert.equal(s.cancelBooking(early.ref).booking.refund, early.total);
  assert.equal(s.cancelBooking(late.ref).booking.refund, 0);
  assert.equal(s.cancelBooking(early.ref).errors[0].code, 'already_cancelled');
  assert.equal(s.cancelBooking('NC-NOPE00').errors[0].code, 'not_found');
});

test('members: demo login works, wrong password does not', () => {
  const s = store();
  assert.equal(s.verifyMember('ingrid@nordlys.example', 'nordlys-demo').name, 'Ingrid Berg');
  assert.equal(s.verifyMember('ingrid@nordlys.example', 'wrong'), null);
  assert.equal(s.verifyMember('nobody@nordlys.example', 'nordlys-demo'), null);
  assert.equal(s.bookingsForMember('m-ingrid').length, 2);
});

test('seed data: totals follow the pricing rules', () => {
  const s = store();
  const b = s.getBooking('NC-7KQ2MD');
  assert.equal(b.total, s.quotePrice(s.getCabin(b.cabin), b.checkIn, b.checkOut).total);
});
