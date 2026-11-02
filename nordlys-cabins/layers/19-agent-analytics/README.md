# Layer 19: agent analytics

Logs every request in the JSON format the Chapter 19 classifier reads
(`chapters/19-measuring-agent-traffic/`), labels it with a class and the evidence
behind it, ties each booking to the kind of visitor that made it, and shows the
result on `/__agents` (HTML) and `/__agents.json`.

- Uses layer 15's Web Bot Auth result (`c.get('botIdentity')`) when that layer runs.
- `NORDLYS_TRUST_PROXY=1` takes the client address from `X-Forwarded-For` (only
  behind a proxy you control).
- `NORDLYS_AGENT_LOG=/path/to/file.jsonl` also appends every record to a file.
- `NORDLYS_ANALYTICS_TOKEN=...` requires `Authorization: Bearer ...` for the
  dashboard. Set it on any public deployment.

Test: `node --test tests/ch19-agent-analytics.test.js`
