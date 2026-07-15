/**
 * Confidence tier-based and Fractional Kelly stake sizing algorithms.
 */

'use strict';

const DEFAULT_TIERS = {
  trusted: 0.02,
  review: 0.01,
  risky: 0.005,
};

function sizeStakeByConfidence(edge, confidence, bankroll, tiers = DEFAULT_TIERS) {
  const pct = tiers[confidence] || tiers.review;
  const kellyFraction = edge * 4;
  const kellyCap = 0.025;
  const fraction = Math.min(pct, kellyCap, kellyFraction);
  return Math.round(bankroll * fraction);
}

function calculateFractionalKellyStake({ odds, fairProbability, bankroll, fraction = 0.25, maxCap = 0.05 }) {
  if (!odds || odds <= 1 || !fairProbability || fairProbability <= 0 || fairProbability >= 1) {
    return 0;
  }
  const b = odds - 1;
  const p = fairProbability;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  if (fullKelly <= 0) return 0;
  const adjustedFraction = Math.min(fullKelly * fraction, maxCap);
  return Math.round(bankroll * adjustedFraction * 100) / 100;
}

function tierPercentages(tiers = DEFAULT_TIERS) {
  return { ...tiers };
}

module.exports = {
  sizeStakeByConfidence,
  calculateFractionalKellyStake,
  tierPercentages,
  DEFAULT_TIERS,
};
