// Signed access tokens without a library: JWTs (RFC 7519) signed with Ed25519
// ("EdDSA", RFC 8037), in the JWT access token profile of RFC 9068 (typ at+jwt).
import { generateKeyPairSync, sign, verify, createPublicKey, randomBytes } from 'node:crypto';

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function createSigner() {
  // A fresh key at every start: restarting the demo invalidates all tokens.
  // In production the key lives in a key store and is rotated with overlapping kids.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const kid = randomBytes(8).toString('base64url');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' };

  return {
    jwks: () => ({ keys: [jwk] }),

    sign(claims) {
      const head = b64({ alg: 'EdDSA', typ: 'at+jwt', kid });
      const body = b64(claims);
      const sig = sign(null, Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
      return `${head}.${body}.${sig}`;
    },

    /** Returns the claims, or null for anything malformed, foreign or forged. */
    verify(token) {
      const parts = String(token ?? '').split('.');
      if (parts.length !== 3) return null;
      try {
        const head = unb64(parts[0]);
        if (head.alg !== 'EdDSA' || head.typ !== 'at+jwt' || head.kid !== kid) return null;
        const ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
        return ok ? unb64(parts[1]) : null;
      } catch {
        return null;
      }
    },
  };
}
