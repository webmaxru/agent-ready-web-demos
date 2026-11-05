// Chapter 7: Designing tools agents can use.
// Two additions that come out of the chapter's checklist:
// 1. find_booking, the read-only tool the MCP server was missing. An agent can
//    show the guest what a cancellation means before it calls cancel_booking.
// 2. A "tool design" audit that lints the live tools/list answer of /mcp with
//    the same rules the chapter's eval harness uses (lint.js).
//
// This chapter comes before the interfaces it improves: the MCP server and the
// public API are Chapter 8, WebMCP is Chapter 9. So the layer only contributes
// to the shared MCP registry, which the Chapter 8 server reads on every request,
// and its audit lints /mcp only when that server is on. With --upto=7 nothing
// changes on the site; find_booking and the lint appear from --upto=8.
import * as z from 'zod/v4';
import { registerMcpTool } from '../08-mcp-server/registry.js';
import { bookingService } from '../08-public-api/service.js';
import { lintTools } from './lint.js';

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28' };
const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'nordlys-tool-lint', version: '1.0.0' },
};

export default {
  chapter: 7,
  order: 1,
  name: 'Tool design',
  description: 'find_booking for the MCP server, and a lint audit of every tool /mcp lists',

  register(app, ctx) {
    const { store } = ctx;
    const service = bookingService(ctx);

    registerMcpTool(
      ctx,
      'find_booking',
      {
        title: 'Find a booking',
        description:
          'Look up a booking by its reference and the email address it was made with. ' +
          'Use it before cancel_booking, so you can tell the user what they are cancelling and how much they get back. ' +
          'Returns found=false if the reference and email do not match, without saying which one is wrong.',
        inputSchema: z.object({
          ref: z.string().regex(/^NC-[0-9A-Z]{6}$/).describe('Booking reference from the confirmation email, for example NC-4KX9TQ'),
          email: z.email().describe('The email address the booking was made with'),
        }),
        outputSchema: z.object({
          found: z.boolean(),
          booking: z
            .object({
              ref: z.string(),
              status: z.enum(['confirmed', 'cancelled']),
              cabin: z.string(),
              checkIn: z.string(),
              checkOut: z.string(),
              guests: z.number().int(),
              total: z.number().int(),
              currency: z.literal('NOK'),
              page: z.string(),
            })
            .optional(),
          ifCancelledToday: z
            .object({ canCancelOnline: z.boolean(), refund: z.number().int(), freeCancellationUntil: z.string() })
            .optional(),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ ref, email }) => {
        const b = store.findBooking(ref, email);
        if (!b) {
          const value = { found: false };
          return { content: [{ type: 'text', text: 'No booking matches that reference and email address. Ask the user to check both.' }], structuredContent: value };
        }
        const { ref: r, status, cabin, checkIn, checkOut, guests, total, currency, page } = service.publicBooking(b);
        const policy = store.cancellationPolicy(b);
        const canCancelOnline = status === 'confirmed' && checkIn > store.today();
        const value = {
          found: true,
          booking: { ref: r, status, cabin, checkIn, checkOut, guests, total, currency, page },
          ifCancelledToday: { canCancelOnline, refund: canCancelOnline && policy.refundable ? total : 0, freeCancellationUntil: policy.freeUntil },
        };
        return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
      },
      { owner: '07-tool-design' }
    );

    ctx.audit('Tool design', async ({ request }) => {
      if (!ctx.layers.some((l) => l.id === '08-mcp-server'))
        return [{ id: 'tool-lint', ok: true, message: 'no MCP server yet (Chapter 8 adds it), nothing to lint' }];
      const res = await request('/mcp', {
        method: 'POST',
        headers: { ...MCP_HEADERS, 'mcp-method': 'tools/list' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } }),
      });
      if (res.status !== 200) return [{ id: 'tool-lint', ok: false, message: `tools/list answered ${res.status}` }];
      const body = await res.json();
      const tools = body.result?.tools ?? [];
      const findings = lintTools(tools);
      const errors = findings.filter((f) => f.level === 'error');
      return [
        { id: 'tool-lint-errors', ok: errors.length === 0, message: `${tools.length} tools, ${errors.length} errors${errors.length ? ': ' + errors.map((e) => `${e.tool} ${e.rule}`).join(', ') : ''}` },
        { id: 'tool-lint-warnings', ok: true, message: findings.filter((f) => f.level === 'warning').map((f) => `${f.tool}${f.param ? '.' + f.param : ''} ${f.rule}`).join(', ') || 'no warnings' },
      ];
    });
  },
};
