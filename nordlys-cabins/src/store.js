import { readFileSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * In-memory data store for Nordlys Cabins. Everything is loaded from the JSON
 * files in ../data at start and lives in memory until the process stops.
 * Business rules (availability, pricing, booking, cancellation) live here so
 * that every interface a layer adds later (a REST API, an MCP server, WebMCP
 * tools) calls exactly the same logic as the human-facing pages.
 */

const DATA_DIR = new URL('../data/', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, DATA_DIR), 'utf8'));

export const CANCELLATION_FREE_DAYS = 14;
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L

/** @typedef {{ok: true, value?: any} | {ok: false, errors: Array<{field: string, code: string, message: string}>}} Result */

const DAY = 86_400_000;
/** @param {string} s  ISO date YYYY-MM-DD */
export function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  return t;
}
export const formatDate = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => formatDate(parseDate(s) + n * DAY);
export const nightsBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY);

/**
 * @param {object} [options]
 * @param {() => Date} [options.now] clock, injectable for tests
 */
export function createStore({ now = () => new Date() } = {}) {
  const cabinData = load('cabins.json');
  const cabins = cabinData.cabins;
  const features = cabinData.features;
  const regions = cabinData.regions;
  const blocked = load('availability.json').blocked;
  const members = load('members.json').members;
  const articles = load('articles.json').articles;
  const faq = load('faq.json').faq;
  const reviews = load('reviews.json').reviews;
  const contactMessages = [];

  const today = () => formatDate(Date.parse(now().toISOString().slice(0, 10) + 'T00:00:00Z'));

  const getCabin = (slug) => cabins.find((c) => c.slug === slug) ?? null;

  /** Price for a stay. Friday and Saturday nights use the weekend rate. */
  function quotePrice(cabin, checkIn, checkOut) {
    const nights = [];
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      const weekday = new Date(parseDate(d)).getUTCDay(); // 5 = Fri, 6 = Sat
      const weekend = weekday === 5 || weekday === 6;
      nights.push({ date: d, rate: weekend ? cabin.weekendRate : cabin.nightlyRate, weekend });
    }
    const accommodation = nights.reduce((sum, n) => sum + n.rate, 0);
    return {
      currency: cabin.currency,
      nights: nights.length,
      nightly: nights,
      accommodation,
      cleaningFee: cabin.cleaningFee,
      total: accommodation + cabin.cleaningFee,
    };
  }

  const bookings = load('bookings.json').bookings.map((b) => {
    const cabin = getCabin(b.cabin);
    const price = quotePrice(cabin, b.checkIn, b.checkOut);
    return { ...b, total: price.total, currency: price.currency };
  });

  const overlaps = (aFrom, aTo, bFrom, bTo) => aFrom < bTo && bFrom < aTo;

  /** Ranges (from inclusive, to exclusive) when the cabin cannot be booked. */
  function unavailableRanges(slug, { excludeRef } = {}) {
    return [
      ...blocked.filter((b) => b.cabin === slug).map((b) => ({ from: b.from, to: b.to, reason: 'blocked' })),
      ...bookings
        .filter((b) => b.cabin === slug && b.status === 'confirmed' && b.ref !== excludeRef)
        .map((b) => ({ from: b.checkIn, to: b.checkOut, reason: 'booked' })),
    ].sort((a, b) => a.from.localeCompare(b.from));
  }

  /** Validate a stay request. Returns field errors in a shape every interface can reuse. */
  function validateStay({ cabin: slug, checkIn, checkOut, guests }) {
    const errors = [];
    const cabin = getCabin(slug);
    if (!cabin) errors.push({ field: 'cabin', code: 'unknown_cabin', message: 'Choose one of our cabins.' });
    const inT = parseDate(checkIn);
    const outT = parseDate(checkOut);
    if (inT === null) errors.push({ field: 'checkIn', code: 'invalid_date', message: 'Enter a check-in date as YYYY-MM-DD.' });
    if (outT === null) errors.push({ field: 'checkOut', code: 'invalid_date', message: 'Enter a check-out date as YYYY-MM-DD.' });
    if (inT !== null && checkIn < today())
      errors.push({ field: 'checkIn', code: 'date_in_past', message: 'Check-in cannot be in the past.' });
    if (inT !== null && outT !== null && outT <= inT)
      errors.push({ field: 'checkOut', code: 'checkout_before_checkin', message: 'Check-out must be after check-in.' });
    const g = Number(guests);
    if (!Number.isInteger(g) || g < 1)
      errors.push({ field: 'guests', code: 'invalid_guests', message: 'Enter the number of guests, at least 1.' });
    else if (cabin && g > cabin.maxGuests)
      errors.push({ field: 'guests', code: 'too_many_guests', message: `${cabin.name} sleeps up to ${cabin.maxGuests} guests.` });
    if (errors.length === 0 && cabin) {
      const n = nightsBetween(checkIn, checkOut);
      if (n < cabin.minNights)
        errors.push({ field: 'checkOut', code: 'min_nights', message: `${cabin.name} has a minimum stay of ${cabin.minNights} nights.` });
      if (n > 28) errors.push({ field: 'checkOut', code: 'max_nights', message: 'Stays longer than 28 nights need a direct request.' });
    }
    return { cabin, errors };
  }

  /**
   * Check availability and price for a stay.
   * @returns {{available: boolean, errors: any[], cabin?: any, quote?: any, conflicts?: any[]}}
   */
  function checkAvailability(input) {
    const { cabin, errors } = validateStay(input);
    if (errors.length) return { available: false, errors };
    const conflicts = unavailableRanges(cabin.slug).filter((r) => overlaps(input.checkIn, input.checkOut, r.from, r.to));
    return {
      available: conflicts.length === 0,
      errors: [],
      cabin,
      quote: quotePrice(cabin, input.checkIn, input.checkOut),
      conflicts: conflicts.map(({ from, to }) => ({ from, to })),
    };
  }

  /** Search cabins. All filters are optional. */
  function searchCabins({ region, guests, checkIn, checkOut, features: wanted = [], maxPrice } = {}) {
    let list = cabins;
    if (region) list = list.filter((c) => c.region.toLowerCase() === String(region).toLowerCase());
    const g = Number(guests);
    if (guests && Number.isInteger(g) && g > 0) list = list.filter((c) => c.maxGuests >= g);
    const want = [].concat(wanted).filter(Boolean);
    if (want.length) list = list.filter((c) => want.every((f) => c.features.includes(f)));
    const mp = Number(maxPrice);
    if (maxPrice && mp > 0) list = list.filter((c) => c.nightlyRate <= mp);
    if (checkIn && checkOut && parseDate(checkIn) !== null && parseDate(checkOut) !== null && checkOut > checkIn) {
      list = list.filter((c) => !unavailableRanges(c.slug).some((r) => overlaps(checkIn, checkOut, r.from, r.to)));
    }
    return list;
  }

  function newRef() {
    let ref;
    do {
      const bytes = randomBytes(6);
      ref = 'NC-' + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
    } while (bookings.some((b) => b.ref === ref));
    return ref;
  }

  /** Create a booking after full validation. */
  function createBooking(input, { member } = {}) {
    const result = checkAvailability(input);
    const errors = [...result.errors];
    const name = String(input.name ?? '').trim();
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!name) errors.push({ field: 'name', code: 'required', message: 'Enter the name of the lead guest.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push({ field: 'email', code: 'invalid_email', message: 'Enter an email address like name@example.com.' });
    if (!(input.acceptTerms === true || input.acceptTerms === 'on' || input.acceptTerms === 'true'))
      errors.push({ field: 'acceptTerms', code: 'required', message: 'Accept the booking terms to continue.' });
    if (errors.length === 0 && !result.available)
      errors.push({ field: 'checkIn', code: 'not_available', message: `${result.cabin.name} is not available for those dates.` });
    if (errors.length) return { ok: false, errors };
    const booking = {
      ref: newRef(),
      cabin: result.cabin.slug,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: Number(input.guests),
      name,
      email,
      phone: String(input.phone ?? '').trim() || undefined,
      requests: String(input.requests ?? '').trim().slice(0, 1000) || undefined,
      memberId: member?.id,
      status: 'confirmed',
      total: result.quote.total,
      currency: result.quote.currency,
      createdAt: now().toISOString(),
    };
    bookings.push(booking);
    return { ok: true, booking };
  }

  const getBooking = (ref) => bookings.find((b) => b.ref === String(ref ?? '').toUpperCase()) ?? null;

  /** Find a booking by reference and the email it was made with (guest access). */
  function findBooking(ref, email) {
    const b = getBooking(ref);
    return b && b.email === String(email ?? '').trim().toLowerCase() ? b : null;
  }

  function cancellationPolicy(booking) {
    const daysLeft = nightsBetween(today(), booking.checkIn);
    return { freeUntil: addDays(booking.checkIn, -CANCELLATION_FREE_DAYS), refundable: daysLeft >= CANCELLATION_FREE_DAYS };
  }

  function cancelBooking(ref) {
    const b = getBooking(ref);
    if (!b) return { ok: false, errors: [{ field: 'ref', code: 'not_found', message: 'No booking with that reference.' }] };
    if (b.status === 'cancelled') return { ok: false, errors: [{ field: 'ref', code: 'already_cancelled', message: 'This booking is already cancelled.' }] };
    if (b.checkIn <= today()) return { ok: false, errors: [{ field: 'ref', code: 'stay_started', message: 'A stay that has started cannot be cancelled online.' }] };
    const policy = cancellationPolicy(b);
    b.status = 'cancelled';
    b.cancelledAt = now().toISOString();
    b.refund = policy.refundable ? b.total : 0;
    return { ok: true, booking: b };
  }

  function verifyMember(email, password) {
    const m = members.find((x) => x.email === String(email ?? '').trim().toLowerCase());
    if (!m) return null;
    const hash = scryptSync(String(password ?? ''), m.salt, 32);
    return timingSafeEqual(hash, Buffer.from(m.passwordHash, 'hex')) ? publicMember(m) : null;
  }
  const publicMember = (m) => ({ id: m.id, name: m.name, email: m.email });
  const getMember = (id) => {
    const m = members.find((x) => x.id === id);
    return m ? publicMember(m) : null;
  };
  const bookingsForMember = (id) => bookings.filter((b) => b.memberId === id).sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  return {
    today,
    cabins: () => cabins,
    features: () => features,
    regions: () => regions,
    getCabin,
    searchCabins,
    reviewsFor: (slug) => reviews.filter((r) => r.cabin === slug),
    unavailableRanges,
    checkAvailability,
    quotePrice,
    createBooking,
    getBooking,
    findBooking,
    cancelBooking,
    cancellationPolicy,
    bookings: () => bookings,
    verifyMember,
    getMember,
    bookingsForMember,
    articles: () => articles,
    getArticle: (slug) => articles.find((a) => a.slug === slug) ?? null,
    faq: () => faq,
    addContactMessage: (msg) => {
      contactMessages.push({ ...msg, receivedAt: now().toISOString() });
      return contactMessages.length;
    },
    contactMessages: () => contactMessages,
  };
}
