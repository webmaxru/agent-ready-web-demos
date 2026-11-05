import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, STAGES } from '../plan.mjs';

test('a booking site builds actions and stops at the trust stage', () => {
  const p = plan({ type: 'booking' });
  assert.ok(p.build.some((b) => b.startsWith('WebMCP')));
  assert.equal(p.stages.at(-1).id, 'trust');
});

test('a content site stops after content formats and skips WebMCP', () => {
  const p = plan({ type: 'content' });
  assert.equal(p.stages.at(-1).id, 'content');
  assert.ok(p.skip.some((s) => s.startsWith('WebMCP')));
});

test('a Shopify shop is told what the platform already ships', () => {
  const p = plan({ type: 'ecommerce', platform: 'shopify' });
  assert.ok(p.platformGives.some((g) => g.includes('WebMCP')));
  assert.ok(!p.build.some((b) => b.startsWith('WebMCP')));
  assert.ok(p.configure.some((b) => b.startsWith('WebMCP')));
});

test('a content site is reminded to verify bots even though no grader counts it', () => {
  assert.ok(plan({ type: 'content' }).also.some((a) => a.includes('Chapter 4')));
  assert.deepEqual(plan({ type: 'booking' }).also, []);
});

test('an existing API is not built again', () => {
  assert.ok(!plan({ type: 'saas', hasApi: true }).build.some((b) => b.startsWith('Public API')));
});

test('the stages follow the isitagentready levels 1 to 5 in order', () => {
  assert.deepEqual(STAGES.map((s) => s.graders.isitagentready.slice(0, 7)), ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5']);
});

test('an unknown site type is refused with the valid ones', () => {
  assert.throws(() => plan({ type: 'casino' }), /content, booking, saas, ecommerce/);
});
