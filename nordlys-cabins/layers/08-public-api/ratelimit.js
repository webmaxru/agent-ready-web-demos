// A small fixed-window rate limiter that speaks the IETF RateLimit header fields.
// draft-ietf-httpapi-ratelimit-headers-11 is still a draft: the field names and
// syntax may change before it becomes an RFC. Production sites usually limit at
// the edge (Chapter 4). This one exists so agents see what a limit looks like.

export function rateLimiter({ quota = 60, windowSeconds = 60, policy = 'default' } = {}) {
  const windows = new Map(); // client -> { start, used }

  return async function rateLimit(c, next) {
    const client = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'anonymous';
    const now = Date.now();
    let w = windows.get(client);
    if (!w || now - w.start >= windowSeconds * 1000) {
      w = { start: now, used: 0 };
      windows.set(client, w);
    }
    const reset = Math.max(0, Math.ceil((w.start + windowSeconds * 1000 - now) / 1000));
    const headers = {
      'ratelimit-policy': `"${policy}";q=${quota};w=${windowSeconds}`,
      ratelimit: `"${policy}";r=${Math.max(0, quota - w.used - 1)};t=${reset}`,
    };
    if (w.used >= quota) {
      const body = {
        type: 'https://iana.org/assignments/http-problem-types#quota-exceeded',
        title: 'Request cannot be satisfied as assigned quota has been exceeded',
        status: 429,
        detail: `This client used its ${quota} requests for the current ${windowSeconds}-second window. Retry after ${reset} seconds.`,
        'violated-policies': [policy],
      };
      return new Response(JSON.stringify(body, null, 2), {
        status: 429,
        headers: { 'content-type': 'application/problem+json', 'retry-after': String(reset), ...headers, ratelimit: `"${policy}";r=0;t=${reset}` },
      });
    }
    w.used += 1;
    await next();
    for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
  };
}
