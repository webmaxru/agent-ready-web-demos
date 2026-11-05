// Three ways to get a model's next move: the OpenAI Chat Completions API, the
// Anthropic Messages API, and a scripted mock for tests. Each returns
// { text, calls: [{ id, name, args }], usage } and keeps its own message history.

const env = (k, d) => process.env[k] ?? d;

async function post(url, headers, body, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    if (res.ok) return res.json();
    if (attempt >= retries || ![429, 500, 502, 503, 504, 529].includes(res.status)) throw new Error(`${url} answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

function openai(model, { system, tools }) {
  const base = env('OPENAI_BASE_URL', 'https://api.openai.com/v1');
  const messages = [{ role: 'system', content: system }];
  const fns = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  return {
    user(text) {
      messages.push({ role: 'user', content: text });
    },
    results(rs) {
      for (const r of rs) messages.push({ role: 'tool', tool_call_id: r.id, content: r.text });
    },
    async next() {
      const body = await post(`${base}/chat/completions`, { authorization: `Bearer ${env('OPENAI_API_KEY')}` }, { model, messages, tools: fns });
      const msg = body.choices[0].message;
      messages.push(msg);
      const calls = (msg.tool_calls ?? []).map((c) => {
        let args;
        try {
          args = JSON.parse(c.function.arguments || '{}');
        } catch {
          args = { __unparsed: c.function.arguments };
        }
        return { id: c.id, name: c.function.name, args };
      });
      return { text: msg.content ?? '', calls, usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 }, model: body.model };
    },
  };
}

function anthropic(model, { system, tools }) {
  const base = env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com/v1');
  const messages = [];
  const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  return {
    user(text) {
      messages.push({ role: 'user', content: text });
    },
    results(rs) {
      messages.push({ role: 'user', content: rs.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) })) });
    },
    async next() {
      const body = await post(`${base}/messages`, { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }, { model, max_tokens: 2000, system, messages, tools: defs });
      messages.push({ role: 'assistant', content: body.content });
      const text = body.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = body.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
      return { text, calls, usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 }, model: body.model };
    },
  };
}

/**
 * A scripted model for tests: script is a list of turns, each either
 * { calls: [{ name, args }] } or { text }. It ignores the conversation.
 */
export function mockModel(script) {
  return () => {
    let i = 0;
    return {
      user() {},
      results() {},
      async next() {
        const turn = script[Math.min(i++, script.length - 1)];
        return { text: turn.text ?? '', calls: (turn.calls ?? []).map((c, n) => ({ id: `call_${i}_${n}`, ...c })), usage: { input: 0, output: 0 }, model: 'mock' };
      },
    };
  };
}

/** Pick the provider from the model name. */
export function modelFor(name) {
  if (typeof name === 'function') return name;
  return (opts) => (name.startsWith('claude') ? anthropic(name, opts) : openai(name, opts));
}
