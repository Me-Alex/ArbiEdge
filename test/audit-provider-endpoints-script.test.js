'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAuditReport,
  isValidPrice,
  selectProviders,
  summarizeProviderEvents,
} = require('../scripts/audit-provider-endpoints');

test('isValidPrice accepts decimal odds and rejects broken prices', () => {
  assert.equal(isValidPrice(1.01), true);
  assert.equal(isValidPrice('2.45'), true);
  assert.equal(isValidPrice(1), false);
  assert.equal(isValidPrice(1001), false);
  assert.equal(isValidPrice('not-a-price'), false);
});

test('selectProviders can match a brand inside a family provider', () => {
  const family = {
    name: 'Family',
    brands: [{ name: 'Brand A' }, { name: 'Brand B' }],
  };
  assert.deepEqual(selectProviders([family], 'brand b'), [family]);
});

test('summarizeProviderEvents reports healthy current odds', () => {
  const provider = { name: 'Example', eventsUrl: 'https://example.test/api/events' };
  const events = [{
    homeTeam: 'Home',
    awayTeam: 'Away',
    competition: 'League',
    startsAt: '2026-07-15T18:00:00.000Z',
    bookmakers: [{
      name: 'Example',
      markets: { h2h: { home: 2.1, draw: 3.2, away: 3.4 } },
    }],
  }];

  const result = summarizeProviderEvents(provider, events, {
    checkedAt: '2026-07-14T10:00:00.000Z',
    durationMs: 10,
    now: new Date('2026-07-14T10:00:00.000Z'),
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.validPriceCount, 3);
  assert.equal(result.bookmakerRowsWithCompleteMarket, 1);
  assert.deepEqual(result.endpoints, ['https://example.test/api/events']);
});

test('buildAuditReport fails when any endpoint is degraded or failed', () => {
  const report = buildAuditReport([
    { status: 'healthy', events: 2, marketCount: 3, validPriceCount: 6 },
    { status: 'failed', events: 0, marketCount: 0, validPriceCount: 0 },
  ], '2026-07-14T10:00:00.000Z');

  assert.equal(report.ok, false);
  assert.equal(report.summary.providers, 2);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.events, 2);
});
