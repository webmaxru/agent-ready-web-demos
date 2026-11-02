/**
 * A tiny HTML template helper. Every interpolated value is escaped unless it
 * was produced by `html` itself or wrapped in `raw()`. No dependencies, so the
 * same templates run on Node, Workers, Deno and Bun.
 */

const SAFE = Symbol('safe-html');

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Mark a string as already-safe HTML. Use only for markup you wrote yourself. */
export function raw(str) {
  return { [SAFE]: true, value: String(str ?? '') };
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'object' && value[SAFE]) return value.value;
  return escapeHtml(value);
}

/**
 * Tagged template: html`<p>${userText}</p>` escapes userText.
 * Arrays are joined, false/null/undefined render nothing.
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return raw(out);
}

/** Turn a template result into a plain string. */
export function toString(value) {
  return render(value);
}

/** Render an attribute map: { name: 'x', hidden: true, title: null } -> ` name="x" hidden` */
export function attrs(map = {}) {
  let out = '';
  for (const [key, val] of Object.entries(map)) {
    if (val === false || val === null || val === undefined) continue;
    out += val === true ? ` ${key}` : ` ${key}="${escapeHtml(val)}"`;
  }
  return raw(out);
}

/**
 * Serialise data for a <script type="application/ld+json"> block.
 * Escapes "<" so the JSON can never close the script element early.
 */
export function jsonForScript(data) {
  return JSON.stringify(data, null, 2).replaceAll('<', '\\u003c');
}
