// A linter for tool definitions: the checklist of Chapter 10 as code.
// It reads tools in the shape every interface shares (name, description, a JSON
// Schema for the input, optional annotations), so the same rules apply to an MCP
// tools/list answer, to WebMCP getTools() output and to OpenAPI operations
// converted to tools. Errors are mistakes that change what an agent does.
// Warnings are habits that make agents slower or less reliable.

const VERBS = ['search', 'find', 'get', 'list', 'check', 'create', 'book', 'start', 'update', 'cancel', 'delete', 'contact', 'plan', 'send'];
const DATEY = /(date|day|checkin|checkout|^from$|^to$|start|end)$/i;
const CONFIRM = /\b(confirm|ask the user|only (call|use) this after|never .* without asking)\b/i;

/** Lint one tool. Returns a list of { tool, rule, level, message }. */
export function lintTool(tool) {
  const out = [];
  const add = (rule, level, message, param) => out.push({ tool: tool.name, ...(param ? { param } : {}), rule, level, message });
  const { name = '', description = '', inputSchema = {}, annotations = {} } = tool;

  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name)) add('name-format', 'error', 'Use snake_case: lower-case words joined by underscores. Model APIs refuse dots and spaces.');
  if (name.length > 128) add('name-length', 'error', 'Model APIs refuse names over 128 characters.');
  else if (name.length > 64) add('name-length', 'warning', 'Over 64 characters: long names are hard to tell apart in a list.');
  if (!VERBS.includes(name.split('_')[0])) add('name-verb', 'warning', `Start with a verb an agent can match to an intent (${VERBS.slice(0, 6).join(', ')}, ...).`);

  if (description.length < 40) add('description-short', 'error', 'Say what the tool does, when to use it and what it returns (40 characters at least).');
  if (description.length > 1200) add('description-long', 'warning', 'Over 1,200 characters: move reference material into a resource or the result.');

  const props = inputSchema.properties ?? {};
  for (const [key, schema] of Object.entries(props)) {
    const s = schema ?? {};
    if (!s.description && !s.title) add('param-undescribed', 'warning', `Describe "${key}": its meaning, unit or format, and where the value comes from.`, key);
    if (s.type === 'string' && DATEY.test(key) && !s.format && !s.pattern) add('param-date-format', 'error', `"${key}" looks like a date: give format "date" or a pattern, and name the time zone.`, key);
    if (s.type === 'string' && !s.enum && !s.const && !s.format && !s.pattern && /(region|status|type|kind|category)$/i.test(key))
      add('param-free-string', 'warning', `"${key}" has a known set of values: list them with enum.`, key);
    if (s.type === 'object' && key === 'body') add('param-wrapped-body', 'warning', 'Flatten the request body into named parameters.', key);
  }

  const consequential = annotations.readOnlyHint !== true;
  if (annotations.readOnlyHint === undefined) add('annotations-missing', 'warning', 'Set readOnlyHint (true or false) so clients know whether to ask before calling.');
  if (consequential && annotations.readOnlyHint === false && !CONFIRM.test(description))
    add('consequential-unconfirmed', 'error', 'This tool changes something. Tell the agent in the description when to ask the user first.');
  if (annotations.destructiveHint === true && !/cannot be undone|can't be undone|not reversible|irreversible/i.test(description))
    add('destructive-unstated', 'warning', 'Say in the description that the action cannot be undone.');
  return out;
}

/** Lint a whole tool set. Adds set-level rules to the per-tool findings. */
export function lintTools(tools) {
  const out = tools.flatMap(lintTool);
  if (tools.length > 20) out.push({ tool: '*', rule: 'too-many-tools', level: 'warning', message: `${tools.length} tools: agents choose worse from long lists. Group or split by task.` });
  const seen = new Map();
  for (const t of tools) {
    if (seen.has(t.name)) out.push({ tool: t.name, rule: 'duplicate-name', level: 'error', message: 'Two tools with the same name.' });
    seen.set(t.name, true);
  }
  return out;
}
