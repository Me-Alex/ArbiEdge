/**
 * Confidence tier-based stake sizing.
 * Trusted: 2% of bankroll
 * Review: 1% of bankroll
 * Risky: 0.5% of bankroll
 */

const DEFAULT_TIERS = {
  trusted: 0.02,
  review: 0.01,
  risky: 0.005,
};

function sizeStakeByConfidence(edge, confidence, bankroll, tiers = DEFAULT_TIERS) {
  const pct = tiers[confidence] || tiers.review;
  const kellyFraction = edge * 4; // simplified Kelly
  const kellyCap = 0.025; // max 2.5% regardless
  const fraction = Math.min(pct, kellyCap, kellyFraction);
  return Math.round(bankroll * fraction);
}

function tierPercentages(tiers = DEFAULT_TIERS) {
  return { ...tiers };
}

module.exports = { sizeStakeByConfidence, tierPercentages, DEFAULT_TIERS };
