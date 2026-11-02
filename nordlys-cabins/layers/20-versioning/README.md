# Layer 20: versioning

Retires the legacy front end's private `/_app/*` endpoints the way the book
recommends for any interface agents use: they keep working until the sunset
date, and every response says so in machine-readable form.

- `Deprecation: @1793577600` (RFC 9745, 2 November 2026)
- `Sunset: Mon, 03 May 2027 00:00:00 GMT` (RFC 8594)
- `Link: <.../changes.md>; rel="deprecation", <.../api/v1/...>; rel="successor-version"`
- `/changes.md`, a changelog of the site's agent interfaces, linked from `llms.txt`

Test: `node --test tests/ch20-versioning.test.js`
