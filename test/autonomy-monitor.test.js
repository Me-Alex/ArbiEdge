'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AutonomyMonitor, compactReport } = require('../src/autonomy/autonomy-monitor');
const { MemoryAutonomyStore } = require('../src/storage/autonomy-store');

test('AutonomyMonitor records endpoint and rotating fidelity audits', async () => {
  const store = await new MemoryAutonomyStore().init();
  const monitor = new AutonomyMonitor({
    store,
    fidelityEnabled: true,
    providerNames: ['A', 'B'],
    endpointRunner: async () => ({ ok: true, checkedAt: 'now', summary: { healthy: 2 } }),
    discoveryRunner: async () => ({ generatedAt: 'now', count: 1, results: [{ ok: true, apiUrls: ['https://api.test'] }] }),
    fidelityRunner: async (provider) => ({
      ok: true, checkedAt: 'now', fidelitySummary: { verified: 1 },
      verificationRecords: [{ bookmaker: provider, marketKey: 'h2h', outcome: 'home', status: 'verified' }],
    }),
  });
  assert.equal((await monitor.runEndpointAudit()).ok, true);
  assert.equal((await monitor.runDiscoveryAudit()).ok, true);
  assert.equal((await monitor.runFidelityAudit()).ok, true);
  assert.equal(monitor.diagnostics().lastFidelity.provider, 'A');
  assert.equal(store.monitorRuns.length, 3);
  assert.equal(store.fidelityRecords.length, 1);
  assert.equal(compactReport({ ok: true }).ok, true);
});
