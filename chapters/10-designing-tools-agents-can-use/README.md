# Chapter 10: an eval harness for tool design

This folder runs a small task suite against two versions of the Nordlys Cabins
tools and reports how often a model gets each task right.

- `toolsets/before.mjs`: every public API operation turned into a tool with no
  editing (names from the URL, one-line summaries, string parameters, HTTP status
  lines as errors). A simulation of naive generation written for the chapter.
- `toolsets/after.mjs`: the MCP tools of Chapters 8 and 10 as plain JSON Schema,
  with every parameter described and errors that say what to do next.
- `tasks.mjs`: eleven guest requests with deterministic checks (no model grades
  another model).
- `backend.mjs`: a fresh copy of the real Nordlys store and booking service for
  every episode, with the clock frozen at 10 November 2026.

## Run it

```sh
npm test -w chapters/10-designing-tools-agents-can-use      # mock model, no keys
node lint.mjs                                               # lint both tool sets
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
  node eval.mjs --models gpt-4.1-mini,claude-haiku-4-5-20251001 --trials 5
```

`OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` point the harness at a proxy or a
compatible endpoint. Results go to `results/` as JSON (every call, argument and
answer) and a Markdown table. `results/README.md` lists the runs the chapter
quotes and which version of the "after" set each one used.

A model sees only the tool definitions, a short system prompt and the guest's
message. There is no human in the loop: a task that needs a confirmation passes
when the model stops and asks.
