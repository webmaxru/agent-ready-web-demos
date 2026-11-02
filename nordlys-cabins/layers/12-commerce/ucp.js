// The UCP documents Nordlys publishes: the business profile at /.well-known/ucp
// and the booking session object. DRAFT IMPLEMENTATION (see sessions.js).
export const UCP_VERSION = '2026-08-25'; // latest released UCP version
export const DRAFT_VERSION = '2026-10-31'; // the Lodging draft as we built against it
const DRAFT = 'https://ucp.dev/draft';

export function businessProfile(origin) {
  return {
    ucp: {
      version: UCP_VERSION,
      services: {
        'dev.ucp.lodging': [{
          version: DRAFT_VERSION,
          spec: `${DRAFT}/specification/overview/`,
          transport: 'rest',
          schema: `${DRAFT}/services/lodging/rest.openapi.json`,
          endpoint: `${origin}/ucp/v1`,
        }],
      },
      capabilities: {
        'dev.ucp.lodging.booking': [{
          version: DRAFT_VERSION,
          spec: `${DRAFT}/specification/lodging/booking/`,
          schema: `${DRAFT}/schemas/lodging/booking.json`,
        }],
        'dev.ucp.lodging.policy.cancellation': [{
          version: DRAFT_VERSION,
          extends: ['dev.ucp.lodging.booking'],
          spec: `${DRAFT}/specification/lodging/extensions/cancellation-policy/`,
          schema: `${DRAFT}/schemas/lodging/policy_cancellation.json`,
        }],
      },
      payment_handlers: {}, // no payment through agents: the guest pays on our site
    },
  };
}

/** A Nordlys session as a UCP booking session response. */
export function bookingSession(s, { origin, policy, minor }) {
  const q = s.quote;
  const totals = [
    { type: 'subtotal', amount: minor(q.accommodation) },
    { type: 'fee', display_text: 'Cleaning fee', amount: minor(q.cleaningFee) },
    { type: 'total', amount: minor(q.total) },
  ];
  const body = {
    ucp: {
      version: UCP_VERSION,
      status: 'success',
      capabilities: { 'dev.ucp.lodging.booking': [{ version: DRAFT_VERSION }] },
      payment_handlers: {},
    },
    id: s.id,
    status: s.status,
    property: {
      id: s.cabin.slug,
      name: s.cabin.name,
      address: { address_locality: s.cabin.region, address_country: 'NO' },
    },
    stays: [{
      id: `stay_${s.cabin.slug}`,
      accommodation_type: { id: 'whole-cabin', title: `${s.cabin.name}, whole cabin` },
      rate_plan: { id: 'flex', title: 'Flexible rate' },
      occupancy: { total: Number(s.input.guests) },
      stay_dates: { start_date: s.input.checkIn, end_date: s.input.checkOut },
      totals, // one cabin per session, so the stay total is the booking total
    }],
    currency: q.currency,
    totals,
    policies: [{
      type: 'dev.ucp.lodging.policy.cancellation',
      refundability: policy.refundable ? 'refundable' : 'non_refundable',
      description: {
        plain: policy.refundable
          ? `Free cancellation until ${policy.freeUntil}. After that the stay is not refunded.`
          : 'This stay starts within 14 days and is not refundable.',
      },
      url: `${origin}/faq`,
    }],
    links: [
      { type: 'terms_of_service', url: `${origin}/faq` },
      { type: 'privacy_policy', url: `${origin}/faq` },
    ],
  };
  if (s.status === 'requires_escalation') {
    body.messages = [{
      type: 'error',
      code: 'buyer_confirmation_required',
      severity: 'requires_buyer_review',
      content: 'Nordlys Cabins confirms every booking with the guest. Open continue_url to review the stay and confirm it.',
    }];
    body.continue_url = `${origin}/checkout/${s.id}`;
    body.expires_at = s.expiresAt.toISOString();
  }
  if (s.booker) body.booker = s.booker;
  if (s.status === 'completed') {
    body.confirmation = { id: s.booking.ref, label: s.booking.ref, permalink_url: `${origin}/bookings` };
  }
  return body;
}
