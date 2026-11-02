#!/usr/bin/env node
// Start Nordlys Cabins.
//   npm start                              clean front end, every layer
//   npm start -- --upto=4                  only the layers for chapters 0-4
//   npm start -- --variant=legacy --upto=0 the agent-hostile baseline from Chapter 2
//   PORT=8080 UPTO=9 VARIANT=clean npm start
import { serve } from '@hono/node-server';
import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const { app, layers } = await createApp({ config });

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const host = info.address === '::' || info.address === '0.0.0.0' ? 'localhost' : info.address;
  const upto = Number.isFinite(config.upto) ? `chapters 0-${config.upto}` : 'all chapters';
  console.log(`Nordlys Cabins (${config.variant} front end, layers for ${upto}${config.now ? `, today is ${config.now}` : ''})`);
  console.log(layers.length ? `Layers: ${layers.map((l) => l.id).join(', ')}` : 'Layers: none');
  console.log(`Listening on http://${host}:${info.port}`);
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received, closing the server`);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
