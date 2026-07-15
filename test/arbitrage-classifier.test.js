'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectArbitrage,
  detectCrossMarketArbitrage,
  getAllOpportunities,
  getMarketLabel,
} = require('../src/formula-engine');

function eventWith(bookmakers) {
  return {
    homeTeam: 'Home',
    awayTeam: 'Away',
    competition: 'Test League',
    startsAt: '2026-07-15T18:00:00Z',
    bookmakers: bookmakers.map((bookmaker) => ({
      sourceStartsAt: '2026-07-15T18:00:00Z',
      ...bookmaker,
    })),
  };
}

test('strict 1X2 arbitrage requires the draw outcome', () => {
  const event = eventWith([
    { name: 'Book A', markets: { h2h: { home: 70, away: 75 } } },
  ]);

  assert.equal(detectArbitrage(event, 'h2h'), null);
});

test('classic arbitrage uses one guaranteed payout, not a sum of all payouts', () => {
  const event = eventWith([
    { name: 'Book A', markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } } },
    { name: 'Book B', markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } } },
  ]);

  const opportunity = detectArbitrage(event, 'h2h');

  assert.ok(opportunity);
  const expectedReturn = opportunity.stake / opportunity.totalProb;
  assert.equal(Number(opportunity.returnAmount.toFixed(6)), Number(expectedReturn.toFixed(6)));
  assert.equal(
    Number(opportunity.profit.toFixed(6)),
    Number((expectedReturn - opportunity.stake).toFixed(6)),
  );
  assert.ok(opportunity.profit < opportunity.stake, 'profit should not be multiplied by outcome count');
});

test('generic extreme two-way markets are rejected as likely data errors', () => {
  const event = eventWith([
    { name: 'Book A', markets: { market_exotic: { home: 70, away: 75 } } },
  ]);

  assert.equal(detectArbitrage(event, 'market_exotic'), null);
});

test('generic two-way markets are rejected without an explicit outcome schema', () => {
  const event = eventWith([
    { name: 'Book A', markets: { market_custom: { home: 2.1, away: 2.1 } } },
    { name: 'Book B', markets: { market_custom: { home: 2.0, away: 2.0 } } },
  ]);

  assert.equal(detectArbitrage(event, 'market_custom'), null);
});

test('overlapping double-chance outcomes are not scanned as classic arbitrage', () => {
  const event = eventWith([
    { name: 'Book A', markets: { doubleChance: { homeDraw: 2.1, homeAway: 2.1, drawAway: 2.1 } } },
  ]);

  assert.equal(detectArbitrage(event, 'doubleChance'), null);
});

test('cross-market double-chance combinations are surfaced separately', () => {
  const event = eventWith([
    { name: 'Book A', markets: { h2h: { home: 3, draw: 3, away: 3.5 } } },
    { name: 'Book B', markets: { doubleChance: { homeDraw: 1.45 } } },
  ]);

  const opportunities = detectCrossMarketArbitrage(event);

  assert.ok(opportunities.some((item) => item.marketKey === 'cross_1X_2'));
});

test('aggregate opportunities include event metadata for UI and exports', () => {
  const opportunities = getAllOpportunities([
    eventWith([
      { name: 'Book A', markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } } },
      { name: 'Book B', markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } } },
    ]),
  ]);

  assert.ok(opportunities.length > 0);
  assert.ok(opportunities.every((item) => item.eventName === 'Home vs Away'));
  assert.ok(opportunities.every((item) => item.competition === 'Test League'));
  assert.ok(opportunities.every((item) => item.kickoff === '2026-07-15T18:00:00Z'));
});

test('aggregate opportunities require verified cross-book evidence to become actionable', () => {
  const opportunity = getAllOpportunities([
    eventWith([
      {
        name: 'Book A',
        markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } },
        verification: { markets: { h2h: { home: { status: 'verified' } } } },
      },
      {
        name: 'Book B',
        markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } },
        verification: { markets: { h2h: { draw: { status: 'verified' }, away: { status: 'verified' } } } },
      },
    ]),
  ]).find((item) => item.marketKey === 'h2h');

  assert.ok(opportunity);
  assert.equal(opportunity.eligibility, 'actionable');
  assert.equal(opportunity.allLegsVerified, true);
  assert.equal(opportunity.sameBook, false);
  assert.deepEqual(opportunity.eligibilityReasons, []);
});

test('same-book underrounds remain visible but are rejected', () => {
  const opportunity = getAllOpportunities([
    eventWith([
      { name: 'Book A', markets: { h2h: { home: 2.6, draw: 3.4, away: 3.6 } } },
    ]),
  ]).find((item) => item.marketKey === 'h2h');

  assert.ok(opportunity);
  assert.equal(opportunity.eligibility, 'rejected');
  assert.equal(opportunity.sameBook, true);
  assert.ok(opportunity.eligibilityReasonCodes.includes('same_book'));
});

test('market labels preserve operator-readable line information', () => {
  assert.equal(getMarketLabel('totalGoals_2_5'), 'O/U 2.5 Goals');
  assert.equal(getMarketLabel('asianHandicap_plus_0_5'), 'AH +0.5');
  assert.equal(getMarketLabel('market_marcheaza_home'), 'Home to Score');
});
