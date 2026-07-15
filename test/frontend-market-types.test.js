const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

let modulePromise;

function loadMarketTypes() {
  if (!modulePromise) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'market-types.js'), 'utf8');
    modulePromise = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  }
  return modulePromise;
}

test('classifies stable scanner market groups', async () => {
  const { classifyOpportunityMarketType } = await loadMarketTypes();

  assert.equal(classifyOpportunityMarketType({ marketKey: 'h2h', marketLabel: 'Winner, 1X2' }), 'result');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'doubleChance_1x', marketLabel: 'Double Chance' }), 'doubleChance');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'drawNoBet_home', marketLabel: 'Draw No Bet' }), 'drawNoBet');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'bothTeamsToScore_yes', marketLabel: 'BTTS' }), 'btts');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'totalGoals_2_5', marketLabel: 'Total Goluri 2.5' }), 'goalsTotals');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'totalCorners_8_5', marketLabel: 'Corners 8.5' }), 'cornersTotals');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'totalCards_4_5', marketLabel: 'Yellow cards 4.5' }), 'cardsTotals');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'asianHandicap_plus_0_5', marketLabel: 'Asian Handicap' }), 'handicap');
  assert.equal(classifyOpportunityMarketType({ marketKey: 'totalGoluriHome_1_5', marketLabel: 'Team goals home' }), 'teamGoals');
  assert.equal(classifyOpportunityMarketType({ type: 'cross-market', marketKey: 'h2h_total' }), 'crossMarket');
  assert.equal(classifyOpportunityMarketType({
    type: 'settlement-formula',
    formulaFamily: 'result-handicap',
    marketKey: 'formula_ah1_0_x_2',
  }), 'crossMarket');
  assert.equal(classifyOpportunityMarketType({
    type: 'settlement-formula',
    formulaFamily: 'totals-band',
    marketKey: 'formula_totals_2_over_integer',
  }), 'goalsTotals');
  assert.equal(classifyOpportunityMarketType({
    type: 'settlement-formula',
    formulaFamily: 'totals-corridor',
    marketKey: 'formula_totals_corridor_p2_p2_5',
  }), 'goalsTotals');
  assert.equal(classifyOpportunityMarketType({
    type: 'settlement-formula',
    formulaFamily: 'asian-total-pair',
    marketKey: 'formula_asian_total_pair_p2_25',
  }), 'goalsTotals');
});

test('uses leg market context for middle opportunities', async () => {
  const { classifyOpportunityMarketType } = await loadMarketTypes();

  assert.equal(classifyOpportunityMarketType({
    type: 'middle',
    marketKey: 'middle_total',
    legs: [
      { label: 'Over 2.5', marketKey: 'totalGoals_2_5' },
      { label: 'Under 3.5', marketKey: 'totalGoals_3_5' },
    ],
  }), 'goalsTotals');
});

test('does not classify by price-only signals', async () => {
  const { classifyOpportunityMarketType } = await loadMarketTypes();

  assert.equal(classifyOpportunityMarketType({
    marketKey: '',
    marketLabel: '',
    legs: [{ price: 1.58 }],
  }), 'other');
});
