# Agent-Ready Websites in Action: demos

Runnable code for the book **Agent-Ready Websites in Action** by Maxim Salnikov.
The book answers one question, "how do I make my site work for
AI agents?", and the chapters add layers to the same small site.

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
`$env:UPTO=8; npm start`. The `--upto=8` flag works the same on every system.

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

## Chapters and demos

The code follows the book's 12 chapters. Layer folders and standalone demo
folders start with the number of the chapter that builds them.

| Chapter | Layer folders (`nordlys-cabins/layers/`) | Standalone demos (`chapters/`) |
| --- | --- | --- |
| 1 The agent-ready web | none | none |
| 2 Your first agent-ready page | `02-first-steps` | `02-your-first-agent-ready-page` |
| 3 How agents see a page | `03-perception` | `03-how-agents-see-a-page` |
| 4 Who gets in: policy and proof | `04-crawler-controls`, `04-bot-identity` | `04-who-gets-in` |
| 5 Content agents can read | `05-structured-data`, `05-agent-content` | none |
| 6 Choosing the right agent interface | none | `06-choosing-the-right-agent-interface` |
| 7 Designing tools agents can actually use | `07-tool-design` | `07-designing-tools-agents-can-use` |
| 8 Server-side tools and discovery | `08-public-api`, `08-mcp-server`, `08-discovery` | none |
| 9 In-page tools with WebMCP | `09-webmcp` | none |
| 10 Security for agent-facing sites | `10-security` | `10-security-for-agent-facing-sites` |
| 11 Agents acting for users | `11-commerce`, `11-oauth`, `11-consent` | `11-agents-acting-for-users` |
| 12 Testing and measuring in production | `12-agent-analytics` | `12-testing-and-measuring-in-production` (`testing/`, `measuring/`) |
| Appendix B | none | `appendix-b-reference` |

## Layers

Each chapter adds one or more folders under `nordlys-cabins/layers/`.
`--upto=N` (or `UPTO=N`) turns on every layer of chapters 0 to N, so you can run
the site as it stands at the end of any chapter. Inside a chapter, layers run in
the order their `order` field gives (see
[nordlys-cabins/LAYERS.md](nordlys-cabins/LAYERS.md), which also has the hook
names, page kinds, form ids and test helpers).

| `--upto` | Layers on |
| --- | --- |
| 0 | none (the example layer only with `NORDLYS_EXAMPLE=1`) |
| 1 | none |
| 2 | `02-first-steps` |
| 3 | + `03-perception` |
| 4 | + `04-crawler-controls`, `04-bot-identity` |
| 5 | + `05-structured-data`, `05-agent-content` |
| 6 | no new layer (Chapter 6 has a standalone demo) |
| 7 | + `07-tool-design`: no visible change yet. It adds `find_booking` and a tool lint to the MCP registry, which the Chapter 8 server reads |
| 8 | + `08-public-api`, `08-mcp-server`, `08-discovery` (with `find_booking` and the lint from Chapter 7) |
| 9 | + `09-webmcp` |
| 10 | + `10-security` |
| 11 | + `11-commerce`, `11-oauth`, `11-consent` |
| 12 or no `--upto` | + `12-agent-analytics` (every layer) |

| Chapter | Layer | What it adds | Tests (`nordlys-cabins/tests/`) |
| --- | --- | --- | --- |
| 0 | [`00-example`](nordlys-cabins/layers/00-example/) | Demonstrates every layer hook. Enabled only with NORDLYS_EXAMPLE=1 | `core-layers.test.js` |
| 2 | [`02-first-steps`](nordlys-cabins/layers/02-first-steps/) | robots.txt, sitemap.xml and a declarative WebMCP tool on the availability form | `ch02-first-steps.spec.js`, `ch02-first-steps.test.js` |
| 3 | [`03-perception`](nordlys-cabins/layers/03-perception/) | a perception contract for every public page: landmarks, headings, labels and names in the server HTML | `ch03-perception.spec.js`, `ch03-perception.test.js` |
| 4 | [`04-crawler-controls`](nordlys-cabins/layers/04-crawler-controls/) | robots.txt with AI crawler groups and content signals, a sitemap with lastmod, noindex on private pages | `ch04-crawler-controls.test.js` |
| 4 | [`04-bot-identity`](nordlys-cabins/layers/04-bot-identity/) | Web Bot Auth verification (RFC 9421 Ed25519), DNS confirmation, request labels, per-class rate limits with RateLimit headers | `ch04-bot-identity.test.js` |
| 5 | [`05-structured-data`](nordlys-cabins/layers/05-structured-data/) | schema.org JSON-LD from the same data as the pages, and an NLWeb-shaped /ask endpoint | `ch05-structured-data.test.js` |
| 5 | [`05-agent-content`](nordlys-cabins/layers/05-agent-content/) | Markdown by content negotiation and .md URLs, llms.txt, an Atom feed and Link headers | `ch05-agent-content.test.js` |
| 7 | [`07-tool-design`](nordlys-cabins/layers/07-tool-design/) | find_booking for the MCP server, and a lint audit of every tool /mcp lists | `ch07-tool-design.test.js` |
| 8 | [`08-public-api`](nordlys-cabins/layers/08-public-api/) | REST API with OpenAPI 3.1, problem details, idempotent booking, RateLimit headers and an RFC 9727 API catalog | `ch08-public-api.test.js` |
| 8 | [`08-mcp-server`](nordlys-cabins/layers/08-mcp-server/) | Remote MCP server at /mcp: four tools, guide resources and a prompt over the same booking service as the API | `ch08-mcp-server.test.js` |
| 8 | [`08-discovery`](nordlys-cabins/layers/08-discovery/) | MCP Server Card, Agent Skills index, ARD manifest and api-catalog entry for the MCP server | `ch08-discovery.test.js` |
| 9 | [`09-webmcp`](nordlys-cabins/layers/09-webmcp/) | Declarative tools on the forms, imperative tools in the page, JSON endpoints for them | `ch09-webmcp-off.spec.js`, `ch09-webmcp.spec.js`, `ch09-webmcp.test.js` |
| 10 | [`10-security`](nordlys-cabins/layers/10-security/) | Clean guest text once, owner-only booking reads, a policy for every MCP tool, an agent action log and pinned tool definitions | `ch10-security.test.js` |
| 11 | [`11-commerce`](nordlys-cabins/layers/11-commerce/) | UCP-style profile, lodging booking sessions, human checkout handoff (draft implementation) | `ch11-commerce.test.js` |
| 11 | [`11-oauth`](nordlys-cabins/layers/11-oauth/) | OAuth 2.1 for agents: AS metadata, consent, PKCE, RFC 9728 metadata for /mcp, scoped member tools, connected agents page | `ch11-oauth.test.js`, `ch11-agent-cli.test.js` |
| 11 | [`11-consent`](nordlys-cabins/layers/11-consent/) | Records and emails for agent bookings, an agent-activity page with export, log retention, and a request_booking tool where the guest confirms on the site | `ch11-consent.test.js` |
| 12 | [`12-agent-analytics`](nordlys-cabins/layers/12-agent-analytics/) | Request log with agent classes and evidence, agent-originated bookings, /__agents dashboard | `ch12-agent-analytics.test.js` |

`core-layers.test.js` also starts the site with every `--upto` from 0 to 12 and
checks that each one serves pages and passes all of its layers' audits.

## Standalone demos

Chapters that need a demo outside the booking site keep it in
[`chapters/`](chapters/).

| Folder | What it is |
| --- | --- |
| [`02-your-first-agent-ready-page`](chapters/02-your-first-agent-ready-page/) | Chapter 2: a local agent-readiness check and a structure-only booking walk |
| [`03-how-agents-see-a-page`](chapters/03-how-agents-see-a-page/) | Chapter 3: the three views of a page and the agent accessibility rules |
| [`04-who-gets-in`](chapters/04-who-gets-in/) | Chapter 4: a test agent that signs requests with Web Bot Auth (Ed25519, RFC 9421) and serves its own key directory |
| [`06-choosing-the-right-agent-interface`](chapters/06-choosing-the-right-agent-interface/) | Chapter 6: a decision helper that prints a staged adoption plan per site type |
| [`07-designing-tools-agents-can-use`](chapters/07-designing-tools-agents-can-use/) | Chapter 7: an eval harness that runs a task suite against two Nordlys tool sets with real models |
| [`10-security-for-agent-facing-sites`](chapters/10-security-for-agent-facing-sites/) | Chapter 10: scan a page for hidden text and instructions aimed at AI agents |
| [`11-agents-acting-for-users`](chapters/11-agents-acting-for-users/) | Chapter 11: a command-line agent that connects to a Nordlys member account with OAuth 2.1 and PKCE |
| [`12-testing-and-measuring-in-production/testing`](chapters/12-testing-and-measuring-in-production/testing/) | Chapter 12: an agent-readiness CI pipeline for Nordlys Cabins |
| [`12-testing-and-measuring-in-production/measuring`](chapters/12-testing-and-measuring-in-production/measuring/) | Chapter 12: classify access-log requests by agent, purpose and evidence, and report crawl-to-refer ratios. No dependencies. |
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
  layers/              one or more folders per chapter (NN-slug)
  tests/               chNN-*.test.js and core-*.test.js (node:test), *.spec.js (Playwright), helpers/
chapters/              standalone demos, one folder per chapter that needs one
```

## Versions

Node.js 24 or later (CI runs 24 and 26; developed on 26.13.0), [Hono](https://hono.dev) 4.13.16,
[@hono/node-server](https://github.com/honojs/node-server) 2.1.6,
[@playwright/test](https://playwright.dev) 1.64.1 (Chromium 156),
the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.4.0) with
[zod](https://zod.dev) 4.6.7, and `jsonld` 9.0.0 for the structured-data tests. Checked on 5 November 2026:
193 unit tests and 32 browser tests pass on Node 24.22.1. Dependencies
are pinned to exact versions in `package.json` and `package-lock.json`.

## Licence

MIT, see [LICENSE](LICENSE). Nordlys Cabins, its cabins, guests and reviews are
fictional.
