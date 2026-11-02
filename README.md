# Agent-ready web demos

Runnable code for the book **The Agent-Ready Web** by Maxim Salnikov
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
| 0 | [`00-example`](nordlys-cabins/layers/00-example/) | Demonstrates every layer hook. Enabled only with NORDLYS_EXAMPLE=1 | `tests/core-layers.test.js` |
| 2 | [`02-first-steps`](nordlys-cabins/layers/02-first-steps/) | robots.txt, sitemap.xml and a declarative WebMCP tool on the availability form | `ch02-first-page.spec.js`, `ch02-first-steps.test.js` |
| 3 | [`03-perception`](nordlys-cabins/layers/03-perception/) | a perception contract for every public page: landmarks, headings, labels and names in the server HTML | `ch03-perception.spec.js`, `ch03-perception.test.js` |
| 4 | [`04-crawler-controls`](nordlys-cabins/layers/04-crawler-controls/) | robots.txt with AI crawler groups and content signals, a sitemap with lastmod, noindex on private pages | `ch04-crawler-controls.test.js` |
| 5 | [`05-structured-data`](nordlys-cabins/layers/05-structured-data/) | schema.org JSON-LD from the same data as the pages, and an NLWeb-shaped /ask endpoint | `ch05-structured-data.test.js` |
| 6 | [`06-agent-content`](nordlys-cabins/layers/06-agent-content/) | Markdown by content negotiation and .md URLs, llms.txt, an Atom feed and Link headers | `ch06-agent-content.test.js` |
| 7 | [`07-public-api`](nordlys-cabins/layers/07-public-api/) | REST API with OpenAPI 3.1, problem details, idempotent booking, RateLimit headers and an RFC 9727 API catalog | `ch07-public-api.test.js` |
| 8 | [`08-mcp-server`](nordlys-cabins/layers/08-mcp-server/) | Remote MCP server at /mcp: four tools, guide resources and a prompt over the same booking service as the API | `ch08-mcp-server.test.js` |
| 9 | [`09-webmcp`](nordlys-cabins/layers/09-webmcp/) | Declarative tools on the forms, imperative tools in the page, JSON endpoints for them | `ch09-webmcp-off.spec.js`, `ch09-webmcp.spec.js`, `ch09-webmcp.test.js` |
| 10 | [`10-tool-design`](nordlys-cabins/layers/10-tool-design/) | find_booking for the MCP server, and a lint audit of every tool /mcp lists | `ch10-tool-design.test.js` |
| 11 | [`11-discovery`](nordlys-cabins/layers/11-discovery/) | MCP Server Card, Agent Skills index, ARD manifest and api-catalog entry for the MCP server | `ch11-discovery.test.js` |
| 12 | [`12-commerce`](nordlys-cabins/layers/12-commerce/) | UCP-style profile, lodging booking sessions, human checkout handoff (draft implementation) | `ch12-commerce.test.js` |
| 14 | [`14-oauth`](nordlys-cabins/layers/14-oauth/) | OAuth 2.1 for agents: AS metadata, consent, PKCE, RFC 9728 metadata for /mcp, scoped member tools, connected agents page | `ch14-agent-cli.test.js`, `ch14-oauth.test.js` |
| 15 | [`15-bot-identity`](nordlys-cabins/layers/15-bot-identity/) | Web Bot Auth verification (RFC 9421 Ed25519), DNS confirmation, request labels, per-class rate limits with RateLimit headers | `ch15-bot-identity.test.js` |
| 16 | [`16-security`](nordlys-cabins/layers/16-security/) | Clean guest text once, owner-only booking reads, a policy for every MCP tool, an agent action log and pinned tool definitions | `ch16-security.test.js` |
| 17 | [`17-consent`](nordlys-cabins/layers/17-consent/) | Records and emails for agent bookings, an agent-activity page with export, log retention, and a request_booking tool where the guest confirms on the site | `ch17-consent.test.js` |
| 19 | [`19-agent-analytics`](nordlys-cabins/layers/19-agent-analytics/) | Request log with agent classes and evidence, agent-originated bookings, /__agents dashboard | `ch19-agent-analytics.test.js` |
| 20 | [`20-versioning`](nordlys-cabins/layers/20-versioning/) | Deprecation and Sunset headers on the retired /_app/* endpoints, an agent-interface changelog | `ch20-versioning.test.js` |

Chapters that need a demo outside the booking site keep it in
[`chapters/`](chapters/).

| Folder | What it is |
| --- | --- |
| [`02-your-first-agent-ready-page`](chapters/02-your-first-agent-ready-page/) | Chapter 2 demos: a local agent-readiness check and a structure-only booking walk |
| [`03-how-agents-see-a-page`](chapters/03-how-agents-see-a-page/) | Chapter 3 of The Agent-Ready Web: the three views of a page and the agent accessibility rules |
| [`10-designing-tools-agents-can-use`](chapters/10-designing-tools-agents-can-use/) | Chapter 10: an eval harness that runs a task suite against two Nordlys tool sets with real models |
| [`13-choosing-the-right-agent-interface`](chapters/13-choosing-the-right-agent-interface/) | Chapter 13: a decision helper that prints a staged adoption plan per site type |
| [`14-connect-an-agent`](chapters/14-connect-an-agent/) | Chapter 14: a command-line agent that connects to a Nordlys member account with OAuth 2.1 and PKCE |
| [`15-signing-agent`](chapters/15-signing-agent/) | Chapter 15: a test agent that signs requests with Web Bot Auth (Ed25519, RFC 9421) and serves its own key directory |
| [`16-security-for-agent-facing-sites`](chapters/16-security-for-agent-facing-sites/) | Chapter 16 demo: scan a page for hidden text and instructions aimed at AI agents |
| [`18-testing-agent-readiness`](chapters/18-testing-agent-readiness/) | Chapter 18 demo: an agent-readiness CI pipeline for Nordlys Cabins |
| [`19-measuring-agent-traffic`](chapters/19-measuring-agent-traffic/) | Chapter 19 demo: classify access-log requests by agent, purpose and evidence, and report crawl-to-refer ratios. No dependencies. |
| [`20-evolving-with-the-standards`](chapters/20-evolving-with-the-standards/) | Chapter 20 demo: Deprecation and Sunset headers, and a standards watch script. No dependencies. |
| [`appendix-b-reference`](chapters/appendix-b-reference/) | Appendix B: check the files, robots.txt lines and headers of the reference tables against a running site |


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
[@playwright/test](https://playwright.dev) 1.64.1 (Chromium 156),
the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.4.0) with
[zod](https://zod.dev) 4.6.7, and `jsonld` 9.0.0 for the structured-data tests. Checked on 2 November 2026:
187 unit tests and 32 browser tests pass on Node 24.22.1. Dependencies
are pinned to exact versions in `package.json` and `package-lock.json`.

## Licence

MIT, see [LICENSE](LICENSE). Nordlys Cabins, its cabins, guests and reviews are
fictional.
