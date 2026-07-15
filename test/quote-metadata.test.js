'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bookmakerQuoteObservedAt,
  evaluateKickoffTiming,
  evaluateQuoteTiming,
  stampQuoteMetadata,
} = require('../src/core/quote-metadata');

test('stampQuoteMetadata timestamps bookmaker rows without mutating provider data', () => {
  const events = [{
    id: 'e1',
    startsAt: '2026-07-14T18:00:00Z',
    bookmakers: [{
      name: 'BookA',
      updatedAt: '2026-07-14T11:59:00Z',
      markets: { h2h: { home: 2.1 } },
    }],
  }];
  const stamped = stampQuoteMetadata(events, {
    observedAt: '2026-07-14T12:00:00Z',
    provider: 'ProviderA',
  });

  assert.equal(events[0].bookmakers[0].observedAt, undefined);
  assert.equal(stamped[0].bookmakers[0].observedAt, '2026-07-14T12:00:00.000Z');
  assert.equal(stamped[0].bookmakers[0].sourceUpdatedAt, '2026-07-14T11:59:00.000Z');
  assert.equal(stamped[0].bookmakers[0].provider, 'ProviderA');
  assert.equal(stamped[0].bookmakers[0].sourceStartsAt, '2026-07-14T18:00:00.000Z');
  assert.equal(bookmakerQuoteObservedAt(stamped[0].bookmakers[0], 'h2h'), '2026-07-14T12:00:00.000Z');
});

test('evaluateKickoffTiming requires selected legs to share the same kickoff window', () => {
  const matched = evaluateKickoffTiming([
    { kickoff: '2026-07-14T18:00:00Z' },
    { kickoff: '2026-07-14T18:03:00Z' },
  ], {
    expectedKickoff: '2026-07-14T18:00:00Z',
    maxSkewMs: 5 * 60_000,
  });
  assert.equal(matched.status, 'matched');
  assert.equal(matched.actionable, true);

  const mismatched = evaluateKickoffTiming([
    { kickoff: '2026-07-14T18:00:00Z' },
    { kickoff: '2026-07-14T18:10:00Z' },
  ], {
    expectedKickoff: '2026-07-14T18:00:00Z',
    maxSkewMs: 5 * 60_000,
  });
  assert.equal(mismatched.status, 'mismatched');
  assert.equal(mismatched.actionable, false);
  assert.equal(mismatched.skewMs, 10 * 60_000);

  assert.equal(evaluateKickoffTiming([
    { kickoff: '2026-07-14T18:00:00Z' },
    {},
  ]).status, 'missing');
});

test('evaluateQuoteTiming distinguishes fresh, stale, skewed, and missing selections', () => {
  const now = new Date('2026-07-14T12:00:30Z');
  const fresh = evaluateQuoteTiming([
    { observedAt: '2026-07-14T12:00:20Z' },
    { observedAt: '2026-07-14T12:00:25Z' },
  ], { now, maxAgeMs: 20_000, maxSkewMs: 10_000 });
  assert.equal(fresh.status, 'fresh');
  assert.equal(fresh.actionable, true);

  assert.equal(evaluateQuoteTiming([
    { observedAt: '2026-07-14T11:59:00Z' },
    { observedAt: '2026-07-14T11:59:05Z' },
  ], { now, maxAgeMs: 20_000, maxSkewMs: 10_000 }).status, 'stale');

  assert.equal(evaluateQuoteTiming([
    { observedAt: '2026-07-14T12:00:10Z' },
    { observedAt: '2026-07-14T12:00:25Z' },
  ], { now, maxAgeMs: 30_000, maxSkewMs: 10_000 }).status, 'skewed');

  assert.equal(evaluateQuoteTiming([
    { observedAt: '2026-07-14T12:00:25Z' },
    {},
  ], { now }).status, 'missing');
});
