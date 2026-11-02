// One label per request, from the strongest evidence available:
// a verified signature > a confirmed network > a User-Agent claim > nothing.
const KNOWN_AGENTS = [
  { token: 'ChatGPT-User', operator: 'https://chatgpt.com' },
  { token: 'ChatGPT Agent', operator: 'https://chatgpt.com' },
  { token: 'Google-Agent', operator: 'https://agent.bot.goog' },
  { token: 'Googlebot', operator: 'https://google.com' },
  { token: 'GPTBot', operator: 'https://openai.com' },
  { token: 'OAI-SearchBot', operator: 'https://openai.com' },
  { token: 'ClaudeBot', operator: 'https://anthropic.com' },
  { token: 'Claude-User', operator: 'https://anthropic.com' },
  { token: 'PerplexityBot', operator: 'https://perplexity.ai' },
];

export function identify(signature, userAgent = '', network = null) {
  const claimed = KNOWN_AGENTS.find((a) => userAgent.includes(a.token));
  const claim = claimed?.token ?? null;
  if (signature.status === 'verified') return { kind: 'verified-agent', agent: signature.agent, keyid: signature.keyid, userAgentClaim: claim };
  if (signature.status === 'invalid') return { kind: 'invalid-signature', reason: signature.reason, userAgentClaim: claim };
  if (network?.status === 'confirmed') return { kind: 'verified-network', userAgentClaim: network.token, host: network.host };
  if (claimed) return { kind: 'claimed-agent', userAgentClaim: claim, operator: claimed.operator, network: network?.status ?? 'unchecked' };
  return { kind: 'unidentified' };
}

/** The bucket a rate limiter counts against: a verified identity by name, everyone else by address. */
export function rateKey(identity, ip) {
  if (identity.kind === 'verified-agent') return `agent:${identity.agent}`;
  if (identity.kind === 'verified-network') return `crawler:${identity.userAgentClaim}`;
  return `ip:${ip}`;
}
