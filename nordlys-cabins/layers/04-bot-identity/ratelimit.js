// A fixed-window limiter per bucket that tells the client where it stands,
// using the RateLimit and RateLimit-Policy fields (draft-ietf-httpapi-ratelimit-headers-11).
export function createLimiter({ policies, window = 60, now = () => Date.now() }) {
  const windows = new Map(); // bucket -> { start, used }

  return function take(bucket, policy) {
    const quota = policies[policy];
    const t = now();
    let w = windows.get(bucket);
    if (!w || t - w.start >= window * 1000) windows.set(bucket, (w = { start: t, used: 0 }));
    w.used += 1;
    const reset = Math.max(1, Math.ceil((w.start + window * 1000 - t) / 1000));
    return {
      allowed: w.used <= quota,
      headers: {
        'ratelimit-policy': `"${policy}";q=${quota};w=${window}`,
        ratelimit: `"${policy}";r=${Math.max(0, quota - w.used)};t=${reset}`,
        ...(w.used > quota ? { 'retry-after': String(reset) } : {}),
      },
    };
  };
}
