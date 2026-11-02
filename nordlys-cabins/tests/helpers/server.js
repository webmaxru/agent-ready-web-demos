import { serve } from '@hono/node-server';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

/** The fixed "today" every core test uses, so dates in tests never go stale. */
export const TODAY = '2026-11-10';

/**
 * Build an app in-process (no port). Use app.request(path, init) in node:test.
 * @param {object} [overrides] any loadConfig override: { upto, variant, now, env, layersDir, ... }
 */
export async function buildApp(overrides = {}) {
  const config = loadConfig({ argv: [], env: { ...process.env, ...(overrides.env ?? {}) }, overrides: { now: TODAY, sessionSecret: 'test-secret', ...overrides } });
  return createApp({ config });
}

/**
 * Start a real HTTP server on a free port. Use it from Playwright specs and
 * from tests that need real sockets. Always call close() in afterAll.
 * @returns {Promise<{ url: string, close: () => Promise<void>, app, ctx, store }>}
 */
export async function startServer(overrides = {}) {
  const built = await buildApp({ legacyDelayMs: 150, ...overrides });
  return new Promise((resolve) => {
    const server = serve({ fetch: built.app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      resolve({
        ...built,
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Minimal cookie jar for app.request(): keeps cookies between calls. */
export function cookieJar() {
  const jar = new Map();
  return {
    headers(extra = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      return cookie ? { ...extra, cookie } : extra;
    },
    store(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (!value || /max-age=0/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
      return res;
    },
  };
}

/** Encode an object as an HTML form body. */
export const formBody = (data) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
});
