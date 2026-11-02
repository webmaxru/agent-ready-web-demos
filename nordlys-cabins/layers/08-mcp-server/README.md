# Layer 08: MCP server

Chapter 8 of *The Agent-Ready Web*. Mounts a remote MCP server at `/mcp`
(Streamable HTTP, protocol revision 2026-07-28, TypeScript SDK v2
`@modelcontextprotocol/server` 2.4.0). It also answers 2025-era clients that
start with `initialize`.

| Primitive | Name | Notes |
| --- | --- | --- |
| tool | `search_cabins` | read-only |
| tool | `check_availability` | read-only, returns the exact quote |
| tool | `create_booking` | idempotent per `idempotencyKey` |
| tool | `cancel_booking` | destructive |
| resource | `nordlys://guide/{slug}` | guide articles as Markdown |
| resource | `nordlys://policies/cancellation` | |
| prompt | `plan_cabin_trip` | |

Every tool calls the booking service of Chapter 7
(`layers/07-public-api/service.js`), so the API and the MCP server give the same
answers and share idempotency keys and domain events (`via: 'mcp'`).

## Adding tools from a later chapter

Do not edit this folder. Import the registry and register from your own layer:

```js
import * as z from 'zod/v4';
import { registerMcpTool } from '../08-mcp-server/registry.js';

registerMcpTool(ctx, 'list_my_bookings', {
  description: 'List the signed-in guest\'s bookings',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async (args, extra) => {
  // extra = { auth, request, ctx, store, sdk }
  return { content: [{ type: 'text', text: extra.auth ? 'your bookings' : 'please sign in' }] };
}, { owner: '14-oauth' });
```

`registerMcpResource(ctx, name, uri, metadata, read)` and
`registerMcpPrompt(ctx, name, config, build)` work the same way. The handler
builds a fresh server for every request, so a tool registered at any time is
listed on the next request, after the Chapter 8 tools (the order is stable).

## Protecting /mcp (Chapter 14)

The SDK handler checks no token. Verify the bearer token in a middleware of your
own layer and store the result on the request:

```js
ctx.middleware(async (c, next) => {
  if (c.req.path === '/mcp') c.set('mcpAuth', await verify(c.req.header('authorization')));
  await next();
});
```

The value reaches every tool handler as `extra.auth` (and the SDK's own
`ctx.http.authInfo`). `create_booking` already reads `extra.auth?.member`.

## Try it

```sh
npm start -- --upto=8
npx @modelcontextprotocol/inspector@2.13.0     # then connect to http://127.0.0.1:3000/mcp
node --test tests/ch08-*.test.js
```
