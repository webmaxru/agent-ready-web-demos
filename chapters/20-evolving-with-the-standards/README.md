# Chapter 20: Evolving with the standards

Two small tools, no dependencies.

**`lib/deprecation.mjs`** builds and reads the `Deprecation` (RFC 9745) and
`Sunset` (RFC 8594) header fields and the `Link` relations that go with them.
The Nordlys Cabins layer `nordlys-cabins/layers/20-versioning/` uses it to retire
the old front end's private `/_app/*` endpoints.

**`standards-watch.mjs`** checks the pages in `watchlist.json` (MCP, WebMCP, the
IETF Web Bot Auth and AI preferences drafts, schema.org, llms.txt, Lighthouse)
and reports which version strings changed since `watch-state.json`.

```sh
node standards-watch.mjs            # same / CHANGED / ERROR per entry, exit 1 on a change
node standards-watch.mjs --update   # store today's values
npm run test:unit                   # offline, against page excerpts in fixtures/
```

`watch-state.json` holds the values read on 2 November 2026. A page that changes
its layout makes an entry fail with `ERROR` instead of passing silently, so fix the
pattern in `watchlist.json` when that happens.
