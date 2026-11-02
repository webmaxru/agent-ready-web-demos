// Chapter 19: Measuring agent traffic and outcomes. Logs every request in the JSON
// format the Chapter 19 classifier reads, labels it (who, why, how sure), ties bookings
// to the kind of visitor that made them, and shows it all on /__agents.
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, classify } from '../../../chapters/19-measuring-agent-traffic/lib/classify.mjs';
import { buildReport } from '../../../chapters/19-measuring-agent-traffic/lib/report.mjs';
import { dashboardPage } from './dashboard.js';

const tool = join(dirname(fileURLToPath(import.meta.url)), '../../../chapters/19-measuring-agent-traffic');
const MAX_RECORDS = 10_000; // in memory only; set NORDLYS_AGENT_LOG to also append to a file

/** Layer 15's label for the request, in the classifier's terms. */
export function signatureFrom(identity) {
  if (identity?.kind === 'verified-agent') return { signature: 'verified', signatureAgent: identity.agent };
  if (identity?.kind === 'invalid-signature') return { signature: 'invalid', signatureAgent: null };
  return { signature: null, signatureAgent: null };
}

export default {
  chapter: 19,
  name: 'Agent analytics',
  description: 'Request log with agent classes and evidence, agent-originated bookings, /__agents dashboard',

  register(app, ctx) {
    const env = ctx.config.env ?? {};
    const rules = loadRules({ agentsFile: join(tool, 'agents.json'), rangesDir: join(tool, 'ip-ranges', '2026-11-02') });
    const records = [];
    const bookings = [];

    const clientIp = (c) =>
      (env.NORDLYS_TRUST_PROXY === '1' && c.req.header('x-forwarded-for')?.split(',')[0].trim()) ||
      c.env?.incoming?.socket?.remoteAddress || null;

    ctx.beforeAuth(async (c, next) => {
      if (c.req.path.startsWith('/__')) return next(); // do not count the dashboards themselves
      const url = new URL(c.req.url);
      const record = {
        time: new Date().toISOString(),
        ip: clientIp(c),
        method: c.req.method,
        path: url.pathname + url.search,
        referer: c.req.header('referer') ?? '',
        ua: c.req.header('user-agent') ?? '',
        ...signatureFrom(c.get('botIdentity')), // set by layer 15 when it runs
      };
      const who = classify({ ...record, userAgent: record.ua }, rules);
      c.set('agentClass', who); // read by the booking listener below
      await next();
      record.status = c.res.status;
      record.contentType = c.res.headers.get('content-type');
      records.push(record);
      if (records.length > MAX_RECORDS) records.shift();
      if (env.NORDLYS_AGENT_LOG) await appendFile(env.NORDLYS_AGENT_LOG, JSON.stringify(record) + '\n');
    });

    // The outcome that matters: which kind of visitor actually booked a cabin.
    ctx.events.on('booking.created', (booking, meta = {}) => {
      const who = meta.c?.get('agentClass') ?? { class: 'unknown', agent: null, evidence: 'none' };
      bookings.push({ ref: booking.ref, cabin: booking.cabin, total: booking.quote?.total ?? null,
        via: meta.via ?? null, class: who.class, agent: who.agent, evidence: who.evidence });
    });

    const summary = () => {
      const report = buildReport(records.map((r) => JSON.stringify(r)), rules);
      const byClass = {};
      for (const b of bookings) byClass[b.class] = (byClass[b.class] ?? 0) + 1;
      return { ...report, bookings: { total: bookings.length, byClass, recent: bookings.slice(-10) } };
    };

    // Optional bearer token: set NORDLYS_ANALYTICS_TOKEN in production.
    const allowed = (c) => !env.NORDLYS_ANALYTICS_TOKEN || c.req.header('authorization') === `Bearer ${env.NORDLYS_ANALYTICS_TOKEN}`;
    ctx.headers(['/__agents', '/__agents.json'], { 'x-robots-tag': 'noindex', 'cache-control': 'no-store' });
    ctx.route('GET', '/__agents.json', (c) => (allowed(c) ? c.json(summary()) : c.json({ error: 'unauthorized' }, 401)));
    ctx.route('GET', '/__agents', (c) => (allowed(c) ? c.html(dashboardPage(ctx.html, summary())) : c.text('Unauthorized', 401)));

    ctx.audit('agent analytics: a spoofed crawler is not counted as the crawler', async () => {
      const who = classify({ userAgent: 'Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)', ip: '198.51.100.250' }, rules);
      return [{ id: 'agents-spoofed-gptbot', ok: who.evidence === 'spoofed', message: 'GPTBot from outside openai.com/gptbot.json is labelled spoofed' }];
    });
  },
};
