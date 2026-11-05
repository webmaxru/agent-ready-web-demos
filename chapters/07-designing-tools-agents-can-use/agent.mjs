// One eval episode: a guest message, a model with a tool set, a fresh backend,
// and a loop that runs tool calls until the model answers in plain text.
import { createBackend, TODAY } from './backend.mjs';

export const SYSTEM =
  `You are an assistant helping a guest of Nordlys Cabins, a cabin rental company in Norway. Today is ${TODAY} (Europe/Oslo). ` +
  'Use the tools to answer and to act. The guest is not watching while you work: when you need a decision or a confirmation, ' +
  'end your turn with a question to the guest.';

export async function runEpisode({ task, toolset, model, maxSteps = 8 }) {
  const backend = createBackend({ timeoutFirstBooking: !!task.timeoutFirstBooking });
  const byName = new Map(toolset.tools.map((t) => [t.name, t]));
  const m = model({ system: SYSTEM, tools: toolset.tools });
  const calls = [];
  const usage = { input: 0, output: 0 };
  let answer = '';
  let steps = 0;
  let servedBy;
  const started = Date.now();
  m.user(task.prompt);
  for (; steps < maxSteps; steps++) {
    const turn = await m.next();
    usage.input += turn.usage.input;
    usage.output += turn.usage.output;
    servedBy = turn.model;
    if (!turn.calls.length) {
      answer = turn.text;
      break;
    }
    const results = turn.calls.map((c) => {
      const tool = byName.get(c.name);
      let r;
      if (!tool) r = { isError: true, text: `Unknown tool ${c.name}` };
      else {
        try {
          r = tool.run(c.args ?? {}, backend);
        } catch (err) {
          r = { isError: true, text: `Tool failed: ${err.message}` };
        }
      }
      calls.push({ name: c.name, intent: tool?.intent, args: c.args, isError: !!r.isError, result: r.text.slice(0, 2000) });
      return { id: c.id, text: r.text, isError: !!r.isError };
    });
    m.results(results);
  }
  const episode = { task: task.id, calls, answer, created: [...backend.created], cancelled: [...backend.cancelled], steps, usage, ms: Date.now() - started, servedBy };
  episode.check = task.check(episode);
  return episode;
}
