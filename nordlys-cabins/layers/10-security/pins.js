// Tool pinning: a hash of everything an agent reads about each tool.
// The lockfile is committed. When a description or schema changes, the audit
// fails until someone reviews the change and runs `node layers/10-security/pin-tools.mjs`.
// This is the site owner's answer to "rug pulls": our tools never change silently.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const LOCKFILE = new URL('./tools.lock.json', import.meta.url);

/** What a client sees in tools/list, reduced to the parts that steer a model. */
export function toolFingerprints(tools) {
  return Object.fromEntries(
    tools.map((t) => {
      const seen = { name: t.name, title: t.title ?? null, description: t.description ?? null,
        inputSchema: t.inputSchema ?? null, outputSchema: t.outputSchema ?? null, annotations: t.annotations ?? null };
      return [t.name, createHash('sha256').update(JSON.stringify(seen)).digest('hex').slice(0, 16)];
    })
  );
}

export async function readPins() {
  return JSON.parse(await readFile(LOCKFILE, 'utf8')).tools;
}

/**
 * Compare live fingerprints with the pins. A tool that appears or changes is a
 * finding. A pinned tool that is absent is not: its layer may simply be off.
 */
export function diffPins(live, pinned) {
  const changes = [];
  for (const n of Object.keys(live).sort()) {
    if (!(n in pinned)) changes.push({ tool: n, change: 'added' });
    else if (live[n] !== pinned[n]) changes.push({ tool: n, change: 'changed' });
  }
  return changes;
}
