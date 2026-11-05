// AI user agents and robots.txt control tokens, grouped by purpose.
// Each entry says what its vendor documents. Checked on 2 November 2026:
// tokens change, so re-check the vendor pages before you copy this table.
export const CHECKED = '2026-11-02';

export const AGENTS = [
  // Training: collects content to train or fine-tune models
  { token: 'GPTBot', vendor: 'OpenAI', purpose: 'training', robots: 'honours', doc: 'https://platform.openai.com/docs/bots' },
  { token: 'ClaudeBot', vendor: 'Anthropic', purpose: 'training', robots: 'honours', doc: 'https://support.claude.com/en/articles/8896518' },
  { token: 'Google-Extended', vendor: 'Google', purpose: 'training', robots: 'control token, no crawler', doc: 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers' },
  { token: 'Applebot-Extended', vendor: 'Apple', purpose: 'training', robots: 'control token, no crawler', doc: 'https://support.apple.com/en-us/119829' },
  { token: 'CCBot', vendor: 'Common Crawl', purpose: 'training', robots: 'honours', doc: 'https://commoncrawl.org/ccbot' },
  { token: 'MistralAI-Training', vendor: 'Mistral AI', purpose: 'training', robots: 'honours', doc: 'https://docs.mistral.ai/robots' },

  // Search: builds an index that AI answers and search results link back to
  { token: 'OAI-SearchBot', vendor: 'OpenAI', purpose: 'search', robots: 'honours', doc: 'https://platform.openai.com/docs/bots' },
  { token: 'Claude-SearchBot', vendor: 'Anthropic', purpose: 'search', robots: 'honours', doc: 'https://support.claude.com/en/articles/8896518' },
  { token: 'PerplexityBot', vendor: 'Perplexity', purpose: 'search', robots: 'honours', doc: 'https://docs.perplexity.ai/guides/bots' },
  { token: 'Amzn-SearchBot', vendor: 'Amazon', purpose: 'search', robots: 'honours', doc: 'https://developer.amazon.com/amazonbot' },
  { token: 'MistralAI-Index', vendor: 'Mistral AI', purpose: 'search', robots: 'honours', doc: 'https://docs.mistral.ai/robots' },

  // User: fetches a page because a person asked an assistant to, right now
  { token: 'ChatGPT-User', vendor: 'OpenAI', purpose: 'user', robots: 'may not apply', doc: 'https://platform.openai.com/docs/bots' },
  { token: 'Claude-User', vendor: 'Anthropic', purpose: 'user', robots: 'honours', doc: 'https://support.claude.com/en/articles/8896518' },
  { token: 'Perplexity-User', vendor: 'Perplexity', purpose: 'user', robots: 'generally ignores', doc: 'https://docs.perplexity.ai/guides/bots' },
  { token: 'Amzn-User', vendor: 'Amazon', purpose: 'user', robots: 'may not follow all', doc: 'https://developer.amazon.com/amazonbot' },
  { token: 'MistralAI-User', vendor: 'Mistral AI', purpose: 'user', robots: 'governs user requests', doc: 'https://docs.mistral.ai/robots' },
];

/** The tokens for one purpose: 'training', 'search' or 'user'. */
export const tokensFor = (purpose) => AGENTS.filter((a) => a.purpose === purpose).map((a) => a.token);
