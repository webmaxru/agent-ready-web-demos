// The Nordlys tools, resources and prompt. Every handler calls the same
// booking service as the public API (layers/08-public-api/service.js).
import * as z from 'zod/v4';
import { ResourceTemplate } from '@modelcontextprotocol/server';
import { bookingService } from '../08-public-api/service.js';
import { registerMcpTool, registerMcpResource, registerMcpPrompt } from './registry.js';

const OWNER = { owner: '08-mcp-server' };
const date = (what) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(`${what} date, YYYY-MM-DD (Europe/Oslo)`);

/** A tool result with both renderings: text for the model, structuredContent for code. */
const ok = (value, text) => ({ content: [{ type: 'text', text: text ?? JSON.stringify(value) }], structuredContent: value });
/** A tool error the model can act on: every field problem with its stable code. */
const failed = (errors) => ({
  isError: true,
  content: [{ type: 'text', text: errors.map((e) => `${e.field}: ${e.message} (${e.code})`).join('\n') }],
});

const CabinSummary = z.object({
  slug: z.string(),
  name: z.string(),
  region: z.string(),
  summary: z.string(),
  maxGuests: z.number().int(),
  features: z.array(z.string()),
  nightlyRate: z.number().int(),
  weekendRate: z.number().int(),
  cleaningFee: z.number().int(),
  currency: z.literal('NOK'),
  minNights: z.number().int(),
  page: z.string(),
});

const Booking = z.object({
  ref: z.string(),
  status: z.enum(['confirmed', 'cancelled']),
  cabin: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.number().int(),
  total: z.number().int(),
  currency: z.literal('NOK'),
  freeCancellationUntil: z.string(),
  refund: z.number().int().optional(),
  page: z.string(),
});

export function registerNordlysTools(ctx) {
  const service = bookingService(ctx);
  const regions = ctx.store.regions().map((r) => r.name);
  const features = Object.keys(ctx.store.features());

  registerMcpTool(
    ctx,
    'search_cabins',
    {
      title: 'Search cabins',
      description:
        'Find Nordlys cabins that match what the user wants. All filters are optional. ' +
        'Give both checkIn and checkOut to get only cabins that are free for the whole stay. Prices are NOK per night.',
      inputSchema: z.object({
        region: z.enum(regions).optional().describe('Region in Norway'),
        guests: z.number().int().min(1).max(8).optional().describe('Number of guests, children included'),
        checkIn: date('Arrival').optional(),
        checkOut: date('Departure').optional(),
        features: z.array(z.enum(features)).optional().describe('Features the cabin must have'),
        maxNightlyRate: z.number().int().positive().optional().describe('Highest weekday nightly rate in NOK'),
      }),
      outputSchema: z.object({ count: z.number().int(), cabins: z.array(CabinSummary) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const cabins = service
        .searchCabins({ ...args, maxPrice: args.maxNightlyRate })
        .map(({ bedrooms, ...c }) => c);
      return ok({ count: cabins.length, cabins });
    },
    OWNER
  );

  registerMcpTool(
    ctx,
    'check_availability',
    {
      title: 'Check availability and price',
      description:
        'Check if one cabin is free for a stay and get the exact total price. ' +
        'Call this before create_booking and tell the user the total. available=false means the dates are taken.',
      inputSchema: z.object({
        cabin: z.string().describe('Cabin slug from search_cabins, for example fjellro'),
        checkIn: date('Arrival'),
        checkOut: date('Departure'),
        guests: z.number().int().min(1),
      }),
      outputSchema: z.object({
        cabin: z.string(),
        checkIn: z.string(),
        checkOut: z.string(),
        guests: z.number().int(),
        available: z.boolean(),
        conflicts: z.array(z.object({ from: z.string(), to: z.string() })),
        quote: z.object({ currency: z.literal('NOK'), nights: z.number().int(), accommodation: z.number().int(), cleaningFee: z.number().int(), total: z.number().int() }),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      const r = service.checkAvailability(args);
      return r.ok ? ok(r.value) : failed(r.errors);
    },
    OWNER
  );

  registerMcpTool(
    ctx,
    'create_booking',
    {
      title: 'Book a cabin',
      description:
        'Book a cabin for the lead guest. Only call this after the user confirmed the cabin, dates, guests and the total from check_availability, ' +
        'and accepted the booking terms. Use a new idempotencyKey (a UUID) per booking, and the same one again if you retry.',
      inputSchema: z.object({
        cabin: z.string(),
        checkIn: date('Arrival'),
        checkOut: date('Departure'),
        guests: z.number().int().min(1),
        name: z.string().min(1).describe('Full name of the lead guest'),
        email: z.email().describe('Where the confirmation goes'),
        phone: z.string().optional(),
        requests: z.string().max(1000).optional().describe('Wishes for the host'),
        acceptTerms: z.literal(true).describe('The user accepted the booking terms. Never set this without asking.'),
        idempotencyKey: z.string().min(8).describe('A UUID that identifies this booking attempt'),
      }),
      outputSchema: Booking,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ idempotencyKey, ...input }, extra) => {
      const r = service.createBooking(input, { idempotencyKey, via: 'mcp', member: extra.auth?.member ?? null });
      if (!r.ok) return failed(r.errors);
      const { name, ...booking } = r.value;
      return ok(booking, `Booked ${booking.cabin} from ${booking.checkIn} to ${booking.checkOut}. Reference ${booking.ref}, total ${booking.total} NOK.`);
    },
    OWNER
  );

  registerMcpTool(
    ctx,
    'cancel_booking',
    {
      title: 'Cancel a booking',
      description:
        'Cancel a booking. This cannot be undone, so ask the user to confirm first. ' +
        'Cancellation is free until 14 days before check-in, the result says how much is refunded.',
      inputSchema: z.object({
        ref: z.string().regex(/^NC-[0-9A-Z]{6}$/).describe('Booking reference, for example NC-4KX9TQ'),
        email: z.email().describe('The email address the booking was made with'),
      }),
      outputSchema: Booking,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const r = service.cancelBooking(args, { via: 'mcp' });
      if (!r.ok) return failed(r.errors);
      const { name, ...booking } = r.value;
      return ok(booking, `Cancelled ${booking.ref}. Refund: ${booking.refund} NOK.`);
    },
    OWNER
  );

  // Resources: the cabin guide articles, as Markdown, and the cancellation policy.
  const toMarkdown = (a) =>
    [`# ${a.title}`, '', a.description, '', ...a.blocks.map((b) => (b.type === 'h2' ? `## ${b.text}` : b.type === 'ul' ? b.items.map((i) => `- ${i}`).join('\n') : b.text))].join('\n\n');

  registerMcpResource(
    ctx,
    'guide-article',
    new ResourceTemplate('nordlys://guide/{slug}', {
      list: async () => ({
        resources: ctx.store.articles().map((a) => ({ uri: `nordlys://guide/${a.slug}`, name: a.title, description: a.description, mimeType: 'text/markdown' })),
      }),
    }),
    { title: 'Cabin guide article', description: 'Practical travel advice from the Nordlys Cabins guide', mimeType: 'text/markdown' },
    async (uri, { slug }) => {
      const article = ctx.store.getArticle(String(slug));
      if (!article) throw new Error(`No guide article ${uri.href}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: toMarkdown(article) }] };
    },
    OWNER
  );

  registerMcpResource(
    ctx,
    'cancellation-policy',
    'nordlys://policies/cancellation',
    { title: 'Cancellation policy', description: 'When a cancellation is free and what is refunded', mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: '# Cancellation policy\n\nCancellation is free until 14 days before check-in, and the full total is refunded. ' +
          'Later cancellations are possible until the day before check-in, without a refund. A stay that has started cannot be cancelled online.',
      }],
    }),
    OWNER
  );

  // A prompt: a person picks it in their MCP host to start a trip plan.
  registerMcpPrompt(
    ctx,
    'plan_cabin_trip',
    {
      title: 'Plan a cabin trip',
      description: 'Find and compare Nordlys cabins for a trip, then help book one',
      argsSchema: z.object({
        when: z.string().describe('When you want to travel, for example "a long weekend in February"'),
        guests: z.string().describe('How many people'),
        wishes: z.string().optional().describe('Anything that matters: sauna, northern lights, pets, budget'),
      }),
    },
    ({ when, guests, wishes }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Help me plan a cabin trip with Nordlys Cabins for ${guests} people, ${when}.` +
            (wishes ? ` What matters to us: ${wishes}.` : '') +
            ' Use search_cabins and check_availability to suggest two or three cabins with exact prices. Do not book anything until I confirm.',
        },
      }],
    }),
    OWNER
  );
}
