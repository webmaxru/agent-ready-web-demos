// The extension point of the Nordlys MCP server.
// Later chapters add tools, resources and prompts here without editing this
// layer: Chapter 14 (OAuth) puts the verified caller into every handler's
// `auth` and adds tools for signed-in guests, Chapters 16 and 17 add guarded
// and confirmed tools.
//
//   import { registerMcpTool } from '../08-mcp-server/registry.js';
//   registerMcpTool(ctx, 'list_my_bookings', { description, inputSchema, annotations }, async (args, extra) => ...);
//
// The MCP handler builds a fresh server per request (the 2026-07-28 protocol is
// stateless), so anything registered here is live on the next request.

const registries = new WeakMap();

function registry(ctx) {
  let r = registries.get(ctx);
  if (!r) {
    r = { tools: new Map(), resources: new Map(), prompts: new Map() };
    registries.set(ctx, r);
  }
  return r;
}

const add = (map, kind, name, entry) => {
  if (map.has(name)) throw new Error(`MCP ${kind} "${name}" is already registered by layer ${map.get(name).owner}`);
  map.set(name, entry);
};

/**
 * Register a tool. Same arguments as McpServer.registerTool, except that the
 * handler receives a second argument: { auth, request, ctx, store, sdk }.
 * auth is whatever a later layer verified (Chapter 14), or null.
 */
export function registerMcpTool(ctx, name, config, handler, { owner = 'unknown' } = {}) {
  add(registry(ctx).tools, 'tool', name, { config, handler, owner });
}

/** Register a resource: uri is a string or a ResourceTemplate, read(uri, vars, extra). */
export function registerMcpResource(ctx, name, uri, metadata, read, { owner = 'unknown' } = {}) {
  add(registry(ctx).resources, 'resource', name, { uri, metadata, read, owner });
}

/** Register a prompt: build(args, extra) returns { messages }. */
export function registerMcpPrompt(ctx, name, config, build, { owner = 'unknown' } = {}) {
  add(registry(ctx).prompts, 'prompt', name, { config, build, owner });
}

/** Everything registered so far, in registration order (tools/list stays deterministic). */
export function mcpRegistry(ctx) {
  const r = registry(ctx);
  return { tools: [...r.tools], resources: [...r.resources], prompts: [...r.prompts] };
}
