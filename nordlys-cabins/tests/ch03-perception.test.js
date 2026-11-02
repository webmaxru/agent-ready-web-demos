import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers/server.js';
import { perceptionProblems } from '../layers/03-perception/index.js';

const perception = async (overrides) => {
  const { ctx } = await buildApp(overrides);
  const { results } = await ctx.runAudits();
  return results.find((r) => r.name === 'perception');
};

test('every public page of the clean front end keeps the perception contract', async () => {
  const audit = await perception({ upto: 3 });
  assert.ok(audit, 'the perception audit is registered');
  for (const check of audit.checks) assert.ok(check.ok, `${check.id}: ${check.message}`);
});

test('the legacy front end breaks the contract on landmarks, headings and click divs', async () => {
  const audit = await perception({ upto: 3, variant: 'legacy' });
  const failing = audit.checks.filter((c) => !c.ok).map((c) => c.id).sort();
  assert.deepEqual(failing, ['no-click-divs', 'one-h1', 'one-main']);
});

test('a control inside a <label> counts as labelled, an empty button does not count as named', () => {
  const page = (body) => `<html lang="en"><title>t</title><main><h1>t</h1>${body}</main></html>`;
  assert.deepEqual(perceptionProblems(page('<label><input type="checkbox" name="a"> Sauna</label>')), []);
  assert.deepEqual(perceptionProblems(page('<input name="email">')), ['labelled-controls']);
  assert.deepEqual(perceptionProblems(page('<button><svg></svg></button>')), ['named-buttons']);
  assert.deepEqual(perceptionProblems(page('<button aria-label="Close"><svg></svg></button>')), []);
  assert.deepEqual(perceptionProblems('<html><div data-href="/">Home</div></html>'), ['html-lang', 'title', 'one-main', 'one-h1', 'no-click-divs']);
});

test('before Chapter 3 there is no perception audit', async () => {
  assert.equal(await perception({ upto: 2 }), undefined);
});
