# Layer 10-tool-design (Chapter 10)

- `find_booking`: a read-only MCP tool. Reference and email in, the booking and
  what a cancellation today would refund out. An agent uses it before
  `cancel_booking`, so the guest hears what they are about to lose.
- `lint.js`: the chapter's checklist as code, for any tool in the shared shape
  (MCP tools/list, WebMCP getTools(), OpenAPI operations converted to tools).
- Audit "Tool design": lints the live `tools/list` answer of `/mcp`. Errors fail
  the audit, warnings are listed.

Tests: `node --test tests/ch10-tool-design.test.js`. The eval harness that uses
the same linter is in `chapters/10-designing-tools-agents-can-use/`.
