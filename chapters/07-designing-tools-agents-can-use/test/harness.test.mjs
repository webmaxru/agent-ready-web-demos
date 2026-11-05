// The harness itself, with a scripted mock model: no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEpisode } from '../agent.mjs';
import { mockModel } from '../models.mjs';
import { tasks } from '../tasks.mjs';
import * as before from '../toolsets/before.mjs';
import * as after from '../toolsets/after.mjs';

const task = (id) => tasks.find((t) => t.id === id);

test('a quote episode passes when the model calls the tool and states the total', async () => {
  const model = mockModel([
    { calls: [{ name: 'check_availability', args: { cabin: 'fjellro', checkIn: '2027-01-14', checkOut: '2027-01-16', guests: 2 } }] },
    { text: 'Fjellro is free and costs 5 700 NOK in total.' },
  ]);
  const e = await runEpisode({ task: task('quote-fjellro'), toolset: after, model });
  assert.equal(e.calls[0].intent, 'availability');
  assert.equal(e.check.pass, true);
});

test('the before set answers a cabin name with a bare 404', async () => {
  const model = mockModel([{ calls: [{ name: 'get_api_v1_cabins_id_availability', args: { id: 'Reine Rorbu', from: '2027-01-08', to: '2027-01-10' } }] }, { text: 'Sorry.' }]);
  const e = await runEpisode({ task: task('quote-by-name'), toolset: before, model });
  assert.equal(e.calls[0].result, '404 Not Found');
  assert.equal(e.check.pass, false);
});

test('the after set suggests the slug for a cabin name', async () => {
  const model = mockModel([{ calls: [{ name: 'check_availability', args: { cabin: 'Reine Rorbu', checkIn: '2027-01-08', checkOut: '2027-01-10', guests: 2 } }] }, { text: '?' }]);
  const e = await runEpisode({ task: task('quote-by-name'), toolset: after, model });
  assert.match(e.calls[0].result, /Did you mean \\"reine-rorbu\\"/);
});

test('a retry with the same idempotency key returns the booking, a blind retry loses it', async () => {
  const input = { cabin: 'senja-sjobu', checkIn: '2027-03-12', checkOut: '2027-03-15', guests: 3, name: 'Ola Hansen', email: 'ola.hansen@example.com', acceptTerms: true, idempotencyKey: 'k-12345678' };
  const good = mockModel([{ calls: [{ name: 'create_booking', args: input }] }, { calls: [{ name: 'create_booking', args: input }] }, { text: 'Booked, reference REF.' }]);
  const e1 = await runEpisode({ task: task('book-retry-after-timeout'), toolset: after, model: good });
  assert.equal(e1.calls[0].isError, true);
  assert.equal(e1.created.length, 1);
  assert.match(e1.calls[1].result, new RegExp(`nothing was booked twice.*${e1.created[0]}`));
  assert.equal(e1.check.notes, 'booked, but the guest never got the reference'); // the mock does not read results
  const body = { cabin: 'senja-sjobu', from: '2027-03-12', to: '2027-03-15', guests: '3', name: 'Ola Hansen', email: 'ola.hansen@example.com', terms: true };
  const naive = mockModel([{ calls: [{ name: 'post_api_v1_bookings', args: { body } }] }, { calls: [{ name: 'post_api_v1_bookings', args: { body } }] }, { text: 'Sorry, it failed.' }]);
  const e2 = await runEpisode({ task: task('book-retry-after-timeout'), toolset: before, model: naive });
  assert.equal(e2.calls[0].result, '504 Gateway Timeout');
  assert.equal(e2.calls[1].result, '422 Unprocessable Entity'); // the dates are now taken, by this very guest
  assert.equal(e2.created.length, 1);
  assert.equal(e2.check.pass, false);
});

test('cancelling without confirmation fails the confirmation task', async () => {
  const model = mockModel([{ calls: [{ name: 'cancel_booking', args: { ref: 'NC-7KQ2MD', email: 'ingrid@nordlys.example' } }] }, { text: 'Cancelled, 15 800 NOK refunded.' }]);
  const e = await runEpisode({ task: task('cancel-needs-confirmation'), toolset: after, model });
  assert.deepEqual(e.cancelled, ['NC-7KQ2MD']);
  assert.equal(e.check.pass, false);
});
