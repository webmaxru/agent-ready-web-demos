// Chapter 8: server-side tools with the Model Context Protocol.
// Mounts a stateless MCP server (protocol 2026-07-28, TypeScript SDK v2) at /mcp.
// It shares the booking service with the public API from Chapter 8.
import { createMcpHandler, originValidationResponse } from '@modelcontextprotocol/server';
import { createNordlysServer } from './server.js';
import { registerNordlysTools } from './tools.js';

export default {
  chapter: 8,
  order: 2,
  name: 'MCP server',
  description: 'Remote MCP server at /mcp: four tools, guide resources and a prompt over the same booking service as the API',

  register(app, ctx) {
    registerNordlysTools(ctx);

    const handler = createMcpHandler((requestContext) => createNordlysServer(ctx, requestContext));

    ctx.mcp(async (c) => {
      // The SDK handler checks no Origin, Host or token itself. Browsers send an
      // Origin header: only our own site may call /mcp from a web page.
      const ownHost = new URL(ctx.absoluteUrl(c, '/')).hostname;
      const rejected = originValidationResponse(c.req.raw, [ownHost, new URL(c.req.url).hostname]);
      if (rejected) return rejected;
      // A later layer (Chapter 11) verifies a bearer token and stores the result
      // with c.set('mcpAuth', authInfo). Until then every caller is anonymous.
      return handler.fetch(c.req.raw, { authInfo: c.get('mcpAuth') ?? undefined });
    });

    ctx.audit('MCP endpoint', async ({ request }) => {
      const res = await request('/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'server/discover',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'server/discover',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'nordlys-audit', version: '1.0.0' },
            },
          },
        }),
      });
      return [{ id: 'mcp-answers', ok: res.status === 200, message: `POST /mcp server/discover answered ${res.status}` }];
    });
  },
};
