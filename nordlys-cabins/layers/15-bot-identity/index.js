// Chapter 15: Telling good agents from bad bots. Verifies Web Bot Auth signatures
// from allowlisted agents, optionally confirms Google's crawlers by DNS, labels every
// request, and gives each class its own rate limit on /mcp and the booking-session API.
// Nordlys verifies. It does not sign.
import { createDirectory } from './directory.js';
import { createVerifier } from './verify.js';
import { createDnsCheck } from './rdns.js';
import { identify, rateKey } from './identity.js';
import { createLimiter } from './ratelimit.js';

// Agents whose keys we fetch. Add your own (comma-separated) with NORDLYS_WBA_TRUST.
const DEFAULT_TRUST = ['https://chatgpt.com', 'https://agent.bot.goog'];
// Requests per minute and per bucket, by what we know about the client.
const POLICIES = { 'verified-agent': 300, 'verified-crawler': 120, anonymous: 60 };

export default {
  chapter: 15,
  name: 'Bot identity',
  description: 'Web Bot Auth verification (RFC 9421 Ed25519), DNS confirmation, request labels, per-class rate limits with RateLimit headers',

  register(app, ctx) {
    const env = ctx.config.env ?? {};
    const trusted = new Set([...DEFAULT_TRUST, ...String(env.NORDLYS_WBA_TRUST ?? '').split(',').map((s) => s.trim()).filter(Boolean)]
      .map((u) => u.replace(/\/$/, '')));
    const directory = createDirectory({ trusted, allowHttp: env.NORDLYS_WBA_ALLOW_HTTP === '1' });
    const verifyRequest = createVerifier({ directory });
    const checkDns = env.NORDLYS_RDNS === '1' ? createDnsCheck() : async () => null;
    const take = createLimiter({ policies: POLICIES });

    ctx.beforeAuth(async (c, next) => {
      const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.env?.incoming?.socket?.remoteAddress || 'local';
      const ua = c.req.header('user-agent') ?? '';
      const signature = await verifyRequest(c.req.raw);
      const network = signature.status === 'unsigned' ? await checkDns(ip, ua) : null;
      const identity = identify(signature, ua, network);
      c.set('botIdentity', identity);
      if (identity.kind !== 'unidentified') ctx.events.emit('bot.identified', identity, { c });

      if (c.req.path === '/mcp' || c.req.path.startsWith('/ucp/')) {
        const bucket = rateKey(identity, ip);
        const policy = bucket.startsWith('agent:') ? 'verified-agent' : bucket.startsWith('crawler:') ? 'verified-crawler' : 'anonymous';
        const { allowed, headers } = take(bucket, policy);
        if (!allowed) return c.json({ error: 'rate_limited', detail: `Limit ${POLICIES[policy]} requests per minute for ${policy} clients.` }, 429, headers);
        await next();
        for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
      } else {
        await next();
      }
      if (env.NORDLYS_WBA_DEBUG === '1') c.res.headers.set('x-nordlys-bot-identity', identity.kind + (identity.agent ? ` ${identity.agent}` : ''));
    });

    ctx.audit('bot identity: unsigned requests pass', async ({ request }) => {
      const res = await request('/', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)' } });
      return [{ id: 'wba-unsigned-ok', ok: res.status === 200, message: 'an unsigned request that only claims to be ChatGPT-User is served, labelled claimed-agent' }];
    });
  },
};
