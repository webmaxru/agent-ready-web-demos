# Layer 12: Agent commerce (Chapter 12)

Makes Nordlys Cabins bookable by shopping agents without letting an agent pay.

- `/.well-known/ucp`: a Universal Commerce Protocol business profile (`ucp.version`
  2026-08-25) that advertises the **draft** Lodging service and the
  `dev.ucp.lodging.booking` capability with its cancellation-policy extension.
  `payment_handlers` is empty on purpose: guests pay on the site.
- `/ucp/v1/booking-sessions`: create, get, update, complete and cancel booking
  sessions shaped after the UCP Lodging draft. Every session answers
  `requires_escalation` with a `continue_url`, because without AP2 mandates the
  draft says a person finalises the booking in a trusted interface.
- `/checkout/:id`: the page behind `continue_url`. The guest reviews dates, guests,
  total and cancellation terms, and confirms. Only then does the store create the
  booking (`booking.created` with `via: 'ucp-checkout'`). Sessions expire after 15
  minutes. Nordlys does not hold inventory: availability is checked again on confirm.
- `/guide/premium/winter-routes` (only with `NORDLYS_X402_DEMO=1`): a teaching
  example of an x402 V2 `402 Payment Required` response on a test network. It never
  verifies or settles a payment.

**Draft implementation.** The Lodging capability exists only in the UCP draft. This
layer was written against commit `58c7ab9` of
https://github.com/Universal-Commerce-Protocol/ucp (31 Oct 2026) and pins the
Lodging service and capability to the version string `2026-10-31`, so no production
platform will negotiate with it by accident. The responses validate against that
commit's JSON Schemas.

Test: `node --test tests/ch12-*.test.js`
