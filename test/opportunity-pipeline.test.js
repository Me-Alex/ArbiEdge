'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryAutonomyStore } = require('../src/storage/autonomy-store');
const {
  OpportunityPipeline,
  lifecycleStatus,
  opportunityFingerprint,
  opportunityPriceFingerprint,
} = require('../src/autonomy/opportunity-pipeline');

function opportunity() {
  return {
    eventId: 'e1', eventName: 'Home vs Away', kickoff: '2026-07-15T18:00:00Z',
    marketKey: 'h2h', type: 'classic', edge: 0.02, eligibility: 'actionable',
    legs: [
      { marketKey: 'h2h', outcome: 'home', bookmaker: 'A', feedGroup: 'a', price: 2.1 },
      { marketKey: 'h2h', outcome: 'draw', bookmaker: 'B', feedGroup: 'b', price: 3.7 },
      { marketKey: 'h2h', outcome: 'away', bookmaker: 'C', feedGroup: 'c', price: 4.2 },
    ],
  };
}

test('OpportunityPipeline requires two identical live snapshots before alerting', async () => {
  const store = await new MemoryAutonomyStore().init();
  const alerted = [];
  let now = new Date('2026-07-14T12:00:00Z');
  const pipeline = new OpportunityPipeline({
    store,
    detector: () => [opportunity()],
    alertOutbox: { queueOpportunity: async (item) => { alerted.push(item); return 1; } },
    now: () => now,
  });
  const firstPayload = { mode: 'live', fetchedAt: now.toISOString(), events: [{}] };
  assert.equal((await pipeline.processSnapshot(firstPayload)).actionable, 0);
  assert.equal((await pipeline.processSnapshot(firstPayload)).actionable, 0);
  now = new Date('2026-07-14T12:00:03Z');
  const secondPayload = { mode: 'live', fetchedAt: now.toISOString(), events: [{}] };
  assert.equal((await pipeline.processSnapshot(secondPayload)).actionable, 1);
  assert.equal(alerted.length, 1);
  assert.equal(store.opportunities.values().next().value.status, 'actionable');
});

test('opportunity fingerprints separate identity from prices', () => {
  const first = opportunity();
  const changed = { ...opportunity(), legs: opportunity().legs.map((leg, index) => ({ ...leg, price: leg.price + index * 0.1 })) };
  assert.equal(opportunityFingerprint(first), opportunityFingerprint(changed));
  assert.notEqual(opportunityPriceFingerprint(first), opportunityPriceFingerprint(changed));
  assert.equal(lifecycleStatus(first, { priceConfirmed: false }).status, 'awaiting_recheck');
  assert.equal(lifecycleStatus({ eligibility: 'review' }).status, 'awaiting_fidelity');
  assert.equal(lifecycleStatus({
    eligibility: 'review',
    quoteTiming: { status: 'stale', actionable: false },
  }).status, 'awaiting_freshness');
});

test('cached quotes cannot satisfy confirmation only because a new cycle ran', async () => {
  const store = await new MemoryAutonomyStore().init();
  let now = new Date('2026-07-14T12:00:00Z');
  let observedAt = '2026-07-14T12:00:00Z';
  const pipeline = new OpportunityPipeline({
    store,
    detector: () => [{
      ...opportunity(),
      legs: opportunity().legs.map((leg) => ({ ...leg, observedAt })),
    }],
    now: () => now,
  });

  assert.equal((await pipeline.processSnapshot({ mode: 'live', fetchedAt: now.toISOString(), events: [{}] })).actionable, 0);
  now = new Date('2026-07-14T12:00:03Z');
  assert.equal((await pipeline.processSnapshot({ mode: 'live', fetchedAt: now.toISOString(), events: [{}] })).actionable, 0);
  observedAt = now.toISOString();
  now = new Date('2026-07-14T12:00:06Z');
  assert.equal((await pipeline.processSnapshot({ mode: 'live', fetchedAt: now.toISOString(), events: [{}] })).actionable, 1);
});
