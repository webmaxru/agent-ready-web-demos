// Compare the size of the HTML and Markdown versions of a few pages.
//   node layers/05-agent-content/token-compare.js
// Uses gpt-tokenizer (o200k_base) when it is installed
// (npm install --no-save gpt-tokenizer@4.1.0), else estimates 4 characters per token.
import { createApp } from '../../src/app.js';

let count = (s) => Math.ceil(s.length / 4);
let method = 'estimate (4 characters per token)';
try {
  const { countTokens } = await import('gpt-tokenizer');
  count = countTokens;
  method = 'gpt-tokenizer, o200k_base';
} catch {}

const { app } = await createApp({ overrides: { upto: 6, now: '2026-11-10', publicOrigin: 'https://nordlys.example' } });
const pages = ['/', '/cabins/fjellro', '/guide/northern-lights-from-a-cabin', '/faq'];
console.log(`Tokens by ${method}`);
console.log('page'.padEnd(40), 'HTML'.padStart(7), 'Markdown'.padStart(9), 'saved'.padStart(7));
for (const path of pages) {
  const html = await (await app.request(path)).text();
  const md = await (await app.request(path, { headers: { accept: 'text/markdown' } })).text();
  const [h, m] = [count(html), count(md)];
  console.log(path.padEnd(40), String(h).padStart(7), String(m).padStart(9), `${Math.round((1 - m / h) * 100)}%`.padStart(7));
}
