// Chapter 10: security for agent-facing sites.
// Guest text is cleaned at one boundary, every MCP tool needs a policy entry,
// booking reads are owner-only, each tool call is logged, and tool definitions are pinned.
import { registerMcpTool, mcpRegistry } from '../08-mcp-server/registry.js';
import { protectReviews, reviewsTool } from './reviews.js';
import { bookingTool } from './access.js';
import { mcpGateway } from './gateway.js';
import { TOOL_POLICY, ruleOfTwoViolations } from './policy.js';
import { toolFingerprints, readPins, diffPins } from './pins.js';

const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;
const AGENT_FORMATS = /^(text\/markdown|text\/plain|application\/json|application\/ld\+json)/;

/** tools/list through the real endpoint, the way any MCP client sees it. */
export async function listTools(request) {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'nordlys-audit', version: '1.0.0' },
  };
  const res = await request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } }),
  });
  return (await res.json()).result.tools;
}

export default {
  chapter: 10,
  order: 1,
  name: 'Security',
  description: 'Clean guest text once, owner-only booking reads, a policy for every MCP tool, an agent action log and pinned tool definitions',

  register(app, ctx) {
    protectReviews(ctx);
    reviewsTool(ctx, registerMcpTool);
    bookingTool(ctx, registerMcpTool);
    ctx.middleware(mcpGateway(ctx));

    // Defence in depth for formats only machines read: no invisible characters leave the site.
    ctx.middleware(async (c, next) => {
      await next();
      const type = c.res.headers.get('content-type') ?? '';
      if (!AGENT_FORMATS.test(type)) return;
      const body = await c.res.text();
      const clean = body.replace(INVISIBLE, '');
      const headers = new Headers(c.res.headers);
      headers.delete('content-length');
      c.res = new Response(clean, { status: c.res.status, headers });
    });

    ctx.audit('security: MCP tool policy', async () => {
      const registered = mcpRegistry(ctx).tools.map(([name]) => name);
      const missing = registered.filter((n) => !Object.hasOwn(TOOL_POLICY, n));
      const violations = ruleOfTwoViolations();
      return [
        { id: 'tool-policy-complete', ok: missing.length === 0, message: missing.length ? `no policy for: ${missing.join(', ')}` : 'every MCP tool has a policy entry' },
        { id: 'rule-of-two', ok: violations.length === 0, message: violations.length ? `all three properties in: ${violations.join(', ')}` : 'no tool combines untrusted input, sensitive data and a state change' },
      ];
    });

    ctx.audit('security: pinned tool definitions', async ({ request }) => {
      const changes = diffPins(toolFingerprints(await listTools(request)), await readPins());
      return [{ id: 'tools-pinned', ok: changes.length === 0,
        message: changes.length ? changes.map((x) => `${x.tool} ${x.change}`).join(', ') : 'tools/list matches tools.lock.json' }];
    });
  },
};
