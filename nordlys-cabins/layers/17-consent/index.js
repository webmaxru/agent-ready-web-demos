// Chapter 17: privacy, consent and the human in the loop.
// Every agent-channel booking gets a record and a plain-language email, guests can
// see and export what agents did, raw agent logs expire, and request_booking keeps
// the guest's own confirmation on our site.
import { registerMcpTool, mcpRegistry } from '../08-mcp-server/registry.js';
import { agentActionLog } from '../16-security/audit-log.js';
import { recordAgentBookings } from './consent.js';
import { outbox, agentBookingNotice } from './outbox.js';
import { activityRoutes } from './activity.js';
import { pruneAgentLog } from './retention.js';
import { requestBookingTool } from './request-booking.js';

export default {
  chapter: 17,
  name: 'Privacy and consent',
  description: 'Records and emails for agent bookings, an agent-activity page with export, log retention, and a request_booking tool where the guest confirms on the site',

  register(app, ctx) {
    const origin = ctx.config.publicOrigin ?? 'https://nordlys.example';

    recordAgentBookings(ctx, {
      onRecord: (record, booking) => {
        const { freeUntil } = ctx.store.cancellationPolicy(booking);
        const cabinName = ctx.store.getCabin(booking.cabin)?.name;
        outbox(ctx).send(agentBookingNotice(record, booking, { origin, freeUntil, cabinName }));
      },
    });

    activityRoutes(ctx);

    // The tool calls the Chapter 12 booking-session API on this same app, on the
    // origin the MCP request came in on, so continue_url points where the guest is.
    requestBookingTool(ctx, registerMcpTool, (path, init, from = origin) => app.request(new URL(path, from), init));

    // Retention: drop raw agent-log entries past their period, once an hour.
    const timer = setInterval(() => pruneAgentLog(agentActionLog(ctx)), 3_600_000);
    timer.unref();

    ctx.audit('privacy: agent activity', async ({ request }) => {
      const page = await request('/account/agent-activity');
      const tools = mcpRegistry(ctx).tools.map(([name]) => name);
      return [
        { id: 'agent-activity-page', ok: page.status === 200, message: '/account/agent-activity answers' },
        { id: 'request-booking-tool', ok: tools.includes('request_booking') && tools.includes('check_booking_request'), message: 'request_booking and check_booking_request are registered' },
      ];
    });
  },
};
