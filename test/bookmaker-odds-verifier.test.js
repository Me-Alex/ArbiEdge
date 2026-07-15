'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectPriceChecks,
  decimalPriceVariants,
  eventMeetsMinHours,
  providerMatches,
  selectCandidate,
  textContainsPrice,
} = require('../scripts/verify-bookmaker-odds');

test('decimalPriceVariants supports dot, comma, fixed, and trimmed prices', () => {
  assert.deepEqual(decimalPriceVariants(3.8), ['3.80', '3,80', '3.8', '3,8']);
});

test('textContainsPrice matches standalone decimal odds only', () => {
  assert.equal(textContainsPrice('Over 6.5 @ 3,80 is visible', 3.8), true);
  assert.equal(textContainsPrice('Different price 13.80 is visible', 3.8), false);
});

test('providerMatches checks provider and brand names', () => {
  assert.equal(providerMatches({ name: 'GetsBet' }, 'getsbet'), true);
  assert.equal(
    providerMatches({ name: 'Digitain group', brands: [{ name: 'Bet7' }] }, 'Bet7'),
    true,
  );
});

test('selectCandidate picks a bookmaker event with matching market prices', () => {
  const event = {
    homeTeam: 'Elfsborg',
    awayTeam: 'Hammarby',
    competition: 'Sweden Allsvenskan',
    startsAt: '2026-07-20T17:00:00Z',
    bookmakers: [
      {
        name: 'GetsBet',
        eventUrl: 'https://example.test/event',
        markets: {
          h2h: { home: 2.1, draw: 3.2, away: 3.4 },
          totalGoals_6_5: { over: 3.8, under: 1.2 },
        },
      },
    ],
  };

  const candidate = selectCandidate([event], {
    bookmakerTarget: 'GetsBet',
    eventFilter: 'Elfsborg',
    marketFilter: 'total goals',
    maxPrices: 2,
  });

  assert.ok(candidate);
  assert.equal(candidate.bookmaker.url, 'https://example.test/event');
  assert.deepEqual(candidate.prices.map((price) => price.price), [3.8, 1.2]);
  assert.deepEqual(candidate.prices.map((price) => price.marketLabel), [
    'O/U 6.5 Goals',
    'O/U 6.5 Goals',
  ]);
});

test('selectCandidate can skip events that are too close to kickoff', () => {
  const nearEvent = {
    homeTeam: 'Near Home',
    awayTeam: 'Near Away',
    competition: 'Test League',
    startsAt: '2026-07-05T18:00:00Z',
    bookmakers: [
      {
        name: 'GetsBet',
        eventUrl: 'https://example.test/near',
        markets: { h2h: { home: 2.1, draw: 3.2, away: 3.4 } },
      },
    ],
  };
  const laterEvent = {
    homeTeam: 'Later Home',
    awayTeam: 'Later Away',
    competition: 'Test League',
    startsAt: '2026-07-06T18:00:00Z',
    bookmakers: [
      {
        name: 'GetsBet',
        eventUrl: 'https://example.test/later',
        markets: { h2h: { home: 2.2, draw: 3.3, away: 3.5 } },
      },
    ],
  };

  const candidate = selectCandidate([nearEvent, laterEvent], {
    bookmakerTarget: 'GetsBet',
    eventFilter: '',
    marketFilter: '',
    maxPrices: 3,
    minHours: 12,
    now: new Date('2026-07-05T17:00:00Z'),
  });

  assert.ok(candidate);
  assert.equal(candidate.bookmaker.url, 'https://example.test/later');
});

test('eventMeetsMinHours rejects invalid and too-soon kickoff times', () => {
  const threshold = new Date('2026-07-05T20:00:00Z');
  assert.equal(eventMeetsMinHours({ startsAt: '2026-07-05T19:59:00Z' }, threshold), false);
  assert.equal(eventMeetsMinHours({ startsAt: '2026-07-05T20:00:00Z' }, threshold), true);
  assert.equal(eventMeetsMinHours({ startsAt: null }, threshold), false);
});

test('collectPriceChecks prioritizes h2h when no market filter is provided', () => {
  const checks = collectPriceChecks({
    markets: {
      totalCards_4_5: { over: 2.5, under: 1.55 },
      h2h: { home: 2.1, draw: 3.2, away: 3.4 },
    },
  }, {
    marketFilter: '',
    maxPrices: 2,
  });

  assert.deepEqual(checks.map((check) => check.marketKey), ['h2h', 'h2h']);
});

test('collectPriceChecks accepts comma-separated market filters', () => {
  const checks = collectPriceChecks({
    markets: {
      totalCards_4_5: { over: 2.5, under: 1.55 },
      h2h: { home: 2.1, draw: 3.2, away: 3.4 },
      totalGoals_2_5: { over: 1.8, under: 2.05 },
    },
  }, {
    marketFilter: 'totalGoals,totalCorners',
    maxPrices: 4,
  });

  assert.deepEqual(checks.map((check) => check.marketKey), ['totalGoals_2_5', 'totalGoals_2_5']);
});
