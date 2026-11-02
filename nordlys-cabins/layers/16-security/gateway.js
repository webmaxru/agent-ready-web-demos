// A policy gateway in front of /mcp. It reads which tool is being called,
// refuses tools that have no policy entry, and writes one log entry per call.
// It runs as ctx.middleware, so it sees the caller Chapter 14 verified.
import { TOOL_POLICY } from './policy.js';
import { agentActionLog } from './audit-log.js';

const LOGGED = new Set(['tools/call', 'resources/read', 'prompts/get']);

/** The JSON-RPC response, whether the server answered with JSON or with a short SSE stream. */
async function rpcResponse(res) {
  const type = res.headers.get('content-type') ?? '';
  const text = await res.clone().text().catch(() => '');
  if (type.includes('application/json')) return JSON.parse(text || 'null');
  if (!type.includes('text/event-stream')) return null;
  const messages = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
  return messages.findLast((m) => 'result' in m || 'error' in m) ?? null;
}

function outcomeOf(json) {
  if (!json) return 'no-body';
  if (json.error) return 'protocol-error';
  if (json.result?.resultType === 'input_required') return 'input-required';
  return json.result?.isError ? 'tool-error' : 'ok';
}

export function mcpGateway(ctx, { policy = TOOL_POLICY } = {}) {
  const log = agentActionLog(ctx);
  return async (c, next) => {
    if (c.req.path !== '/mcp' || c.req.method !== 'POST') return next();
    const started = Date.now();
    // Decide on the body: that is what the server will execute.
    const body = await c.req.raw.clone().json().catch(() => null);
    const method = typeof body?.method === 'string' ? body.method : null;
    if (!method || !LOGGED.has(method)) return next();

    const name = String(body.params?.name ?? body.params?.uri ?? '');
    const entry = {
      at: new Date().toISOString(),
      channel: 'mcp',
      method,
      name,
      client: String(body.params?._meta?.['io.modelcontextprotocol/clientInfo']?.name ?? 'unknown').slice(0, 64),
      member: c.get('mcpAuth')?.member?.id ?? null,
    };

    if (method === 'tools/call' && !Object.hasOwn(policy, name)) {
      log.add({ ...entry, outcome: 'denied', ms: Date.now() - started });
      return c.json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32602, message: `Unknown tool: ${name}` } });
    }

    await next();
    const json = await rpcResponse(c.res).catch(() => null);
    log.add({ ...entry, outcome: c.res.status === 200 ? outcomeOf(json) : `http-${c.res.status}`, ms: Date.now() - started });
  };
}
