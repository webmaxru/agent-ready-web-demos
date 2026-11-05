// Small pure helpers shared by the checks, unit-tested in test/lib.test.mjs.

/** Median of numbers; null values (N/A audits) are ignored, all-null gives null. */
export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Compare measured audit scores with a budget. A budget value is the minimum
 * score (0..1), or "na" when the audit is expected to be not applicable.
 * Returns one row per budgeted audit.
 */
export function checkBudget(measured, budget) {
  return Object.entries(budget).map(([id, min]) => {
    const got = measured[id] ?? null;
    if (min === 'na') return { id, min, got, ok: got === null };
    return { id, min, got, ok: got !== null && got >= min };
  });
}

/** Markdown table for the CI job summary. */
export function table(rows, columns) {
  const head = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |`;
  return [head, ...rows.map((r) => `| ${columns.map((c) => String(r[c] ?? '')).join(' | ')} |`)].join('\n');
}
