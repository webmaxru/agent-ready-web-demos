// The Chapter 13 decision helper as data: which agent interfaces a site should
// add, in which order, given what kind of site it is and what it already has.
// Each stage names the chapters that build it and the graders that see it.

export const STAGES = [
  {
    id: 'basics',
    title: 'Stage 1: be readable and reachable',
    interfaces: ['markup'],
    work: ['Semantic HTML, labels and a clean accessibility tree (Chapters 2 and 3)', 'robots.txt with AI user-agent rules and a sitemap (Chapter 4)', 'Link headers to your sitemap and key resources (Chapter 6)'],
    graders: { isitagentready: 'Level 1 (2 of 3: robots.txt, sitemap, Link headers)', lighthouse: ['agent-accessibility-tree', 'cumulative-layout-shift'] },
  },
  {
    id: 'policy',
    title: 'Stage 2: say what agents may do',
    interfaces: ['markup'],
    work: ['AI bot rules and Content Signals in robots.txt (Chapter 4)', 'structured data for your main entities (Chapter 5)'],
    graders: { isitagentready: 'Level 2 (Level 1 + AI bot rules and Content Signals)', lighthouse: [] },
  },
  {
    id: 'content',
    title: 'Stage 3: serve content agents can use cheaply',
    interfaces: ['content'],
    work: ['Markdown through content negotiation and llms.txt (Chapter 6)'],
    graders: { isitagentready: 'Level 3 (Level 2 + Markdown negotiation)', lighthouse: ['llms-txt'] },
  },
  {
    id: 'actions',
    title: 'Stage 4: offer actions',
    interfaces: ['api', 'mcp', 'webmcp'],
    work: ['A public API with OpenAPI and an API catalog (Chapter 7)', 'An MCP server with a server card (Chapters 8 and 11)', 'WebMCP tools on your forms and pages (Chapter 9)', 'Tool design and an eval (Chapter 10)'],
    graders: { isitagentready: 'Level 4 (Level 3 + 1 of: MCP Server Card, A2A Agent Card, Agent Skills, API Catalog)', lighthouse: ['webmcp-registered-tools', 'webmcp-form-coverage', 'webmcp-schema-validity', 'ard-schema'] },
  },
  {
    id: 'trust',
    title: 'Stage 5: know who is acting, and for whom',
    interfaces: ['api', 'mcp'],
    work: ['OAuth discovery and protected resource metadata (Chapter 14)', 'Web Bot Auth verification (Chapter 15)', 'Commerce protocols where they fit (Chapter 12)'],
    graders: { isitagentready: 'Level 5 (Level 4 + 2 of: Web Bot Auth, all four integration checks, auth metadata)', lighthouse: [] },
  },
];

/** Interfaces per site type: what to build, what to skip, and why. Order is priority. */
export const SITE_TYPES = {
  content: {
    label: 'Content site (publisher, docs, blog)',
    build: ['markup', 'content'],
    consider: ['nlweb', 'mcp'],
    skip: { webmcp: 'few actions to offer', a2a: 'no agent of your own to talk to' },
    stop: 'content',
    also: ['Verify signed agents and crawlers at your edge (Chapter 15). No grader counts it, but it is how the policy from Stage 2 gets enforced.'],
  },
  booking: {
    label: 'Booking site (rentals, restaurants, appointments)',
    build: ['markup', 'content', 'api', 'webmcp', 'mcp'],
    consider: ['a2a'],
    skip: { nlweb: 'a search box over six cabins is not worth an endpoint' },
    stop: 'trust',
  },
  saas: {
    label: 'SaaS application',
    build: ['markup', 'api', 'mcp', 'webmcp'],
    consider: ['a2a', 'content'],
    skip: { nlweb: 'your users ask your product, not your marketing pages' },
    stop: 'trust',
  },
  ecommerce: {
    label: 'E-commerce shop',
    build: ['markup', 'content', 'webmcp', 'api'],
    consider: ['mcp', 'a2a'],
    skip: {},
    stop: 'trust',
  },
};

/** What common platforms already ship, so you configure instead of build. */
export const PLATFORMS = {
  shopify: { covers: ['webmcp', 'api'], gives: ['a WebMCP adapter (search_catalog, add_to_cart, proceed_to_checkout and more)', 'a UCP commerce profile at /.well-known/ucp that points agents at the platform\'s checkout services', 'OAuth discovery and protected resource metadata'], note: 'observed on allbirds.com, brooklinen.com and kith.com, 2 Nov 2026' },
  wordpress: { gives: ['Abilities API (WordPress 6.9)', 'MCP through the official MCP Adapter plugin (v0.7.1, 16 Oct 2026)'], note: 'the adapter is a plugin you install and configure, not a default' },
  cloudflare: { covers: ['content'], gives: ['managed robots.txt with Content Signals', 'Markdown for Agents (beta, Pro, Business and Enterprise plans)'], note: 'zone settings, no code. llms.txt is still yours to write' },
  custom: { gives: [], note: 'everything is yours to build' },
};

export const INTERFACES = {
  markup: 'Markup: semantic HTML, accessibility tree, structured data',
  content: 'Content formats: Markdown negotiation, llms.txt, feeds',
  api: 'Public API (OpenAPI, or your platform\'s own API)',
  mcp: 'MCP server',
  webmcp: 'WebMCP tools in the page',
  a2a: 'A2A agent card and endpoint',
  nlweb: 'NLWeb-style natural-language endpoint',
  clicking: 'Agents clicking the human UI',
};

/** Build a plan: the stages up to the site type's stop, minus what the platform already gives. */
export function plan({ type, platform = 'custom', hasApi = false }) {
  const site = SITE_TYPES[type];
  if (!site) throw new Error(`Unknown site type "${type}". Use one of: ${Object.keys(SITE_TYPES).join(', ')}`);
  const given = PLATFORMS[platform] ?? PLATFORMS.custom;
  const last = STAGES.findIndex((s) => s.id === site.stop);
  const stages = STAGES.slice(0, last + 1).map((s) => ({
    ...s,
    interfaces: s.interfaces.filter((i) => site.build.includes(i) || site.consider.includes(i)),
  }));
  return {
    site: site.label,
    platformGives: given.gives,
    platformNote: given.note,
    build: site.build.filter((i) => !(hasApi && i === 'api') && !(given.covers ?? []).includes(i)).map((i) => INTERFACES[i]),
    configure: site.build.filter((i) => (given.covers ?? []).includes(i)).map((i) => INTERFACES[i]),
    consider: site.consider.map((i) => INTERFACES[i]),
    skip: Object.entries(site.skip).map(([i, why]) => `${INTERFACES[i]}: ${why}`),
    also: site.also ?? [],
    stages: stages.filter((s) => s.interfaces.length || s.id === 'basics' || s.id === 'policy' || s.id === 'trust'),
  };
}
