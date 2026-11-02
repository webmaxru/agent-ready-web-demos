import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { serveStatic } from '@hono/node-server/serve-static';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createContext } from './context.js';
import { discoverLayers, selectLayers, DEFAULT_LAYERS_DIR } from './layers.js';
import { layout } from './views/layout.js';
import * as P from './views/pages.js';
import * as L from './views/legacy.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/** The security headers every response starts with. Layers may override them with ctx.headers(). */
export const BASE_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

/**
 * Build the Nordlys Cabins app with the layers this run enables.
 * @param {object} [options]
 * @param {object} [options.config]   result of loadConfig(); built from argv/env when omitted
 * @param {object} [options.overrides] shortcut: loadConfig({ argv: [], overrides })
 * @param {Array}  [options.layers]   use these layer objects instead of discovering ./layers
 * @returns {Promise<{ app: Hono, ctx: object, layers: object[], config: object, store: object }>}
 */
export async function createApp({ config, overrides, layers } = {}) {
  config ??= loadConfig({ argv: [], overrides });
  const now = config.now ? () => new Date(`${config.now}T12:00:00Z`) : () => new Date();
  const store = createStore({ now });
  const available = layers ?? (await discoverLayers(config.layersDir ?? DEFAULT_LAYERS_DIR));
  const enabled = selectLayers(available, config);
  const { ctx, internals: hooks } = createContext({ config, store, layers: enabled });
  const app = new Hono();
  hooks.attach(app);

  const secret = config.sessionSecret ?? randomBytes(32).toString('hex');
  const sessions = new Map(); // session id -> member id
  const tokenFor = (ref) => createHmac('sha256', secret).update(`booking:${ref}`).digest('base64url').slice(0, 22);
  const tokenOk = (ref, token) => {
    const a = Buffer.from(tokenFor(String(ref).toUpperCase()));
    const b = Buffer.from(String(token ?? ''));
    return a.length === b.length && timingSafeEqual(a, b);
  };

  // ---------- middleware pipeline ----------
  // 1. Response headers: base security headers, then every ctx.headers() rule (outermost, so it sees every response).
  app.use('*', async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(BASE_HEADERS)) if (!c.res.headers.has(k)) c.res.headers.set(k, v);
    await hooks.applyHeaders(c);
  });
  // 2. Before-auth middleware from layers (bot verification, rate limits, signatures).
  app.use('*', (c, next) => runChain(hooks.beforeAuth(), c, next));
  // 3. Root-path static files from layers (robots.txt, llms.txt, /.well-known/*).
  app.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      const res = await hooks.serveStatic(c);
      if (res) return res;
    }
    return next();
  });
  // 4. Sessions and auth.
  app.use('*', async (c, next) => {
    const sid = getCookie(c, 'nordlys_session');
    const memberId = sid ? sessions.get(sid) : null;
    c.set('member', memberId ? store.getMember(memberId) : null);
    return next();
  });
  // 5. After-auth middleware from layers.
  app.use('*', (c, next) => runChain(hooks.afterAuth(), c, next));

  // ---------- static assets ----------
  app.use('/css/*', serveStatic({ root: PUBLIC_DIR }));
  app.use('/js/*', serveStatic({ root: PUBLIC_DIR }));
  app.use('/images/*', serveStatic({ root: PUBLIC_DIR }));
  for (const layer of enabled) {
    if (!layer.publicDir) continue;
    const prefix = `/layers/${layer.id}`;
    app.use(`${prefix}/*`, serveStatic({ root: layer.publicDir, rewriteRequestPath: (p) => p.slice(prefix.length) }));
  }

  // ---------- rendering helpers ----------
  const variant = config.variant;
  const isLegacy = variant === 'legacy';
  const page = (c, kind, extra = {}) => {
    const p = { kind, path: c.req.path, url: ctx.absoluteUrl(c, c.req.path), variant, member: c.get('member'), title: '', description: '', data: {}, ...extra };
    c.set('page', p);
    return p;
  };
  const render = (c, p, body, status = 200) => c.html(layout(hooks, p, body), status);
  const views = { store, config };
  const form = async (c) => Object.fromEntries(
    Object.entries(await c.req.parseBody({ all: true })).map(([k, v]) => [k, Array.isArray(v) ? v.at(-1) : v])
  );

  // ---------- pages ----------
  app.get('/', (c) => {
    const p = page(c, 'home', { title: '', description: 'Book cabins in Norway directly: Lofoten, Senja, Lyngen, Rondane, Hardanger and Femunden.' });
    return render(c, p, isLegacy ? L.legacyHomePage(hooks, p, views) : P.homePage(hooks, p, views));
  });

  app.get('/cabins', (c) => {
    const q = c.req.query();
    const query = { ...q, features: c.req.queries('features') ?? [] };
    const results = store.searchCabins(query);
    const p = page(c, 'cabin-list', { title: 'Cabins', legacyTitle: 'Nordlys', description: 'All Nordlys cabins with prices, sizes and features. Filter by region, guests, dates and features.', data: { query, results } });
    return render(c, p, isLegacy ? L.legacyCabinListPage(hooks, p, views) : P.cabinListPage(hooks, p, { ...views, query, results }));
  });

  app.get('/cabins/:slug', (c) => {
    const cabin = store.getCabin(c.req.param('slug'));
    if (!cabin) return notFound(c);
    const query = c.req.query();
    const check = query.checkIn || query.checkOut ? store.checkAvailability({ cabin: cabin.slug, ...query }) : null;
    const p = page(c, 'cabin', { title: cabin.name, legacyTitle: 'Nordlys', description: cabin.summary, data: { cabin, query, check } });
    return render(c, p, isLegacy ? L.legacyCabinDetailPage(hooks, p, { ...views, cabin }) : P.cabinDetailPage(hooks, p, { ...views, cabin, query, check }));
  });

  app.get('/book/:slug', (c) => {
    const cabin = store.getCabin(c.req.param('slug'));
    if (!cabin) return notFound(c);
    if (isLegacy) return c.redirect(`/cabins/${cabin.slug}`, 302); // legacy books in a modal on the cabin page
    const values = { guests: 2, ...c.req.query() };
    const check = values.checkIn && values.checkOut ? store.checkAvailability({ cabin: cabin.slug, ...values }) : null;
    const member = c.get('member');
    if (member) values.name ??= member.name, (values.email ??= member.email);
    const p = page(c, 'booking-form', { title: `Book ${cabin.name}`, description: `Book ${cabin.name}.`, data: { cabin, values, check } });
    return render(c, p, P.bookingFormPage(hooks, p, { ...views, cabin, values, check, errors: check?.errors ?? [] }));
  });

  app.post('/book/:slug', async (c) => {
    const cabin = store.getCabin(c.req.param('slug'));
    if (!cabin) return notFound(c);
    const values = await form(c);
    const result = store.createBooking({ ...values, cabin: cabin.slug }, { member: c.get('member') });
    if (!result.ok) {
      const check = store.checkAvailability({ cabin: cabin.slug, ...values });
      const p = page(c, 'booking-form', { title: `Book ${cabin.name}`, data: { cabin, values, check, errors: result.errors } });
      return render(c, p, P.bookingFormPage(hooks, p, { ...views, cabin, values, check, errors: result.errors }), 422);
    }
    ctx.events.emit('booking.created', result.booking, { via: 'form', c });
    return c.redirect(`/bookings/${result.booking.ref}?token=${tokenFor(result.booking.ref)}&new=1`, 303);
  });

  const canSee = (c, booking, token) => tokenOk(booking.ref, token) || (c.get('member') && c.get('member').id === booking.memberId);

  app.get('/bookings', (c) => {
    const p = page(c, 'booking-lookup', { title: 'Find your booking' });
    return render(c, p, P.lookupPage(hooks, p, {}));
  });
  app.post('/bookings', async (c) => {
    const values = await form(c);
    const booking = store.findBooking(values.ref, values.email);
    if (!booking) {
      const errors = [{ field: 'ref', code: 'not_found', message: 'We could not find a booking with that reference and email address.' }];
      const p = page(c, 'booking-lookup', { title: 'Find your booking', data: { errors } });
      return render(c, p, P.lookupPage(hooks, p, { values, errors }), 404);
    }
    return c.redirect(`/bookings/${booking.ref}?token=${tokenFor(booking.ref)}`, 303);
  });

  app.get('/bookings/:ref', (c) => {
    const booking = store.getBooking(c.req.param('ref'));
    const token = c.req.query('token');
    if (!booking || !canSee(c, booking, token)) return notFound(c);
    const t = tokenFor(booking.ref);
    const p = page(c, 'booking', { title: `Booking ${booking.ref}`, legacyTitle: 'Nordlys', data: { booking } });
    if (isLegacy) return render(c, p, L.legacyBookingPage(hooks, p, { ...views, booking, token: t }));
    return render(c, p, P.bookingPage(hooks, p, { ...views, booking, token: t, justBooked: c.req.query('new') === '1', justCancelled: c.req.query('cancelled') === '1' }));
  });

  app.get('/bookings/:ref/cancel', (c) => {
    const booking = store.getBooking(c.req.param('ref'));
    const token = c.req.query('token');
    if (!booking || !canSee(c, booking, token)) return notFound(c);
    if (booking.status === 'cancelled') return c.redirect(`/bookings/${booking.ref}?token=${tokenFor(booking.ref)}`, 303);
    const p = page(c, 'booking-cancel', { title: `Cancel booking ${booking.ref}`, data: { booking } });
    return render(c, p, P.cancelConfirmPage(hooks, p, { ...views, booking, token: tokenFor(booking.ref) }));
  });

  app.post('/bookings/:ref/cancel', async (c) => {
    const values = await form(c);
    const booking = store.getBooking(c.req.param('ref'));
    if (!booking || !canSee(c, booking, values.token)) return notFound(c);
    const result = store.cancelBooking(booking.ref);
    if (!result.ok) {
      const p = page(c, 'booking', { title: `Booking ${booking.ref}`, data: { booking } });
      return render(c, p, P.bookingPage(hooks, p, { ...views, booking, token: tokenFor(booking.ref), errors: result.errors }), 409);
    }
    ctx.events.emit('booking.cancelled', result.booking, { via: 'form', c });
    return c.redirect(`/bookings/${booking.ref}?token=${tokenFor(booking.ref)}&cancelled=1`, 303);
  });

  // ---------- members ----------
  app.get('/login', (c) => {
    const p = page(c, 'login', { title: 'Sign in' });
    return render(c, p, P.loginPage(hooks, p, { next: safeNext(c.req.query('next')) }));
  });
  app.post('/login', async (c) => {
    const values = await form(c);
    const member = store.verifyMember(values.email, values.password);
    if (!member) {
      const errors = [{ field: 'email', code: 'invalid_login', message: 'The email address or password is wrong.' }];
      const p = page(c, 'login', { title: 'Sign in', data: { errors } });
      return render(c, p, P.loginPage(hooks, p, { values, errors, next: safeNext(values.next) }), 401);
    }
    const sid = randomBytes(24).toString('base64url');
    sessions.set(sid, member.id);
    setCookie(c, 'nordlys_session', sid, { httpOnly: true, sameSite: 'Lax', path: '/', secure: new URL(c.req.url).protocol === 'https:' });
    ctx.events.emit('member.login', member, { c });
    return c.redirect(safeNext(values.next) || '/account/bookings', 303);
  });
  app.post('/logout', (c) => {
    const sid = getCookie(c, 'nordlys_session');
    if (sid) sessions.delete(sid);
    deleteCookie(c, 'nordlys_session', { path: '/' });
    ctx.events.emit('member.logout', c.get('member'), { c });
    return c.redirect('/', 303);
  });
  app.get('/account/bookings', (c) => {
    const member = c.get('member');
    if (!member) return c.redirect('/login?next=/account/bookings', 302);
    const bookings = store.bookingsForMember(member.id);
    const p = page(c, 'my-bookings', { title: 'My bookings', data: { bookings } });
    return render(c, p, P.myBookingsPage(hooks, p, { store, member, bookings, tokenFor }));
  });

  // ---------- content ----------
  app.get('/guide', (c) => {
    const p = page(c, 'guide', { title: 'Guide', description: 'Practical notes for a cabin trip in Norway.' });
    return render(c, p, P.guideIndexPage(hooks, p, views));
  });
  app.get('/guide/:slug', (c) => {
    const article = store.getArticle(c.req.param('slug'));
    if (!article) return notFound(c);
    const p = page(c, 'article', { title: article.title, description: article.description, data: { article } });
    return render(c, p, P.articlePage(hooks, p, { article }));
  });
  app.get('/faq', (c) => {
    const p = page(c, 'faq', { title: 'FAQ', description: 'Answers about check-in, cancellation, pets, minimum stays and the northern lights.' });
    return render(c, p, P.faqPage(hooks, p, views));
  });
  app.get('/contact', (c) => {
    const p = page(c, 'contact', { title: 'Contact', description: 'Write to Nordlys Cabins.' });
    return render(c, p, P.contactPage(hooks, p, {}));
  });
  app.post('/contact', async (c) => {
    const values = await form(c);
    const errors = [];
    if (!String(values.name ?? '').trim()) errors.push({ field: 'name', code: 'required', message: 'Enter your name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email ?? '').trim())) errors.push({ field: 'email', code: 'invalid_email', message: 'Enter an email address like name@example.com.' });
    if (!String(values.message ?? '').trim()) errors.push({ field: 'message', code: 'required', message: 'Enter a message.' });
    const p = page(c, 'contact', { title: 'Contact', data: { errors } });
    if (errors.length) return render(c, p, P.contactPage(hooks, p, { values, errors }), 422);
    const msg = { name: values.name.trim(), email: values.email.trim(), topic: values.topic, message: String(values.message).slice(0, 4000) };
    store.addContactMessage(msg);
    ctx.events.emit('contact.received', msg, { c });
    return render(c, p, P.contactPage(hooks, p, { sent: true }));
  });

  // ---------- internal JSON used by the legacy front end (undocumented on purpose) ----------
  app.get('/_app/cabins', (c) => c.json({ cabins: store.cabins(), features: store.features() }));
  app.get('/_app/cabins/:slug', (c) => {
    const cabin = store.getCabin(c.req.param('slug'));
    return cabin ? c.json(cabin) : c.json({ error: 'not_found' }, 404);
  });
  app.get('/_app/quote', (c) => {
    const r = store.checkAvailability(c.req.query());
    return c.json({ available: r.available, errors: r.errors, quote: r.quote ?? null }, r.errors.length ? 400 : 200);
  });
  app.post('/_app/bookings', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = store.createBooking(body, { member: c.get('member') });
    if (!result.ok) return c.json(result, 422);
    ctx.events.emit('booking.created', result.booking, { via: 'legacy-app', c });
    return c.json({ ...result, manageUrl: `/bookings/${result.booking.ref}?token=${tokenFor(result.booking.ref)}` }, 201);
  });
  app.get('/_app/bookings/:ref', (c) => {
    const b = store.getBooking(c.req.param('ref'));
    if (!b || !canSee(c, b, c.req.query('token'))) return c.json({ error: 'not_found' }, 404);
    return c.json({ ...b, cabinName: store.getCabin(b.cabin).name });
  });
  app.post('/_app/bookings/:ref/cancel', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const b = store.getBooking(c.req.param('ref'));
    if (!b || !canSee(c, b, body.token)) return c.json({ error: 'not_found' }, 404);
    const result = store.cancelBooking(b.ref);
    if (!result.ok) return c.json(result, 409);
    ctx.events.emit('booking.cancelled', result.booking, { via: 'legacy-app', c });
    return c.json({ ok: true, booking: { ...result.booking, cabinName: store.getCabin(b.cabin).name } });
  });

  // ---------- developer endpoints ----------
  if (config.audit) {
    app.get('/__layers', (c) => c.json(hooks.describe()));
    app.get('/__audit', async (c) => {
      const report = await ctx.runAudits();
      return c.json(report, report.ok ? 200 : 500);
    });
  }

  // ---------- layers ----------
  for (const layer of enabled) {
    hooks.setLayer(layer);
    await layer.register(app, ctx);
  }
  hooks.setLayer(null);

  function notFound(c) {
    const p = page(c, 'not-found', { title: 'Page not found' });
    return render(c, p, P.notFoundPage(), 404);
  }
  app.notFound((c) => notFound(c));
  app.onError((err, c) => {
    console.error(err);
    return c.text('Something went wrong on our side.', 500);
  });

  return { app, ctx, layers: enabled, config, store, tokenFor };
}

/** Run a list of Hono middleware as one chain, then continue with `next`. */
async function runChain(list, c, next) {
  const dispatch = async (i) => {
    if (i === list.length) return next();
    const res = await list[i](c, () => dispatch(i + 1));
    if (res instanceof Response) c.res = res;
  };
  await dispatch(0);
}

/** Only allow local redirects after login. */
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '';
}
