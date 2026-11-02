// A record of every booking an agent made or prepared: who agreed to what, through
// which channel and which agent, and what Nordlys told the guest about it.
// This is the evidence a guest, a host or a regulator asks for first.
//
// Legal note (not legal advice): the lawful basis for processing a booking is the
// contract (GDPR Art. 6(1)(b)), not consent. What this record proves is that the
// guest, or their agent with their authority, asked for the booking and accepted
// the terms, and that we told them an agent was involved.

const ledgers = new WeakMap();

/** Channels where a program, not our own web form, sent the booking. */
// The words are written for the guest: they appear in the email and on the activity page.
export const AGENT_CHANNELS = {
  mcp: 'An AI assistant made this booking for you through our MCP server',
  api: 'A program made this booking for you through our API',
  'ucp-checkout': 'An AI assistant prepared this booking and you confirmed it on nordlys.example',
};

export const TERMS_VERSION = '2026-09-01'; // the version of /faq#cancellation in force (demo value)

export function bookingRecords(ctx) {
  let ledger = ledgers.get(ctx);
  if (!ledger) {
    const records = [];
    ledger = {
      add(record) { records.push(record); return record; },
      forRef: (ref) => records.find((r) => r.ref === ref) ?? null,
      forEmail: (email) => records.filter((r) => r.email === String(email).trim().toLowerCase()),
      forMember: (id) => records.filter((r) => r.memberId === id),
      all: () => [...records],
    };
    ledgers.set(ctx, ledger);
  }
  return ledger;
}

/** Record every agent-channel booking. Called once per app from the layer. */
export function recordAgentBookings(ctx, { onRecord = () => {} } = {}) {
  ctx.events.on('booking.created', (booking, meta = {}) => {
    const via = meta.via;
    if (!AGENT_CHANNELS[via]) return; // our own form: the guest was on the page
    const record = bookingRecords(ctx).add({
      ref: booking.ref,
      at: new Date().toISOString(),
      email: booking.email,
      memberId: booking.memberId ?? null,
      channel: via,
      agent: meta.agent ?? null,
      what: AGENT_CHANNELS[via],
      confirmedBy: via === 'ucp-checkout' ? 'you, on nordlys.example' : 'the assistant, which accepted the terms for you',
      termsVersion: TERMS_VERSION,
      dataReceived: ['name', 'email', 'dates', 'guests', ...(booking.phone ? ['phone'] : []), ...(booking.requests ? ['requests'] : [])],
    });
    onRecord(record, booking);
  });
}
