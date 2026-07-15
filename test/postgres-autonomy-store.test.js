'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresAutonomyStore } = require('../src/storage/autonomy-store');

test('PostgresAutonomyStore migrates and persists autonomous state', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const store = await new PostgresAutonomyStore({ connectionString: process.env.TEST_DATABASE_URL }).init();
  const token = `${Date.now()}-${Math.random()}`;
  try {
    const snapshotId = await store.saveSnapshot({ mode: 'live', fetchedAt: new Date().toISOString(), events: [{ id: token }], providers: [] });
    assert.ok(snapshotId);
    assert.equal((await store.loadLatestSnapshot()).events[0].id, token);
    await store.upsertOpportunity({
      fingerprint: token, status: 'awaiting_recheck', eventKey: token, marketKey: 'h2h', edge: 0.01,
      expiresAt: new Date(Date.now() + 60_000), firstSeenAt: new Date(), lastSeenAt: new Date(),
      priceConfirmed: false, payload: { token },
    });
    const alert = await store.enqueueAlert({ dedupeKey: token, channel: 'webhook', destination: {}, payload: { token } });
    assert.equal(alert.inserted, true);
    assert.equal((await store.claimAlerts(1)).length, 1);
  } finally {
    await store.close();
  }
});
