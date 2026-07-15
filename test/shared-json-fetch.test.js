'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSharedJsonFetch, requestKey } = require('../src/providers/shared-json-fetch');

test('createSharedJsonFetch coalesces identical JSON requests and clones payloads', async () => {
  let calls = 0;
  const sharedFetch = createSharedJsonFetch({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ rows: [1] }) };
    },
    now: () => 1000,
  });
  const options = { method: 'POST', body: '{"a":1}', headers: { origin: 'one' } };
  const [left, right] = await Promise.all([
    sharedFetch('https://example.test/events', options),
    sharedFetch('https://example.test/events', { ...options, headers: { origin: 'two' } }),
  ]);
  const leftPayload = await left.json();
  const rightPayload = await right.json();
  leftPayload.rows.push(2);
  assert.deepEqual(rightPayload, { rows: [1] });
  assert.equal(calls, 1);
  assert.equal(requestKey('x', { method: 'POST', body: 'y' }), 'POST|x|y');
});
