const test = require('node:test');
const assert = require('node:assert/strict');

const { warmOddsCache } = require('../src/server');

test('warms the odds cache only when enabled', async () => {
  let calls = 0;
  const oddsService = {
    getOdds: async () => {
      calls += 1;
      return { events: [{ id: 'event-1' }] };
    },
  };
  const logs = [];

  warmOddsCache({
    enabled: false,
    oddsService,
    logger: { info: (msg, meta) => logs.push(msg), warn: (msg, meta) => logs.push(msg) },
  });
  assert.equal(calls, 0);

  warmOddsCache({
    enabled: true,
    oddsService,
    logger: { info: (msg, meta) => logs.push(msg), warn: (msg, meta) => logs.push(msg) },
  });

  await waitForMicrotasks();
  assert.equal(calls, 1);
  assert.deepEqual(logs, ['Odds cache warmed']);
});

test('logs startup odds cache warm-up failures without throwing', async () => {
  const warnings = [];

  warmOddsCache({
    enabled: true,
    oddsService: {
      getOdds: async () => {
        throw new Error('provider blocked');
      },
    },
    logger: { info: () => {}, warn: (msg, meta) => warnings.push(msg) },
  });

  await waitForMicrotasks();
  assert.deepEqual(warnings, ['Odds cache warm-up failed']);
});

async function waitForMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}
