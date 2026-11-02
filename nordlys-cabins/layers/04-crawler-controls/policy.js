// Nordlys Cabins' access policy, decided by people before anyone writes robots.txt.
// One answer per purpose. The robots.txt and the headers are generated from it.
export const POLICY = {
  search: true, // classic search and AI search indexes: yes, bookings come from them
  aiInput: true, // content as input to AI answers (grounding, RAG): yes, with a link back
  aiTrain: false, // training generative models: no
  userAgents: true, // assistants fetching a page for a person right now: yes, incl. the booking flow

  // Paths no crawler needs. They are protected by sign-in or tokens anyway,
  // because robots.txt is a request, not access control.
  privatePaths: ['/account/', '/bookings/', '/login'],
  // Transactional pages: closed to crawlers, open to agents acting for a person.
  transactionalPaths: ['/book/'],

  // Drafts (November 2026). Off by default, see Chapter 4 "Still in flux".
  experimental: {
    contentUsage: false, // IETF aipref Content-Usage rule and header (draft-ietf-aipref-attach-05)
    trainingGroup: false, // User-Agent: __usage_ai-training (draft-kelley-aipref-training-preference-signal-00)
  },
};
