# Chapter 10: Security for agent-facing sites

A page scanner that looks at one page the ways agents do: the rendered text a
person sees, the accessibility tree, the raw HTML (comments included), image alt
text and JSON-LD. It reports text that people cannot see and text that talks to an
AI system ("ignore your previous instructions", "Assistant:", requests to send a
booking reference somewhere). It uses the same heuristics as the Nordlys security
layer (`nordlys-cabins/layers/10-security/untrusted.js`).

```sh
node scan-page.mjs fixtures/cabin-hostile.html     # 7 findings, exit code 1
node scan-page.mjs fixtures/cabin-clean.html       # 0 findings, exit code 0
node scan-page.mjs http://127.0.0.1:3000/cabins/fjellro --json
npm run test:e2e -w chapters/10-security-for-agent-facing-sites
```

The heuristics find the payloads in these fixtures. They are a moderation aid and a
regression test, not a defence on their own: an attacker who reads the patterns can
phrase around them. The defences are in the layer (clean once, label untrusted
text, authorize every tool call in code, log, pin tool definitions) and in the
agents themselves.

Versions: Node 20 or later, Playwright 1.64.1 with its Chromium (156.0.8078.4).
