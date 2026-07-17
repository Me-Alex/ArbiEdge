'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  detectArbitrage,
  detectCrossMarketArbitrage,
  detectMiddleBets,
  detectHandicapArbitrage,
  detectBttsTeamScoreArbitrage,
  detectTeamMatchTotalArbitrage,
  detectValueBet,
  getAllOpportunities,
  getValueBets,
  getEventMarkets,
  findBestPrices,
  classifyConfidence,
  getMarketLabel,
  getOutcomeLabel,
  calculateNoVigMarket,
} = require('../src/formula-engine');

function makeEvent(overrides = {}) {
  return {
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    startsAt: '2026-07-15T18:00:00Z',
    competition: 'Test League',
    bookmakers: [],
    ...overrides,
  };
}

test('detectArbitrage finds classic cross-book arb', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } },
      },
      {
        name: 'BookB',
        markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } },
      },
    ],
  });

  const arb = detectArbitrage(event, 'h2h');
  assert.ok(arb, 'should detect an arbitrage');
  assert.strictEqual(arb.type, 'classic');
  assert.ok(arb.edge > 0, 'edge should be positive');
  assert.equal(
    Number(arb.profit.toFixed(6)),
    Number((arb.stake / arb.totalProb - arb.stake).toFixed(6)),
  );
  assert.strictEqual(arb.legs.length, 3);
  assert.strictEqual(arb.legs[0].bookmaker, 'BookA'); // best home
  assert.strictEqual(arb.legs[1].bookmaker, 'BookB'); // best draw
  assert.strictEqual(arb.legs[2].bookmaker, 'BookB'); // best away
});

test('detectArbitrage returns null when no edge', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 1.5, draw: 3.5, away: 6.0 } } },
    ],
  });

  const arb = detectArbitrage(event, 'h2h');
  // 1/1.5 + 1/3.5 + 1/6 = 0.667 + 0.286 + 0.167 = 1.119 > 1, no arb
  assert.strictEqual(arb, null);
});

test('detectArbitrage returns null for single outcome', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 2.5 } } },
    ],
  });

  assert.strictEqual(detectArbitrage(event, 'h2h'), null);
});

test('detectArbitrage rejects 3-way market with missing outcome', () => {
  // h2h with only home and away — draw is missing
  // Old behavior: 1/70 + 1/75 = 0.0276 → 97.2% fake edge
  // New behavior: null (draw required for h2h)
  const event = makeEvent({
    bookmakers: [
      { name: 'Superbet', markets: { h2h: { home: 70.0, away: 75.0 } } },
    ],
  });

  assert.strictEqual(detectArbitrage(event, 'h2h'), null);
});

test('detectArbitrage rejects edge above MAX_ARB_EDGE', () => {
  // Generic market with 2 outcomes at extreme odds — edge would be ~97%
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { market_exotic: { home: 70.0, away: 75.0 } } },
    ],
  });

  assert.strictEqual(detectArbitrage(event, 'market_exotic'), null);
});

test('detectArbitrage rejects generic market without a proven outcome schema', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { market_custom: { home: 2.1, away: 2.1 } } },
      { name: 'BookB', markets: { market_custom: { home: 2.0, away: 2.0 } } },
    ],
  });

  assert.strictEqual(detectArbitrage(event, 'market_custom'), null);
});

test('detectArbitrage scans integer totals as candidates and half-lines as classic arbs', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: {
        totalGoals_2: { over: 2.1, under: 2.1 },
        totalGoals_2_5: { over: 2.1, under: 2.1 },
      } },
    ],
  });

  // Integer lines are scannable math candidates (push risk → review eligibility).
  assert.ok(detectArbitrage(event, 'totalGoals_2'));
  assert.ok(detectArbitrage(event, 'totalGoals_2_5'));
});

test('detectArbitrage rejects non-positive total line markets', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'Unibet', markets: { totalGoals_0: { over: 1.58, under: 2.3 } } },
      { name: 'BookB', markets: { totalGoals_0: { over: 1.6, under: 2.35 } } },
    ],
  });

  assert.strictEqual(detectArbitrage(event, 'totalGoals_0'), null);
});

test('detectArbitrage rejects result-like generic market with missing draw outcome', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'Superbet',
        markets: {
          market_rezultat_1x2_in_primele_x_minute_1: {
            primele_1_min_minus_1: 70.0,
            primele_1_min_minus_2: 75.0,
          },
        },
      },
    ],
  });

  assert.strictEqual(
    detectArbitrage(event, 'market_rezultat_1x2_in_primele_x_minute_1'),
    null,
  );
});

test('detectArbitrage rejects incomplete bucketed interval markets', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'NetBet',
        markets: {
          market_a_doua_repriza_total_goluri_away_interval_extins_2: {
            '2minus3': 126.0,
            '2minus4': 126.0,
          },
        },
      },
    ],
  });

  assert.strictEqual(
    detectArbitrage(event, 'market_a_doua_repriza_total_goluri_away_interval_extins_2'),
    null,
  );
});

test('detectArbitrage ignores invalid odds', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 0, draw: -1, away: 'abc' } } },
      { name: 'BookB', markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } } },
      { name: 'BookC', markets: { h2h: { home: 2.6, draw: 3.4, away: 3.6 } } },
    ],
  });

  // Best: home=2.6, draw=3.4, away=3.6 → 0.385+0.294+0.278 = 0.957 < 1 → arb
  const arb = detectArbitrage(event, 'h2h');
  assert.ok(arb, 'should detect arb from valid bookmakers');
  assert.strictEqual(arb.legs.length, 3);
  assert.strictEqual(arb.legs[0].bookmaker, 'BookC'); // best home
  assert.strictEqual(arb.legs[1].bookmaker, 'BookC'); // best draw
  assert.strictEqual(arb.legs[2].bookmaker, 'BookC'); // best away
});

test('calculateNoVigMarket strips margin from a 3-way market', () => {
  const result = calculateNoVigMarket({ home: 2.4, draw: 3.3, away: 3.1 });

  assert.ok(result);
  assert.ok(result.overround > 1);
  assert.strictEqual(result.outcomes.length, 3);

  const fairProbTotal = result.outcomes.reduce((sum, outcome) => sum + outcome.fairProb, 0);
  assert.strictEqual(Number(fairProbTotal.toFixed(6)), 1);

  const home = result.outcomes.find((outcome) => outcome.outcome === 'home');
  assert.ok(home);
  assert.ok(home.fairOdds > home.price, 'fair odds should lengthen once vig is removed');
});

test('calculateNoVigMarket returns null when fewer than two valid prices exist', () => {
  assert.strictEqual(calculateNoVigMarket({ home: 2.1 }), null);
  assert.strictEqual(calculateNoVigMarket({ home: 0, away: 1 }), null);
});

test('detectCrossMarketArbitrage finds 1X + 2 edge', () => {
  // h2h: home=3.0, draw=3.0, away=3.0 → implied 1.0
  // DC 1X at 1.5 → implied 0.667
  // h2h away at 3.0 → implied 0.333
  // total = 1.0 → no edge
  // Let's make it so DC 1X is cheap and away is cheap
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 3.0, draw: 3.0, away: 3.5 } } },
      { name: 'BookB', markets: { doubleChance: { homeDraw: 1.45 } } },
    ],
  });

  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.length > 0, 'should find cross-market arb');
  const oneXTwo = results.find((r) => r.marketKey === 'cross_1X_2');
  assert.ok(oneXTwo, 'should find 1X + 2 combination');
  assert.ok(oneXTwo.edge > 0);
});

test('detectMiddleBets pairs European and Asian goal lines across families', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          totalGoals_2_5: { over: 2.15, under: 1.75 },
          asianTotalGoals_3_25: { over: 2.4, under: 2.2 },
        },
      },
      {
        name: 'BookB',
        markets: {
          totalGoals_2_5: { over: 2.05, under: 1.8 },
          asianTotalGoals_3_25: { over: 2.3, under: 2.05 },
        },
      },
    ],
  });
  const middles = detectMiddleBets(event);
  assert.ok(middles.some((item) => item.crossFamily && item.marketKey.includes('totalGoals_2_5') && item.marketKey.includes('asianTotalGoals_3_25')));
});

test('detectMiddleBets finds non-adjacent line pairs in the same family', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          totalGoals_2_5: { over: 2.2, under: 1.7 },
          totalGoals_3: { over: 2.0, under: 1.85 },
          totalGoals_3_5: { over: 2.5, under: 2.15 },
        },
      },
      {
        name: 'BookB',
        markets: {
          totalGoals_2_5: { over: 2.05, under: 1.8 },
          totalGoals_3: { over: 1.9, under: 1.95 },
          totalGoals_3_5: { over: 2.3, under: 2.05 },
        },
      },
    ],
  });

  const middles = detectMiddleBets(event);
  assert.ok(middles.some((item) => item.marketKey.includes('totalGoals_2_5') && item.marketKey.includes('totalGoals_3_5')));
  assert.ok(middles.some((item) => item.middleWindow === '2.5 - 3.5'));
});

test('detectMiddleBets preserves decimal lines and does not mix market families', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'Superbet',
        markets: {
          totalGoals_6_5: { over: 17.0, under: 1.02 },
          totalGoals_7_5: { over: 30.0, under: 3.65 },
          totalCorners_7_5: { over: 1.2, under: 3.65 },
        },
      },
    ],
  });

  const results = detectMiddleBets(event);
  assert.ok(results.length > 0, 'should find at least one middle candidate');
  assert.ok(
    results.some((r) => r.marketLabel === 'Goals Middle: Over 6.5 / Under 7.5'),
    'should preserve decimal line values and market family in middle labels',
  );
  const goalsMiddle = results.find((r) => r.marketLabel === 'Goals Middle: Over 6.5 / Under 7.5');
  assert.ok(goalsMiddle);
  assert.deepStrictEqual(
    goalsMiddle.legs.map((leg) => leg.label),
    ['Over 6.5 Goals', 'Under 7.5 Goals'],
  );
  assert.ok(
    !results.some((r) => r.marketKey === 'middle_totalGoals_6_5_totalCorners_7_5'),
    'should not mix goals and corners into the same middle',
  );
});

test('detectMiddleBets does not mix full-time and first-half corner totals', () => {
  const event = makeEvent({
    homeTeam: 'Brommapojkarna',
    awayTeam: 'GAIS',
    competition: 'Allsvenskan',
    bookmakers: [
      {
        name: 'GetsBet',
        markets: {
          firstHalfTotalCorners_6_5: { over: 4.25, under: 1.15 },
          totalCorners_7_5: { over: 1.27, under: 3.3 },
        },
      },
    ],
  });

  const results = detectMiddleBets(event);

  assert.equal(
    results.some((result) => result.marketLabel === 'Corners Middle: Over 6.5 / Under 7.5'),
    false,
    'should not pair first-half over corners with full-time under corners',
  );
  assert.equal(
    results.some((result) =>
      result.marketKey.includes('firstHalfTotalCorners') &&
      result.marketKey.includes('totalCorners')),
    false,
    'should not emit any middle that crosses first-half and full-time corner keys',
  );
});

test('detectMiddleBets ignores zero total lines from bad provider normalization', () => {
  const event = makeEvent({
    homeTeam: 'Arsenal',
    awayTeam: 'Coventry',
    competition: 'Anglia Premier League',
    bookmakers: [
      {
        name: 'Unibet',
        markets: {
          totalGoals_0: { over: 1.58, under: 2.3 },
        },
      },
      {
        name: 'Superbet',
        markets: {
          totalGoals_0_5: { over: 1.01, under: 16 },
        },
      },
    ],
  });

  const results = detectMiddleBets(event);

  assert.equal(
    results.some((result) => result.marketLabel === 'Goals Middle: Over 0 / Under 0.5'),
    false,
    'should not build a middle from a zero total-goals line',
  );
});

test('detectMiddleBets names card and corner market families', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          totalCards_4_5: { over: 3.2, under: 1.2 },
          totalCards_5_5: { over: 4.2, under: 2.6 },
          firstHalfTotalCorners_3_5: { over: 2.5, under: 1.55 },
          firstHalfTotalCorners_4_5: { over: 3.8, under: 2.6 },
        },
      },
    ],
  });

  const results = detectMiddleBets(event);
  assert.ok(
    results.some((r) => r.marketLabel === 'Cards Middle: Over 4.5 / Under 5.5'),
    'should name card middles explicitly',
  );
  assert.ok(
    results.some((r) => r.marketLabel === '1st Half Corners Middle: Over 3.5 / Under 4.5'),
    'should name period-specific corner middles explicitly',
  );
});

test('detectValueBet identifies outlier price', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
      { name: 'BookB', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
      { name: 'BookC', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
      { name: 'BookD', markets: { h2h: { home: 2.0, draw: 3.2, away: 5.5 } } }, // outlier
    ],
  });

  const vb = detectValueBet(event, 'h2h');
  assert.ok(vb, 'should detect a value bet');
  assert.strictEqual(vb.outcome, 'away');
  assert.strictEqual(vb.bookmaker, 'BookD');
  assert.ok(vb.gap > 0, 'gap should be positive');
});

test('detectValueBet rejects non-positive total line markets', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { totalGoals_0: { over: 1.58, under: 2.3 } } },
      { name: 'BookB', markets: { totalGoals_0: { over: 1.59, under: 2.32 } } },
      { name: 'BookC', markets: { totalGoals_0: { over: 2.2, under: 2.31 } } },
    ],
  });

  assert.strictEqual(detectValueBet(event, 'totalGoals_0'), null);
});

test('detectValueBet returns null when only one bookmaker', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
    ],
  });

  assert.strictEqual(detectValueBet(event, 'h2h'), null);
});

test('detectValueBet rejects result-like generic market with missing draw outcome', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          market_rezultat_1x2_in_primele_x_minute_1: {
            primele_1_min_minus_1: 6.2,
            primele_1_min_minus_2: 7.4,
          },
        },
      },
      {
        name: 'BookB',
        markets: {
          market_rezultat_1x2_in_primele_x_minute_1: {
            primele_1_min_minus_1: 2.4,
            primele_1_min_minus_2: 2.5,
          },
        },
      },
    ],
  });

  assert.strictEqual(
    detectValueBet(event, 'market_rezultat_1x2_in_primele_x_minute_1'),
    null,
  );
});

test('detectValueBet rejects incomplete bucketed interval markets', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'NetBet',
        markets: {
          market_a_doua_repriza_total_goluri_away_interval_extins_2: {
            '2minus3': 126.0,
            '2minus4': 126.0,
          },
        },
      },
      {
        name: 'BookB',
        markets: {
          market_a_doua_repriza_total_goluri_away_interval_extins_2: {
            '2minus3': 4.8,
            '2minus4': 5.2,
          },
        },
      },
    ],
  });

  assert.strictEqual(
    detectValueBet(event, 'market_a_doua_repriza_total_goluri_away_interval_extins_2'),
    null,
  );
});

test('getAllOpportunities aggregates from multiple events', () => {
  const events = [
    makeEvent({
      homeTeam: 'Team X',
      bookmakers: [
        { name: 'BookA', markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } } },
        { name: 'BookB', markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } } },
      ],
    }),
    makeEvent({
      homeTeam: 'Team Y',
      bookmakers: [
        { name: 'BookC', markets: { h2h: { home: 1.8, draw: 3.5, away: 5.0 } } },
      ],
    }),
  ];

  const opps = getAllOpportunities(events);
  assert.ok(opps.length > 0, 'should find at least one opportunity');
  assert.ok(opps.every((o) => o.eventName), 'every opp should have eventName');
});

test('getAllOpportunities rejects an arbitrage when selected bookmaker kickoffs disagree', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        feedGroup: 'bookmaker:book-a',
        sourceStartsAt: '2026-07-15T18:00:00Z',
        observedAt: '2026-07-14T12:00:00Z',
        markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } },
        verification: { markets: { h2h: { home: 'verified' } } },
      },
      {
        name: 'BookB',
        feedGroup: 'bookmaker:book-b',
        sourceStartsAt: '2026-07-15T18:10:00Z',
        observedAt: '2026-07-14T12:00:05Z',
        markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } },
        verification: { markets: { h2h: { draw: 'verified', away: 'verified' } } },
      },
    ],
  });

  const opportunity = getAllOpportunities([event], {
    now: new Date('2026-07-14T12:00:10Z'),
  }).find((item) => item.marketKey === 'h2h');

  assert.ok(opportunity, 'the mathematical edge remains visible for diagnosis');
  assert.equal(opportunity.kickoffTiming.status, 'mismatched');
  assert.equal(opportunity.kickoffTiming.skewMs, 10 * 60_000);
  assert.equal(opportunity.kickoffsMatched, false);
  assert.equal(opportunity.eligibility, 'rejected');
  assert.ok(opportunity.eligibilityReasonCodes.includes('kickoff_mismatch'));
});

test('getAllOpportunities caps confidence when a selected leg has failed fidelity verification', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } },
      },
      {
        name: 'BookB',
        markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } },
        verification: {
          markets: {
            h2h: {
              draw: { status: 'mismatch' },
              away: { status: 'verified' },
            },
          },
        },
      },
    ],
  });

  const opportunity = getAllOpportunities([event])
    .find((item) => item.marketKey === 'h2h');

  assert.ok(opportunity, 'should still detect the mathematical opportunity');
  assert.equal(opportunity.confidence, 'risky');
  assert.equal(opportunity.eligibility, 'rejected');
  assert.ok(opportunity.eligibilityReasonCodes.includes('verification_failed'));
  assert.deepEqual(opportunity.verificationStatuses, ['unverified', 'mismatch', 'verified']);
  assert.equal(
    opportunity.legs.find((leg) => leg.outcome === 'draw').verificationStatus,
    'mismatch',
  );
});

test('getAllOpportunities caps ambiguous fidelity at review without promoting weaker confidence', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } },
      },
      {
        name: 'BookB',
        markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } },
        verification: {
          markets: {
            h2h: {
              draw: { status: 'ambiguous' },
              away: { status: 'verified' },
            },
          },
        },
      },
    ],
  });

  const opportunity = getAllOpportunities([event])
    .find((item) => item.marketKey === 'h2h');

  assert.ok(opportunity);
  assert.equal(opportunity.confidence, 'review');
  assert.equal(opportunity.eligibility, 'review');
  assert.ok(opportunity.eligibilityReasonCodes.includes('verification_missing'));
});

test('getAllOpportunities caps missing fidelity verification at review', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } },
      },
      {
        name: 'BookB',
        markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } },
      },
    ],
  });

  const opportunity = getAllOpportunities([event])
    .find((item) => item.marketKey === 'h2h');

  assert.ok(opportunity);
  assert.equal(opportunity.confidence, 'review');
  assert.equal(opportunity.eligibility, 'review');
  assert.equal(opportunity.allLegsVerified, false);
  assert.deepEqual(opportunity.verificationStatuses, ['unverified']);
});

test('getAllOpportunities fills leg kickoff from event startsAt when bookmaker lacks it', () => {
  const event = makeEvent({
    startsAt: '2026-07-20T18:00:00Z',
    bookmakers: [
      {
        name: 'BookA',
        // no sourceStartsAt
        markets: { h2h: { home: 2.5, draw: 3.2, away: 3.0 } },
      },
      {
        name: 'BookB',
        markets: { h2h: { home: 2.4, draw: 3.5, away: 3.8 } },
      },
    ],
  });

  const opportunity = getAllOpportunities([event]).find((item) => item.marketKey === 'h2h');
  assert.ok(opportunity);
  assert.ok(opportunity.legs.every((leg) => Date.parse(leg.kickoff) === Date.parse('2026-07-20T18:00:00Z')));
  assert.equal(opportunity.kickoffTiming?.status, 'matched');
  assert.ok(!opportunity.eligibilityReasonCodes?.includes('kickoff_missing'));
});

test('getAllOpportunities keeps edge outliers in review (not actionable, not hard-rejected)', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: { h2h: { home: 3, draw: 3, away: 3 } },
        verification: { markets: { h2h: { home: 'verified' } } },
      },
      {
        name: 'BookB',
        markets: { h2h: { home: 2.9, draw: 4, away: 4 } },
        verification: { markets: { h2h: { draw: 'verified', away: 'verified' } } },
      },
    ],
  });

  const opportunity = getAllOpportunities([event]).find((item) => item.marketKey === 'h2h');
  assert.ok(opportunity);
  assert.ok(opportunity.edge > 0.08);
  assert.equal(opportunity.eligibility, 'review');
  assert.ok(opportunity.eligibilityReasonCodes.includes('edge_outlier'));
});

test('detectArbitrage scans goals odd/even as classic two-way', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { market_total_goluri_impar_par: { odd: 2.1, even: 1.85 } } },
      { name: 'BookB', markets: { market_total_goluri_impar_par: { odd: 1.9, even: 2.15 } } },
    ],
  });
  const arb = detectArbitrage(event, 'market_total_goluri_impar_par');
  assert.ok(arb);
  assert.equal(arb.type, 'classic');
  assert.ok(arb.edge > 0);
});

test('sport-aware h2h scanning accepts two-way basketball outcomes', () => {
  const event = makeEvent({
    sport: 'basketball',
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 2.1, away: 2.1 } } },
    ],
  });

  assert.ok(detectArbitrage(event, 'h2h', 'basketball'));
});

test('classic scanning supports half-line point totals in non-football sports', () => {
  const event = {
    id: 'basketball-total',
    sport: 'Basketball',
    competition: 'NBA',
    startsAt: '2026-07-15T18:00:00Z',
    homeTeam: 'Home',
    awayTeam: 'Away',
    bookmakers: [
      { name: 'BookA', markets: { totalPoints_224_5: { over: 2.1, under: 1.8 } } },
      { name: 'BookB', markets: { totalPoints_224_5: { over: 1.8, under: 2.1 } } },
    ],
  };
  const arb = detectArbitrage(event, 'totalPoints_224_5', event.sport);
  assert.ok(arb);
  assert.equal(arb.marketLabel, 'O/U 224.5 Points');
  assert.equal(arb.legs.length, 2);
});

test('getValueBets returns sorted by Kelly', () => {
  const events = [
    makeEvent({
      bookmakers: [
        { name: 'BookA', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
        { name: 'BookB', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
        { name: 'BookC', markets: { h2h: { home: 2.0, draw: 3.2, away: 5.5 } } },
      ],
    }),
  ];

  const bets = getValueBets(events, 10);
  assert.ok(bets.length > 0);
  for (let i = 1; i < bets.length; i++) {
    assert.ok(bets[i - 1].kelly >= bets[i].kelly, 'bets should be sorted by Kelly desc');
  }
});

test('classifyConfidence returns correct levels', () => {
  assert.strictEqual(classifyConfidence(0.06, 3, 3), 'high');
  assert.strictEqual(classifyConfidence(0.03, 2, 2), 'trusted');
  assert.strictEqual(classifyConfidence(0.01, 2, 2), 'review');
  assert.strictEqual(classifyConfidence(0.001, 2, 2), 'risky');
});

test('getMarketLabel returns known labels', () => {
  assert.strictEqual(getMarketLabel('h2h'), '1X2');
  assert.strictEqual(getMarketLabel('doubleChance'), 'Double Chance');
  assert.strictEqual(getMarketLabel('drawNoBet'), 'Draw No Bet');
});

test('getMarketLabel parses line markets correctly', () => {
  assert.strictEqual(getMarketLabel('totalGoals_2_5'), 'O/U 2.5 Goals');
  assert.strictEqual(getMarketLabel('totalGoals_3'), 'O/U 3 Goals');
  assert.strictEqual(getMarketLabel('firstHalfTotalGoals_1_5'), '1H O/U 1.5 Goals');
  assert.strictEqual(getMarketLabel('totalCorners_8_5'), 'O/U 8.5 Corners');
  assert.strictEqual(getMarketLabel('totalCards_4'), 'O/U 4 Cards');
});

test('getMarketLabel parses handicap lines correctly', () => {
  assert.strictEqual(getMarketLabel('asianHandicap_plus_0_5'), 'AH +0.5');
  assert.strictEqual(getMarketLabel('asianHandicap_minus_1'), 'AH -1');
  assert.strictEqual(getMarketLabel('handicap_plus_2'), 'Handicap +2');
  assert.strictEqual(getMarketLabel('handicap_minus_0_25'), 'Handicap -0.25');
});

test('getMarketLabel handles market_ prefixed keys', () => {
  assert.strictEqual(getMarketLabel('market_marcheaza_home'), 'Home to Score');
  assert.strictEqual(getMarketLabel('market_marcheaza_away'), 'Away to Score');
  assert.strictEqual(getMarketLabel('market_clean_sheet_home'), 'Home Clean Sheet');
});

test('describeMarket returns descriptions for known markets', () => {
  const { describeMarket } = require('../src/formula-engine');
  assert.strictEqual(describeMarket('h2h'), 'Match result — Home / Draw / Away');
  assert.strictEqual(describeMarket('drawNoBet'), 'Home or Away wins; stake refunded on a draw');
  assert.ok(describeMarket('asianHandicap_plus_0_5').includes('Asian handicap +0.5'));
  assert.ok(describeMarket('totalGoals_2_5').includes('Over/Under'));
  assert.strictEqual(describeMarket('nonexistent_market'), null);
});

test('getOutcomeLabel returns known labels', () => {
  assert.strictEqual(getOutcomeLabel('home'), '1');
  assert.strictEqual(getOutcomeLabel('draw'), 'X');
  assert.strictEqual(getOutcomeLabel('away'), '2');
  assert.strictEqual(getOutcomeLabel('homeDraw'), '1X');
  assert.strictEqual(getOutcomeLabel('homeAway'), '12');
  assert.strictEqual(getOutcomeLabel('drawAway'), 'X2');
});

test('findBestPrices picks highest price per outcome', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 2.0, draw: 3.0, away: 4.0 } } },
      { name: 'BookB', markets: { h2h: { home: 2.5, draw: 2.8, away: 3.5 } } },
    ],
  });

  const best = findBestPrices(event, 'h2h');
  assert.strictEqual(best.home.price, 2.5);
  assert.strictEqual(best.home.bookmaker, 'BookB');
  assert.strictEqual(best.draw.price, 3.0);
  assert.strictEqual(best.draw.bookmaker, 'BookA');
  assert.strictEqual(best.away.price, 4.0);
  assert.strictEqual(best.away.bookmaker, 'BookA');
});

test('getEventMarkets returns unique market keys', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: {}, doubleChance: {} } },
      { name: 'BookB', markets: { h2h: {}, drawNoBet: {} } },
    ],
  });

  const keys = getEventMarkets(event);
  assert.strictEqual(keys.length, 3);
  assert.ok(keys.includes('h2h'));
  assert.ok(keys.includes('doubleChance'));
  assert.ok(keys.includes('drawNoBet'));
});

test('detectHandicapArbitrage checks Asian Handicap and ignores European Handicap', () => {
  // 1. Asian Handicap (2-way) should be detected if there is an edge
  const asianEvent = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { asianHandicap_plus_0_5: { home: 2.1, away: 1.8 } } },
      { name: 'BookB', markets: { asianHandicap_plus_0_5: { home: 1.9, away: 2.1 } } },
    ],
  });
  const asianArbs = detectHandicapArbitrage(asianEvent);
  assert.strictEqual(asianArbs.length, 1);
  assert.strictEqual(asianArbs[0].marketKey, 'asianHandicap_plus_0_5');
  assert.ok(asianArbs[0].edge > 0);

  // 2. European Handicap (3-way) with draw should be bypassed in detectHandicapArbitrage
  const europeanEvent = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { handicap_minus_1: { home: 2.2, draw: 3.4, away: 2.6 } } },
      { name: 'BookB', markets: { handicap_minus_1: { home: 2.1, draw: 3.5, away: 2.8 } } },
    ],
  });
  const europeanArbs = detectHandicapArbitrage(europeanEvent);
  assert.strictEqual(europeanArbs.length, 0, 'European Handicap with draw outcome should be skipped');
});

test('detectValueBet computes proper overround-based consensus fair odds', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
      { name: 'BookB', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
      { name: 'BookC', markets: { h2h: { home: 2.0, draw: 3.2, away: 4.0 } } },
      { name: 'BookD', markets: { h2h: { home: 2.0, draw: 3.2, away: 5.0 } } }, // outlier
    ],
  });

  const vb = detectValueBet(event, 'h2h');
  assert.ok(vb);
  assert.strictEqual(vb.outcome, 'away');
  assert.strictEqual(vb.consensus, 4.0);
  // Fair probability: (1 / 4.0) / (1/2.0 + 1/3.2 + 1/4.0) = 0.25 / (0.5 + 0.3125 + 0.25) = 0.25 / 1.0625 = 0.235294
  // Fair odds: 1 / 0.235294 = 4.25
  assert.strictEqual(Number(vb.fairOdds.toFixed(4)), 4.25);
  // Kelly stake: (b * p - q) / b where b = 5.0 - 1 = 4, p = 0.235294, q = 1 - p = 0.764706
  // Kelly = (4 * 0.235294 - 0.764706) / 4 = (0.941176 - 0.764706) / 4 = 0.0441176
  assert.strictEqual(Number(vb.kelly.toFixed(4)), 0.0441);
});

test('detectCrossMarketArbitrage finds EU↔Asian same-line O/U edges', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          totalGoals_2_5: { over: 2.2, under: 1.7 },
          asianTotalGoals_2_5: { over: 1.75, under: 2.15 },
        },
      },
      {
        name: 'BookB',
        markets: {
          totalGoals_2_5: { over: 1.8, under: 2.0 },
          asianTotalGoals_2_5: { over: 2.05, under: 1.8 },
        },
      },
    ],
  });
  // best over 2.2 (euro A) + best under 2.15 (asian A) same book → skipped;
  // best over 2.2 (A euro) + best under 2.0 (B euro) or cross: over 2.2 + under 2.15 need multi-book
  // BookA over euro 2.2 + BookB under asian 1.8? under 2.15 from A asian, under 2.0 from B euro
  // best over = 2.2 BookA, best under = 2.15 BookA asian — same book skipped
  // candidates include asian over 2.05 BookB + euro under 2.0 BookB same book skip
  // euro over 2.2 A + euro under 2.0 B = edge
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => String(item.marketKey).startsWith('cross_eu_as_ou_goals_2_5')));
});

test('detectCrossMarketArbitrage finds DNB Home + X2 soft cover', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { drawNoBet: { home: 1.85, away: 2.0 }, doubleChance: { homeDraw: 1.3, homeAway: 1.25, drawAway: 2.1 } } },
      { name: 'BookB', markets: { drawNoBet: { home: 1.8, away: 2.1 }, doubleChance: { homeDraw: 1.28, homeAway: 1.22, drawAway: 2.25 } } },
    ],
  });
  // best DNB home 1.85 + best X2 2.25 → 1/1.85 + 1/2.25 < 1
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_dnb_home_x2'));
});

test('detectCrossMarketArbitrage finds 1X2 Home + DNB Away soft cover', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { h2h: { home: 2.2, draw: 3.2, away: 3.1 }, drawNoBet: { home: 1.6, away: 2.3 } } },
      { name: 'BookB', markets: { h2h: { home: 2.1, draw: 3.3, away: 3.2 }, drawNoBet: { home: 1.55, away: 2.15 } } },
    ],
  });
  // best home 2.2 + best DNB away 2.3 → 1/2.2 + 1/2.3 < 1
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_h2h_home_dnb_away'));
});

test('detectCrossMarketArbitrage finds 1H 1X2 + 1H DNB mirror cover', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          firstHalfH2h: { home: 2.3, draw: 2.2, away: 3.4 },
          firstHalfDrawNoBet: { home: 1.7, away: 2.2 },
        },
      },
      {
        name: 'BookB',
        markets: {
          firstHalfH2h: { home: 2.2, draw: 2.25, away: 3.5 },
          firstHalfDrawNoBet: { home: 1.65, away: 2.05 },
        },
      },
    ],
  });
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_1H_h2h_home_dnb_away'));
});

test('detectCrossMarketArbitrage finds Home CS No + Away No Score cover', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          market_clean_sheet_home: { yes: 2.4, no: 1.65 },
          market_marcheaza_away: { yes: 1.5, no: 2.6 },
        },
      },
      {
        name: 'BookB',
        markets: {
          market_clean_sheet_home: { yes: 2.3, no: 1.55 },
          market_marcheaza_away: { yes: 1.45, no: 2.8 },
        },
      },
    ],
  });
  // best home CS no 1.65 + best away no score 2.8 → 1/1.65 + 1/2.8 < 1
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_home_cs_no_vs_away_ns'));
});

test('detectCrossMarketArbitrage finds home-score vs away clean-sheet cover', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          market_marcheaza_home: { yes: 1.55, no: 2.4 },
          market_clean_sheet_away: { yes: 3.4, no: 1.28 },
        },
      },
      {
        name: 'BookB',
        markets: {
          market_marcheaza_home: { yes: 1.48, no: 2.5 },
          market_clean_sheet_away: { yes: 3.1, no: 1.32 },
        },
      },
    ],
  });
  // best home yes 1.55 + best away CS yes 3.4 → 1/1.55 + 1/3.4 < 1
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_home_score_vs_away_cs'));
});

test('detectCrossMarketArbitrage merges AH0 with DNB for soft two-way edges', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          drawNoBet: { home: 1.7, away: 2.1 },
          asianHandicap_0: { home: 1.65, away: 2.25 },
        },
      },
      {
        name: 'BookB',
        markets: {
          drawNoBet: { home: 1.55, away: 2.35 },
          asianHandicap_0: { home: 1.8, away: 2.0 },
        },
      },
    ],
  });
  // Merged home 1.8 (AH0 B) + merged away 2.35 (DNB B) → 1/1.8 + 1/2.35 ≈ 0.981
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_dnb_ah0_merged'));
  assert.ok(results.some((item) => item.marketKey === 'cross_ah0_home_dnb_away'));
});

test('detectCrossMarketArbitrage finds team-score vs team-total 0.5 identity covers', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          market_marcheaza_home: { yes: 1.7, no: 2.2 },
          market_total_goluri_home_0_5: { over: 1.55, under: 2.4 },
          market_clean_sheet_home: { yes: 2.15, no: 1.7 },
          market_total_goluri_away_0_5: { over: 1.65, under: 2.2 },
        },
      },
      {
        name: 'BookB',
        markets: {
          market_marcheaza_home: { yes: 1.6, no: 2.3 },
          market_total_goluri_home_0_5: { over: 1.5, under: 2.9 },
          market_clean_sheet_home: { yes: 2.05, no: 1.75 },
          market_total_goluri_away_0_5: { over: 2.05, under: 1.8 },
        },
      },
    ],
  });
  // Home scores Yes 1.7 + Home Under 0.5 2.9 → edge ~6.7%
  // Home CS Yes 2.15 + Away Over 0.5 2.05 → edge ~2.7%
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_home_score_yes_vs_home_under_0_5'));
  assert.ok(results.some((item) => item.marketKey === 'cross_home_cs_yes_vs_away_over_0_5'));
});

test('detectCrossMarketArbitrage surfaces to-qualify vs match soft pairs', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { toQualify: { home: 1.55, away: 2.4 }, h2h: { home: 2.1, draw: 3.2, away: 3.4 } } },
      { name: 'BookB', markets: { toQualify: { home: 1.5, away: 2.6 }, h2h: { home: 2.05, draw: 3.1, away: 2.15 } } },
    ],
  });
  const results = detectCrossMarketArbitrage(event);
  assert.ok(results.some((item) => item.marketKey === 'cross_qualify_home_match_away'));
});

test('detectCrossMarketArbitrage finds BTTS No + Over 1.5 soft cover', () => {
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { bothTeamsToScore: { yes: 1.9, no: 2.4 }, totalGoals_1_5: { over: 1.55, under: 2.4 } } },
      { name: 'BookB', markets: { bothTeamsToScore: { yes: 1.85, no: 2.1 }, totalGoals_1_5: { over: 2.05, under: 1.8 } } },
    ],
  });
  // best no 2.4 + best over 2.05 → 1/2.4 + 1/2.05 < 1
  const results = detectCrossMarketArbitrage(event);
  const hit = results.find((item) => item.marketKey === 'cross_btts_no_over_1_5');
  assert.ok(hit, 'should emit BTTS No + Over 1.5');
  assert.ok(hit.edge > 0);
});

test('detectCrossMarketArbitrage finds first-half 1X2 vs double-chance edges', () => {
  const event = makeEvent({
    bookmakers: [
      {
        name: 'BookA',
        markets: {
          firstHalfH2h: { home: 3.1, draw: 2.4, away: 3.4 },
          firstHalfDoubleChance: { homeDraw: 1.35, homeAway: 1.45, drawAway: 1.4 },
        },
      },
      {
        name: 'BookB',
        markets: {
          firstHalfH2h: { home: 2.9, draw: 2.5, away: 3.6 },
          firstHalfDoubleChance: { homeDraw: 1.42, homeAway: 1.38, drawAway: 1.5 },
        },
      },
    ],
  });

  const opportunities = detectCrossMarketArbitrage(event);
  assert.ok(opportunities.some((item) => item.marketKey.startsWith('cross_1H_')));
});

test('detectBttsTeamScoreArbitrage finds edge from BTTS and Team clean sheets', () => {
  // BTTS Yes: 2.2, Home No: 4.0, Away No: 4.0
  // 1/2.2 + 1/4.0 + 1/4.0 = 0.954 < 1 (edge)
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { bothTeamsToScore: { yes: 2.2 } } },
      { name: 'BookB', markets: { market_marcheaza_home: { no: 4.0 } } },
      { name: 'BookC', markets: { market_total_goluri_away_0_5: { under: 4.0 } } },
    ],
  });

  const results = detectBttsTeamScoreArbitrage(event);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].marketKey, 'cross_btts_team_score');
  assert.ok(results[0].edge > 0);
  assert.strictEqual(results[0].legs.length, 3);
  assert.strictEqual(results[0].legs[0].bookmaker, 'BookA');
  assert.strictEqual(results[0].legs[1].bookmaker, 'BookB');
  assert.strictEqual(results[0].legs[2].bookmaker, 'BookC');
});

test('detectTeamMatchTotalArbitrage finds edge from team totals vs match totals', () => {
  // Match Over 2.5: 2.2, Home Under 1.5: 4.0, Away Under 1.5: 4.0
  // 1/2.2 + 1/4.0 + 1/4.0 = 0.954 < 1 (edge)
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { totalGoals_2_5: { over: 2.2 } } },
      { name: 'BookB', markets: { market_total_goluri_home_1_5: { under: 4.0 } } },
      { name: 'BookC', markets: { market_total_goluri_away_1_5: { under: 4.0 } } },
    ],
  });

  const results = detectTeamMatchTotalArbitrage(event);
  assert.strictEqual(results.length, 1);
  assert.ok(results[0].marketKey.startsWith('cross_totals_totalGoals_2_5_'));
  assert.ok(results[0].edge > 0);
  assert.strictEqual(results[0].legs.length, 3);
});
