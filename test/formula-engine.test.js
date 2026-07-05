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

test('detectArbitrage accepts generic market with reasonable edge', () => {
  // Generic 2-way market with a real edge (~4.8%)
  const event = makeEvent({
    bookmakers: [
      { name: 'BookA', markets: { market_custom: { home: 2.1, away: 2.1 } } },
      { name: 'BookB', markets: { market_custom: { home: 2.0, away: 2.0 } } },
    ],
  });

  const arb = detectArbitrage(event, 'market_custom');
  assert.ok(arb, 'should detect arb on generic market with reasonable edge');
  assert.ok(arb.edge > 0 && arb.edge <= 0.25);
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
