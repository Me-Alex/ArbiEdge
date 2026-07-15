'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DurableAlertOutbox, destinationHash, retryDelayMs, webhookPayload } = require('../src/autonomy/alert-outbox');
const { MemoryAutonomyStore } = require('../src/storage/autonomy-store');
const { WebhookManager } = require('../src/finance/webhook-manager');

test('DurableAlertOutbox deduplicates and delivers configured webhooks', async () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-')), 'webhooks.json');
  const webhooks = new WebhookManager({ filePath });
  webhooks.addWebhook('https://example.test/hook', { minEdge: 0.01 });
  const calls = [];
  const store = await new MemoryAutonomyStore().init();
  const outbox = new DurableAlertOutbox({
    store,
    webhookManager: webhooks,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200 }; },
  });
  const opportunity = {
    eventName: 'A vs B', edge: 0.02, legs: [],
    autonomy: { fingerprint: 'fp', pricesHash: 'prices', expiresAt: '2026-07-14T12:01:00Z' },
  };
  assert.equal(await outbox.queueOpportunity(opportunity), 1);
  assert.equal(await outbox.queueOpportunity(opportunity), 0);
  const summary = await outbox.dispatchPending();
  assert.equal(summary.delivered, 1);
  assert.equal(calls.length, 1);
  assert.equal(destinationHash('x').length, 24);
  assert.equal(retryDelayMs(1), 1000);
  assert.equal(webhookPayload(opportunity).event, 'arb_alert');
});
