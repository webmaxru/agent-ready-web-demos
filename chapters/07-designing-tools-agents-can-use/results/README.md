# Results of 2 November 2026

All runs: Node 22, `--trials 5` unless stated, default temperature, the system
prompt in `agent.mjs`, 8 steps at most. Models as the APIs reported them:
gpt-4.1-mini-2025-04-14, gpt-5.4-mini-2026-03-17, claude-haiku-4-5-20251001,
claude-haiku-5-5. Every file holds every tool call, argument, result and answer.

The checks were re-run over every file after two fixes to the checks themselves
(a request to confirm without a question mark counted as "no question", and
"its maximum is four guests" did not match the limit pattern), and after the
quote checks started to accept a stay total from `search_cabins`. `eval.mjs
--rescore <file>` repeats that without calling a model.

| File | Tool sets | What changed in `toolsets/after.mjs` |
| --- | --- | --- |
| `2026-11-02` | before, after v1 | v1: the Chapter 8 tools as JSON Schema, find_booking, errors with `next`, create_booking result with a sentence |
| `2026-11-02-iteration` | after v2, 3 tasks | v2: search_cabins description says to call check_availability for exact totals, empty search returns a "search again" hint |
| `2026-11-02-iteration-2` | after v3, 2 tasks | v3: the hint replaced by `nearMisses` (what rules each cabin out) |
| `2026-11-02-after-v3` | after v3, all tasks | |
| `2026-11-02-iteration-3` | after v4, 1 task, 10 trials | v4: search with dates returns `stayTotal` per cabin |
| `2026-11-02-after-final` | after v4, all tasks | the version in this folder |
