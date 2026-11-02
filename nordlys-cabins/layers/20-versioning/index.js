// Chapter 20: Evolving with the standards. The legacy front end's private /_app/*
// endpoints are being retired. Agents that learned to call them get machine-readable
// warnings (Deprecation, Sunset, Link) and a changelog of the site's agent interfaces.
import { deprecationHeaders } from '../../../chapters/20-evolving-with-the-standards/lib/deprecation.mjs';

const DEPRECATED = '2026-11-02T00:00:00Z';
const SUNSET = '2027-05-03T00:00:00Z'; // six months later

// Old private endpoint -> its documented replacement in the public API (Chapter 7)
const SUCCESSORS = [
  [/^\/_app\/cabins\/([^/]+)$/, (m) => `/api/v1/cabins/${m[1]}`],
  [/^\/_app\/cabins$/, () => '/api/v1/cabins'],
  [/^\/_app\/quote$/, () => '/api/v1/cabins/{slug}/availability'],
  [/^\/_app\/bookings(\/.*)?$/, () => '/api/v1/bookings'],
];

export const CHANGES = `# Nordlys Cabins: changes to agent interfaces

Every change to an interface that agents use (the public API, the MCP server,
the WebMCP tools, llms.txt and the discovery files) is listed here, newest first.
Deprecated interfaces keep working until their sunset date.

## 2026-11-02

- Deprecated: the private JSON endpoints under /_app/ that the old front end used.
  They stop working on 2027-05-03. Use the public API instead:
  /api/v1/cabins, /api/v1/cabins/{slug}/availability and /api/v1/bookings
  (OpenAPI description: /openapi.json).
- Every deprecated response carries the Deprecation, Sunset and Link headers.
`;

export default {
  chapter: 20,
  name: 'Versioning',
  description: 'Deprecation and Sunset headers on the retired /_app/* endpoints, an agent-interface changelog',

  register(app, ctx) {
    ctx.staticFile('/changes.md', CHANGES, { contentType: 'text/markdown; charset=utf-8' });

    ctx.headers(
      (c) => c.req.path.startsWith('/_app/'),
      (c) => {
        const found = SUCCESSORS.map(([re, to]) => [re.exec(c.req.path), to]).find(([m]) => m);
        return deprecationHeaders({
          deprecated: DEPRECATED,
          sunset: SUNSET,
          policy: ctx.absoluteUrl(c, '/changes.md'),
          successor: found ? ctx.absoluteUrl(c, found[1](found[0])) : undefined,
        });
      },
    );

    // After the sunset date the old endpoints answer 410 Gone and name the successor.
    ctx.beforeAuth(async (c, next) => {
      if (!c.req.path.startsWith('/_app/') || ctx.store.today() < SUNSET.slice(0, 10)) return next();
      return c.json({ error: 'gone', detail: `Retired on ${SUNSET.slice(0, 10)}. See /changes.md.` }, 410);
    });

    // Point llms.txt (Chapter 6) at the changelog, if that layer is on. Root files are
    // served before ctx.middleware() runs, so this wraps them from ctx.beforeAuth().
    ctx.beforeAuth(async (c, next) => {
      await next();
      if (c.req.path !== '/llms.txt' || c.res.status !== 200) return;
      const body = await c.res.text();
      const line = `\n## Changes\n\n- [Agent interface changes](${ctx.absoluteUrl(c, '/changes.md')}): deprecations and sunset dates\n`;
      c.res = new Response(body.includes('/changes.md') ? body : body.trimEnd() + '\n' + line, c.res);
    });
  },
};
