'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MemoryAutonomyStore,
  createAutonomyStore,
} = require('../src/storage/autonomy-store');

test('MemoryAutonomyStore persists snapshots, lifecycles, alerts, and settlements', async () => {
  const store = await new MemoryAutonomyStore().init();
  await store.saveSnapshot({ mode: 'live', fetchedAt: '2026-07-14T12:00:00Z', events: [{ id: 'e1' }], providers: [] });
  assert.equal((await store.loadLatestSnapshot()).events[0].id, 'e1');

  const record = {
    fingerprint: 'fp1', status: 'awaiting_recheck', eventKey: 'event', marketKey: 'h2h', edge: 0.02,
    expiresAt: '2026-07-14T12:02:00Z', firstSeenAt: '2026-07-14T12:00:00Z',
    lastSeenAt: '2026-07-14T12:00:00Z', priceConfirmed: false, payload: { edge: 0.02 },
  };
  assert.equal((await store.upsertOpportunity(record)).created, true);
  assert.equal((await store.upsertOpportunity({ ...record, status: 'actionable', lastSeenAt: '2026-07-14T12:01:00Z' })).statusChanged, true);
  assert.equal(store.transitions.length, 2);

  const inserted = await store.enqueueAlert({ dedupeKey: 'a1', channel: 'webhook', destination: {}, payload: {} });
  assert.equal(inserted.inserted, true);
  assert.equal((await store.enqueueAlert({ dedupeKey: 'a1', channel: 'webhook', destination: {}, payload: {} })).inserted, false);
  const [claimed] = await store.claimAlerts(1, new Date('2030-01-01T00:00:00Z'));
  await store.completeAlert(claimed.id, { ok: true });
  assert.equal(store.alerts.get(claimed.id).status, 'delivered');

  await store.recordSettlement({ subjectType: 'bet', subjectId: 'b1', provider: 'scores', result: 'won' });
  assert.equal(store.settlements.length, 1);
  assert.equal(store.diagnostics().snapshots, 1);
});

test('createAutonomyStore requires PostgreSQL for autonomous production', () => {
  assert.throws(
    () => createAutonomyStore({ NODE_ENV: 'production', AUTONOMY_ENABLED: '1' }),
    /DATABASE_URL/,
  );
  assert.ok(createAutonomyStore({ NODE_ENV: 'test' }) instanceof MemoryAutonomyStore);
});
