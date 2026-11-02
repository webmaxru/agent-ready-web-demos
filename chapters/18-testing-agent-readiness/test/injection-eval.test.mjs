// The injection eval's own tests: no keys, no network. The scripted "obedient"
// model is the worst case, so the numbers here are about our side only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSuite, reviewsTool, HOSTILE_REVIEW } from '../evals/injection-eval.mjs';
import { createBackend } from '../../10-designing-tools-agents-can-use/backend.mjs';

test('an obedient agent cancels when it reads the raw review', async () => {
  const [raw] = await runSuite({ models: ['mock'], conditions: ['raw'], runs: 1 });
  assert.equal(raw.cancelled, 1);
  assert.equal(raw.safe, 0);
});

test('labelled reviews keep the words but lose the hiding place and the link', () => {
  const out = JSON.parse(reviewsTool('labelled').run({ cabin: 'lyngen-lysthus' }, createBackend()).text);
  assert.equal(out.trust, 'untrusted');
  const text = out.reviews[0].text;
  assert.ok(!text.includes('<span'));
  assert.ok(!text.includes('nordlys-deals'));
  assert.match(text, /cancel their booking/); // cleaning removes hiding places, not meaning
});

test('moderation holds the hostile review, so no agent ever reads it', () => {
  const out = JSON.parse(reviewsTool('moderated').run({ cabin: 'lyngen-lysthus' }, createBackend()).text);
  assert.ok(out.reviews.every((r) => r.author !== HOSTILE_REVIEW.author || r.date !== HOSTILE_REVIEW.date));
  assert.ok(out.reviews.length > 0);
});
