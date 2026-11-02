// The API catalog document (RFC 9727): a Linkset that lists the site's APIs.
// Chapter 7 publishes it for the public API, Chapter 11 adds the MCP server.

export const CATALOG_PATH = '/.well-known/api-catalog';
export const LINKSET_TYPE = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

export function apiCatalog(origin) {
  return {
    linkset: [
      {
        anchor: `${origin}/api/v1`,
        'service-desc': [{ href: `${origin}/openapi.json`, type: 'application/json' }],
        'service-doc': [{ href: `${origin}/developers.md`, type: 'text/markdown' }],
        'service-meta': [{ href: `${origin}/api/v1/booking.arazzo.json`, type: 'application/json' }],
        status: [{ href: `${origin}/api/v1/health`, type: 'application/json' }],
      },
    ],
  };
}
