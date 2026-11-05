---
name: book-a-nordlys-cabin
description: Find, price and book a holiday cabin at Nordlys Cabins (Norway). Use when a user wants to rent a cabin in Rondane, Lyngen, Senja, Lofoten, Hardanger or Femunden, check if a cabin is free, or cancel a Nordlys booking.
---

# Book a Nordlys cabin

Nordlys Cabins rents six holiday cabins in Norway. You can work with it in two
ways. Use whichever your environment supports, they share the same data.

- MCP server: `https://nordlys.example/mcp` (Streamable HTTP). Tools:
  `search_cabins`, `check_availability`, `create_booking`, `cancel_booking`.
- HTTP API: `https://nordlys.example/openapi.json` (OpenAPI 3.1). Operations:
  `searchCabins`, `getCabin`, `checkAvailability`, `createBooking`, `cancelBooking`.

## Steps

1. Ask for what you do not know yet: region or wishes, dates, number of guests.
2. Search. Pass both dates so you only get cabins that are free.
3. Check availability for the cabin the user likes. Tell the user the total price
   in NOK and what it includes (nights and one cleaning fee).
4. Before booking, confirm cabin, dates, guests, total and the lead guest's name
   and email. Ask the user to accept the booking terms (https://nordlys.example/faq).
   Never accept the terms on the user's behalf.
5. Book with a new idempotency key (a UUID). If the call times out, retry with the
   same key: you get the same booking back, not a second one.
6. Give the user the booking reference (it starts with `NC-`) and the free-cancellation date.

## Rules

- Dates are YYYY-MM-DD in Europe/Oslo. Check-in is 16:00, check-out 11:00.
- Friday and Saturday nights cost more. The cleaning fee is added once per stay.
- Free cancellation ends 14 days before check-in. Cancelling cannot be undone:
  always ask first.
- Errors carry a stable `code` (for example `min_nights`, `too_many_guests`,
  `not_available`). Explain the problem to the user and suggest a fix instead of
  retrying blindly.
