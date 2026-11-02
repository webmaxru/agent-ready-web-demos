import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deprecationHeaders, parseDeprecation, parseSunset, parseLinks, checkDeprecation } from '../lib/deprecation.mjs';

test('builds the RFC 9745 and RFC 8594 forms', () => {
  const h = deprecationHeaders({ deprecated: '2023-06-30T23:59:59Z', sunset: '2018-12-31T23:59:59Z',
    policy: 'https://nordlys.example/changes.md', successor: 'https://nordlys.example/api/v1/cabins' });
  assert.equal(h.deprecation, '@1688169599'); // the example in RFC 9745
  assert.equal(h.sunset, 'Mon, 31 Dec 2018 23:59:59 GMT');
  assert.equal(h.link, '<https://nordlys.example/changes.md>; rel="deprecation"; type="text/markdown", <https://nordlys.example/api/v1/cabins>; rel="successor-version"');
});

test('parses only well-formed values', () => {
  assert.equal(parseDeprecation('@1688169599').toISOString(), '2023-06-30T23:59:59.000Z');
  assert.equal(parseDeprecation('true'), null); // the old draft's boolean form is not a date
  assert.equal(parseSunset('Sat, 31 Dec 2018 23:59:59 GMT').toISOString(), '2018-12-31T23:59:59.000Z');
  assert.equal(parseSunset('2018-12-31'), null);
  assert.deepEqual(parseLinks('<https://a.example/p>; rel="deprecation", <https://a.example/v2>; rel="successor-version"'),
    { deprecation: 'https://a.example/p', 'successor-version': 'https://a.example/v2' });
});

test('a client sees the deadline', () => {
  const res = new Response('{}', { headers: deprecationHeaders({ deprecated: '2026-11-02', sunset: '2027-05-03' }) });
  const seen = checkDeprecation(res, new Date('2027-05-01T00:00:00Z'));
  assert.equal(seen.deprecated, true);
  assert.equal(seen.daysLeft, 2);
  assert.equal(checkDeprecation(new Response('{}')), null);
});
