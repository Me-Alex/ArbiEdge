'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isBookmakerLobbyUrl, betconstructEventUrl } = require('../src/providers/event-links');
const {
  collectPriceChecks,
  decimalPriceVariants,
  eventMeetsMinHours,
  isAllowedNetworkEvidenceHost,
  networkBodyMatchesCandidate,
  providerMatches,
  selectCandidate,
  textContainsPrice,
} = require('../scripts/verify-bookmaker-odds');

test('decimalPriceVariants supports dot, comma, fixed, and trimmed prices', () => {
  assert.deepEqual(decimalPriceVariants(3.8), ['3.80', '3,80', '3.8', '3,8']);
});

test('allows Superbet Fastly API hosts for network fidelity evidence', () => {
  assert.equal(
    isAllowedNetworkEvidenceHost('production-superbet-offer-ro.freetls.fastly.net', 'superbet.ro'),
    true,
  );
  assert.equal(isAllowedNetworkEvidenceHost('exalogic.lasvegas.ro', 'lasvegas.ro'), true);
  assert.equal(isAllowedNetworkEvidenceHost('evil.example', 'superbet.ro'), false);
});

test('detects lobby URLs and builds BetConstruct event deep-links', () => {
  assert.equal(isBookmakerLobbyUrl('https://www.victorybet.ro/rv/pre-match'), true);
  assert.equal(isBookmakerLobbyUrl('https://www.manhattan.ro/ro/sports/pre-match'), true);
  assert.equal(
    isBookmakerLobbyUrl('https://www.victorybet.ro/rv/pre-match/event/12345'),
    false,
  );
  assert.equal(
    betconstructEventUrl('VictoryBet', { id: 99 }, 'https://www.victorybet.ro/rv/pre-match'),
    'https://www.victorybet.ro/rv/pre-match/event/99',
  );
  assert.equal(
    betconstructEventUrl('Manhattan', { id: 99 }, 'https://www.manhattan.ro/ro/sports/pre-match'),
    'https://www.manhattan.ro/ro/sports/event/99',
  );
});

test('selectCandidate skips lobby-only bookmaker URLs', () => {
  const event = {
    homeTeam: 'Home',
    awayTeam: 'Away',
    competition: 'League',
    startsAt: '2026-07-20T17:00:00Z',
    bookmakers: [{
      name: 'VictoryBet',
      bookmakerUrl: 'https://www.victorybet.ro/rv/pre-match',
      markets: { h2h: { home: 2.1, draw: 3.2, away: 3.4 } },
    }],
  };
  assert.equal(
    selectCandidate([event], {
      bookmakerTarget: 'VictoryBet',
      eventFilter: '',
      marketFilter: 'h2h',
      maxPrices: 3,
    }),
    null,
  );

  event.bookmakers[0].eventUrl = 'https://www.victorybet.ro/rv/pre-match/event/30';
  const candidate = selectCandidate([event], {
    bookmakerTarget: 'VictoryBet',
    eventFilter: '',
    marketFilter: 'h2h',
    maxPrices: 3,
  });
  assert.ok(candidate);
  assert.equal(candidate.bookmaker.url, 'https://www.victorybet.ro/rv/pre-match/event/30');
});

test('network body matches by event id when team names are abbreviated', () => {
  const candidate = {
    event: { id: 'superbet:13865104', homeTeam: 'Mainz', awayTeam: 'Kaiserslautern' },
    prices: [{ price: 1.4 }],
  };
  assert.equal(
    networkBodyMatchesCandidate(
      JSON.stringify({ eventId: 13865104, marketName: 'Ambele echipe marcheaza', name: 'Da', price: 1.4 }),
      candidate,
    ),
    true,
  );
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
        eventUrl: 'https://example.test/event/12345',
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
  assert.equal(candidate.bookmaker.url, 'https://example.test/event/12345');
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
        eventUrl: 'https://example.test/event/1',
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
        eventUrl: 'https://example.test/event/2',
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
  assert.equal(candidate.bookmaker.url, 'https://example.test/event/2');
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
