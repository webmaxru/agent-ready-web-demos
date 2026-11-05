// TEACHING EXAMPLE ONLY: what an x402 V2 "402 Payment Required" response looks
// like. Nordlys sells cabin stays, not content, so this route is off by default
// (NORDLYS_X402_DEMO=1 turns it on). It never verifies or settles a payment.
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

export function x402Demo(ctx) {
  ctx.route('GET', '/guide/premium/winter-routes', (c) => {
    const required = {
      x402Version: 2,
      error: 'PAYMENT-SIGNATURE header is required',
      resource: {
        url: ctx.absoluteUrl(c, '/guide/premium/winter-routes'),
        description: 'Winter ski-touring routes near Nordlys cabins (teaching example)',
        mimeType: 'text/markdown',
      },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:84532', // Base Sepolia, a test network: no real money
        amount: '10000', // 0.01 test USDC in atomic units (6 decimals)
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x0000000000000000000000000000000000000000',
        maxTimeoutSeconds: 60,
        extra: { name: 'USDC', version: '2' },
      }],
    };
    if (c.req.header('payment-signature')) required.error = 'This teaching demo never settles payments';
    c.header('PAYMENT-REQUIRED', b64(required));
    return c.json(required, 402);
  });
}
