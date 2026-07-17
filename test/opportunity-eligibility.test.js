'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachOpportunityEligibility,
  evaluateOpportunityEligibility,
  isHalfLineMarket,
  isScannableHandicapMarket,
  isSupportedClassicMarket,
  isSupportedHandicapMarket,
  normalizeVerificationStatus,
} = require('../src/engine/opportunity-eligibility');

function verifiedOpportunity(overrides = {}) {
  return {
    type: 'classic',
    marketKey: 'bothTeamsToScore',
    edge: 0.03,
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'verified' },
      { bookmaker: 'Book B', verificationStatus: 'verified' },
    ],
    ...overrides,
  };
}

test('normalizeVerificationStatus uses a conservative unverified fallback', () => {
  assert.equal(normalizeVerificationStatus(), 'unverified');
  assert.equal(normalizeVerificationStatus('Verified'), 'verified');
  assert.equal(normalizeVerificationStatus('not found'), 'not_found');
  assert.equal(normalizeVerificationStatus('not-found'), 'not_found');
});

test('isHalfLineMarket accepts half lines and rejects integer or quarter lines', () => {
  assert.equal(isHalfLineMarket('totalGoals_2_5'), true);
  assert.equal(isHalfLineMarket('totalGoals_2'), false);
  assert.equal(isHalfLineMarket('asianTotalGoals_2_25'), false);
});

test('isSupportedClassicMarket only approves explicit exhaustive schemas', () => {
  assert.equal(isSupportedClassicMarket('h2h'), true);
  assert.equal(isSupportedClassicMarket('totalGoals_2_5'), true);
  assert.equal(isSupportedClassicMarket('doubleChance'), false);
  assert.equal(isSupportedClassicMarket('market_custom'), false);
  assert.equal(isSupportedClassicMarket('totalPoints_224_5'), true);
  assert.equal(isSupportedClassicMarket('totalGames_22_5'), true);
  assert.equal(isSupportedClassicMarket('toQualify'), true);
  assert.equal(isSupportedClassicMarket('market_marcheaza_home'), true);
  assert.equal(isSupportedClassicMarket('totalGoals_2'), false);
  assert.equal(isSupportedClassicMarket('market_total_goluri_home_1_5'), true);
  assert.equal(isSupportedClassicMarket('market_total_goluri_away_0_5'), true);
  assert.equal(isSupportedClassicMarket('market_total_goluri_home_1'), false);
});

test('push-settlement math candidates stay in review instead of rejected', () => {
  const integerTotal = evaluateOpportunityEligibility({
    type: 'classic',
    marketKey: 'totalGoals_2',
    edge: 0.03,
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'unverified' },
      { bookmaker: 'Book B', verificationStatus: 'unverified' },
    ],
  });
  assert.equal(integerTotal.eligibility, 'review');
  assert.ok(integerTotal.eligibilityReasonCodes.includes('push_settlement'));
  assert.ok(integerTotal.eligibilityReasonCodes.includes('verification_missing'));
});

test('edge outliers stay in review even when every leg is verified', () => {
  const outlier = evaluateOpportunityEligibility({
    type: 'classic',
    marketKey: 'h2h',
    edge: 0.12,
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'verified' },
      { bookmaker: 'Book B', verificationStatus: 'verified' },
      { bookmaker: 'Book C', verificationStatus: 'verified' },
    ],
  });
  assert.equal(outlier.eligibility, 'review');
  assert.ok(outlier.eligibilityReasonCodes.includes('edge_outlier'));
});

test('h2h vs AH half-line cross formulas are structurally safe', () => {
  const opp = evaluateOpportunityEligibility({
    type: 'cross-market',
    marketKey: 'cross_h2h_home_ah2_plus_0_5',
    edge: 0.03,
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'verified' },
      { bookmaker: 'Book B', verificationStatus: 'verified' },
    ],
  });
  assert.equal(opp.structuralStatus, 'approved');

  const discovered = evaluateOpportunityEligibility({
    type: 'cross-market',
    marketKey: 'cross_h2h_home_ah2_plus_3_5',
    edge: 0.03,
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'verified' },
      { bookmaker: 'Book B', verificationStatus: 'verified' },
    ],
  });
  assert.equal(discovered.structuralStatus, 'approved');
});

test('team vs match totals cross formulas are structurally safe', () => {
  const {
    isSafeCrossMarket,
  } = require('../src/engine/opportunity-eligibility');
  assert.equal(isSafeCrossMarket('cross_totals_totalGoals_2_5_market_total_goluri_home_1_5_market_total_goluri_away_1_5'), true);
  assert.equal(isSafeCrossMarket('cross_totals_inv_totalGoals_2_5_x_y'), true);
  assert.equal(isSafeCrossMarket('cross_btts_team_score'), true);
  assert.equal(isSafeCrossMarket('cross_qualify_home_match_away'), false);

  const totalsCross = evaluateOpportunityEligibility({
    type: 'cross-market',
    marketKey: 'cross_totals_totalGoals_2_5_market_total_goluri_home_1_5_market_total_goluri_away_1_5',
    edge: 0.03,
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'unverified' },
      { bookmaker: 'Book B', verificationStatus: 'unverified' },
      { bookmaker: 'Book C', verificationStatus: 'unverified' },
    ],
  });
  assert.equal(totalsCross.eligibility, 'review');
  assert.equal(totalsCross.structuralStatus, 'approved');
});

test('isSupportedHandicapMarket only approves two-way half lines', () => {
  assert.equal(isSupportedHandicapMarket('asianHandicap_plus_0_5'), true);
  assert.equal(isSupportedHandicapMarket('handicap_minus_1'), false);
  // Zero-line AH is scannable for candidates but not actionable (push on draw).
  assert.equal(isScannableHandicapMarket('asianHandicap_0'), true);
  assert.equal(isScannableHandicapMarket('handicap_0'), true);
  assert.equal(isSupportedHandicapMarket('asianHandicap_0'), false);
  assert.equal(isSupportedHandicapMarket('asianHandicap_plus_0'), false);
});

test('zero-line AH candidates stay in review as push settlement', () => {
  const zeroAh = evaluateOpportunityEligibility({
    type: 'handicap',
    marketKey: 'asianHandicap_0',
    edge: 0.03,
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'unverified' },
      { bookmaker: 'Book B', verificationStatus: 'unverified' },
    ],
  });
  assert.equal(zeroAh.eligibility, 'review');
  assert.ok(zeroAh.eligibilityReasonCodes.includes('push_settlement'));
});

test('evaluateOpportunityEligibility separates actionable, review, and rejected candidates', () => {
  assert.equal(evaluateOpportunityEligibility(verifiedOpportunity()).eligibility, 'actionable');
  assert.equal(evaluateOpportunityEligibility(verifiedOpportunity({
    legs: [
      { bookmaker: 'Book A' },
      { bookmaker: 'Book B', verificationStatus: 'verified' },
    ],
  })).eligibility, 'review');
  const rejected = evaluateOpportunityEligibility(verifiedOpportunity({
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'verified' },
      { bookmaker: 'Book A', verificationStatus: 'verified' },
    ],
  }));
  assert.equal(rejected.eligibility, 'rejected');
  assert.ok(rejected.eligibilityReasonCodes.includes('same_book'));
});

test('evaluateOpportunityEligibility approves only complete settlement formula matrices', () => {
  const settlementFormula = verifiedOpportunity({
    type: 'settlement-formula',
    marketKey: 'formula_ah1_0_x_2',
    stake: 100,
    minimumReturn: 103,
    settlementModel: 'score-state-matrix-v1',
    coverageVerified: true,
    scenarioReturns: [
      { scenario: 'home', returnAmount: 103 },
      { scenario: 'draw', returnAmount: 104 },
      { scenario: 'away', returnAmount: 103 },
    ],
    legs: [
      { bookmaker: 'Book A', verificationStatus: 'verified' },
      { bookmaker: 'Book B', verificationStatus: 'verified' },
      { bookmaker: 'Book C', verificationStatus: 'verified' },
    ],
  });
  assert.equal(evaluateOpportunityEligibility(settlementFormula).eligibility, 'actionable');

  const incomplete = evaluateOpportunityEligibility({
    ...settlementFormula,
    scenarioReturns: [],
  });
  assert.equal(incomplete.eligibility, 'rejected');
  assert.ok(incomplete.eligibilityReasonCodes.includes('incomplete_settlement_matrix'));
});

test('attachOpportunityEligibility writes decision metadata and confidence', () => {
  const opportunity = attachOpportunityEligibility(verifiedOpportunity());
  assert.equal(opportunity.eligibility, 'actionable');
  assert.equal(opportunity.confidence, 'trusted');
  assert.equal(opportunity.verifiedLegCount, 2);
});

test('correlated brand labels do not count as independent price evidence', () => {
  const result = evaluateOpportunityEligibility(verifiedOpportunity({
    legs: [
      { bookmaker: 'Stanleybet', feedGroup: 'nsoft:stanleybet-family', verificationStatus: 'verified' },
      { bookmaker: 'GameWorld', feedGroup: 'nsoft:stanleybet-family', verificationStatus: 'verified' },
    ],
  }));
  assert.equal(result.eligibility, 'rejected');
  assert.equal(result.independentFeedCount, 1);
  assert.ok(result.eligibilityReasonCodes.includes('same_feed'));
});

test('stale or unsynchronized verified quotes stay in review', () => {
  const stale = evaluateOpportunityEligibility(verifiedOpportunity({
    quoteTiming: { status: 'stale', actionable: false, maxAgeMs: 60_000, skewMs: 1_000 },
  }));
  assert.equal(stale.eligibility, 'review');
  assert.ok(stale.eligibilityReasonCodes.includes('quote_stale'));

  const skewed = evaluateOpportunityEligibility(verifiedOpportunity({
    quoteTiming: { status: 'skewed', actionable: false, maxAgeMs: 5_000, skewMs: 30_000 },
  }));
  assert.equal(skewed.eligibility, 'review');
  assert.ok(skewed.eligibilityReasonCodes.includes('quote_time_skew'));
});

test('missing kickoff evidence stays in review and mismatched kickoffs are rejected', () => {
  const missing = evaluateOpportunityEligibility(verifiedOpportunity({
    kickoffTiming: { status: 'missing', actionable: false },
  }));
  assert.equal(missing.eligibility, 'review');
  assert.equal(missing.kickoffsMatched, false);
  assert.ok(missing.eligibilityReasonCodes.includes('kickoff_missing'));

  const mismatched = evaluateOpportunityEligibility(verifiedOpportunity({
    kickoffTiming: { status: 'mismatched', actionable: false, skewMs: 600_000 },
  }));
  assert.equal(mismatched.eligibility, 'rejected');
  assert.equal(mismatched.kickoffsMatched, false);
  assert.ok(mismatched.eligibilityReasonCodes.includes('kickoff_mismatch'));
});
