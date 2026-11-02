// Retention for agent data. PROPOSAL: the periods below are the defaults this
// book suggests for a small booking site, not legal advice. Set yours with
// whoever is responsible for data protection, write them in the privacy notice,
// and make the code match the notice.
import { createHmac } from 'node:crypto';

export const RETENTION = {
  agentActionLog: { days: 30, why: 'security investigations; no arguments are logged' },
  bookingRecords: { keep: 'as long as the booking record itself', why: 'evidence of who agreed to what' },
  ipAddresses: { days: 0, why: 'stored only as a keyed hash that changes every day' },
};

/** Entries older than `days` are dropped. Entries need an ISO `at`. */
export function pruneOlderThan(entries, days, now = new Date()) {
  const cutoff = now.getTime() - days * 86_400_000;
  return entries.filter((e) => Date.parse(e.at) >= cutoff);
}

/** A daily-rotating keyed hash: the same IP is linkable within one day, not across days. */
export function hashIp(ip, secret, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return createHmac('sha256', `${secret}:${day}`).update(String(ip)).digest('hex').slice(0, 16);
}

/** Apply the agent-log period to the Chapter 16 log. Returns how many entries were dropped. */
export function pruneAgentLog(log, now = new Date()) {
  return log.keepOnly((e) => pruneOlderThan([e], RETENTION.agentActionLog.days, now).length === 1);
}
