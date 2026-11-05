// The security log of agent actions: who called which tool, and what happened.
// It records the facts an incident review needs and leaves out the arguments,
// which may contain personal data (Chapter 11 is about what we keep and for how long).
const logs = new WeakMap();
const MAX_ENTRIES = 5000;

export function agentActionLog(ctx) {
  let log = logs.get(ctx);
  if (!log) {
    const entries = [];
    log = {
      add(entry) {
        entries.push(entry);
        if (entries.length > MAX_ENTRIES) entries.shift();
        ctx.events.emit('agent.action', entry);
        return entry;
      },
      entries: () => [...entries],
      /** Keep only the entries `keep` returns true for (retention, Chapter 11). Returns how many were dropped. */
      keepOnly(keep) {
        const before = entries.length;
        entries.splice(0, entries.length, ...entries.filter(keep));
        return before - entries.length;
      },
    };
    logs.set(ctx, log);
  }
  return log;
}
