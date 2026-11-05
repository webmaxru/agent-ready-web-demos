// The part of HTTP Message Signatures (RFC 9421) that Web Bot Auth needs:
// parse Signature-Input, Signature and Signature-Agent, rebuild the signature
// base from the request, and sign or verify it with Ed25519. No dependencies.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

/** Split a structured-field list or dictionary at top-level commas. */
function splitTop(s) {
  const out = [];
  let cur = '', quoted = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      cur += ch;
      if (ch === '\\') cur += s[++i] ?? '';
      else if (ch === '"') quoted = false;
    } else if (ch === '"') { quoted = true; cur += ch; }
    else if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A Dictionary as label -> raw member value (the text after "label="). */
export function parseDictionary(header) {
  const map = new Map();
  for (const member of splitTop(header ?? '')) {
    const eq = member.indexOf('=');
    if (eq > 0) map.set(member.slice(0, eq).trim(), member.slice(eq + 1).trim());
  }
  return map;
}

const unquote = (v) => (v.startsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : /^-?\d+$/.test(v) ? Number(v) : v);

/** Parse ("@authority" "signature-agent";key="sig1");created=...;keyid="..." */
export function parseSignatureInput(raw) {
  const close = raw.indexOf(')');
  const items = [...raw.slice(1, close).matchAll(/"([^"]+)"((?:;[a-z]+=(?:"[^"]*"|[^\s;"]+))*)/g)].map((m) => {
    const params = Object.fromEntries([...m[2].matchAll(/;([a-z]+)=("[^"]*"|[^\s;"]+)/g)].map((p) => [p[1], unquote(p[2])]));
    return { name: m[1], params };
  });
  const params = Object.fromEntries([...raw.slice(close + 1).matchAll(/;([a-z]+)=("(?:[^"\\]|\\.)*"|[^;]+)/g)].map((p) => [p[1], unquote(p[2])]));
  return { items, params, raw };
}

/** The value of one covered component, as RFC 9421 section 2 defines it. */
function componentValue(request, { name, params }) {
  const url = new URL(request.url);
  switch (name) {
    case '@method': return request.method.toUpperCase();
    case '@authority': return url.host.toLowerCase();
    case '@path': return url.pathname;
    case '@query': return url.search || '?';
    case '@target-uri': return url.href;
    default: {
      if (name.startsWith('@')) throw new Error(`unsupported derived component ${name}`);
      const value = request.headers.get(name);
      if (value === null) throw new Error(`covered header ${name} is missing`);
      if (params.key === undefined) return value.trim();
      // A single Dictionary member, e.g. "signature-agent";key="sig1".
      const member = parseDictionary(value).get(params.key);
      if (member === undefined) throw new Error(`${name} has no member ${params.key}`);
      return member;
    }
  }
}

const label = ({ name, params }) => `"${name}"${Object.entries(params).map(([k, v]) => `;${k}="${v}"`).join('')}`;

/** The signature base (RFC 9421 section 2.5). */
export function signatureBase(request, input) {
  const lines = input.items.map((it) => `${label(it)}: ${componentValue(request, it)}`);
  lines.push(`"@signature-params": ${input.raw}`);
  return lines.join('\n');
}

/** Serialize the signature parameters, keeping the order given. */
export function serializeInput(items, params) {
  const p = Object.entries(params).map(([k, v]) => `;${k}=${typeof v === 'number' ? v : `"${v}"`}`).join('');
  return `(${items.map(label).join(' ')})${p}`;
}

/** JWK SHA-256 thumbprint of an Ed25519 key (RFC 7638, RFC 8037 appendix A.3). */
export const thumbprint = (jwk) =>
  createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest('base64url');

export function signBase(base, privateJwk) {
  return sign(null, Buffer.from(base), createPrivateKey({ key: privateJwk, format: 'jwk' })).toString('base64');
}

export function verifyBase(base, signatureB64, publicJwk) {
  if (publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519') return false;
  const { d, ...pub } = publicJwk; // never treat a private key from a directory as anything but public
  return verify(null, Buffer.from(base), createPublicKey({ key: pub, format: 'jwk' }), Buffer.from(signatureB64, 'base64'));
}
