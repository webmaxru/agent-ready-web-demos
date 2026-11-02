// Builds the Nordlys MCP server. createMcpHandler calls this once per HTTP
// request, so the server holds no state between requests and any instance
// behind a load balancer can answer any call.
import { McpServer } from '@modelcontextprotocol/server';
import { mcpRegistry } from './registry.js';

const INSTRUCTIONS =
  'Nordlys Cabins rents holiday cabins in Norway. Use search_cabins to find cabins, check_availability to get the exact price, ' +
  'and create_booking only after the user confirmed the cabin, dates, guests and total. Prices are NOK. Dates are YYYY-MM-DD in Europe/Oslo. ' +
  'Free cancellation ends 14 days before check-in.';

export function createNordlysServer(ctx, { authInfo, requestInfo } = {}) {
  const server = new McpServer({ name: 'nordlys-cabins', title: 'Nordlys Cabins', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const extra = { auth: authInfo ?? null, request: requestInfo ?? null, ctx, store: ctx.store };
  const { tools, resources, prompts } = mcpRegistry(ctx);

  for (const [name, { config, handler }] of tools) {
    server.registerTool(name, config, (args, sdk) => handler(args, { ...extra, sdk }));
  }
  for (const [name, { uri, metadata, read }] of resources) {
    server.registerResource(name, uri, metadata, (u, vars, sdk) => read(u, vars ?? {}, { ...extra, sdk }));
  }
  for (const [name, { config, build }] of prompts) {
    server.registerPrompt(name, config, (args, sdk) => build(args, { ...extra, sdk }));
  }
  return server;
}
