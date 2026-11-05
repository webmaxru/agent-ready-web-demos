/**
 * Runtime configuration from CLI flags and environment variables.
 * CLI flags win over environment variables.
 *
 *   --upto=NN      / UPTO=NN          enable every layer of chapters 0..NN ("all" = every layer, the default)
 *   --variant=V    / VARIANT=V        "clean" (default) or "legacy" front end for the booking flow
 *   --port=N       / PORT=N           port to listen on (default 3000, 0 = any free port)
 *   --host=H       / HOST=H           interface to bind (default 127.0.0.1)
 *   --now=DATE     / NOW=DATE         freeze "today" (YYYY-MM-DD), for tests and screenshots
 *   PUBLIC_ORIGIN                      absolute origin for links layers generate (default: the request's origin)
 *   LEGACY_DELAY_MS                    how late the legacy front end injects its content (default 400)
 *   LAYERS_DIR                         where to look for layers (default ./layers)
 *   SESSION_SECRET                     key for booking links (default: random per start)
 *   AUDIT=1                            expose /__audit and /__layers even when NODE_ENV=production
 */

export const VARIANTS = ['clean', 'legacy'];

export function parseArgs(argv = []) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (m) out[m[1]] = m[2] ?? 'true';
  }
  return out;
}

function parseUpto(value) {
  if (value === undefined || value === null || value === '' || String(value).toLowerCase() === 'all') return Infinity;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`UPTO must be a chapter number or "all", got "${value}"`);
  return n;
}

export function loadConfig({ argv = process.argv.slice(2), env = process.env, overrides = {} } = {}) {
  const args = parseArgs(argv);
  const pick = (flag, name) => args[flag] ?? env[name];
  const variant = String(overrides.variant ?? pick('variant', 'VARIANT') ?? 'clean').toLowerCase();
  if (!VARIANTS.includes(variant)) throw new Error(`VARIANT must be one of ${VARIANTS.join(', ')}, got "${variant}"`);
  const now = overrides.now ?? pick('now', 'NOW');
  if (now && !/^\d{4}-\d{2}-\d{2}$/.test(String(now))) throw new Error(`NOW must be YYYY-MM-DD, got "${now}"`);
  const config = {
    upto: parseUpto(overrides.upto ?? pick('upto', 'UPTO')),
    variant,
    port: Number(overrides.port ?? pick('port', 'PORT') ?? 3000),
    host: overrides.host ?? pick('host', 'HOST') ?? '127.0.0.1',
    now: now ? String(now) : null,
    publicOrigin: overrides.publicOrigin ?? env.PUBLIC_ORIGIN ?? null,
    legacyDelayMs: Number(overrides.legacyDelayMs ?? env.LEGACY_DELAY_MS ?? 400),
    layersDir: overrides.layersDir ?? args['layers-dir'] ?? env.LAYERS_DIR ?? null,
    sessionSecret: overrides.sessionSecret ?? env.SESSION_SECRET ?? null,
    audit: overrides.audit ?? (env.AUDIT === '1' || env.NODE_ENV !== 'production'),
    env: { ...env, ...(overrides.env ?? {}) },
  };
  return config;
}
