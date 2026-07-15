'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AutonomousRuntime } = require('../src/autonomy/autonomous-runtime');
const { MemoryAutonomyStore } = require('../src/storage/autonomy-store');

test('AutonomousRuntime persists provider runs and executes the pipeline', async () => {
  const store = new MemoryAutonomyStore();
  let processed = 0;
  const runtime = new AutonomousRuntime({
    store,
    oddsService: {
      restoreFromStore: async () => null,
      forceRefresh: async () => ({ mode: 'live', fetchedAt: '2026-07-14T12:00:00Z', events: [{}], providers: [{ name: 'A', ok: true }] }),
    },
    opportunityPipeline: { processSnapshot: async () => { processed += 1; return { total: 0 }; } },
    alertOutbox: { dispatchPending: async () => ({ claimed: 0 }) },
    collectionIntervalMs: 60_000,
    alertIntervalMs: 60_000,
  });
  await runtime.start();
  assert.equal(processed, 1);
  assert.equal(store.providerRuns.length, 1);
  assert.equal(runtime.diagnostics().lastCycle.ok, true);
  await runtime.stop();
  assert.equal(runtime.diagnostics().started, false);
});

test('AutonomousRuntime evaluates bounded progressive snapshots before final collection', async () => {
  const store = new MemoryAutonomyStore();
  let processed = 0;
  let verified = 0;
  const runtime = new AutonomousRuntime({
    store,
    oddsService: {
      restoreFromStore: async () => null,
      async *forceRefreshStream() {
        yield { mode: 'live', fetchedAt: '2026-07-14T12:00:00Z', events: [], providers: [], progress: { done: 0, total: 2, complete: false } };
        yield { mode: 'live', fetchedAt: '2026-07-14T12:00:00Z', events: [{}], providers: [{ name: 'A', ok: true }], progress: { done: 1, total: 2, complete: false } };
        yield { mode: 'live', fetchedAt: '2026-07-14T12:00:00Z', events: [{}, {}], providers: [{ name: 'A', ok: true }, { name: 'B', ok: true }], progress: { done: 2, total: 2, complete: true } };
      },
    },
    opportunityPipeline: { processSnapshot: async () => { processed += 1; return { total: 0 }; } },
    candidateVerificationBroker: {
      verifySnapshot: async () => { verified += 1; return { ok: true, records: 0 }; },
      diagnostics: () => ({ enabled: true }),
    },
    alertOutbox: { dispatchPending: async () => ({ claimed: 0 }) },
    progressiveBatches: 2,
    collectionIntervalMs: 60_000,
    alertIntervalMs: 60_000,
  });

  await runtime.start();
  assert.equal(processed, 2);
  assert.equal(verified, 2);
  assert.equal(runtime.diagnostics().lastCycle.snapshotsProcessed, 2);
  assert.equal(store.providerRuns.length, 2);
  await runtime.stop();
});
