# Chapter 12: Testing agent-readiness

An agent-readiness pipeline for Nordlys Cabins. Every check runs locally and in
GitHub Actions (`workflow/agent-readiness.yml`; copy it to `.github/workflows/`
at the repository root to enable it).

| Script | What it checks | Fails when |
| --- | --- | --- |
| `scripts/readiness.mjs` | The isitagentready-style checks of Chapter 2 (`chapters/02-your-first-agent-ready-page/agent-ready-check.mjs`) | The level drops below `baselines/readiness.json`, or a check that passed there stops passing |
| `scripts/structured-data.mjs` | JSON-LD on five pages: parses, schema.org context, the properties in `RULES` | Any problem |
| `scripts/robots-llms.mjs` | robots.txt syntax, sitemap, the crawler access in `baselines/robots-expectations.json`, llms.txt shape and links | Any problem |
| `scripts/lighthouse-agentic.mjs` | Lighthouse 13.6.0 Agentic Browsing, median of 3 runs per page | A median audit score falls below `baselines/lighthouse.json` |
| `evals/injection-eval.mjs` | Real models read a hostile review through raw, labelled and moderated versions of a review tool (reuses Chapter 7's harness). Not part of the merge gate: run nightly or before a release | Exit code 1 when a labelled or moderated run is unsafe (a cancellation or the attacker's link). Results of 2 Nov 2026 in `results/` |
| `e2e/agent-paths.spec.js` | Playwright: a booking by roles and labels, the booking form's aria snapshot, WebMCP tools, the MCP contract against `layers/10-security/tools.lock.json` | Any test |

```sh
# from the repository root, with Nordlys running on port 4318
node nordlys-cabins/server.js --port=4318 --now=2026-11-10 &
npm run test:unit -w chapters/12-testing-and-measuring-in-production/testing
npm run check:readiness -w chapters/12-testing-and-measuring-in-production/testing -- http://127.0.0.1:4318
npm run check:schema -w chapters/12-testing-and-measuring-in-production/testing -- http://127.0.0.1:4318
npm run check:robots -w chapters/12-testing-and-measuring-in-production/testing -- http://127.0.0.1:4318
CHROME_PATH=$(node -e "console.log(require('playwright').chromium.executablePath())") \
  npm run check:lighthouse -w chapters/12-testing-and-measuring-in-production/testing -- http://127.0.0.1:4318
NORDLYS_URL=http://127.0.0.1:4318 npm run test:e2e -w chapters/12-testing-and-measuring-in-production/testing
```

Without `NORDLYS_URL`, Playwright starts the server itself (see `playwright.config.js`).

Baselines are files in review. After an intended change, regenerate the readiness
baseline with `node scripts/readiness.mjs <url> --write-baseline`, edit
`baselines/lighthouse.json` by hand (raise numbers, never lower them silently), and
re-pin MCP tools with `node nordlys-cabins/layers/10-security/pin-tools.mjs`.

Evals with real models (keys in `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, optional `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` for a proxy):

```sh
npm run eval:injection -w chapters/12-testing-and-measuring-in-production/testing -- --models=gpt-4.1-mini,claude-haiku-4-5 --runs=10
node chapters/12-testing-and-measuring-in-production/testing/evals/injection-eval.mjs --models=mock   # no keys: the scripted worst case
```

Versions: Node 22 or later, Lighthouse 13.6.0 (pinned: the Agentic Browsing category
changes in every minor release), Playwright 1.64.1 with Chromium 156.0.8078.4.
