# Layer 12-agent-analytics (Chapter 12)

Logs every request in the JSON format the Chapter 12 classifier reads
(`chapters/12-testing-and-measuring-in-production/measuring/`), labels it with a class and the evidence
behind it, ties each booking to the kind of visitor that made it, and shows the
result on `/__agents` (HTML) and `/__agents.json`.

- Uses the Web Bot Auth result of layer 04-bot-identity (`c.get('botIdentity')`) when that layer runs.
- `NORDLYS_TRUST_PROXY=1` takes the client address from `X-Forwarded-For` (only
  behind a proxy you control).
- `NORDLYS_AGENT_LOG=/path/to/file.jsonl` also appends every record to a file.
- `NORDLYS_ANALYTICS_TOKEN=...` requires `Authorization: Bearer ...` for the
  dashboard. Set it on any public deployment.

Test: `node --test tests/ch12-agent-analytics.test.js`
