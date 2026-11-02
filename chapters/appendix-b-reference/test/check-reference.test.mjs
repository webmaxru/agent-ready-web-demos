// Boots Nordlys Cabins with every layer and checks it against the Appendix B tables.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSite } from '../check-reference.mjs';

const serverDir = fileURLToPath(new URL('../../../nordlys-cabins/', import.meta.url));
let server;
let base;

before(async () => {
  const port = 3200 + Math.floor(Math.random() * 500);
  server = spawn(process.execPath, ['server.js', `--port=${port}`], {
    cwd: serverDir,
    env: { ...process.env, PUBLIC_ORIGIN: 'https://nordlys.example' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout.on('data', (chunk) => {
      const m = String(chunk).match(/Listening on (http:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => server?.kill());

test('Nordlys serves what Appendix B says it serves, and skips what it skips', async () => {
  const rows = await checkSite(base);
  const present = new Set(rows.filter((r) => r.ok).map((r) => r.item));

  const served = [
    '/robots.txt', '/sitemap.xml', '/llms.txt', '/openapi.json',
    '/.well-known/api-catalog', '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server',
    '/.well-known/mcp/server-card.json', '/mcp/server-card', '/.well-known/ard.json',
    '/.well-known/agent-skills/index.json', '/.well-known/ucp',
    'robots.txt User-agent:', 'robots.txt Sitemap:', 'robots.txt Content-Signal:',
    'Link (homepage)', 'Accept: text/markdown -> Content-Type', 'Vary: Accept',
    'POST /mcp tools/list with Mcp-Method', 'application/problem+json (API 404)',
    'ratelimit-policy (/api/v1/cabins)', 'ratelimit (/api/v1/cabins)',
  ];
  for (const item of served) assert.ok(present.has(item), `expected ${item}`);

  const skipped = [
    '/.well-known/http-message-signatures-directory', // Nordlys sends no bot traffic
    '/.well-known/agent-card.json', // Nordlys runs no agent of its own
    '/.well-known/acp.json', // UCP is the commerce profile it chose
    '/.well-known/ai-catalog.json', // legacy ARD location
  ];
  for (const item of skipped) assert.ok(!present.has(item), `did not expect ${item}`);
});

test('the homepage Link header carries the relations from Table B.5', async () => {
  const rows = await checkSite(base);
  const link = rows.find((r) => r.item === 'Link (homepage)');
  for (const rel of ['api-catalog', 'alternate', 'describedby', 'ard']) {
    assert.match(link.detail, new RegExp(`\\b${rel}\\b`));
  }
});
