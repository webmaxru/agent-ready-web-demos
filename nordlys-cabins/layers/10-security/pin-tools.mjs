// Rewrite tools.lock.json from tools/list with every layer on.
// Run it after you reviewed a tool change:  node layers/10-security/pin-tools.mjs
import { writeFile } from 'node:fs/promises';
import { buildApp } from '../../tests/helpers/server.js';
import { listTools } from './index.js';
import { toolFingerprints, LOCKFILE } from './pins.js';

const { app } = await buildApp();
const tools = toolFingerprints(await listTools((path, init) => app.request(path, init)));
await writeFile(LOCKFILE, JSON.stringify({ note: 'Reviewed tool definitions. Regenerate with pin-tools.mjs after a review.', tools }, null, 2) + '\n');
console.log(`pinned ${Object.keys(tools).length} tools`);
