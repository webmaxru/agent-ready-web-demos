# Chapter 3: How agents see a page

Companion code for Chapter 3 of *The Agent-Ready Web*. Two scripts, one fixture.

| File | What it does |
|---|---|
| `three-views.mjs` | Captures the three views of one URL: the server's HTML read without JavaScript, the accessibility tree of the rendered page (Playwright ARIA snapshot and the full CDP tree) and a screenshot. Prints sizes and counts, and saves the raw views with `--out=dir`. |
| `agent-axe.mjs` | Runs the 33 axe-core rules behind Lighthouse's `agent-accessibility-tree` audit on any URL or local file. `--all` runs the WCAG 2.x A/AA and best-practice rules instead, for comparison. |
| `fixtures/broken-booking.html` | A small booking form with common mistakes, one per line. |

The chapter's Nordlys layer is `nordlys-cabins/layers/03-perception/`: a perception contract (landmarks, one `h1`, labels, button names, no click divs, image sizes) checked on every public page and reported by `GET /__audit`.

## Run

From the repository root, with the site running (`npm start`, port 3000):

```sh
node chapters/03-how-agents-see-a-page/three-views.mjs http://127.0.0.1:3000/cabins/fjellro --out=views
node chapters/03-how-agents-see-a-page/agent-axe.mjs http://127.0.0.1:3000/cabins/fjellro
node chapters/03-how-agents-see-a-page/agent-axe.mjs chapters/03-how-agents-see-a-page/fixtures/broken-booking.html
node chapters/03-how-agents-see-a-page/agent-axe.mjs --all http://127.0.0.1:3000/cabins/fjellro
```

Start the legacy front end with `npm run start:legacy -w nordlys-cabins` to compare. The site sends a Content Security Policy, so `agent-axe.mjs` opens pages with `bypassCSP: true` to inject axe-core.

Tests: `tests/ch03-perception.test.js` (node:test) and `tests/ch03-perception.spec.js` (Playwright) in `nordlys-cabins`.

## Results on 2 November 2026

Chromium 156.0.8078.4, Playwright 1.64.1, axe-core 4.14.0, page `/cabins/fjellro`.

| View | Legacy | Clean |
|---|---|---|
| Server HTML | 2.1 KB, 0 interactive elements | 4.8 KB, 15 interactive elements |
| DOM after render | 54 elements | 100 elements |
| Accessibility tree (CDP) | 81 nodes, 2 interactive, 0 headings, 0 landmarks | 233 nodes, 23 interactive, 5 headings, 9 landmarks |
| ARIA snapshot | 0.6 KB, 2 interactive lines | 3.1 KB, 15 interactive lines |
| Screenshot 1280x800 | 61.6 KB | 66.3 KB |
| 33 agent rules | no violations | no violations |
| WCAG A/AA and best practices | landmark-one-main, page-has-heading-one, region | no violations |

The fixture fails ten of the 33 agent rules, and axe reports `aria-hidden-focus` as "needs review", which Lighthouse does not count.
