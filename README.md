# Agent-ready web demos

Runnable code for the book **Building Agent-Ready Websites** by Maxim Salnikov
(working title). The book answers one question, "how do I make my site work for
AI agents?", and every chapter adds one layer to the same small site.

The site is **Nordlys Cabins** (`nordlys.example` in the book), a fictional
company that rents six cabins in Norway. It has what a real booking site has: a
cabin list with filters, cabin pages, an availability check, a booking form with
server-side validation and prices, cancellation, member sign-in with "My
bookings", a guide with articles, an FAQ and a contact form. Data lives in JSON
files and in memory, so there is no database to set up.

## Run it

You need [Node.js](https://nodejs.org) 24 or later (26 is the current LTS line
and what CI uses for browser tests).

```sh
npm install
npm start                      # http://127.0.0.1:3000, clean front end, every layer
npm test                       # node:test, then Playwright
```

| What you want | Command |
| --- | --- |
| The agent-hostile baseline from Chapter 2 | `npm start -- --variant=legacy --upto=0` |
| The site as it stands after chapter N | `npm start -- --upto=N` (or `UPTO=N npm start`) |
| Another port | `npm start -- --port=8080` (or `PORT=8080`) |
| A frozen date, for screenshots | `npm start -- --now=2026-11-10` |
| Only the server tests | `npm run test:unit` |
| Only the browser tests | `npm run test:e2e` |

On Windows PowerShell, environment variables are set like this:
`$env:UPTO=6; npm start`. The `--upto=6` flag works the same on every system.

Browser tests use Playwright's Chromium. Install it once with
`npx playwright install chromium` if you have not used Playwright on your machine.

Demo accounts for sign-in: `ingrid@nordlys.example` and `ola@nordlys.example`,
both with the password `nordlys-demo`.

## Two front ends

The booking flow comes in two variants, so the book can show the same task
before and after:

- **`clean`** (default): semantic HTML, landmarks, native form controls with
  labels, real links and buttons, a native `<dialog>`, server-rendered content
  that works without JavaScript.
- **`legacy`**: what many real booking sites ship. Clickable `<div>`s, a custom
  date picker with a read-only, placeholder-only input, icon buttons without
  names, a "modal" that is a positioned `<div>`, and content that JavaScript
  fetches from undocumented `/_app/*` endpoints after a delay.

Both front ends call the same business logic, so a booking made in one shows
up in the other.

## Layers

Each chapter adds a folder under `nordlys-cabins/layers/` and enables it for
`--upto` values at or above its chapter number. The contract (hook names,
signatures, page kinds, form ids, test helpers) is in
[nordlys-cabins/LAYERS.md](nordlys-cabins/LAYERS.md).

| Chapter | Layer | What it adds | Tests |
| --- | --- | --- | --- |
| 0 | [`00-example`](nordlys-cabins/layers/00-example/) | Uses every hook once. Off unless `NORDLYS_EXAMPLE=1` | `node --test nordlys-cabins/tests/core-layers.test.js` |

Chapters that need a demo outside the booking site keep it in
[`chapters/`](chapters/).

## Repository layout

```
nordlys-cabins/
  server.js            npm start: reads flags, starts the server, shuts down cleanly
  src/app.js           routes, middleware pipeline, layer loading
  src/context.js       the hooks layers use (ctx)
  src/layers.js        layer discovery and the UPTO filter
  src/store.js         cabins, availability, prices, bookings, members
  src/views/           HTML templates: layout, clean pages, legacy shells
  public/              CSS, front-end scripts, images
  data/                cabins, availability, seed bookings, members, articles, FAQ, reviews
  layers/              one folder per chapter
  tests/               core-*.test.js (node:test), core-*.spec.js (Playwright), helpers/
chapters/              standalone demos per chapter
```

## Versions

Node.js 24 or later (CI runs 24 and 26; developed on 26.13.0), [Hono](https://hono.dev) 4.13.16,
[@hono/node-server](https://github.com/honojs/node-server) 2.1.6,
[@playwright/test](https://playwright.dev) 1.64.1 (Chromium 156). Dependencies
are pinned to exact versions in `package.json` and `package-lock.json`.

## Licence

MIT, see [LICENSE](LICENSE). Nordlys Cabins, its cabins, guests and reviews are
fictional.
