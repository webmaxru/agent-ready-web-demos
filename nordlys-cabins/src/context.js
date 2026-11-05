import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { html, raw, escapeHtml, attrs, jsonForScript, toString } from './html.js';

/**
 * The layer context ("ctx"). Every hook a chapter layer can use lives here.
 * The core app reads these registries at request time, so the order in which
 * layers register does not matter for correctness, only for precedence
 * (later layers win where two layers set the same thing).
 *
 * See LAYERS.md for the contract with examples.
 */

const TYPES = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonld': 'application/ld+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
export function contentTypeFor(path) {
  const m = /\.[a-z0-9]+$/i.exec(path);
  if (m && TYPES[m[0].toLowerCase()]) return TYPES[m[0].toLowerCase()];
  if (path.startsWith('/.well-known/')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

/** Compile a path pattern: "/cabins/*" matches the prefix, "/faq" matches exactly. */
function pathMatcher(pattern) {
  if (pattern === undefined || pattern === null || pattern === '*') return () => true;
  if (Array.isArray(pattern)) {
    const all = pattern.map(pathMatcher);
    return (p, x) => all.some((f) => f(p, x));
  }
  if (pattern instanceof RegExp) return (p) => pattern.test(p);
  if (typeof pattern === 'function') return (p, x) => Boolean(pattern(x ?? p));
  const s = String(pattern);
  if (s.endsWith('*')) return (p) => p.startsWith(s.slice(0, -1));
  return (p) => p === s;
}

/** Matcher for page-level hooks: { match, kinds } where kinds is a list of page kinds. */
function pageMatcher({ match, kinds } = {}) {
  const byPath = pathMatcher(match);
  const kindList = kinds ? [].concat(kinds) : null;
  return (page) => (!kindList || kindList.includes(page.kind)) && byPath(page.path, page);
}

export function createContext({ config, store, layers = [] }) {
  const head = [];
  const headers = [];
  const staticFiles = new Map();
  const beforeAuth = [];
  const afterAuth = [];
  const audits = [];
  const slots = [];
  const formAttrs = [];
  const fieldAttrs = [];
  const routes = [];
  let mcp = null;
  let currentLayer = null;

  const owner = () => currentLayer?.id ?? 'core';

  const ctx = {
    /** Runtime configuration (variant, upto, port, now, publicOrigin, ...). Read-only by convention. */
    config,
    /** Business logic and data: cabins, availability, prices, bookings, members, articles, FAQ. */
    store,
    /** Layers that are enabled in this run, in order: [{ id, chapter, order, name, description }]. */
    layers: layers.map(({ id, chapter, order, name, description }) => ({ id, chapter, order, name, description })),
    /** Template helpers, the same ones the core pages use. */
    html: { html, raw, escapeHtml, attrs, jsonForScript, toString },
    /** Domain events: booking.created, booking.cancelled, member.login, member.logout, contact.received. */
    events: new EventEmitter(),

    /** Absolute URL for a path: PUBLIC_ORIGIN if set, else the origin of the current request. */
    absoluteUrl(c, path = '/') {
      const origin = config.publicOrigin ?? new URL(c.req.url).origin;
      return new URL(path, origin).href;
    },

    /**
     * Add tags to <head> of HTML pages.
     * @param {object|object[]|((page) => object|object[]|null)} entries
     *   { meta: {...attrs} } | { link: {...attrs} } | { jsonLd: object } | { script: { src, type, defer, async } }
     * @param {{ match?: string|RegExp|Function|Array, kinds?: string|string[] }} [options]
     */
    head(entries, options = {}) {
      head.push({ entries, test: pageMatcher(options), owner: owner() });
    },

    /** Add an external script to pages (CSP-friendly: no inline code). type defaults to "module". */
    pageScript(src, { type = 'module', defer, async, ...options } = {}) {
      head.push({ entries: { script: { src, type, defer, async } }, test: pageMatcher(options), owner: owner() });
    },

    /**
     * Add or override response headers on every response whose path matches.
     * @param {string|RegExp|Function|Array} match   "/cabins/*", /^\/api\//, (c) => boolean, or "*"
     * @param {Record<string,string|null>|((c) => Record<string,string|null>|null)} values  null deletes a header
     */
    headers(match, values) {
      headers.push({ test: pathMatcher(match), values, owner: owner() });
    },

    /**
     * Serve a file at a root path, e.g. /robots.txt, /llms.txt, /.well-known/api-catalog.
     * @param {string} path
     * @param {string|Uint8Array|((c, ctx) => string|Uint8Array|Response|Promise<any>)|{file: string}} body
     * @param {{ contentType?: string, replace?: boolean }} [options]
     *   replace: true is required to override a file another layer already serves.
     */
    staticFile(path, body, { contentType, replace = false } = {}) {
      if (!path.startsWith('/')) throw new Error(`staticFile path must start with "/": ${path}`);
      const prev = staticFiles.get(path);
      if (prev && !replace)
        throw new Error(`${path} is already served by layer ${prev.owner}; pass { replace: true } to override it`);
      staticFiles.set(path, { body, contentType: contentType ?? contentTypeFor(path), owner: owner() });
    },

    /** Read what is currently registered for a static path (to extend another layer's robots.txt, for example). */
    async getStaticFile(path, c = null) {
      const f = staticFiles.get(path);
      if (!f) return null;
      const body = await resolveStatic(f, c);
      return body instanceof Response ? await body.text() : typeof body === 'string' ? body : new TextDecoder().decode(body);
    },

    /** Add a route. Same as app.on(method, path, handler), recorded for /__layers. */
    route(method, path, ...handlers) {
      routes.push({ method, path, owner: owner() });
      app().on(method, path, ...handlers);
    },

    /**
     * Mount an MCP endpoint (Streamable HTTP) at /mcp, or another path.
     * @param {(c) => Response|Promise<Response>} handler  receives every method (POST, GET, DELETE) on the path
     */
    mcp(handler, { path = '/mcp' } = {}) {
      if (mcp) throw new Error(`An MCP endpoint is already mounted at ${mcp.path} by layer ${mcp.owner}`);
      mcp = { path, owner: owner() };
      routes.push({ method: 'ALL', path, owner: owner() });
      app().all(path, handler);
    },

    /** Middleware that runs before sessions and auth: bot verification, rate limits, request signatures. */
    beforeAuth(middleware) {
      beforeAuth.push({ fn: middleware, owner: owner() });
    },

    /** Middleware that runs after auth. c.get('member') is the signed-in member or null. */
    middleware(middleware) {
      afterAuth.push({ fn: middleware, owner: owner() });
    },

    /**
     * Add HTML to a named place in the page layout.
     * Slots: "head-end", "header-end", "main-start", "main-end", "footer", "body-end",
     * plus per-page slots "cabin-detail-end", "booking-form-end", "booking-confirmed".
     * @param {string} name
     * @param {(page) => any} render  return html`...` (escaped) or null
     */
    slot(name, render, options = {}) {
      slots.push({ name, render, test: pageMatcher(options), owner: owner() });
    },

    /**
     * Add attributes to one of the core forms. Form ids: search, availability, booking, lookup,
     * cancel, login, logout, contact. Example (declarative WebMCP):
     *   ctx.formAttributes('booking', { toolname: 'book_cabin', tooldescription: '...' })
     */
    formAttributes(formId, values) {
      formAttrs.push({ formId, values, owner: owner() });
    },

    /** Add attributes to one named field of a core form: ctx.fieldAttributes('booking', 'email', {...}). */
    fieldAttributes(formId, field, values) {
      fieldAttrs.push({ formId, field, values, owner: owner() });
    },

    /**
     * Register a check that tests (and GET /__audit) can run.
     * @param {string} name
     * @param {(tools: { request: (path: string, init?: RequestInit) => Promise<Response>, ctx }) => Promise<Array<{ id: string, ok: boolean, message?: string }>>|Array<...>} run
     */
    audit(name, run) {
      audits.push({ name, run, owner: owner() });
    },

    /** Run every registered audit against the app in-process. */
    async runAudits() {
      const request = (path, init) => app().request(path, init);
      const results = [];
      for (const a of audits) {
        try {
          const checks = (await a.run({ request, ctx })) ?? [];
          results.push({ name: a.name, layer: a.owner, ok: checks.every((x) => x.ok), checks });
        } catch (err) {
          results.push({ name: a.name, layer: a.owner, ok: false, checks: [{ id: 'error', ok: false, message: String(err?.message ?? err) }] });
        }
      }
      return { ok: results.every((r) => r.ok), results };
    },
  };

  // ---- internals the core app uses (not part of the layer contract) ----
  let appRef = null;
  const app = () => {
    if (!appRef) throw new Error('ctx is not attached to an app yet');
    return appRef;
  };

  async function resolveStatic(f, c) {
    if (typeof f.body === 'function') return f.body(c, ctx);
    if (f.body && typeof f.body === 'object' && 'file' in f.body) return readFile(f.body.file);
    return f.body;
  }

  const internals = {
    attach(a) {
      appRef = a;
    },
    setLayer(layer) {
      currentLayer = layer;
    },
    headTags(page) {
      const out = [];
      for (const h of head) {
        if (!h.test(page)) continue;
        let entries = typeof h.entries === 'function' ? h.entries(page) : h.entries;
        if (!entries) continue;
        for (const e of [].concat(entries)) out.push(renderHeadEntry(e, h.owner));
      }
      return raw(out.join('\n    '));
    },
    slot(name, page) {
      return raw(
        slots
          .filter((s) => s.name === name && s.test(page))
          .map((s) => toString(s.render(page)))
          .join('\n')
      );
    },
    formAttrs(formId, page) {
      const merged = {};
      for (const f of formAttrs) if (f.formId === formId) Object.assign(merged, typeof f.values === 'function' ? f.values(page) : f.values);
      return attrs(merged);
    },
    fieldAttrs(formId, field, page) {
      const merged = {};
      for (const f of fieldAttrs)
        if (f.formId === formId && f.field === field) Object.assign(merged, typeof f.values === 'function' ? f.values(page) : f.values);
      return attrs(merged);
    },
    async applyHeaders(c) {
      const path = c.req.path;
      for (const h of headers) {
        if (!h.test(path, c)) continue;
        const values = typeof h.values === 'function' ? await h.values(c) : h.values;
        if (!values) continue;
        for (const [k, v] of Object.entries(values)) {
          try {
            if (v === null) c.res.headers.delete(k);
            else c.res.headers.set(k, v);
          } catch {
            c.res = new Response(c.res.body, c.res); // immutable headers: copy and retry
            if (v === null) c.res.headers.delete(k);
            else c.res.headers.set(k, v);
          }
        }
      }
    },
    async serveStatic(c) {
      const f = staticFiles.get(c.req.path);
      if (!f) return null;
      const body = await resolveStatic(f, c);
      if (body instanceof Response) return body;
      if (body === null || body === undefined) return null;
      return new Response(c.req.method === 'HEAD' ? null : body, { headers: { 'content-type': f.contentType } });
    },
    beforeAuth: () => beforeAuth.map((m) => m.fn),
    afterAuth: () => afterAuth.map((m) => m.fn),
    describe() {
      return {
        config: { variant: config.variant, upto: Number.isFinite(config.upto) ? config.upto : 'all', now: config.now },
        layers: ctx.layers,
        staticFiles: [...staticFiles].map(([path, f]) => ({ path, layer: f.owner })),
        routes,
        mcp,
        hooks: {
          head: head.map((h) => h.owner),
          headers: headers.map((h) => h.owner),
          beforeAuth: beforeAuth.map((m) => m.owner),
          middleware: afterAuth.map((m) => m.owner),
          slots: slots.map((s) => ({ name: s.name, layer: s.owner })),
          formAttributes: formAttrs.map((f) => ({ form: f.formId, layer: f.owner })),
          fieldAttributes: fieldAttrs.map((f) => ({ form: f.formId, field: f.field, layer: f.owner })),
          audits: audits.map((a) => ({ name: a.name, layer: a.owner })),
        },
      };
    },
  };

  return { ctx, internals };
}

function renderHeadEntry(e, ownerId) {
  if (e.meta) return `<meta${toString(attrs(e.meta))}>`;
  if (e.link) return `<link${toString(attrs(e.link))}>`;
  if (e.jsonLd) return `<script type="application/ld+json">${jsonForScript(e.jsonLd)}</script>`;
  if (e.script) {
    if (!e.script.src) throw new Error(`Layer ${ownerId}: head scripts need a src (inline scripts break the CSP)`);
    return `<script${toString(attrs({ type: e.script.type ?? 'module', src: e.script.src, defer: e.script.defer, async: e.script.async }))}></script>`;
  }
  if (e.raw) return String(e.raw);
  throw new Error(`Layer ${ownerId}: unknown head entry ${JSON.stringify(e)}`);
}
