# The layer contract

Nordlys Cabins starts as a plain booking site. Each chapter of the book makes it
more agent-ready by adding one **layer**: a folder that registers routes, headers,
files, head tags, scripts and middleware through a small set of hooks. Chapter
code never edits the shared files (`src/`, `public/`, `data/`, `server.js`).

## A layer is a folder

```
nordlys-cabins/layers/NN-slug/
  index.js        required: exports the layer object (default export)
  public/         optional: static files, served at /layers/NN-slug/...
  *.js            optional: anything else the layer imports
nordlys-cabins/tests/chNN-*.test.js   node:test tests for the layer (no browser)
nordlys-cabins/tests/chNN-*.spec.js   Playwright tests for the layer (browser)
```

`NN` is the two-digit chapter number. `slug` is lowercase letters, digits and dashes.
A chapter can have more than one layer (Chapter 8 has `08-public-api`,
`08-mcp-server` and `08-discovery`); they share the `NN` and differ in `order`.

```js
// layers/04-crawler-controls/index.js
export default {
  chapter: 4,                         // must match the folder's NN
  order: 1,                           // position inside the chapter (default 1)
  name: 'Crawler controls',           // short human name
  description: 'robots.txt with AI crawler rules and content signals',
  enabled: true,                      // optional: boolean or (config) => boolean, default true
  register(app, ctx) {                // may be async
    ctx.staticFile('/robots.txt', 'User-agent: *\nAllow: /\n');
  },
};
```

## Which layers run

The server finds every `layers/NN-slug/index.js`, sorts them by `chapter`, then by
`order`, then by folder name, and enables every layer of chapters 0 to `UPTO`
whose `enabled` flag is true.

`order` is a positive integer: the layer's position inside its chapter. It is
explicit because alphabetical folder order is not the order a chapter builds
things in (`08-public-api` comes before `08-mcp-server`, which comes before
`08-discovery`). It defaults to 1, and two layers of the same chapter with the
same `order` stop the server with an error. The layers today:

| Chapter | Order | Folder |
| --- | --- | --- |
| 0 | 1 | `00-example` |
| 2 | 1 | `02-first-steps` |
| 3 | 1 | `03-perception` |
| 4 | 1 | `04-crawler-controls` |
| 4 | 2 | `04-bot-identity` |
| 5 | 1 | `05-structured-data` |
| 5 | 2 | `05-agent-content` |
| 7 | 1 | `07-tool-design` |
| 8 | 1 | `08-public-api` |
| 8 | 2 | `08-mcp-server` |
| 8 | 3 | `08-discovery` |
| 9 | 1 | `09-webmcp` |
| 10 | 1 | `10-security` |
| 11 | 1 | `11-commerce` |
| 11 | 2 | `11-oauth` |
| 11 | 3 | `11-consent` |
| 12 | 1 | `12-agent-analytics` |

A layer may build on a layer of a *later* chapter, as long as it does nothing
visible until that layer is on. Chapter 7's `07-tool-design` is the example: it
adds `find_booking` to the MCP registry (`layers/08-mcp-server/registry.js`),
which the Chapter 8 server reads on every request, and its lint audit runs only
when `08-mcp-server` is enabled. So `--upto=7` serves the same pages and files as
`--upto=5` (only `/__audit` shows the lint waiting for an MCP server), and the
tool and the lint appear from `--upto=8`. `tests/core-layers.test.js` starts the
site with every `--upto` from 0 to 12 and checks that all audits pass.

| Command | Front end | Layers |
| --- | --- | --- |
| `npm start` | clean | all |
| `npm start -- --upto=8` or `UPTO=8 npm start` | clean | every layer of chapters 0 to 8 |
| `npm start -- --variant=legacy --upto=0` (`npm run start:baseline`) | legacy | none (the Chapter 2 baseline) |
| `npm run start:legacy` | legacy | all |

Other flags and variables: `--port` / `PORT` (default 3000), `--host` / `HOST`
(default 127.0.0.1), `--now` / `NOW` (freeze today's date, `YYYY-MM-DD`),
`PUBLIC_ORIGIN` (the origin `ctx.absoluteUrl()` uses, for example
`https://nordlys.example`), `LEGACY_DELAY_MS`, `LAYERS_DIR`, `SESSION_SECRET`,
`AUDIT=1`. `GET /__layers` lists what is enabled and which layer registered what.

A layer that only makes sense for one front end checks `ctx.config.variant`
(`'clean'` or `'legacy'`) inside `register()`.

## Order and precedence

Layers register in chapter order (and `order` inside a chapter), after the core routes. The core reads every hook
registry **at request time**, so a layer can rely on the hooks of earlier
chapters, and where two layers set the same thing, the later chapter wins:

- `ctx.headers()`: rules apply in registration order, later values overwrite earlier ones.
- `ctx.staticFile()`: a second layer must pass `{ replace: true }`; it can read the
  earlier body with `ctx.getStaticFile(path)` and extend it.
- `ctx.mcp()`: one MCP endpoint per run; a second call throws.

Every request goes through this pipeline:

```
request
 └─ 1. response headers   base security headers + ctx.headers() rules (applied on the way out)
    └─ 2. ctx.beforeAuth()  middleware, in layer order
       └─ 3. ctx.staticFile() root files (GET and HEAD)
          └─ 4. session and auth (sets c.get('member'))
             └─ 5. ctx.middleware() middleware, in layer order
                └─ 6. routes: core pages, /_app/* JSON, /css /js /images, layer routes, /mcp
```

The base headers are a strict Content-Security-Policy (`script-src 'self'`, no
inline scripts or inline styles), `x-content-type-options: nosniff` and
`referrer-policy: strict-origin-when-cross-origin`. A layer can change them with
`ctx.headers('*', { 'content-security-policy': '...' })`.

## The hooks (`ctx`)

| Hook | Signature | Use it for |
| --- | --- | --- |
| `ctx.head` | `head(entries, { match?, kinds? })` | meta tags, link tags, JSON-LD in `<head>` |
| `ctx.pageScript` | `pageScript(src, { type = 'module', defer?, async?, match?, kinds? })` | external page scripts (WebMCP tools) |
| `ctx.headers` | `headers(match, values)` | response headers per route (Link, Content-Signal, Cache-Control, Vary) |
| `ctx.staticFile` | `staticFile(path, body, { contentType?, replace? })` | `/robots.txt`, `/llms.txt`, `/sitemap.xml`, `/.well-known/*` |
| `ctx.getStaticFile` | `await getStaticFile(path, c?)` → string or null | extending another layer's file |
| `ctx.route` | `route(method, path, ...handlers)` | API routes (`/api/*`); same as `app.on()`, but listed in `/__layers` |
| `ctx.mcp` | `mcp(handler, { path = '/mcp' })` | an MCP Streamable HTTP endpoint; `handler(c)` gets every method |
| `ctx.beforeAuth` | `beforeAuth(async (c, next) => ...)` | bot verification, Web Bot Auth signatures, rate limits |
| `ctx.middleware` | `middleware(async (c, next) => ...)` | anything that needs `c.get('member')` or `c.get('page')`, response transforms such as Markdown negotiation |
| `ctx.slot` | `slot(name, (page) => html\`...\`, { match?, kinds? })` | visible HTML in the layout |
| `ctx.formAttributes` | `formAttributes(formId, values)` | attributes on a core `<form>` (declarative WebMCP) |
| `ctx.fieldAttributes` | `fieldAttributes(formId, field, values)` | attributes on one field of a core form |
| `ctx.audit` | `audit(name, async ({ request, ctx }) => [{ id, ok, message? }])` | checks that tests and `GET /__audit` run |
| `ctx.runAudits` | `await runAudits()` → `{ ok, results }` | running every audit in-process |
| `ctx.absoluteUrl` | `absoluteUrl(c, path)` | absolute URLs (`PUBLIC_ORIGIN`, else the request origin) |
| `ctx.events` | Node `EventEmitter` | `booking.created`, `booking.cancelled`, `member.login`, `member.logout`, `contact.received` |
| `ctx.store` | object | business logic, see below |
| `ctx.html` | `{ html, raw, escapeHtml, attrs, jsonForScript, toString }` | the same templates the core uses |
| `ctx.config` | object | `variant`, `upto`, `port`, `now`, `publicOrigin`, `env`, ... |
| `ctx.layers` | array | the enabled layers: `{ id, chapter, name, description }` |

`app` is the [Hono](https://hono.dev) app itself. Prefer the hooks; use `app`
directly only for something no hook covers.

### Matching

- `match` for `headers()` is a path pattern: `'*'` (everything), `'/faq'` (exact),
  `'/cabins/*'` (prefix), a `RegExp`, an array of these, or `(c) => boolean`.
- `match` for page hooks (`head`, `pageScript`, `slot`) is the same, tested against
  the page path, or `(page) => boolean`. `kinds` limits a hook to page kinds.

### Head entries

```js
ctx.head({ meta: { name: 'description', content: '...' } });
ctx.head({ link: { rel: 'alternate', type: 'text/markdown', href: '/cabins/fjellro.md' } });
ctx.head((page) => ({ jsonLd: { '@context': 'https://schema.org', '@type': 'LodgingBusiness', name: page.data.cabin.name } }), { kinds: 'cabin' });
ctx.head([{ meta: {...} }, { link: {...} }]);   // several at once; a function may return null to skip a page
```

JSON-LD is serialised with `<` escaped, so data can never close the script element.
Scripts must have a `src` (the CSP blocks inline code); put the file in the layer's
`public/` folder and reference it as `/layers/NN-slug/file.js`.

### The page object

Page hooks receive the page the core is rendering. Middleware can read the same
object with `c.get('page')` after `await next()`.

```js
{
  kind: 'cabin',                 // see the table below
  path: '/cabins/fjellro',
  url: 'http://127.0.0.1:3000/cabins/fjellro',
  title: 'Fjellro',
  description: 'A timber mountain cabin ...',
  variant: 'clean',
  member: null,                  // or { id, name, email }
  data: { cabin, query, check }  // per kind
}
```

| Kind | Path | `data` |
| --- | --- | --- |
| `home` | `/` | |
| `cabin-list` | `/cabins` | `query`, `results` |
| `cabin` | `/cabins/:slug` | `cabin`, `query`, `check` |
| `booking-form` | `/book/:slug` (clean only) | `cabin`, `values`, `check`, `errors?` |
| `booking` | `/bookings/:ref` | `booking` |
| `booking-cancel` | `/bookings/:ref/cancel` | `booking` |
| `booking-lookup` | `/bookings` | `errors?` |
| `login` | `/login` | `errors?` |
| `my-bookings` | `/account/bookings` | `bookings` |
| `guide` | `/guide` | |
| `article` | `/guide/:slug` | `article` (with `blocks`: `p`, `h2`, `ul`) |
| `faq` | `/faq` | |
| `contact` | `/contact` | `errors?` |
| `not-found` | any unknown path | |

### Slots

`head-end`, `header-end`, `main-start`, `main-end`, `footer`, `body-end`, and three
page slots: `cabin-detail-end` (cabin page, both variants), `booking-form-end`
(inside the clean booking form, before it closes) and `booking-confirmed` (on the
confirmation page). A slot renderer returns `html\`...\`` (escaped) or `null`.

### Forms and fields

Forms exist in the clean front end only (the legacy one has none, which is the point).

| Form id | Page | Method and action | Fields |
| --- | --- | --- | --- |
| `search` | `/cabins` | GET `/cabins` | `region`, `guests`, `checkIn`, `checkOut`, `maxPrice`, `features` (checkboxes) |
| `availability` | `/cabins/:slug` | GET `/cabins/:slug` | `checkIn`, `checkOut`, `guests` |
| `booking` | `/book/:slug` | POST `/book/:slug` | `checkIn`, `checkOut`, `guests`, `name`, `email`, `phone`, `requests`, `acceptTerms` |
| `cancel` | `/bookings/:ref`, `/bookings/:ref/cancel` | POST `/bookings/:ref/cancel` | `token` (hidden) |
| `lookup` | `/bookings` | POST `/bookings` | `ref`, `email` |
| `login` | `/login` | POST `/login` | `email`, `password`, `next` (hidden) |
| `logout` | header, when signed in | POST `/logout` | |
| `contact` | `/contact` | POST `/contact` | `name`, `email`, `topic`, `message` |

Every control has the id `<formId>-<field>` and a `<label>`. Example, declarative WebMCP:

```js
ctx.formAttributes('booking', { toolname: 'book_cabin', tooldescription: 'Book a Nordlys cabin for given dates' });
ctx.fieldAttributes('booking', 'checkIn', { toolparamdescription: 'Arrival date, YYYY-MM-DD' });
```

Values may be functions of the page: `ctx.formAttributes('availability', (page) => ({ ... }))`.
`false` or `null` leaves an attribute out, `true` writes a bare attribute.

### The store

`ctx.store` is the same business logic the pages use, so an API, an MCP server or a
WebMCP tool behaves exactly like the booking form:

```
today()                                   'YYYY-MM-DD' (frozen by NOW)
cabins(), getCabin(slug), features(), regions(), reviewsFor(slug)
searchCabins({ region, guests, checkIn, checkOut, features, maxPrice })
checkAvailability({ cabin, checkIn, checkOut, guests })
   -> { available, errors: [{ field, code, message }], cabin, quote, conflicts }
quotePrice(cabin, checkIn, checkOut)      -> { currency, nights, nightly, accommodation, cleaningFee, total }
unavailableRanges(slug)                   -> [{ from, to, reason }]   (to is exclusive)
createBooking(input, { member })          -> { ok: true, booking } | { ok: false, errors }
getBooking(ref), findBooking(ref, email), cancelBooking(ref), cancellationPolicy(booking)
verifyMember(email, password), getMember(id), bookingsForMember(memberId)
articles(), getArticle(slug), faq(), addContactMessage(msg), contactMessages()
```

Error `code`s are stable: `unknown_cabin`, `invalid_date`, `date_in_past`,
`checkout_before_checkin`, `invalid_guests`, `too_many_guests`, `min_nights`,
`max_nights`, `required`, `invalid_email`, `not_available`, `not_found`,
`already_cancelled`, `stay_started`.

Data lives in memory and resets on every start. Prices are integers in NOK.
Friday and Saturday nights use the cabin's weekend rate, and the cleaning fee is
added once per stay. Free cancellation ends 14 days before check-in.

### Domain events

```js
ctx.events.on('booking.created', (booking, { via, c }) => { /* via: 'form' | 'legacy-app' | your layer's name */ });
```

A layer that creates or cancels bookings through its own interface (an API, MCP)
should emit the same events with its own `via`, so analytics (Chapter 12) see every channel.

## Testing a layer

`tests/helpers/server.js` builds the app with a fixed date (`TODAY = '2026-11-10'`):

```js
// tests/ch04-crawler-controls.test.js  (node:test, no browser)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers/server.js';

test('robots.txt is served', async () => {
  const { app } = await buildApp({ upto: 4 });
  const res = await app.request('/robots.txt');
  assert.equal(res.status, 200);
});
```

```js
// tests/ch09-webmcp.spec.js  (Playwright)
import { test, expect } from '@playwright/test';
import { startServer } from './helpers/server.js';

let server;
test.beforeAll(async () => { server = await startServer({ upto: 9 }); });
test.afterAll(async () => server?.close());

test('the booking page loads the WebMCP script', async ({ page }) => {
  await page.goto(`${server.url}/book/fjellro`);
  await expect(page.locator('script[src^="/layers/09-"]')).toHaveCount(1);
});
```

`buildApp()` and `startServer()` take the same overrides as the CLI: `upto`,
`variant`, `now`, `env`, `layersDir`, `publicOrigin`. Other helpers: `cookieJar()`
(keeps the session cookie between `app.request()` calls) and `formBody(object)`
(a urlencoded POST). Register checks with `ctx.audit()` when they describe the
layer's promise ("robots.txt names GPTBot"); a test can then assert
`(await ctx.runAudits()).ok`.

Run one chapter's tests: `node --test tests/ch04-*.test.js` and
`npx playwright test tests/ch09-`.

## The example layer

`layers/00-example/` uses every hook once. It is off unless `NORDLYS_EXAMPLE=1`,
so it never changes what the chapters measure. Copy it to start a new layer.
