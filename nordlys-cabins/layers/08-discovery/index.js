// Chapter 8: making capabilities discoverable.
// Publishes the discovery documents for what Chapter 8 built: an MCP
// Server Card, an Agent Skills index with one skill, an ARD manifest, an MCP
// entry in the API catalog, and a Link header that points at the ARD manifest.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { apiCatalog, CATALOG_PATH, LINKSET_TYPE } from '../08-public-api/catalog.js';

const SKILL = 'book-a-nordlys-cabin';
const skillFile = readFileSync(new URL(`./skills/${SKILL}/SKILL.md`, import.meta.url), 'utf8');
const MCP_CARD_TYPE = 'application/mcp-server-card+json';

export default {
  chapter: 8,
  order: 3,
  name: 'Discovery',
  description: 'MCP Server Card, Agent Skills index, ARD manifest and api-catalog entry for the MCP server',

  register(app, ctx) {
    const origin = (c) => ctx.absoluteUrl(c, '/').replace(/\/$/, '');
    const host = (c) => new URL(origin(c)).hostname;
    // The skill names the production host, so a copy fetched from anywhere still points at the right site.
    const skillBody = (c) => skillFile.replaceAll('https://nordlys.example', origin(c));
    const digest = (text) => 'sha256:' + createHash('sha256').update(text).digest('hex');

    // 1. MCP Server Card (MCP Server Card extension, SEP-2127): at <mcp-url>/server-card,
    //    the location the extension reserves, and mirrored at the path today's scanners probe.
    const serverCard = (c) => ({
      $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
      name: `${host(c).split('.').reverse().join('.')}/booking`,
      version: '1.0.0',
      title: 'Nordlys Cabins',
      description: 'Search Nordlys holiday cabins in Norway, check availability and exact prices, and book or cancel a stay.',
      websiteUrl: origin(c),
      repository: { url: 'https://github.com/webmaxru/agent-ready-web-demos', source: 'github', subfolder: 'nordlys-cabins/layers/08-mcp-server' },
      remotes: [{ type: 'streamable-http', url: `${origin(c)}/mcp`, supportedProtocolVersions: ['2025-11-25', '2026-07-28'] }],
    });
    ctx.staticFile('/mcp/server-card', (c) => JSON.stringify(serverCard(c), null, 2), { contentType: MCP_CARD_TYPE });
    ctx.staticFile('/.well-known/mcp/server-card.json', (c) => JSON.stringify(serverCard(c), null, 2));

    // 2. Agent Skills Discovery (v0.2.0): an index with name, type, description, url and a SHA-256 digest.
    ctx.staticFile(`/.well-known/agent-skills/${SKILL}/SKILL.md`, (c) => skillBody(c));
    ctx.staticFile('/.well-known/agent-skills/index.json', (c) =>
      JSON.stringify(
        {
          $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
          skills: [
            {
              name: SKILL,
              type: 'skill-md',
              description: 'Find, price and book a holiday cabin at Nordlys Cabins (Norway), or cancel a booking.',
              url: `/.well-known/agent-skills/${SKILL}/SKILL.md`,
              digest: digest(skillBody(c)),
            },
          ],
        },
        null,
        2
      )
    );

    // 3. ARD manifest (Agentic Resource Discovery v0.91) at /.well-known/ard.json.
    ctx.staticFile('/.well-known/ard.json', (c) =>
      JSON.stringify(
        {
          specVersion: '1.0',
          entries: [
            {
              identifier: `urn:air:${host(c)}:mcp:booking`,
              displayName: 'Nordlys Cabins booking',
              type: MCP_CARD_TYPE,
              url: `${origin(c)}/mcp/server-card`,
              description: 'MCP server for searching, pricing, booking and cancelling Nordlys holiday cabins in Norway.',
              tags: ['travel', 'lodging', 'booking', 'norway'],
              representativeQueries: [
                'find a cabin with a sauna in Lofoten for four people',
                'is the Fjellro cabin free from 2 to 5 December',
                'book a mountain cabin in Norway for a long weekend',
              ],
            },
            {
              identifier: `urn:air:${host(c)}:skill:${SKILL}`,
              displayName: 'Book a Nordlys cabin',
              type: 'application/agent-skills+md',
              url: `${origin(c)}/.well-known/agent-skills/${SKILL}/SKILL.md`,
              description: 'Step-by-step instructions for an agent that books a Nordlys cabin through the MCP server or the HTTP API.',
              representativeQueries: [
                'how do I book a Nordlys cabin for a customer',
                'cancel a Nordlys Cabins booking',
              ],
            },
          ],
        },
        null,
        2
      )
    );

    // 4. The API catalog from Chapter 8 gains an entry for the MCP endpoint.
    ctx.staticFile(
      CATALOG_PATH,
      (c) => {
        const catalog = apiCatalog(origin(c));
        catalog.linkset.push({ anchor: `${origin(c)}/mcp`, 'service-desc': [{ href: `${origin(c)}/mcp/server-card`, type: MCP_CARD_TYPE }] });
        return JSON.stringify(catalog, null, 2);
      },
      { replace: true, contentType: LINKSET_TYPE }
    );

    // 5. The home page links the ARD manifest (rel="ard"), after whatever earlier chapters linked.
    ctx.headers('/', (c) => {
      const earlier = c.res.headers.get('link');
      const ours = '</.well-known/ard.json>; rel="ard"';
      return { link: earlier ? `${earlier}, ${ours}` : ours };
    });

    ctx.audit('Discovery documents', async ({ request }) => {
      const card = await request('/mcp/server-card');
      const skills = await request('/.well-known/agent-skills/index.json');
      const ard = await request('/.well-known/ard.json');
      const index = skills.ok ? await skills.json() : null;
      const skill = await request(index?.skills?.[0]?.url ?? '/missing');
      return [
        { id: 'server-card', ok: card.ok && (card.headers.get('content-type') ?? '').startsWith(MCP_CARD_TYPE) },
        { id: 'skill-digest', ok: skill.ok && digest(await skill.text()) === index.skills[0].digest },
        { id: 'ard', ok: ard.ok && (await ard.json()).entries.length > 0 },
      ];
    });
  },
};
