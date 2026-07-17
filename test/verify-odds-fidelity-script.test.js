'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVerificationIndex,
  isLiveEvent,
  normalizeVerificationRecords,
  selectFidelityCandidates,
  summarizeVerificationProblems,
} = require('../scripts/verify-odds-fidelity');

function event(overrides = {}) {
  return {
    id: overrides.id || 'event-1',
    homeTeam: overrides.homeTeam || 'Home',
    awayTeam: overrides.awayTeam || 'Away',
    competition: 'Test League',
    startsAt: overrides.startsAt || '2026-07-10T17:00:00Z',
    bookmakers: overrides.bookmakers || [{
      name: 'BookA',
      eventUrl: 'https://example.test/event/12345',
      markets: {
        h2h: { home: 2.2, draw: 3.4, away: 3.1 },
        totalGoals_2_5: { over: 1.8, under: 2.05 },
      },
    }],
    ...overrides,
  };
}

test('selectFidelityCandidates samples future events per bookmaker and requested markets', () => {
  const events = [
    event({ id: 'near', startsAt: '2026-07-05T18:00:00Z' }),
    event({ id: 'live', live: true, startsAt: '2026-07-10T18:00:00Z' }),
    event({ id: 'valid-1', homeTeam: 'Alpha' }),
    event({ id: 'valid-2', homeTeam: 'Beta' }),
  ];

  const candidates = selectFidelityCandidates(events, {
    bookmakerTarget: 'BookA',
    marketFilters: ['totalGoals'],
    eventsPerBookmaker: 1,
    maxPrices: 2,
    minHours: 2,
    now: new Date('2026-07-05T17:00:00Z'),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].event.id, 'valid-1');
  assert.deepEqual(candidates[0].prices.map((price) => price.marketKey), [
    'totalGoals_2_5',
    'totalGoals_2_5',
  ]);
});

test('selectFidelityCandidates skips events without bookmaker urls', () => {
  const candidates = selectFidelityCandidates([
    event({
      id: 'no-url',
      bookmakers: [{
        name: 'BookA',
        markets: { h2h: { home: 2.2, draw: 3.4, away: 3.1 } },
      }],
    }),
  ], {
    bookmakerTarget: 'all',
    marketFilters: ['h2h'],
    now: new Date('2026-07-05T17:00:00Z'),
  });

  assert.deepEqual(candidates, []);
});

test('isLiveEvent recognizes common live flags', () => {
  assert.equal(isLiveEvent({ live: true }), true);
  assert.equal(isLiveEvent({ inPlay: true }), true);
  assert.equal(isLiveEvent({ status: 'in_play' }), true);
  assert.equal(isLiveEvent({ status: 'scheduled' }), false);
});

test('normalizes fidelity reports into bookmaker market records and problem summaries', () => {
  const records = normalizeVerificationRecords([{
    provider: 'ProviderA',
    checkedAt: '2026-07-07T10:00:00.000Z',
    bookmaker: { name: 'BookA', url: 'https://example.test/event' },
    event: {
      id: 'event-1',
      homeTeam: 'Home',
      awayTeam: 'Away',
      competition: 'Test League',
      startsAt: '2026-07-10T17:00:00Z',
    },
    screenshotPath: 'output/fidelity/booka.png',
    priceChecks: [{
      marketKey: 'totalGoals_2_5',
      marketFamily: 'totalGoals',
      period: 'fulltime',
      line: '2.5',
      outcome: 'over',
      endpointPrice: 1.8,
      websitePrice: 1.9,
      status: 'mismatch',
      evidence: { source: 'table-row' },
    }],
  }]);

  assert.equal(records.length, 1);
  assert.equal(records[0].bookmaker, 'BookA');
  assert.equal(records[0].status, 'mismatch');
  assert.equal(records[0].screenshotPath, 'output/fidelity/booka.png');

  const index = buildVerificationIndex(records);
  assert.equal(index.BookA['event-1'].markets.totalGoals_2_5.over.status, 'mismatch');

  const summary = summarizeVerificationProblems(records);
  assert.equal(summary.total, 1);
  assert.equal(summary.byBookmaker.BookA.statuses.mismatch, 1);
  assert.equal(summary.byBookmaker.BookA.markets['totalGoals_2_5:over'].samples[0].websitePrice, 1.9);
});
