'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdditionalFormulaDefinitions,
  createSettlementFormulaDefinitions,
  detectSettlementFormulaArbitrage,
  maximizeMinimumReturn,
  settlementReturnMultiplier,
  splitAsianLine,
} = require('../src/engine/arbitrage/settlement-formula-scanner');
const {
  detectQuarterHandicapArbitrage,
} = require('../src/engine/arbitrage/quarter-handicap-scanner');
const { getAllOpportunities } = require('../src/engine/formula-engine');

function bookmaker(name, markets) {
  return {
    name,
    eventUrl: `https://example.test/${name.toLowerCase().replace(/\s+/g, '-')}`,
    sourceStartsAt: '2026-07-20T18:00:00.000Z',
    verification: { status: 'verified' },
    markets,
  };
}

function eventWithMarkets(bookmakers) {
  return {
    homeTeam: 'Matrix FC',
    awayTeam: 'Boundary United',
    competition: 'Formula Test League',
    startsAt: '2026-07-20T18:00:00.000Z',
    sport: 'football',
    bookmakers,
  };
}

test('splitAsianLine expands quarter lines and leaves whole or half lines intact', () => {
  assert.deepEqual(splitAsianLine(-0.25), [-0.5, 0]);
  assert.deepEqual(splitAsianLine(0.25), [0, 0.5]);
  assert.deepEqual(splitAsianLine(2.25), [2, 2.5]);
  assert.deepEqual(splitAsianLine(1.5), [1.5]);
});

test('settlementReturnMultiplier models half-loss, push, and half-win returns', () => {
  assert.equal(settlementReturnMultiplier(
    { kind: 'handicap', side: 'home', line: -0.25 },
    { goalDifference: 0 },
    2,
  ), 0.5);
  assert.equal(settlementReturnMultiplier(
    { kind: 'handicap', side: 'home', line: 0.25 },
    { goalDifference: 0 },
    2,
  ), 1.5);
  assert.equal(settlementReturnMultiplier(
    { kind: 'totalGoals', outcome: 'over', line: 2.25 },
    { totalGoals: 2 },
    2,
  ), 0.5);
  assert.equal(settlementReturnMultiplier(
    { kind: 'totalGoals', outcome: 'under', line: 2.25 },
    { totalGoals: 2 },
    2,
  ), 1.5);
  assert.equal(settlementReturnMultiplier(
    { kind: 'handicap', side: 'away', line: 0 },
    { goalDifference: 0 },
    2,
  ), 1);
});

test('maximizeMinimumReturn produces the maximin stake split', () => {
  const solution = maximizeMinimumReturn([
    [2, 0],
    [0, 2],
  ]);
  assert.ok(solution);
  assert.deepEqual(solution.stakes.map((stake) => Number(stake.toFixed(6))), [0.5, 0.5]);
  assert.equal(Number(solution.minimumReturn.toFixed(6)), 1);
});

test('createSettlementFormulaDefinitions includes every formula shown in the selector', () => {
  const labels = new Set(createSettlementFormulaDefinitions({ totalsAnchors: [2] }).map((formula) => formula.label));
  const expected = [
    'AH1(0) - X - 2',
    'AH2(0) - X - 1',
    'AH1(0) - X2 - 2',
    'AH2(0) - 1X - 1',
    'Over 2 - Under 2.5 - Under 1.5',
    'Under 2 - Over 1.5 - Over 2.5',
    'AH1(-0.25) - X - 2',
    'AH2(-0.25) - X - 1',
    'AH1(-0.25) - X2 - 2',
    'AH2(-0.25) - 1X - 1',
    'Over 2.25 - Under 2.5 - Under 1.5',
    'Under 1.75 - Over 1.5 - Over 2.5',
    'AH1(+0.25) - X - 2',
    'AH2(+0.25) - X - 1',
    'AH1(+0.25) - X2 - 2',
    'AH2(+0.25) - 1X - 1',
    'Over 1.75 - Under 2.5 - Under 1.5',
    'Under 2.25 - Over 1.5 - Over 2.5',
    'AH1(-0.25) - X - AH2(0)',
  ];
  for (const label of expected) assert.equal(labels.has(label), true, `missing ${label}`);
});

test('createAdditionalFormulaDefinitions builds exhaustive substitution, corridor, and Asian-pair families', () => {
  const definitions = createAdditionalFormulaDefinitions({
    handicapLines: [-0.5, -0.25, 0, 0.25, 0.5],
    totalLines: [2, 2.25, 2.5],
  });
  const labels = new Set(definitions.map((definition) => definition.label));

  for (const label of [
    '1 - X - AH2(0)',
    '2 - AH1(+0.5)',
    'X - AH1(-0.5) - AH2(-0.5)',
    '1X - AH2(-0.5)',
    'AH1(-0.25) - X2',
    'AH1(-0.25) - AH2(+0.25)',
    'Over 2.25 - Under 2.25',
    'Over 2 - Under 2.5',
  ]) {
    assert.equal(labels.has(label), true, `missing ${label}`);
  }

  assert.equal(labels.has('Over 2 - Under 2'), false, 'a shared whole-line push cannot guarantee profit');
  assert.equal(labels.has('AH1(+0.5) - AH2(-0.5)'), false, 'classic half-line arb already owns this pair');
});

test('detectSettlementFormulaArbitrage resolves exact result and handicap lines', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { asianHandicap_0: { home: 2.8 } }),
    bookmaker('Book B', { h2h: { draw: 2.8 } }),
    bookmaker('Book C', { h2h: { away: 2.8 } }),
  ]);
  const opportunities = detectSettlementFormulaArbitrage(event, {
    definitionOptions: { handicapLines: [0], bridgeLines: [], totalsAnchors: [] },
  });
  const opportunity = opportunities.find((item) => item.marketLabel === 'AH1(0) - X - 2');

  assert.ok(opportunity);
  assert.equal(opportunity.settlementModel, 'score-state-matrix-v1');
  assert.equal(opportunity.coverageVerified, true);
  assert.equal(opportunity.legs.length, 3);
  assert.equal(Number(opportunity.legs.reduce((sum, leg) => sum + leg.stake, 0).toFixed(6)), 100);
  assert.ok(opportunity.scenarioReturns.every((scenario) => scenario.returnAmount >= opportunity.minimumReturn - 1e-7));
});

test('detectSettlementFormulaArbitrage validates totals formulas at every goal boundary', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { totalGoals_2: { over: 2.1 } }),
    bookmaker('Book B', { totalGoals_2_5: { under: 2.1 } }),
    bookmaker('Book C', { totalGoals_1_5: { under: 2.1 } }),
  ]);
  const opportunities = detectSettlementFormulaArbitrage(event, {
    definitionOptions: { handicapLines: [], bridgeLines: [], totalsAnchors: [2] },
  });
  const opportunity = opportunities.find((item) => item.marketLabel === 'Over 2 - Under 2.5 - Under 1.5');

  assert.ok(opportunity);
  assert.deepEqual(opportunity.scenarioReturns.map((scenario) => scenario.scenario), [
    '0 total goals',
    '1 total goal',
    '2 total goals',
    '3 total goals',
    '4 total goals',
    '5 total goals',
    '6 total goals',
  ]);
  assert.ok(opportunity.scenarioReturns.every((scenario) => scenario.profit > 0));
});

test('detectSettlementFormulaArbitrage finds result and half-handicap substitutions', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { h2h: { home: 2.1 } }),
    bookmaker('Book B', { asianHandicap_minus_0_5: { away: 2.1 } }),
  ]);
  const opportunity = detectSettlementFormulaArbitrage(event)
    .find((item) => item.marketLabel === '1 - AH2(+0.5)');

  assert.ok(opportunity);
  assert.equal(opportunity.formulaFamily, 'result-half-handicap');
  assert.equal(Number(opportunity.minimumReturn.toFixed(6)), 105);
  assert.ok(opportunity.scenarioReturns.every((scenario) => scenario.profit > 0));
});

test('detectSettlementFormulaArbitrage finds corner total corridors via shared count model', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { totalCorners_9: { over: 2.2 } }),
    bookmaker('Book B', { totalCorners_9_5: { under: 2 } }),
  ]);
  const opportunity = detectSettlementFormulaArbitrage(event)
    .find((item) => item.marketLabel === 'Corners Over 9 - Under 9.5' || item.marketLabel === 'Over 9 - Under 9.5');
  assert.ok(opportunity, 'corner lines should enter the totals catalog for corridor formulas');
  assert.ok(opportunity.edge > 0);
});

test('detectSettlementFormulaArbitrage does not mix goals Over with corners Under', () => {
  // Same numeric line, different families — must not form a false corridor.
  const event = eventWithMarkets([
    bookmaker('Book A', { totalGoals_8_5: { over: 2.2 } }),
    bookmaker('Book B', { totalCorners_8_5: { under: 2.2 } }),
  ]);
  const opportunities = detectSettlementFormulaArbitrage(event);
  const mixed = opportunities.find((item) => {
    const keys = (item.legs || []).map((leg) => leg.marketKey || '');
    return keys.some((k) => k.includes('Goals') || k.includes('goals'))
      && keys.some((k) => k.includes('Corners') || k.includes('corners'));
  });
  assert.equal(mixed, undefined, 'goals and corners must not share a settlement pair');
});

test('detectSettlementFormulaArbitrage uses DNB prices as AH0 catalog legs', () => {
  // 1 - X - AH2(0) lives in resultSubstitutionDefinitions (additional families).
  const event = eventWithMarkets([
    bookmaker('Book A', { h2h: { home: 2.8 } }),
    bookmaker('Book B', { h2h: { draw: 3.2 } }),
    bookmaker('Book C', { drawNoBet: { away: 3.2 } }),
  ]);
  const dnbOpp = detectSettlementFormulaArbitrage(event, {
    definitionOptions: { handicapLines: [], bridgeLines: [], totalsAnchors: [] },
    additionalDefinitionOptions: {
      handicapLines: [0],
      totalLines: [],
      handicapDoubleChanceLines: [],
      halfHandicapLines: [],
    },
  }).find((item) => item.formulaId === 'result_home_x_ah2_0' || item.marketLabel === '1 - X - AH2(0)');
  assert.ok(dnbOpp, 'DNB away should supply AH0 away for result-dnb formulas');
  assert.ok(dnbOpp.legs.some((leg) => leg.marketKey === 'drawNoBet'));
});

test('detectSettlementFormulaArbitrage uses first-half totals in corridor catalog', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { firstHalfTotalGoals_1: { over: 2.2 } }),
    bookmaker('Book B', { firstHalfTotalGoals_1_5: { under: 2 } }),
  ]);
  const opportunity = detectSettlementFormulaArbitrage(event)
    .find((item) => item.marketLabel === 'Over 1 - Under 1.5');
  assert.ok(opportunity, 'period goal lines should enter the goals count catalog');
  assert.ok(opportunity.edge > 0);
});

test('detectSettlementFormulaArbitrage finds guaranteed totals corridors', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { totalGoals_2: { over: 2.2 } }),
    bookmaker('Book B', { totalGoals_2_5: { under: 2 } }),
  ]);
  const opportunity = detectSettlementFormulaArbitrage(event)
    .find((item) => item.marketLabel === 'Over 2 - Under 2.5');

  assert.ok(opportunity);
  assert.equal(opportunity.formulaFamily, 'totals-corridor');
  assert.ok(opportunity.scenarioReturns.find((scenario) => scenario.scenario === '2 total goals').profit > opportunity.profit);
  assert.ok(opportunity.scenarioReturns.every((scenario) => scenario.profit > 0));
});

test('detectSettlementFormulaArbitrage finds opposing quarter-line Asian pairs', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { asianHandicap_minus_0_25: { home: 2.2 } }),
    bookmaker('Book B', { asianHandicap_minus_0_25: { away: 2.2 } }),
    bookmaker('Book C', { totalGoals_2_25: { over: 2.2 } }),
    bookmaker('Book D', { totalGoals_2_25: { under: 2.2 } }),
  ]);
  const opportunities = detectSettlementFormulaArbitrage(event);
  const handicap = opportunities.find((item) => item.marketLabel === 'AH1(-0.25) - AH2(+0.25)');
  const total = opportunities.find((item) => item.marketLabel === 'Over 2.25 - Under 2.25');

  assert.ok(handicap);
  assert.ok(total);
  assert.equal(Number(handicap.minimumReturn.toFixed(6)), 106.666667);
  assert.equal(Number(total.minimumReturn.toFixed(6)), 106.666667);
});

test('detectQuarterHandicapArbitrage delegates quarter lines to the settlement matrix', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { asianHandicap_minus_0_25: { home: 3 } }),
    bookmaker('Book B', { h2h: { draw: 2.8 } }),
    bookmaker('Book C', { h2h: { away: 2.8 } }),
  ]);
  const opportunities = detectQuarterHandicapArbitrage(event, {
    definitionOptions: { handicapLines: [-0.25], bridgeLines: [], totalsAnchors: [] },
  });
  assert.ok(opportunities.some((item) => item.marketLabel === 'AH1(-0.25) - X - 2'));
  assert.ok(opportunities.every((item) => item.settlementModel === 'score-state-matrix-v1'));
});

test('getAllOpportunities finalizes verified matrix formulas for the scanner', () => {
  const event = eventWithMarkets([
    bookmaker('Book A', { asianHandicap_0: { home: 2.8 } }),
    bookmaker('Book B', { h2h: { draw: 2.8 } }),
    bookmaker('Book C', { h2h: { away: 2.8 } }),
  ]);
  const opportunity = getAllOpportunities([event])
    .find((item) => item.marketLabel === 'AH1(0) - X - 2');

  assert.ok(opportunity);
  assert.equal(opportunity.eligibility, 'actionable');
  assert.equal(opportunity.settlementScope, 'fulltime-score-matrix');
  assert.equal(opportunity.eventName, 'Matrix FC vs Boundary United');
});
