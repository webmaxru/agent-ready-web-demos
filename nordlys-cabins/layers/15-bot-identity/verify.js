// Verifying Web Bot Auth signatures (draft-ietf-webbotauth-httpsig-protocol-01).
// The result is a label for the request, never a reason to trust its content.
import { parseDictionary, parseSignatureInput, signatureBase, thumbprint, verifyBase } from './httpsig.js';

export function createVerifier({ directory, now = () => Math.floor(Date.now() / 1000), maxLifetime = 86400, skew = 60 }) {
  return async function verifyRequest(request) {
    const inputHeader = request.headers.get('signature-input');
    const sigHeader = request.headers.get('signature');
    if (!inputHeader || !sigHeader) return { status: 'unsigned' };

    const signatures = parseDictionary(sigHeader);
    const agentHeader = request.headers.get('signature-agent') ?? '';
    // Legacy form: a bare string. It belongs to whichever label covers it.
    const legacy = agentHeader.startsWith('"');
    const agents = legacy ? null : parseDictionary(agentHeader);

    let lastError = 'no web-bot-auth signature';
    for (const [lbl, raw] of parseDictionary(inputHeader)) {
      const input = parseSignatureInput(raw);
      if (input.params.tag !== 'web-bot-auth') continue;
      try {
        const names = input.items.map((i) => i.name);
        if (!names.includes('@authority') && !names.includes('@target-uri')) throw new Error('signature covers no authority');
        const agentItem = input.items.find((i) => i.name === 'signature-agent');
        if (!agentItem) throw new Error('Signature-Agent is not covered');
        const member = legacy ? agentHeader : agents.get(agentItem.params.key ?? lbl);
        // A member is a bare quoted URL. The draft says to ignore members that carry parameters.
        if (!member || !/^"[^"]+"$/.test(member)) throw new Error('no usable Signature-Agent member for this signature');
        const agent = member.slice(1, -1);

        const { created, expires, keyid } = input.params;
        const t = now();
        if (typeof created !== 'number' || typeof expires !== 'number') throw new Error('created and expires are required');
        if (created > t + skew) throw new Error('signature is from the future');
        if (expires < t - skew) throw new Error('signature has expired');
        if (expires - created > maxLifetime) throw new Error('signature lives too long');

        const keys = await directory.keys(agent);
        // Select by thumbprint, computed here: a directory's own kid is a label, not proof.
        const key = keys.find((k) => k.kty === 'OKP' && thumbprint(k) === keyid);
        if (key && ((key.nbf && t < key.nbf - skew) || (key.exp && t > key.exp + skew))) throw new Error('key is outside its validity period');
        if (!key) throw new Error('keyid is not in the agent\'s directory');
        const sig = signatures.get(lbl)?.match(/^:([A-Za-z0-9+/=]+):$/)?.[1];
        if (!sig) throw new Error('no signature value for this label');
        if (!verifyBase(signatureBase(request, input), sig, key)) throw new Error('signature does not verify');
        return { status: 'verified', agent, keyid, label: lbl };
      } catch (e) {
        lastError = e.message;
      }
    }
    return { status: 'invalid', reason: lastError };
  };
}
