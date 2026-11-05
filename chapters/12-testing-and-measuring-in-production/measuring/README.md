# Chapter 12: Measuring agent traffic and outcomes

A dependency-free log classifier. It reads an access log, decides for every request
who sent it, for what purpose and how sure we can be, and prints a report with
crawl-to-refer ratios per platform. The Nordlys Cabins layer
`nordlys-cabins/layers/12-agent-analytics/` uses the same code on the site's own
request log and shows it on `/__agents`.

```sh
node make-synthetic-log.mjs                  # writes fixtures/synthetic-access.log and .jsonl
node report.mjs fixtures/synthetic-access.jsonl
node report.mjs /var/log/nginx/access.log --ranges=ip-ranges/2026-11-02
node report.mjs fixtures/synthetic-access.jsonl --json
npm run test:unit                            # node --test, no network
```

The synthetic log is invented for the demo (the weights are in
`make-synthetic-log.mjs`). It is not traffic data from any real site.

## What it reads

- The Apache/nginx **combined** log format.
- **JSON lines** with `time`, `ip`, `method`, `path`, `status`, `referer`, `ua`,
  `contentType` and, when your server verifies Web Bot Auth signatures (Chapter 4),
  `signature` (`verified` or `invalid`) and `signatureAgent`. The combined format has
  no place for a signature result, which is one reason to log JSON.

## How it decides

| Order | Evidence | Result |
| --- | --- | --- |
| 1 | A verified Web Bot Auth signature | `signed-agent`, whatever the user agent says |
| 2 | A documented user agent from outside that agent's published IP ranges, or with an invalid signature | `other-bot` with evidence `spoofed` or `invalid-signature` |
| 3 | A documented user agent from inside its published ranges | its purpose (`training`, `search`, `user-fetch`, `browsing-agent`), evidence `ip-range` |
| 4 | A documented user agent with no range file to check | its purpose, evidence `ua-only` |
| 5 | Any other user agent that names itself a bot, or none at all | `other-bot` |
| 6 | Everything else | `unknown` (mostly people, plus browser agents that do not identify themselves) |

The user agents, purposes and range files are in `agents.json`, from each operator's
documentation as of 2 November 2026. Referrals come from the `Referer` host or a
`utm_source` tag (only `utm_source=chatgpt.com`, which is widely reported but not
documented by OpenAI in the pages we read).

The crawl-to-refer ratio here is HTML pages requested by a platform's training and
search crawlers, divided by HTML pages requested by visitors that platform referred.
Cloudflare Radar's ratio uses the same idea on its own network. User-triggered
fetches and browsing agents are reported next to it, not inside it.

## IP ranges

`ip-ranges/2026-11-02/` holds the range files as published on 2 November 2026 (see
`SOURCES.md` there). They change often: run `node fetch-ip-ranges.mjs` to save
today's copies in a new dated folder, and pass it with `--ranges`.
