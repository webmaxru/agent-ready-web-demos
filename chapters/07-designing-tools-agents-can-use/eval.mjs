#!/usr/bin/env node
// Run the task suite against tool sets and models, and print a pass-rate table.
//   node eval.mjs --models gpt-4.1-mini,claude-haiku-4-5-20251001 --sets before,after --trials 3
// Keys come from OPENAI_API_KEY / ANTHROPIC_API_KEY, base URLs from
// OPENAI_BASE_URL / ANTHROPIC_BASE_URL (defaults: the vendors' public APIs).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { tasks } from './tasks.mjs';
import { runEpisode } from './agent.mjs';
import { modelFor } from './models.mjs';

const { values } = parseArgs({
  options: {
    models: { type: 'string', default: 'gpt-4.1-mini' },
    sets: { type: 'string', default: 'before,after' },
    tasks: { type: 'string', default: '' },
    trials: { type: 'string', default: '3' },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string', default: `results/run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}` },
    rescore: { type: 'string', default: '' },
  },
});

// --rescore results/x.json re-runs only the checks over recorded episodes (no model calls).
const recorded = values.rescore ? JSON.parse(readFileSync(values.rescore, 'utf8')) : null;
if (recorded) {
  values.trials = recorded.args.trials;
  values.models = recorded.args.models;
  values.sets = recorded.args.sets;
  values.tasks = [...new Set(recorded.episodes.map((ep) => ep.task))].join(',');
  values.out = values.rescore.replace(/\.json$/, '');
}
const sets = Object.fromEntries(await Promise.all(values.sets.split(',').map(async (s) => [s, await import(`./toolsets/${s}.mjs`)])));
const models = values.models.split(',');
const selected = values.tasks ? tasks.filter((t) => values.tasks.split(',').includes(t.id)) : tasks;
const jobs = [];
for (const model of models) for (const set of Object.keys(sets)) for (const task of selected) for (let trial = 1; trial <= Number(values.trials); trial++) jobs.push({ model, set, task, trial });

const episodes = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    try {
      const e = await runEpisode({ task: job.task, toolset: sets[job.set], model: modelFor(job.model) });
      episodes.push({ model: job.model, set: job.set, trial: job.trial, ...e });
    } catch (err) {
      episodes.push({ model: job.model, set: job.set, trial: job.trial, task: job.task.id, error: err.message, check: { pass: false, notes: 'run failed' } });
    }
    if (episodes.length % 20 === 0 || episodes.length === jobs.length) process.stderr.write(`${episodes.length}/${jobs.length} episodes\n`);
  }
}
if (recorded) {
  for (const ep of recorded.episodes) {
    const task = tasks.find((t) => t.id === ep.task);
    episodes.push(ep.error ? ep : { ...ep, check: task.check(ep) });
  }
} else await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));

// Summary: pass rate per model and set, then per task.
const key = (e) => `${e.model} / ${e.set}`;
const groups = new Map();
for (const e of episodes) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
const pct = (n, d) => `${n}/${d}`;
const lines = ['| Model | Tool set | Passed | Errors | Avg tool calls | Avg tokens in/out |', '| --- | --- | --- | --- | --- | --- |'];
for (const [k, es] of [...groups].sort()) {
  const done = es.filter((e) => !e.error);
  const avg = (f) => (done.length ? Math.round(done.reduce((s, e) => s + f(e), 0) / done.length) : 0);
  lines.push(`| ${k.replace(' / ', ' | ')} | ${pct(es.filter((e) => e.check.pass).length, es.length)} | ${es.length - done.length} | ${(done.reduce((s, e) => s + e.calls.length, 0) / (done.length || 1)).toFixed(1)} | ${avg((e) => e.usage.input)}/${avg((e) => e.usage.output)} |`);
}
lines.push('', '| Task | ' + [...groups.keys()].sort().join(' | ') + ' |', '| --- |' + ' --- |'.repeat(groups.size));
for (const t of selected) {
  const row = [...groups.keys()].sort().map((k) => {
    const es = groups.get(k).filter((e) => e.task === t.id);
    return pct(es.filter((e) => e.check.pass).length, es.length);
  });
  lines.push(`| ${t.id} | ${row.join(' | ')} |`);
}
const servedBy = [...new Set(episodes.map((e) => `${e.model} -> ${e.servedBy}`))].join(', ');
const md = `Run ${recorded?.when ?? new Date().toISOString()}${recorded ? ` (checks re-run ${new Date().toISOString()})` : ''}, ${values.trials} trials per task, models served as: ${servedBy}\n\n${lines.join('\n')}\n`;
mkdirSync('results', { recursive: true });
writeFileSync(`${values.out}.json`, JSON.stringify({ when: recorded?.when ?? new Date().toISOString(), rescored: recorded ? new Date().toISOString() : undefined, args: values, episodes }, null, 1));
writeFileSync(`${values.out}.md`, md);
console.log(md);
