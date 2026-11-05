// IP prefix matching for the published range files (IPv4 and IPv6), no dependencies.

function ipv4ToBigInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    const v = Number(p);
    if (!/^\d{1,3}$/.test(p) || v > 255) return null;
    n = (n << 8n) + BigInt(v);
  }
  return n;
}

function ipv6ToBigInt(ip) {
  if (ip.includes('.')) return null; // IPv4-mapped forms are normalised by parseIp
  const [head, tail = ''] = ip.split('::');
  if (ip.split('::').length > 2) return null;
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

/** '203.0.113.7' or '2001:db8::1' -> { version, value } or null */
export function parseIp(ip) {
  const s = String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.)/i, '');
  const v4 = ipv4ToBigInt(s);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = ipv6ToBigInt(s);
  return v6 === null ? null : { version: 6, value: v6 };
}

/** Turn a range file ({ prefixes: [{ ipv4Prefix } | { ipv6Prefix }] }) into matchers. */
export function compileRanges(file) {
  return (file?.prefixes ?? []).map((p) => {
    const cidr = p.ipv4Prefix ?? p.ipv6Prefix;
    const [addr, len] = cidr.split('/');
    const ip = parseIp(addr);
    const bits = ip.version === 4 ? 32n : 128n;
    const shift = bits - BigInt(len);
    return { version: ip.version, shift, network: ip.value >> shift };
  });
}

export function inRanges(ip, compiled) {
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return compiled.some((r) => r.version === parsed.version && parsed.value >> r.shift === r.network);
}
