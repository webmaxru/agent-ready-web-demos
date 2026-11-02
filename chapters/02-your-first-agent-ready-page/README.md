# Chapter 2: Your first agent-ready page

Demos for Chapter 2 of *The Agent-Ready Web* by Maxim Salnikov. The chapter layer
itself lives in [`nordlys-cabins/layers/02-first-steps/`](../../nordlys-cabins/layers/02-first-steps/).

| File | What it does |
| --- | --- |
| `agent-ready-check.mjs` | A local, dependency-free re-implementation of the checks isitagentready.com documents (its `llms-full.txt`, read 2 November 2026), with the same check ids and level rules. Works against any origin, including `http://localhost`, which the real scanner cannot reach. Chapter 18 reuses it in CI. |
| `booking-walk.mjs` | A structure-only "agent" built with Playwright: it tries to book a cabin by finding every control by role and accessible name, the way agents that read the accessibility tree do, and reports each step. |

## Run it

```sh
# terminal 1, from the repository root
npm install
npm run start:baseline -w nordlys-cabins      # the legacy site, no layers, port 3000

# terminal 2
cd chapters/02-your-first-agent-ready-page
node agent-ready-check.mjs http://127.0.0.1:3000/cabins/fjellro
node booking-walk.mjs http://127.0.0.1:3000
```

Then stop the server, start the clean site after Chapter 2 with
`npm start -w nordlys-cabins -- --upto=2` and run both scripts again.

Lighthouse's Agentic Browsing category (Lighthouse 13.6.0, Chromium 150 or later):

```sh
npx lighthouse@13.6.0 http://127.0.0.1:3000/cabins/fjellro \
  --only-categories=agentic-browsing \
  --chrome-flags="--headless=new --enable-features=WebMCPTesting"
```

The real scanner for a public site:

```sh
curl -s -X POST https://isitagentready.com/api/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'
```

## Tests

```sh
cd nordlys-cabins
node --test tests/ch02-*.test.js        # robots.txt, sitemap, the declared tool, agent-ready-check levels
npx playwright test tests/ch02-          # the booking walk, and the tool as Chromium sees it
```

## What we measured (2 November 2026)

Booking page `/cabins/fjellro`, Lighthouse 13.6.0, Chromium 156.0.8078.4 headless
with `--enable-features=WebMCPTesting`, Node 22.

| | Legacy, no layers | Clean, no layers | Clean, after Chapter 2 |
| --- | --- | --- | --- |
| Booking walk (role and name only) | 0 of 13 steps | 13 of 13 | 13 of 13 |
| Lighthouse `agent-accessibility-tree` | pass | pass | pass |
| Lighthouse `cumulative-layout-shift` | 0.116 | 0 | 0 |
| Lighthouse `webmcp-form-coverage` | not applicable (no forms) | 1 form without a tool (informative) | pass |
| Lighthouse `webmcp-schema-validity` | not applicable | not applicable | pass |
| Lighthouse category (passed audits) | 1 of 2 | 2 of 2 | 4 of 4 |
| `agent-ready-check.mjs` level | 0 Not Ready | 0 Not Ready | 1 Basic Web Presence |
