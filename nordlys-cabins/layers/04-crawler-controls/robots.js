import { tokensFor } from './agents.js';

const yn = (v) => (v ? 'yes' : 'no');

/** Content Signals (Cloudflare's policy, also read by isitagentready.com). */
export const contentSignal = (p) =>
  `search=${yn(p.search)}, ai-input=${yn(p.aiInput)}, ai-train=${yn(p.aiTrain)}`;

/** The IETF aipref vocabulary (draft-ietf-aipref-vocab-08): y or n per category. */
export const contentUsage = (p) =>
  `train-ai=${p.aiTrain ? 'y' : 'n'}, ai-use=${p.aiInput ? 'y' : 'n'}, search=${p.search ? 'y' : 'n'}`;

/** Build robots.txt from the policy. Every group repeats the signals, because a
 *  crawler reads only the one group that matches it best (RFC 9309, section 2.2.1). */
export function buildRobotsTxt(policy, { sitemapUrl }) {
  const signals = [`Content-Signal: ${contentSignal(policy)}`];
  if (policy.experimental?.contentUsage) signals.push(`Content-Usage: ${contentUsage(policy)}`);
  const disallow = (paths) => paths.map((p) => `Disallow: ${p}`);
  const groups = [];

  groups.push(['# Everyone else: search engines and AI search crawlers', 'User-agent: *', ...signals,
    'Allow: /', ...disallow([...policy.privatePaths, ...policy.transactionalPaths])]);

  if (policy.userAgents) {
    groups.push(['# Assistants fetching pages for a person: the booking flow is open',
      ...tokensFor('user').map((t) => `User-agent: ${t}`), ...signals, 'Allow: /', ...disallow(policy.privatePaths)]);
  }
  if (!policy.aiTrain) {
    groups.push(['# Training only: no', ...tokensFor('training').map((t) => `User-agent: ${t}`), ...signals, 'Disallow: /']);
    if (policy.experimental?.trainingGroup) groups.push(['# IETF aipref training preference (draft)', 'User-Agent: __usage_ai-training', 'Disallow: /']);
  }
  const header = ['# robots.txt for Nordlys Cabins, generated from layers/04-crawler-controls/policy.js',
    '# Content signals: https://contentsignals.org/', ''];
  return [...header, groups.map((g) => g.join('\n')).join('\n\n'), '', `Sitemap: ${sitemapUrl}`, ''].join('\n');
}
