'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProviderSupervisor,
  adaptiveRefreshInterval,
  jitter,
  normalizedSchemaFingerprint,
  validateProviderEvents,
} = require('../src/autonomy/provider-supervisor');

function event(name = 'BookA') {
  return [{
    id: `${name}:1`, sport: 'Football', competition: 'League', startsAt: '2026-07-15T18:00:00Z',
    homeTeam: 'Home', awayTeam: 'Away', bookmakers: [{ name, markets: { h2h: { home: 2, draw: 3.5, away: 4 } } }],
  }];
}

test('ProviderSupervisor collects, validates, annotates, and caches providers', async () => {
  let calls = 0;
  const provider = { name: 'Fortuna', getOdds: async () => { calls += 1; return event('Fortuna'); } };
  const supervisor = new ProviderSupervisor([provider], {
    now: () => new Date('2026-07-14T12:00:00Z'),
    retryDelaysMs: [],
  });
  const result = await supervisor.refreshAll();
  assert.equal(calls, 1);
  assert.equal(result.events.length, 1);
  assert.match(result.events[0].bookmakers[0].feedGroup, /^bookmaker:/);
  assert.equal(result.providers[0].circuitState, 'closed');
  assert.equal(supervisor.diagnostics().providerCount, 1);
  assert.equal(result.providers[0].refreshIntervalMs, 15_000);
});

test('adaptive provider cadence keeps fast feeds frequent and slow feeds bounded', () => {
  assert.equal(adaptiveRefreshInterval(2_000), 15_000);
  assert.equal(adaptiveRefreshInterval(20_000), 60_000);
  assert.equal(adaptiveRefreshInterval(100_000), 120_000);
});

test('ProviderSupervisor opens a circuit after repeated failures', async () => {
  const provider = { name: 'Broken', getOdds: async () => { throw new Error('network timeout'); } };
  const supervisor = new ProviderSupervisor([provider], {
    circuitFailures: 1,
    retryDelaysMs: [],
    now: () => new Date('2026-07-14T12:00:00Z'),
  });
  const result = await supervisor.refreshAll();
  assert.equal(result.providers[0].circuitState, 'open');
  assert.equal(result.providers[0].ok, false);
});

test('provider supervisor utilities validate schemas deterministically', () => {
  assert.equal(validateProviderEvents(event()).ok, true);
  assert.equal(validateProviderEvents([]).ok, false);
  assert.equal(normalizedSchemaFingerprint(event()), normalizedSchemaFingerprint(event('BookB')));
  assert.equal(jitter(1000, () => 0.5), 1000);
});

test('ProviderSupervisor bounds progressive collection concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const providers = Array.from({ length: 6 }, (_, index) => ({
    name: `Bounded ${index}`,
    getOdds: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return event(`Bounded ${index}`);
    },
  }));
  const supervisor = new ProviderSupervisor(providers, {
    concurrency: 2,
    retryDelaysMs: [],
    now: () => new Date('2026-07-14T12:00:00Z'),
  });

  const snapshots = [];
  for await (const snapshot of supervisor.getOddsProgress()) snapshots.push(snapshot);

  assert.equal(maxActive, 2);
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots.at(-1).progress, { done: 6, total: 6, complete: true });
  assert.equal(supervisor.diagnostics().concurrency, 2);
});
