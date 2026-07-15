'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server/app');

test('autonomy status is exposed through health, readiness, metrics, and its endpoint', async () => {
  const diagnostics = {
    enabled: true, started: true, cycleRunning: false,
    lastCycle: {
      ok: true,
      events: 10,
      providers: 3,
      snapshotsProcessed: 2,
      opportunities: {
        total: 7,
        actionable: 1,
        awaitingFidelity: 3,
        awaitingFreshness: 1,
        awaitingRecheck: 2,
        quoteTiming: { fresh: 4, stale: 1, skewed: 1 },
      },
      candidateVerification: {
        candidates: 2,
        legs: 5,
        records: 5,
        statusCounts: { verified: 4, mismatch: 1 },
      },
    },
    storage: { pendingAlerts: 2, fidelityRecords: 12 },
    supervisor: { providers: [{ stale: true, circuitState: 'closed' }, { stale: false, circuitState: 'open' }] },
  };
  const app = createApp({
    liveConfigured: true,
    oddsService: {
      diagnostics: () => ({
        mode: 'live', cache: { fresh: true, ageMs: 1, expiresInMs: 1000 }, inFlight: false,
        lastRefresh: { status: 'live', events: 10, providers: 2, failedProviders: 0 },
      }),
    },
    autonomyRuntime: { diagnostics: () => diagnostics },
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/health`).then((response) => response.json())).autonomy.enabled, true);
    assert.equal((await fetch(`${base}/api/readiness`)).status, 200);
    assert.equal((await fetch(`${base}/api/autonomy/status`).then((response) => response.json())).lastCycle.events, 10);
    const metrics = await fetch(`${base}/api/metrics`).then((response) => response.text());
    assert.match(metrics, /odds_autonomy_pending_alerts 2/);
    assert.match(metrics, /odds_autonomy_opportunities_actionable 1/);
    assert.match(metrics, /odds_autonomy_opportunities_awaiting_freshness 1/);
    assert.match(metrics, /odds_autonomy_verification_verified 4/);
    assert.match(metrics, /odds_autonomy_providers_circuit_open 1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
