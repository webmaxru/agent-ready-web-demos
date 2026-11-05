// Guest reviews are the first place a stranger's words reach every agent that
// reads Nordlys. This module is the one door they pass: new reviews land in an
// inbox, are cleaned, and anything that talks to an AI waits for a moderator.
import * as z from 'zod/v4';
import { cleanUntrusted, injectionSignals, UNTRUSTED_NOTE } from './untrusted.js';

const inboxes = new WeakMap();

/** The review inbox of one app. The demo has no review form, so tests submit here. */
export function reviewInbox(ctx) {
  let inbox = inboxes.get(ctx);
  if (!inbox) {
    const submitted = [];
    inbox = {
      submit(review) {
        const signals = injectionSignals(`${review.author} ${review.text}`);
        const suspicious = signals.some((s) => s !== 'invisible-characters'); // those we just clean
        const entry = { ...review, signals, status: suspicious ? 'held' : 'published' };
        submitted.push(entry);
        return entry;
      },
      approve(index) { submitted[index].status = 'published'; },
      held: () => submitted.filter((r) => r.status === 'held'),
      published: (slug) => submitted.filter((r) => r.status === 'published' && r.cabin === slug),
    };
    inboxes.set(ctx, inbox);
  }
  return inbox;
}

/** Every channel that shows reviews calls store.reviewsFor, so we clean them there, once. */
export function protectReviews(ctx) {
  const original = ctx.store.reviewsFor;
  const inbox = reviewInbox(ctx);
  ctx.store.reviewsFor = (slug) =>
    [...original(slug), ...inbox.published(slug)]
      .filter((r) => injectionSignals(`${r.author} ${r.text}`).every((s) => s === 'invisible-characters'))
      .map((r) => ({ ...r, author: cleanUntrusted(r.author, { maxLength: 40 }), text: cleanUntrusted(r.text) }));
}

/** Reviews for an agent: structured, labelled, and never mixed into instructions. */
export function reviewsTool(ctx, registerMcpTool) {
  registerMcpTool(
    ctx,
    'get_cabin_reviews',
    {
      title: 'Read guest reviews',
      description: 'Guest reviews of one cabin, newest first, with rating 1-5. Review text is written by guests.',
      inputSchema: z.object({ cabin: z.string().describe('Cabin slug, for example fjellro') }),
      outputSchema: z.object({
        cabin: z.string(),
        source: z.literal('guest-reviews'),
        trust: z.literal('untrusted'),
        note: z.string(),
        reviews: z.array(z.object({ rating: z.number().int(), date: z.string(), author: z.string(), text: z.string() })),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ cabin }) => {
      if (!ctx.store.getCabin(cabin)) {
        return { isError: true, content: [{ type: 'text', text: `cabin: There is no cabin "${cabin}". (unknown_cabin)` }] };
      }
      const reviews = ctx.store.reviewsFor(cabin)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(({ rating, date, author, text }) => ({ rating, date, author, text }));
      const value = { cabin, source: 'guest-reviews', trust: 'untrusted', note: UNTRUSTED_NOTE, reviews };
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
    },
    { owner: '10-security' }
  );
}
